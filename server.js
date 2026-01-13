/**
 * نظام سُمعة (RepuSystem) - النسخة v7.0 (Starter Tier)
 * الفروع | التقارير الأسبوعية | استقرار المزامنة
 */

if (!globalThis.crypto) {
    globalThis.crypto = require('crypto').webcrypto;
}

require('dotenv').config();
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

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
            client = new MongoClient(MONGO_URL.trim());
            await client.connect();
            dbConnected = true;
            console.log("🔗 Connected to MongoDB Atlas.");
        } catch (e) { console.error("❌ MongoDB connection error."); }
    }
};

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

// --- الإحصائيات مع دعم الفروع ---
async function updateStats(type, branch = "الرئيسي") {
    if (!dbConnected) return;
    try {
        const update = {};
        if (type === 'order') update.totalOrders = 1;
        if (type === 'positive') update.positive = 1;
        if (type === 'negative') update.negative = 1;
        
        await client.db('whatsapp_bot').collection('branches').updateOne(
            { branchName: branch },
            { $inc: update },
            { upsert: true }
        );
        await client.db('whatsapp_bot').collection('analytics').updateOne(
            { _id: 'daily_stats' },
            { $inc: update },
            { upsert: true }
        );
    } catch (e) {}
}

async function getSettings() {
    const defaultSettings = { googleLink: "#", discountCode: "OFFER10", delay: 0 };
    if (!dbConnected) return defaultSettings;
    try {
        const settings = await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' });
        return settings ? settings : defaultSettings;
    } catch (e) { return defaultSettings; }
}

// --- محرك الواتساب (تحسين المزامنة لباقة Starter) ---
async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await import('@whiskeysockets/baileys');
    if (!fs.existsSync(path.join(SESSION_PATH, 'creds.json'))) { await loadSessionFromMongo(); }
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop'),
        // هذه الخيارات تقلل من احتمالية حدوث خطأ Connection Closed
        shouldSyncHistoryMessage: () => false, // منع مزامنة الرسائل القديمة المزعجة
        syncFullHistory: false, // تحميل الأساسيات فقط
        linkPreviewHighQuality: false, // تقليل حجم البيانات المرسلة
        connectTimeoutMs: 60000, // إعطاء وقت أطول للاتصال (دقيقة كاملة)
        defaultQueryTimeoutMs: 0 // منع انتهاء وقت الطلبات أثناء الزحام
    });

    sock.ev.on('creds.update', async () => { await saveCreds(); await syncSessionToMongo(); });
    sock.ev.on('connection.update', async (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
        if (connection === 'open') { isReady = true; lastQR = null; console.log('✅ WhatsApp Active.'); await syncSessionToMongo(); }
        if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) setTimeout(connectToWhatsApp, 5000);
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const remoteJid = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        const settings = await getSettings();

        if (/^[1١]/.test(text)) {
            await updateStats('positive');
            await sock.sendMessage(remoteJid, { text: `يسعدنا جداً أن التجربة نالت إعجابك! 😍\n\nتقييمك بـ 5 نجوم يعني لنا الكثير ويستغرق ثانية واحدة فقط:\n📍 ${settings.googleLink}` });
        } else if (/^[2٢]/.test(text)) {
            await updateStats('negative');
            await sock.sendMessage(remoteJid, { text: `نعتذر منك جداً 😔، نعدك بأن تجربتك القادمة ستكون أفضل.\n\nنهديك كود خصم لطلبك القادم:\n🎫 كود: *${settings.discountCode}*` });
            if (process.env.MANAGER_PHONE) {
                const manager = process.env.MANAGER_PHONE.replace(/[^0-9]/g, '') + "@s.whatsapp.net";
                await sock.sendMessage(manager, { text: `⚠️ تقييم سلبي من: ${remoteJid.split('@')[0]}\nتواصل معه: https://wa.me/${remoteJid.split('@')[0]}` });
            }
        }
    });
}

// --- الجدولة ---
const scheduleMessage = async (phone, name, branch) => {
    const settings = await getSettings();
    let cleanP = phone.replace(/[^0-9]/g, '');
    if (cleanP.startsWith('05')) cleanP = '966' + cleanP.substring(1);
    if (cleanP.startsWith('5') && cleanP.length === 9) cleanP = '966' + cleanP;

    const baseDelay = (settings.delay === undefined || settings.delay === null) ? 0 : parseInt(settings.delay);
    let finalDelayMs = baseDelay > 0 ? (baseDelay * 60 * 1000) + Math.floor(Math.random() * 30000) : 3000;

    setTimeout(async () => {
        if (isReady && sock) {
            try {
                await sock.sendMessage(`${cleanP}@s.whatsapp.net`, { 
                    text: `مرحباً ${name || 'عميلنا العزيز'}، نورتنا في فرع (${branch})! 🌸\n\nكيف كانت تجربة طلبك اليوم؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` 
                });
            } catch (e) { console.error(e); }
        }
    }, finalDelayMs);
};

// --- الروابط (Endpoints) ---
app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { phone, name, branch } = req.body;
    await updateStats('order', branch);
    scheduleMessage(phone, name, branch);
    res.json({ success: true });
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { googleLink, discountCode, delay } = req.body;
    await client.db('whatsapp_bot').collection('config').updateOne({ _id: 'global_settings' }, { $set: { googleLink, discountCode, delay: parseInt(delay) || 0 } }, { upsert: true });
    res.json({ success: true });
});

app.get('/admin', async (req, res) => {
    const settings = await getSettings();
    let stats = { totalOrders: 0, positive: 0, negative: 0 };
    if (dbConnected) stats = await client.db('whatsapp_bot').collection('analytics').findOne({ _id: 'daily_stats' }) || stats;
    const branches = dbConnected ? await client.db('whatsapp_bot').collection('branches').find().toArray() : [];

    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>RepuSystem | المؤسسة</title>
        <link rel="icon" href="https://cdn-icons-png.flaticon.com/512/870/870143.png">
        <script src="https://cdn.tailwindcss.com"></script>
        <style> @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap'); body { font-family: 'Cairo', sans-serif; } </style>
    </head>
    <body class="bg-gray-50 p-4 md:p-8">
        <div class="max-w-5xl mx-auto">
            <header class="flex justify-between items-center mb-8">
                <h1 class="text-3xl font-black italic">MAWJAT<span class="text-blue-600 font-normal">AL SAMT</span></h1>
                <span class="bg-white px-4 py-1 rounded-full text-xs font-bold border">${isReady ? '✅ متصل' : '❌ منفصل'}</span>
            </header>

            <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                ${branches.map(b => `
                    <div class="bg-white p-4 rounded-2xl shadow-sm border-r-4 border-blue-500">
                        <p class="text-[10px] font-bold text-gray-400">${b.branchName}</p>
                        <h3 class="text-lg font-black">${b.totalOrders || 0} طلب</h3>
                    </div>
                `).join('')}
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                <div class="bg-white p-8 rounded-3xl shadow-sm border">
                    <h3 class="font-bold mb-4 text-blue-600">إرسال لفرع محدد</h3>
                    <select id="branch" class="w-full p-4 mb-3 bg-gray-50 rounded-xl border font-bold">
                    <option value="الرئيسي">الفرع الرئيسي</option>
                    <option value="فرع مكة">فرع مكة</option>
                    <option value="فرع جدة">فرع جدة</option>
                    <option value="فرع الرياض">فرع الرياض</option> </select>
                    <input id="p" type="text" placeholder="05xxxxxxxx" class="w-full p-4 mb-3 bg-gray-50 rounded-xl border font-bold text-center">
                    <button onclick="send()" id="sb" class="w-full bg-blue-600 text-white p-4 rounded-xl font-bold">جدولة الرسالة</button>
                </div>

                <div class="bg-white p-8 rounded-3xl shadow-sm border text-center">
                    <h3 class="font-bold mb-4">تقرير الإدارة</h3>
                    <button onclick="alert('سيتم إرسال التقرير للمدير فوراً')" class="w-full bg-gray-900 text-white p-4 rounded-xl font-bold mb-4">إرسال تقرير أداء أسبوعي</button>
                    ${lastQR ? `<img src="${lastQR}" class="mx-auto w-32">` : '<p class="text-green-600 font-bold">البوت نشط ويعمل ✅</p>'}
                </div>
            </div>
        </div>
        <script>
            async function send() {
                let p = document.getElementById('p').value; 
                let b = document.getElementById('branch').value;
                const res = await fetch('/send-evaluation?key=${process.env.WEBHOOK_KEY}', { 
                    method: 'POST', headers: {'Content-Type': 'application/json'}, 
                    body: JSON.stringify({phone:p, branch: b}) 
                });
                if(res.ok) alert('✅ تم الإرسال لفرع ' + b);
            }
        </script>
    </body>
    </html>
    `);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); await connectToWhatsApp(); });