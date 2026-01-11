/**
 * نظام سُمعة (RepuSystem) - النسخة v4.6 (النسخة العالمية الهجينة)
 * التحديث: إضافة واجهة إرسال يدوية مدمجة في صفحة الحالة لخدمة المطاعم التي لا تملك نظام ربط آلي.
 * الخصوصية: نظام التشفير ومنع المجموعات لا يزال مفعلاً بأعلى المعايير.
 */

require('dotenv').config();
const express = require('express');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// --- إعدادات CORS الشاملة ---
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// --- نظام مراقبة الأخطاء ---
process.on('unhandledRejection', (reason) => {
    if (reason && reason.toString().includes('Bad MAC')) {
        console.error('⚠️ [Security] تلف مفاتيح التشفير.');
    }
});
process.on('uncaughtException', (err) => {
    console.error('❌ خطأ غير متوقع:', err.message);
    if (err.message.includes('Bad MAC') || err.message.includes('405')) {
        clearInvalidSession().then(() => process.exit(1));
    }
});

// --- إعدادات MongoDB ---
let MongoClient;
try { MongoClient = require('mongodb').MongoClient; } catch (e) {}

const MONGO_URL = process.env.MONGO_URL;
let client = null;
let dbConnected = false;

const initMongo = async () => {
    if (typeof MONGO_URL === 'string' && MONGO_URL.trim().startsWith('mongodb')) {
        try {
            client = new MongoClient(MONGO_URL.trim(), { connectTimeoutMS: 15000 });
            await client.connect();
            dbConnected = true;
            console.log("🔗 [MongoDB] تم الربط السحابي.");
        } catch (e) {
            console.error(`⚠️ [MongoDB] فشل الاتصال: ${e.message}`);
        }
    }
};

const SESSION_PATH = 'auth_new_session';

async function syncSessionToMongo() {
    if (!client || !dbConnected) return;
    try {
        const credsPath = path.join(SESSION_PATH, 'creds.json');
        if (fs.existsSync(credsPath)) {
            const credsData = fs.readFileSync(credsPath, 'utf-8');
            const db = client.db('whatsapp_bot');
            await db.collection('session_data').updateOne(
                { _id: 'whatsapp_creds' },
                { $set: { data: credsData, updatedAt: new Date() } },
                { upsert: true }
            );
        }
    } catch (err) {}
}

async function loadSessionFromMongo() {
    if (!client || !dbConnected) return;
    try {
        const db = client.db('whatsapp_bot');
        const result = await db.collection('session_data').findOne({ _id: 'whatsapp_creds' });
        if (result && result.data) {
            if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });
            fs.writeFileSync(path.join(SESSION_PATH, 'creds.json'), result.data);
            console.log('📥 [System] تم استعادة الجلسة.');
            return true;
        }
    } catch (err) {}
    return false;
}

async function clearInvalidSession() {
    try {
        if (fs.existsSync(SESSION_PATH)) fs.rmSync(SESSION_PATH, { recursive: true, force: true });
        if (client && dbConnected) {
            await client.db('whatsapp_bot').collection('session_data').deleteOne({ _id: 'whatsapp_creds' });
        }
    } catch (err) {}
}

// --- المحرك الرئيسي ---
let sock = null;
let isReady = false;
let lastQR = null;
const processedWebhooks = new Map();

async function connectToWhatsApp() {
    if (sock) { try { sock.logout(); } catch(e) {} sock = null; }

    try {
        if (dbConnected) await loadSessionFromMongo();
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
        const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: Browsers.appropriate('Chrome'),
            printQRInTerminal: false,
            connectTimeoutMS: 60000,
            keepAliveIntervalMs: 30000,
            shouldIgnoreJid: (jid) => jid.endsWith('@g.us')
        });

        sock.ev.on('creds.update', async () => {
            await saveCreds();
            if (dbConnected) syncSessionToMongo();
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const errorMessage = lastDisconnect?.error?.message || "";
                isReady = false;
                if (statusCode === 401 || statusCode === 405 || errorMessage.includes('Bad MAC')) {
                    await clearInvalidSession();
                    setTimeout(connectToWhatsApp, 3000);
                } else if (DisconnectReason.loggedOut !== statusCode) {
                    setTimeout(connectToWhatsApp, 5000);
                }
            } else if (connection === 'open') {
                isReady = true;
                lastQR = null;
                console.log('✅ [WhatsApp] نظام سُمعة متصل ونشط!');
                if (dbConnected) syncSessionToMongo();
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;
            const remoteJid = msg.key.remoteJid;
            if (remoteJid.endsWith('@g.us')) return;

            let text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
            if (!text) return;

            if (/^[1١]/.test(text)) {
                await sock.sendMessage(remoteJid, { text: "يسعدنا جداً أن التجربة كانت ممتازة! 😍 كرمًا منك شاركنا تقييمك هنا:\n📍 [رابط جوجل ماب الخاص بك]" });
            } 
            else if (/^[2٢]/.test(text)) {
                const discountCode = process.env.DISCOUNT_CODE || "WELCOME10";
                await sock.sendMessage(remoteJid, { text: `نعتذر منك جداً 😔، هدفنا رضاك التام. وتقديراً منا لصدقك، نهديك كود خصم خاص بطلبك القادم:\n🎫 كود الخصم: *${discountCode}*` });
                
                const managerPhone = process.env.MANAGER_PHONE;
                if (managerPhone && isReady) {
                    const cleanManager = managerPhone.replace(/[^0-9]/g, '');
                    await sock.sendMessage(`${cleanManager}@s.whatsapp.net`, { text: `⚠️ تنبيه تقييم سلبي من ${remoteJid.split('@')[0]}\nللتواصل: https://wa.me/${remoteJid.split('@')[0]}` });
                }
            }
            else if (/(شكرا|شكراً|تسلم|يعطيك|تمام|اوكي|ok|thanks)/i.test(text)) {
                await sock.sendMessage(remoteJid, { text: "في خدمتك دائماً، نورتنا! ❤️" });
            }
        });
    } catch (error) {
        setTimeout(connectToWhatsApp, 15000);
    }
}

// --- دالة الإرسال المركزية ---
const sendEvaluationMessage = async (phone, name) => {
    if (!isReady || !sock) return { success: false, error: 'البوت غير متصل حالياً' };
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const jid = `${cleanPhone}@s.whatsapp.net`;
    try {
        await sock.sendMessage(jid, { 
            text: `مرحباً ${name || 'عميلنا العزيز'}، نورتنا! 🌸\n\nكيف كانت تجربة طلبك اليوم؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` 
        });
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
};

// --- [1] استقبال بيانات فودكس ---
app.post('/foodics-webhook', async (req, res) => {
    const apiKey = req.query.key;
    if (apiKey !== process.env.WEBHOOK_KEY) return res.status(401).send('Unauthorized');
    const { customer, status, id, hid } = req.body;
    if (!customer?.phone) return res.status(400).send('Missing data');
    const orderId = id || hid || customer.phone;
    if (processedWebhooks.has(orderId)) return res.send('Duplicate');
    processedWebhooks.set(orderId, Date.now());
    setTimeout(() => processedWebhooks.delete(orderId), 600000);
    if (status == 4 || status === 'closed' || status === 'completed') {
        setTimeout(() => sendEvaluationMessage(customer.phone, customer.name), 3000);
    }
    res.send('OK');
});

// --- [2] استقبال الإرسال اليدوي ---
app.post('/send-evaluation', async (req, res) => {
    const apiKey = req.query.key;
    if (apiKey !== process.env.WEBHOOK_KEY) return res.status(401).send('Unauthorized');
    const { phone, name } = req.body;
    if (!phone) return res.status(400).json({ error: 'رقم الجوال مطلوب' });
    const result = await sendEvaluationMessage(phone, name);
    if (result.success) res.json({ message: 'تم الإرسال بنجاح' });
    else res.status(500).json({ error: result.error });
});

app.get('/health', (req, res) => {
    const statusHtml = isReady ? '<h1 style="color:green;">✅ نظام سمعة متصل ونشط</h1>' : (lastQR ? '<h1>📲 الربط مطلوب</h1><img src="'+lastQR+'" style="border:10px solid #eee; border-radius:15px;"/>' : '<h1>⏳ جاري التحميل...</h1>');
    
    res.send(`
        <div style="font-family:sans-serif; text-align:center; padding-top:50px; direction:rtl; max-width:500px; margin:auto;">
            ${statusHtml}
            <hr style="margin:30px 0; border:0; border-top:1px solid #eee;">
            <div style="background:#f9f9f9; padding:20px; border-radius:15px; border:1px solid #eee;">
                <h3>🚀 إرسال تقييم يدوي</h3>
                <p style="font-size:12px; color:gray;">(للمطاعم بدون فودكس أو لطلبات هنقرستيشن)</p>
                <input type="text" id="phone" placeholder="9665xxxxxxxx" style="width:90%; padding:10px; margin-bottom:10px; border-radius:8px; border:1px solid #ccc;">
                <input type="text" id="name" placeholder="اسم العميل (اختياري)" style="width:90%; padding:10px; margin-bottom:10px; border-radius:8px; border:1px solid #ccc;">
                <button onclick="send()" id="btn" style="width:90%; padding:12px; background:#10b981; color:white; border:none; border-radius:8px; cursor:pointer; font-bold;">إرسال الآن</button>
                <p id="msg" style="margin-top:10px; font-weight:bold;"></p>
            </div>
            <script>
                async function send() {
                    const phone = document.getElementById('phone').value;
                    const name = document.getElementById('name').value;
                    const btn = document.getElementById('btn');
                    const msg = document.getElementById('msg');
                    if(!phone) return alert('ضع رقم الجوال');
                    btn.disabled = true; btn.innerText = 'جاري الإرسال...';
                    try {
                        const res = await fetch('/send-evaluation?key=${process.env.WEBHOOK_KEY}', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({phone, name})
                        });
                        if(res.ok) { msg.style.color='green'; msg.innerText='✅ تم الإرسال!'; }
                        else { msg.style.color='red'; msg.innerText='❌ فشل الإرسال'; }
                    } catch(e) { msg.innerText='خطأ في الاتصال'; }
                    btn.disabled = false; btn.innerText = 'إرسال الآن';
                }
            </script>
        </div>
    `);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
    console.log(`🚀 [Server] يعمل على المنفذ ${PORT}`);
    await initMongo();
    connectToWhatsApp();
});