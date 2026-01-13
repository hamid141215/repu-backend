/**
 * نظام سُمعة (RepuSystem) - النسخة v7.2 المستقرة
 * دعم الفروع | استقرار التشفير | باقة Starter
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

// --- MongoDB Atlas Setup ---
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
            console.log("🔗 Connected to MongoDB.");
        } catch (e) { console.error("❌ MongoDB Error"); }
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

// --- Stats & Settings ---
async function updateStats(type, branch = "الرئيسي") {
    if (!dbConnected) return;
    try {
        const update = {};
        if (type === 'order') update.totalOrders = 1;
        if (type === 'positive') update.positive = 1;
        if (type === 'negative') update.negative = 1;
        const db = client.db('whatsapp_bot');
        await db.collection('branches').updateOne({ branchName: branch }, { $inc: update }, { upsert: true });
        await db.collection('analytics').updateOne({ _id: 'daily_stats' }, { $inc: update }, { upsert: true });
    } catch (e) {}
}

async function getSettings() {
    const def = { googleLink: "#", discountCode: "OFFER10", delay: 0 };
    if (!dbConnected) return def;
    try {
        const s = await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' });
        return s ? s : def;
    } catch (e) { return def; }
}

// --- WhatsApp Logic ---
async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await import('@whiskeysockets/baileys');
    
    // محاولة تحميل الجلسة من مونجو
    await loadSessionFromMongo(); 

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

    if (sock) { try { sock.terminate(); } catch (e) {} sock = null; }

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop'),
        printQRInTerminal: false,
        // إعدادات لضمان ظهور الكود وتخفيف الحمل
        shouldSyncHistoryMessage: () => false,
        syncFullHistory: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000,
        // منع تعليق الاتصال القديم
        retryRequestDelayMs: 5000 
    });

    sock.ev.on('creds.update', async () => { await saveCreds(); await syncSessionToMongo(); });
    
    sock.ev.on('connection.update', async (u) => {
        const { connection, lastDisconnect, qr } = u;
        
        // تحديث الرابط فور توليد الكود
        if (qr) {
            lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
            console.log("🆕 New QR Generated");
        }
        
        if (connection === 'open') { 
            isReady = true; lastQR = null; 
            console.log('✅ WhatsApp Active.'); 
            await syncSessionToMongo(); 
        }
        
        if (connection === 'close') {
            isReady = false;
            const code = lastDisconnect?.error?.output?.statusCode;
            // إذا كانت الجلسة معطوبة، امسحها وابدأ من جديد
            if (code === DisconnectReason.loggedOut || code === 401) {
                console.log("⚠️ Session Corrupted, Clearing...");
                fs.rmSync(SESSION_PATH, { recursive: true, force: true });
                setTimeout(connectToWhatsApp, 3000);
            } else {
                setTimeout(connectToWhatsApp, 5000);
            }
        }
    });
}

// --- Endpoints ---
app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { phone, name, branch } = req.body;
    await updateStats('order', branch || "الرئيسي");
    const settings = await getSettings();
    const delay = (parseInt(settings.delay) || 0) * 60000 + 3000;
    setTimeout(async () => {
        if (isReady) {
            let p = phone.replace(/[^0-9]/g, '');
            if (p.startsWith('05')) p = '966' + p.substring(1);
            await sock.sendMessage(p + "@s.whatsapp.net", { text: `مرحباً ${name || 'عميلنا'}، نورتنا في (${branch || 'الفرع'})! 🌸\n\nكيف كانت تجربتك؟\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` });
        }
    }, delay);
    res.json({ success: true });
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { googleLink, discountCode, delay } = req.body;
    await client.db('whatsapp_bot').collection('config').updateOne({ _id: 'global_settings' }, { $set: { googleLink, discountCode, delay: parseInt(delay) || 0 } }, { upsert: true });
    res.json({ success: true });
});

app.get('/admin', async (req, res) => {
    const s = await getSettings();
    const br = dbConnected ? await client.db('whatsapp_bot').collection('branches').find().toArray() : [];
    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8"><script src="https://cdn.tailwindcss.com"></script>
        <style> @import url('https://fonts.googleapis.com/css2?family=Cairo&display=swap'); body { font-family: 'Cairo', sans-serif; } </style>
    </head>
    <body class="bg-gray-50 p-5 md:p-10 text-right">
        <div class="max-w-4xl mx-auto">
            <header class="flex justify-between items-center mb-10">
                <h1 class="text-2xl font-black italic">MAWJAT <span class="text-blue-600 font-normal">AL SAMT</span></h1>
                <div class="bg-white px-4 py-2 rounded-xl shadow-sm border font-bold text-xs uppercase">
                    الحالة: ${isReady ? '<span class="text-green-600">متصل ✅</span>' : '<span class="text-red-500 animate-pulse">جاري الربط...</span>'}
                </div>
            </header>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
                ${br.map(b => `<div class="bg-white p-4 rounded-2xl shadow-sm border-r-4 border-blue-500"><p class="text-[10px] font-bold text-gray-400">${b.branchName}</p><h3 class="text-lg font-black">${b.totalOrders || 0} طلب</h3></div>`).join('')}
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
                <div class="bg-white p-8 rounded-3xl shadow-sm border text-center space-y-4">
                    <h3 class="font-bold text-blue-600">📥 جدولة طلب</h3>
                    <select id="branch" class="w-full p-3 bg-gray-50 rounded-xl border outline-none font-bold">
                        <option value="الفرع الرئيسي">الفرع الرئيسي</option>
                        <option value="فرع مكة">فرع مكة</option>
                        <option value="فرع جدة">فرع جدة</option>
                    </select>
                    <input id="p" placeholder="رقم الجوال" class="w-full p-3 bg-gray-50 rounded-xl border text-center font-bold">
                    <input id="n" placeholder="اسم العميل" class="w-full p-3 bg-gray-50 rounded-xl border text-center font-bold">
                    <button onclick="send()" class="w-full bg-blue-600 text-white p-3 rounded-xl font-bold">إرسال التقييم</button>
                </div>
                <div class="bg-white p-8 rounded-3xl shadow-sm border text-center space-y-4">
                    <h3 class="font-bold text-green-600">⚙️ الإعدادات</h3>
                    <input id="gl" value="${s.googleLink}" class="w-full p-3 bg-gray-50 rounded-xl border text-xs">
                    <div class="flex gap-2">
                        <input id="dc" value="${s.discountCode}" class="w-1/2 p-3 bg-gray-50 rounded-xl border text-center font-bold uppercase">
                        <input id="dl" value="${s.delay}" class="w-1/2 p-3 bg-gray-50 rounded-xl border text-center font-bold">
                    </div>
                    <button onclick="save()" class="w-full bg-black text-white p-3 rounded-xl font-bold">حفظ الإعدادات</button>
                </div>
            </div>
            <div class="bg-white p-6 rounded-3xl text-center border-2 border-dashed">
                ${lastQR ? `<img src="${lastQR}" class="mx-auto w-32 border p-2 bg-white rounded-xl">` : isReady ? '<p class="text-green-600 font-bold tracking-widest uppercase">SYSTEM ACTIVE ✅</p>' : '<p class="text-gray-400 animate-pulse uppercase">Connecting...</p>'}
            </div>
        </div>
        <script>
            async function send() {
                const p = document.getElementById('p').value; const n = document.getElementById('n').value; const b = document.getElementById('branch').value;
                const res = await fetch('/send-evaluation?key=${process.env.WEBHOOK_KEY}', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({phone:p, name:n, branch:b}) });
                if(res.ok) alert('✅ تمت الجدولة');
            }
            async function save() {
                const d = { googleLink: document.getElementById('gl').value, discountCode: document.getElementById('dc').value, delay: document.getElementById('dl').value };
                const res = await fetch('/update-settings?key=${process.env.WEBHOOK_KEY}', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(d) });
                if(res.ok) { alert('✅ تم الحفظ'); location.reload(); }
            }
        </script>
    </body>
    </html>
    `);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); await connectToWhatsApp(); });