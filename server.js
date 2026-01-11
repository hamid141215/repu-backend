/**
 * نظام سُمعة (RepuSystem) - النسخة v3.3 (الإصلاح التلقائي للجلسة)
 * التحديث: معالجة خطأ 401 (Session Invalid) بمسح البيانات التالفة تلقائياً وطلب إعادة الربط.
 * الخصوصية: محتوى الرسائل محمي ولا يظهر في السجلات.
 */

require('dotenv').config();
const express = require('express');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// --- إعدادات CORS ---
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// --- نظام مراقبة الأخطاء لمنع الانهيار ---
process.on('unhandledRejection', (reason) => {
    // تجاهل أخطاء الاتصال البسيطة
});
process.on('uncaughtException', (err) => {
    console.error('❌ خطأ غير متوقع في النظام:', err.message);
});

// --- MongoDB Setup ---
let MongoClient;
try { 
    MongoClient = require('mongodb').MongoClient; 
} catch (e) {
    console.warn("⚠️ مكتبة mongodb غير مثبتة.");
}

const MONGO_URL = process.env.MONGO_URL;
let client = null;
let dbConnected = false;

const initMongo = async () => {
    if (typeof MONGO_URL === 'string' && MONGO_URL.trim().startsWith('mongodb')) {
        try {
            client = new MongoClient(MONGO_URL.trim(), { connectTimeoutMS: 10000 });
            await client.connect();
            dbConnected = true;
            console.log("🔗 [MongoDB] تم الربط السحابي بنجاح.");
        } catch (e) {
            console.error(`⚠️ [MongoDB] فشل الاتصال: ${e.message}`);
            client = null;
        }
    } else {
        console.log("🏠 [System] يعمل بالوضع المحلي.");
    }
};

const SESSION_PATH = 'auth_new_session';

// --- إدارة المزامنة السحابية ---
let syncTimeout = null;
async function syncSessionToMongo() {
    if (!client || !dbConnected) return;
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(async () => {
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
    }, 5000); 
}

async function loadSessionFromMongo() {
    if (!client || !dbConnected) return;
    try {
        const db = client.db('whatsapp_bot');
        const result = await db.collection('session_data').findOne({ _id: 'whatsapp_creds' });
        if (result && result.data) {
            if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });
            fs.writeFileSync(path.join(SESSION_PATH, 'creds.json'), result.data);
            console.log('📥 [System] تم استيراد الجلسة من السحابة.');
        }
    } catch (err) {}
}

// دالة لمسح الجلسة التالفة (تستخدم عند حدوث خطأ 401)
async function clearInvalidSession() {
    console.log("🧹 [System] جاري مسح بيانات الجلسة غير الصالحة...");
    try {
        if (fs.existsSync(SESSION_PATH)) {
            fs.rmSync(SESSION_PATH, { recursive: true, force: true });
        }
        if (client && dbConnected) {
            const db = client.db('whatsapp_bot');
            await db.collection('session_data').deleteOne({ _id: 'whatsapp_creds' });
            console.log("☁️ [MongoDB] تم حذف الجلسة التالفة من السحابة.");
        }
    } catch (err) {
        console.error("❌ فشل مسح البيانات:", err.message);
    }
}

// --- المحرك الرئيسي لاتصال واتساب ---
let sock = null;
let isReady = false;
let lastQR = null;
const processedWebhooks = new Map();

async function connectToWhatsApp() {
    try {
        await loadSessionFromMongo();
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
        const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ['RepuSystem', 'Chrome', '110.0'],
            printQRInTerminal: false,
            connectTimeoutMS: 60000,
            keepAliveIntervalMs: 15000
        });

        sock.ev.on('creds.update', async () => {
            await saveCreds();
            syncSessionToMongo();
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
                console.log("📲 [WhatsApp] بانتظار مسح الباركود في صفحة /health");
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                isReady = false;
                
                if (statusCode === 401) {
                    console.log("❌ [WhatsApp] الجلسة غير صالحة أو تم تسجيل الخروج. يرجى إعادة الربط.");
                    await clearInvalidSession();
                    setTimeout(connectToWhatsApp, 2000);
                } else if (statusCode === 515) {
                    console.log("🔄 [WhatsApp] جاري تحديث الاتصال تلقائياً...");
                    setTimeout(connectToWhatsApp, 5000);
                } else if (shouldReconnect) {
                    console.log(`📡 [WhatsApp] انقطع الاتصال (كود: ${statusCode}). إعادة المحاولة...`);
                    setTimeout(connectToWhatsApp, 5000);
                }
            } else if (connection === 'open') {
                isReady = true;
                lastQR = null;
                console.log('✅ [WhatsApp] النظام متصل وجاهز للاستقبال!');
                syncSessionToMongo();
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const remoteJid = msg.key.remoteJid;
            if (remoteJid.endsWith('@g.us')) return; 

            let text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
            
            if (text.length > 0) {
                console.log(`📩 [Activity] رسالة واردة من رقم ينتهي بـ: [${remoteJid.split('@')[0].slice(-4)}]`);
            }

            if (/^[1١]/.test(text)) {
                await sock.sendMessage(remoteJid, { text: "يسعدنا جداً أن التجربة كانت ممتازة! 😍 كرمًا منك شاركنا تقييمك هنا:\n📍 [رابط جوجل ماب الخاص بك]" });
            } 
            else if (/^[2٢]/.test(text)) {
                await sock.sendMessage(remoteJid, { text: "نعتذر منك جداً 😔، هدفنا رضاك التام. سيتم التواصل معك من قبل الإدارة فوراً." });
                const managerPhone = process.env.MANAGER_PHONE;
                if (managerPhone && isReady) {
                    const customerPhone = remoteJid.split('@')[0];
                    const managerJid = `${managerPhone.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
                    await sock.sendMessage(managerJid, { text: `⚠️ تنبيه: تقييم سلبي من ${customerPhone}\nللتواصل: https://wa.me/${customerPhone}` });
                }
            }
        });
    } catch (error) {
        console.error("❌ خطأ في محرك الواتساب:", error.message);
        setTimeout(connectToWhatsApp, 10000);
    }
}

// --- استقبال بيانات فودكس (Webhook) ---
app.post('/foodics-webhook', async (req, res) => {
    const apiKey = req.query.key;
    if (apiKey !== process.env.WEBHOOK_KEY) return res.status(401).send('Unauthorized');
    const { customer, status, id, hid } = req.body;
    if (!customer?.phone) return res.status(400).send('Missing data');

    const orderId = id || hid || customer.phone;
    if (processedWebhooks.has(orderId)) return res.send('OK');
    processedWebhooks.set(orderId, Date.now());
    setTimeout(() => processedWebhooks.delete(orderId), 600000);

    if ((status === 4 || status === 'closed' || status === 'completed') && isReady) {
        const jid = `${customer.phone.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        setTimeout(async () => {
            try { 
                if (sock && isReady) {
                    await sock.sendMessage(jid, { text: `مرحباً ${customer.name || 'عميلنا العزيز'}، كيف كانت تجربتك؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` }); 
                }
            } catch (e) {}
        }, 3000);
    }
    res.send('OK');
});

// --- صفحة الحالة الصحية ---
app.get('/health', (req, res) => {
    res.send(`<div style="font-family:sans-serif;text-align:center;padding-top:50px;direction:rtl;">${isReady ? '<h1 style="color:green;">✅ نظام سمعة آمن ونشط</h1><p>السيرفر متصل بالواتساب وجاهز.</p>' : (lastQR ? '<h1>📲 الربط مطلوب</h1><p>الجلسة السابقة انتهت صلاحيتها. يرجى إعادة مسح الباركود:</p><img src="'+lastQR+'" style="border:10px solid #eee; border-radius:15px;"/>' : '<h1>⏳ جاري التحميل...</h1>')}</div>`);
});

// --- تشغيل السيرفر ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
    console.log(`🚀 [Server] يعمل الآن على المنفذ ${PORT}`);
    await initMongo();
    connectToWhatsApp();
});