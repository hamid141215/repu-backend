/**
 * نظام سُمعة (RepuSystem) - النسخة الماستر v5.0 (الكاملة)
 * تشمل: الإحصائيات، لوحة التحكم، الربط مع فودكس، وإدارة الجلسة سحابياً.
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

// --- الإعدادات والمتغيرات ---
const EVALUATION_DELAY_MINUTES = parseInt(process.env.DELAY_MINUTES) || 20;
const SESSION_PATH = 'auth_new_session';
let sock = null, isReady = false, lastQR = null;

// --- إعداد MongoDB ---
let MongoClient;
try { MongoClient = require('mongodb').MongoClient; } catch (e) {}
const MONGO_URL = process.env.MONGO_URL;
let client = null, dbConnected = false;

const initMongo = async () => {
    if (typeof MONGO_URL === 'string' && MONGO_URL.trim().startsWith('mongodb')) {
        try {
            client = new MongoClient(MONGO_URL.trim(), { connectTimeoutMS: 15000 });
            await client.connect();
            dbConnected = true;
            console.log("🔗 MongoDB Connected.");
        } catch (e) { console.error("❌ MongoDB Fail."); }
    }
};

// --- وظائف الإحصائيات والجلسة ---
async function updateStats(type) {
    if (!dbConnected) return;
    try {
        const db = client.db('whatsapp_bot');
        const update = {};
        if (type === 'order') update.$inc = { totalOrders: 1 };
        if (type === 'positive') update.$inc = { positive: 1 };
        if (type === 'negative') update.$inc = { negative: 1 };
        await db.collection('analytics').updateOne({ _id: 'daily_stats' }, update, { upsert: true });
    } catch (e) { console.error("Stats Error:", e); }
}

async function getStats() {
    if (!dbConnected) return { totalOrders: 0, positive: 0, negative: 0 };
    const stats = await client.db('whatsapp_bot').collection('analytics').findOne({ _id: 'daily_stats' });
    return stats || { totalOrders: 0, positive: 0, negative: 0 };
}

async function syncSessionToMongo() {
    if (!client || !dbConnected) return;
    try {
        const credsPath = path.join(SESSION_PATH, 'creds.json');
        if (fs.existsSync(credsPath)) {
            await client.db('whatsapp_bot').collection('session_data').updateOne(
                { _id: 'whatsapp_creds' },
                { $set: { data: fs.readFileSync(credsPath, 'utf-8'), updatedAt: new Date() } },
                { upsert: true }
            );
        }
    } catch (err) {}
}

async function loadSessionFromMongo() {
    if (!client || !dbConnected) return false;
    try {
        const result = await client.db('whatsapp_bot').collection('session_data').findOne({ _id: 'whatsapp_creds' });
        if (result && result.data) {
            if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });
            fs.writeFileSync(path.join(SESSION_PATH, 'creds.json'), result.data);
            return true;
        }
    } catch (err) {}
    return false;
}

// --- محرك الواتساب ---
async function connectToWhatsApp() {
    if (sock) { try { sock.logout(); } catch(e) {} sock = null; }
    try {
        if (dbConnected) await loadSessionFromMongo();
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
        const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

        sock = makeWASocket({
            version, auth: state, logger: pino({ level: 'silent' }),
            browser: Browsers.appropriate('Chrome'),
            printQRInTerminal: false,
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
                isReady = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode === 401 || statusCode === 405) {
                    if (fs.existsSync(SESSION_PATH)) fs.rmSync(SESSION_PATH, { recursive: true, force: true });
                    setTimeout(connectToWhatsApp, 3000);
                } else {
                    setTimeout(connectToWhatsApp, 5000);
                }
            } else if (connection === 'open') {
                isReady = true; lastQR = null; console.log('✅ WhatsApp Ready.');
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;
            const remoteJid = msg.key.remoteJid;
            let text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

            if (/^[1١]/.test(text)) {
                await updateStats('positive');
                await sock.sendMessage(remoteJid, { text: "يسعدنا جداً أن التجربة كانت ممتازة! 😍 كرمًا منك شاركنا تقييمك هنا:\n📍 " + (process.env.GOOGLE_MAPS_LINK || "[رابط جوجل]") });
            } 
            else if (/^[2٢]/.test(text)) {
                await updateStats('negative');
                const code = process.env.DISCOUNT_CODE || "REPU10";
                await sock.sendMessage(remoteJid, { text: `نعتذر منك جداً 😔، نهديك كود خصم لطلبك القادم:\n🎫 كود الخصم: *${code}*` });
                const manager = process.env.MANAGER_PHONE;
                if (manager) {
                    const cleanM = manager.replace(/[^0-9]/g, '');
                    await sock.sendMessage(`${cleanM}@s.whatsapp.net`, { text: `⚠️ تقييم سلبي من: ${remoteJid.split('@')[0]}\nللتواصل: https://wa.me/${remoteJid.split('@')[0]}` });
                }
            }
        });
    } catch (error) { console.log("Conn Error:", error); }
}

// --- الجدولة والـ Webhooks ---
const scheduleMessage = async (phone, name) => {
    const delay = EVALUATION_DELAY_MINUTES * 60 * 1000;
    const cleanP = phone.replace(/[^0-9]/g, '');
    setTimeout(async () => {
        if (!isReady || !sock) return;
        try {
            await sock.sendMessage(`${cleanP}@s.whatsapp.net`, { 
                text: `مرحباً ${name || 'عميلنا العزيز'}، نورتنا! 🌸\n\nكيف كانت تجربة طلبك اليوم؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` 
            });
        } catch (e) {}
    }, delay);
};

app.post('/foodics-webhook', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.status(401).send('Unauthorized');
    const { customer, status } = req.body;
    if (customer?.phone && (status == 4 || status === 'closed')) {
        await updateStats('order');
        scheduleMessage(customer.phone, customer.name);
    }
    res.send('OK');
});

app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.status(401).send('Unauthorized');
    const { phone, name } = req.body;
    if (!phone) return res.status(400).send('Phone required');
    await updateStats('order');
    scheduleMessage(phone, name);
    res.json({ message: `Scheduled in ${EVALUATION_DELAY_MINUTES}m` });
});

// --- لوحة التحكم المحدثة (إضافة خانة الاسم) ---
app.get('/admin', async (req, res) => {
    const stats = await getStats();
    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>لوحة تحكم RepuSystem</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    </head>
    <body class="bg-gray-50 font-sans">
        <div class="max-w-4xl mx-auto p-4 md:p-10">
            <div class="flex justify-between items-center mb-10 bg-white p-6 rounded-3xl shadow-sm">
                <div>
                    <h1 class="text-2xl font-black text-gray-800 italic">REPU<span class="text-green-600">SYSTEM</span></h1>
                    <p class="text-xs text-gray-400 font-medium font-bold">نظام إدارة السمعة الذكي</p>
                </div>
                <div class="flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-full border">
                    <span class="flex h-3 w-3 rounded-full ${isReady ? 'bg-green-500' : 'bg-red-500'}"></span>
                    <span class="text-sm font-bold text-gray-700">${isReady ? 'متصل بنجاح' : 'جاري الربط...'}</span>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                <div class="bg-white p-6 rounded-3xl shadow-sm border-t-4 border-blue-500">
                    <p class="text-gray-400 text-sm mb-1 font-bold">إجمالي الإرسال</p>
                    <h2 class="text-3xl font-black">${stats.totalOrders || 0}</h2>
                </div>
                <div class="bg-white p-6 rounded-3xl shadow-sm border-t-4 border-green-500">
                    <p class="text-gray-400 text-sm mb-1 font-bold">تقييم ممتاز (1)</p>
                    <h2 class="text-3xl font-black text-green-600">${stats.positive || 0}</h2>
                </div>
                <div class="bg-white p-6 rounded-3xl shadow-sm border-t-4 border-red-500">
                    <p class="text-gray-400 text-sm mb-1 font-bold">يحتاج تحسين (2)</p>
                    <h2 class="text-3xl font-black text-red-600">${stats.negative || 0}</h2>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="bg-white p-8 rounded-3xl shadow-sm text-center border">
                    <h3 class="font-bold mb-6 text-gray-700 border-b pb-2">حالة الارتباط</h3>
                    ${lastQR ? `<img src="${lastQR}" class="mx-auto w-48 shadow-lg rounded-xl border-4 border-gray-50">` : isReady ? `<div class="py-10 text-green-500"><i class="fas fa-check-double text-6xl"></i><p class="mt-4 font-bold">الواتساب نشط</p></div>` : '<p class="py-10">جاري تحميل النظام...</p>'}
                </div>

                <div class="bg-white p-8 rounded-3xl shadow-sm border">
                    <h3 class="font-bold mb-6 text-gray-700 border-b pb-2">إرسال يدوي (تطبيقات / محلي)</h3>
                    <input type="text" id="phone" placeholder="رقم الجوال (9665xxxxxxx)" class="w-full p-4 mb-3 bg-gray-50 border rounded-2xl focus:ring-2 ring-green-400 outline-none text-center font-bold">
                    <input type="text" id="name" placeholder="اسم العميل (اختياري)" class="w-full p-4 mb-4 bg-gray-50 border rounded-2xl focus:ring-2 ring-green-400 outline-none text-center font-bold">
                    <button onclick="sendManual()" id="sendBtn" class="w-full bg-green-600 text-white p-4 rounded-2xl font-bold hover:bg-green-700 transition flex items-center justify-center gap-2">
                        <i class="fas fa-paper-plane"></i> جدولة الإرسال
                    </button>
                    <p id="resMsg" class="mt-4 text-sm font-bold text-center"></p>
                </div>
            </div>
        </div>

        <script>
            async function sendManual() {
                const phone = document.getElementById('phone').value;
                const name = document.getElementById('name').value;
                const btn = document.getElementById('sendBtn');
                const msg = document.getElementById('resMsg');

                if(!phone) { alert('الرجاء إدخال رقم الجوال'); return; }
                
                btn.disabled = true;
                btn.innerHTML = 'جاري الجدولة...';
                
                try {
                    const res = await fetch('/send-evaluation?key=${process.env.WEBHOOK_KEY}', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ phone, name })
                    });
                    
                    if(res.ok) {
                        msg.className = "mt-4 text-sm font-bold text-center text-green-600";
                        msg.innerText = "✅ تمت الجدولة (سيصل خلال ${EVALUATION_DELAY_MINUTES} دقيقة)";
                        document.getElementById('phone').value = '';
                        document.getElementById('name').value = '';
                    } else {
                        throw new Error();
                    }
                } catch(e) {
                    msg.className = "mt-4 text-sm font-bold text-center text-red-600";
                    msg.innerText = "❌ حدث خطأ في الإرسال";
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fas fa-paper-plane"></i> جدولة الإرسال';
                }
            }
        </script>
    </body>
    </html>
    `);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
    await initMongo();
    connectToWhatsApp();
    console.log(`🚀 RepuSystem v5.0 Live on Port ${PORT}`);
});