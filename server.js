/**
 * نظام سُمعة (RepuSystem) - النسخة v7.2 المستقرة
 * تصحيح أخطاء العرض | استقرار الاتصال | باقة Starter
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

// --- إعداد MongoDB Atlas ---
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

// --- إدارة البيانات ---
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
    const defaultS = { googleLink: "#", discountCode: "OFFER10", delay: 0 };
    if (!dbConnected) return defaultS;
    try {
        const settings = await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' });
        return settings ? settings : defaultS;
    } catch (e) { return defaultS; }
}

// --- محرك الواتساب (تحسين استقرار الاتصال) ---
async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await import('@whiskeysockets/baileys');
    if (!fs.existsSync(path.join(SESSION_PATH, 'creds.json'))) { await loadSessionFromMongo(); }
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

    if (sock) { try { sock.terminate(); } catch (e) {} sock = null; }

    sock = makeWASocket({
        version, auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop'),
        printQRInTerminal: false,
        shouldSyncHistoryMessage: () => false,
        syncFullHistory: false,
        markOnlineOnConnect: false, // تحسين لمنع أخطاء 428
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0
    });

    sock.ev.on('creds.update', async () => { await saveCreds(); await syncSessionToMongo(); });
    sock.ev.on('connection.update', async (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
        if (connection === 'open') { isReady = true; lastQR = null; console.log('✅ WhatsApp Active.'); await syncSessionToMongo(); }
        if (connection === 'close') {
            isReady = false;
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) setTimeout(connectToWhatsApp, 5000);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const remoteJid = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        const settings = await getSettings();

        if (/^[1١]/.test(text)) {
            await updateStats('positive');
            await sock.sendMessage(remoteJid, { text: `يسعدنا جداً أن التجربة نالت إعجابك! 😍\n\nتقييمك بـ 5 نجوم يعني لنا الكثير:\n📍 ${settings.googleLink}` });
        } else if (/^[2٢]/.test(text)) {
            await updateStats('negative');
            await sock.sendMessage(remoteJid, { text: `نعتذر منك 😔، نعدك بتجربة أفضل قادماً.\n🎫 كود الخصم: ${settings.discountCode}` });
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
    let finalDelayMs = baseDelay > 0 ? (baseDelay * 60 * 1000) + Math.floor(Math.random() * 20000) : 4000;

    setTimeout(async () => {
        if (isReady && sock) {
            try {
                await sock.sendMessage(`${cleanP}@s.whatsapp.net`, { 
                    text: `مرحباً ${name || 'عميلنا العزيز'}، نورتنا في (${branch})! 🌸\n\nكيف كانت تجربتك؟\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` 
                });
            } catch (e) {}
        }
    }, finalDelayMs);
};

// --- الروابط ---
app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { phone, name, branch } = req.body;
    await updateStats('order', branch || "الرئيسي");
    scheduleMessage(phone, name, branch || "الرئيسي");
    res.json({ success: true });
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { googleLink, discountCode, delay } = req.body;
    await client.db('whatsapp_bot').collection('config').updateOne(
        { _id: 'global_settings' },
        { $set: { googleLink, discountCode, delay: (delay === "" || delay === null) ? 0 : parseInt(delay) } },
        { upsert: true }
    );
    res.json({ success: true });
});

// --- واجهة الإدارة المصححة ---
app.get('/admin', async (req, res) => {
    const settings = await getSettings();
    const branches = dbConnected ? await client.db('whatsapp_bot').collection('branches').find().toArray() : [];

    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>RepuSystem | لوحة التحكم</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style> @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap'); body { font-family: 'Cairo', sans-serif; background-color: #f8fafc; } </style>
    </head>
    <body class="p-4 md:p-8 text-gray-800">
        <div class="max-w-6xl mx-auto">
            <header class="flex justify-between items-center mb-10">
                <h1 class="text-3xl font-black italic text-gray-900 tracking-tighter">MAWJAT<span class="text-blue-600 font-normal text-2xl uppercase">AL SAMT</span></h1>
                <div class="bg-white px-5 py-2 rounded-2xl shadow-sm border flex items-center gap-2 font-bold text-xs uppercase">
                    <div class="w-2 h-2 rounded-full ${isReady ? 'bg-green-500 animate-pulse' : 'bg-red-500'}"></div>
                    <span>${isReady ? 'متصل ✅' : 'جاري الربط...'}</span>
                </div>
            </header>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
                ${branches.map(b => `
                    <div class="bg-white p-5 rounded-3xl border-r-4 border-blue-500 shadow-sm">
                        <p class="text-[10px] font-bold text-gray-400 mb-1">${b.branchName}</p>
                        <h3 class="text-xl font-black">${b.totalOrders || 0} <span class="text-xs font-normal">طلب</span></h3>
                    </div>
                `).join('')}
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
                    <h3 class="text-lg font-bold mb-6 text-blue-600 italic">📥 جدولة طلب</h3>
                    <div class="space-y-4 text-center">
                        <select id="branch" class="w-full p-4 bg-gray-50 rounded-2xl border-none ring-1 ring-gray-200 font-bold outline-none">
                            <option value="الفرع الرئيسي">الفرع الرئيسي</option>
                            <option value="فرع مكة">فرع مكة</option>
                            <option value="فرع جدة">فرع جدة</option>
                        </select>
                        <input id="p" type="text" placeholder="05xxxxxxxx" class="w-full p-4 bg-gray-50 rounded-2xl border-none ring-1 ring-gray-200 font-bold text-center outline-none">
                        <input id="n" type="text" placeholder="اسم العميل (اختياري)" class="w-full p-4 bg-gray-50 rounded-2xl border-none ring-1 ring-gray-200 font-bold text-center outline-none">
                        <button onclick="send()" id="sb" class="w-full bg-blue-600 text-white p-4 rounded-2xl font-bold shadow-lg shadow-blue-100 transition">إرسال التقييم</button>
                    </div>
                </div>

                <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100">
                    <h3 class="text-lg font-bold mb-6 text-green-600 italic">⚙️ الإعدادات</h3>
                    <div class="space-y-5">
                        <div>
                            <label class="text-[10px] font-bold text-gray-400 mr-2 uppercase">رابط جوجل ماب</label>
                            <input id="gl" type="text" value="${settings.googleLink}" class="w-full p-3 bg-gray-50 rounded-xl border-none ring-1 ring-gray-200 text-xs font-mono outline-none">
                        </div>
                        <div class="flex gap-4">
                            <div class="flex-1">
                                <label class="text-[10px] font-bold text-gray-400 block mb-1 text-center">كود الخصم</label>
                                <input id="dc" type="text" value="${settings.discountCode}" class="w-full p-3 bg-gray-50 rounded-xl border-none ring-1 ring-gray-200 font-bold text-center uppercase outline-none text-blue-600">
                            </div>
                            <div class="flex-1 text-center">
                                <label class="text-[10px] font-bold text-gray-400 block mb-1">التأخير (د)</label>
                                <input id="dl" type="number" value="${settings.delay}" class="w-full p-3 bg-gray-50 rounded-xl border-none ring-1 ring-gray-200 font-bold text-center outline-none">
                            </div>
                        </div>
                        <button onclick="save()" class="w-full bg-gray-900 text-white p-4 mt-2 rounded-2xl font-bold transition">حفظ الإعدادات</button>
                    </div>
                </div>
            </div>

            <div class="mt-10 bg-white p-8 rounded-[2.5rem] text-center border-dashed border-2">
                 ${lastQR ? `<img src="${lastQR}" class="mx-auto w-36 mb-2 border p-2 bg-white rounded-xl shadow-sm"><p class="text-amber-600 text-xs font-bold">امسح الكود للربط</p>` : isReady ? '<p class="text-green-600 font-black text-xs tracking-widest uppercase">System Connected Successfully ✅</p>' : '<p class="text-gray-400 animate-pulse text-xs uppercase">Awaiting cloud synchronization...</p>'}
            </div>
        </div>
        <script>
            async function send() {
                let p = document.getElementById('p').value.trim(); 
                const n = document.getElementById('n').value.trim();
                const b = document.getElementById('branch').value;
                if(!p) return alert('أدخل الرقم');
                try {
                    const res = await fetch('/send-evaluation?key=${process.env.WEBHOOK_KEY}', { 
                        method: 'POST', headers: {'Content-Type': 'application/json'}, 
                        body: JSON.stringify({phone:p, name:n, branch:b}) 
                    });
                    if(res.ok) alert('✅ تمت الجدولة لفرع ' + b);
                } catch(e) { alert('❌ خطأ'); }
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