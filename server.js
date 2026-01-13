/**
 * نظام سُمعة (RepuSystem) - النسخة الاحترافية v6.2
 * مُحسنة لباقة Starter | دعم كامل للرقم (0) | واجهة UI متطورة
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

// --- إعداد MongoDB Atlas (ثبات الجلسة بدون قرص ثابت) ---
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

// --- إدارة الإعدادات والإحصائيات ---
async function getSettings() {
    const defaultSettings = { googleLink: "#", discountCode: "OFFER10", delay: 0 };
    if (!dbConnected) return defaultSettings;
    try {
        const settings = await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' });
        return settings ? settings : defaultSettings;
    } catch (e) { return defaultSettings; }
}

async function updateStats(type) {
    if (!dbConnected) return;
    try {
        const update = {};
        if (type === 'order') update.totalOrders = 1;
        if (type === 'positive') update.positive = 1;
        if (type === 'negative') update.negative = 1;
        await client.db('whatsapp_bot').collection('analytics').updateOne({ _id: 'daily_stats' }, { $inc: update }, { upsert: true });
    } catch (e) {}
}

// --- محرك الواتساب ---
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
        printQRInTerminal: false
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
            await sock.sendMessage(remoteJid, { text: `يسعدنا جداً أن التجربة نالت إعجابك! 😍\n\nتقييمك بـ 5 نجوم يعني لنا الكثير ويستغرق ثانية واحدة فقط:\n📍 ${settings.googleLink}` });
        } else if (/^[2٢]/.test(text)) {
            await updateStats('negative');
            await sock.sendMessage(remoteJid, { text: `نعتذر منك جداً 😔، نعدك بأن تجربتك القادمة ستكون أفضل.\n\nنهديك كود خصم لطلبك القادم:\n🎫 كود: *${settings.discountCode}*` });
            if (process.env.MANAGER_PHONE) {
                const manager = process.env.MANAGER_PHONE.replace(/[^0-9]/g, '');
                await sock.sendMessage(`${manager}@s.whatsapp.net`, { text: `⚠️ تقييم سلبي من: ${remoteJid.split('@')[0]}\nتواصل معه: https://wa.me/${remoteJid.split('@')[0]}` });
            }
        }
    });
}

// --- الجدولة والتحقق من الأرقام ---
const scheduleMessage = async (phone, name) => {
    const settings = await getSettings();
    let cleanP = phone.replace(/[^0-9]/g, '');
    if (cleanP.startsWith('05')) cleanP = '966' + cleanP.substring(1);
    if (cleanP.startsWith('5') && cleanP.length === 9) cleanP = '966' + cleanP;

    const baseDelay = (settings.delay === undefined || settings.delay === null) ? 0 : parseInt(settings.delay);
    let finalDelayMs = baseDelay > 0 ? (baseDelay * 60 * 1000) + Math.floor(Math.random() * 30000) : 3000;

    setTimeout(async () => {
        if (isReady && sock) {
            try {
                await new Promise(r => setTimeout(r, Math.random() * 5000));
                await sock.sendMessage(`${cleanP}@s.whatsapp.net`, { 
                    text: `مرحباً ${name || 'عميلنا العزيز'}، نورتنا! 🌸\n\nكيف كانت تجربة طلبك اليوم؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` 
                });
            } catch (e) { console.error(`❌ Send error:`, e); }
        }
    }, finalDelayMs);
};

// --- الروابط (Endpoints) ---
app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    await updateStats('order');
    scheduleMessage(req.body.phone, req.body.name);
    res.json({ success: true });
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { googleLink, discountCode, delay } = req.body;
    if (dbConnected) {
        try {
            await client.db('whatsapp_bot').collection('config').updateOne(
                { _id: 'global_settings' },
                { $set: { googleLink, discountCode, delay: (delay === "" || delay === null) ? 0 : parseInt(delay) } },
                { upsert: true }
            );
            res.json({ success: true });
        } catch (e) { res.status(500).send(e.message); }
    } else res.sendStatus(500);
});

// --- واجهة الإدارة UI ---
app.get('/admin', async (req, res) => {
    const settings = await getSettings();
    let stats = { totalOrders: 0, positive: 0, negative: 0 };
    if (dbConnected) stats = await client.db('whatsapp_bot').collection('analytics').findOne({ _id: 'daily_stats' }) || stats;
    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>RepuSystem | لوحة التحكم</title>
        <link rel="icon" href="https://cdn-icons-png.flaticon.com/512/870/870143.png" type="image/x-icon">
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');
            body { font-family: 'Cairo', sans-serif; background-color: #f8fafc; }
            .stat-card { transition: all 0.3s ease; }
            .stat-card:hover { transform: translateY(-5px); box-shadow: 0 10px 20px rgba(0,0,0,0.05); }
            .btn-action { transition: all 0.2s; }
            .btn-action:active { transform: scale(0.95); }
        </style>
    </head>
    <body class="p-4 md:p-8">
        <div class="max-w-5xl mx-auto">
            <header class="flex justify-between items-center mb-10">
                <div>
                    <h1 class="text-3xl font-black italic text-gray-900 tracking-tighter">REPU<span class="text-green-600 font-normal">SYSTEM</span></h1>
                    <p class="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Powered by Starter Tier</p>
                </div>
                <div class="bg-white px-5 py-2 rounded-2xl shadow-sm border flex items-center gap-2">
                    <div class="w-2 h-2 rounded-full ${isReady ? 'bg-green-500 animate-pulse' : 'bg-red-500'}"></div>
                    <span class="text-xs font-bold uppercase">${isReady ? 'نشط ✅' : 'جاري الربط...'}</span>
                </div>
            </header>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                <div class="stat-card bg-white p-6 rounded-3xl border-b-4 border-blue-500 shadow-sm text-center">
                    <p class="text-[10px] font-bold text-gray-400 uppercase mb-1">الطلبات اليوم</p>
                    <h2 class="text-3xl font-black text-gray-800">${stats.totalOrders}</h2>
                </div>
                <div class="stat-card bg-white p-6 rounded-3xl border-b-4 border-green-500 shadow-sm text-center">
                    <p class="text-[10px] font-bold text-gray-400 uppercase mb-1">تقييم ممتاز</p>
                    <h2 class="text-3xl font-black text-green-600">${stats.positive}</h2>
                </div>
                <div class="stat-card bg-white p-6 rounded-3xl border-b-4 border-red-500 shadow-sm text-center">
                    <p class="text-[10px] font-bold text-gray-400 uppercase mb-1">يحتاج تحسين</p>
                    <h2 class="text-3xl font-black text-red-500">${stats.negative}</h2>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
                <div class="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
                    <h3 class="text-lg font-bold mb-6 flex items-center gap-2 text-blue-600">
                        <span>📥</span> إرسال سريع
                    </h3>
                    <div class="space-y-4">
                        <input id="p" type="text" placeholder="رقم الجوال (مثال: 050xxx)" class="w-full p-4 bg-gray-50 rounded-2xl border-none ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-500 font-bold text-center outline-none">
                        <input id="n" type="text" placeholder="اسم العميل (اختياري)" class="w-full p-4 bg-gray-50 rounded-2xl border-none ring-1 ring-gray-200 focus:ring-2 focus:ring-blue-500 font-bold text-center outline-none">
                        <button onclick="send()" id="sb" class="btn-action w-full bg-blue-600 text-white p-4 rounded-2xl font-bold shadow-lg shadow-blue-100">جدولة الرسالة الآن</button>
                    </div>
                </div>

                <div class="bg-white p-8 rounded-[2rem] shadow-sm border border-gray-100">
                    <h3 class="text-lg font-bold mb-6 flex items-center gap-2 text-green-600">
                        <span>⚙️</span> الإعدادات الذكية
                    </h3>
                    <div class="space-y-4">
                        <div>
                            <label class="text-[10px] font-bold text-gray-400 mr-2 uppercase">رابط التقييم المباشر</label>
                            <input id="gl" type="text" value="${settings.googleLink}" class="w-full p-3 bg-gray-50 rounded-xl border-none ring-1 ring-gray-200 text-xs font-mono">
                        </div>
                        <div class="flex gap-4">
                            <div class="flex-1">
                                <label class="text-[10px] font-bold text-gray-400 block mb-1 uppercase text-center">كود الخصم</label>
                                <input id="dc" type="text" value="${settings.discountCode}" class="w-full p-3 bg-gray-50 rounded-xl border-none ring-1 ring-gray-200 font-bold text-center uppercase">
                            </div>
                            <div class="flex-1">
                                <label class="text-[10px] font-bold text-gray-400 block mb-1 uppercase text-center">التأخير (دقيقة)</label>
                                <input id="dl" type="number" value="${settings.delay}" class="w-full p-3 bg-gray-50 rounded-xl border-none ring-1 ring-gray-200 font-bold text-center">
                            </div>
                        </div>
                        <button onclick="save()" id="vb" class="btn-action w-full bg-gray-900 text-white p-4 mt-2 rounded-2xl font-bold">تحديث الإعدادات</button>
                    </div>
                </div>
            </div>

            <div class="bg-white p-10 rounded-[2rem] shadow-sm border border-gray-100 text-center">
                 ${lastQR ? '<div class="bg-gray-50 d-inline-block p-4 rounded-3xl mb-4 border-2 border-dashed mx-auto w-fit"><img src="' + lastQR + '" class="w-48 rounded-xl shadow-lg border-4 border-white"></div><p class="text-amber-600 font-bold animate-bounce">امسح الكود لتفعيل النظام 📱</p>' : isReady ? '<p class="text-green-600 font-black text-xl italic tracking-widest uppercase">RepuSystem Live & Stable ✅</p>' : '<p class="text-gray-400 animate-pulse font-bold uppercase">Connecting to cloud services...</p>'}
            </div>
        </div>

        <script>
            async function send() {
                let p = document.getElementById('p').value.trim(); const n = document.getElementById('n').value.trim();
                const btn = document.getElementById('sb');
                if(!p) return alert('يرجى إدخال الرقم');
                p = p.replace(/[^0-9]/g, '');
                if (p.startsWith('05')) p = '966' + p.substring(1);
                else if (p.startsWith('5') && p.length === 9) p = '966' + p;

                btn.disabled = true; btn.innerHTML = "جاري الجدولة...";
                try {
                    const res = await fetch('/send-evaluation?key=${process.env.WEBHOOK_KEY}', { 
                        method: 'POST', headers: {'Content-Type': 'application/json'}, 
                        body: JSON.stringify({phone:p, name:n}) 
                    });
                    if(res.ok) alert('✅ تمت الجدولة بنجاح للرقم: ' + p);
                    else alert('❌ فشل، تأكد من اتصال الواتساب');
                } catch(e) { alert('❌ خطأ في الاتصال'); }
                btn.disabled = false; btn.innerHTML = "جدولة الرسالة الآن";
            }
            async function save() {
                const d = { googleLink: document.getElementById('gl').value, discountCode: document.getElementById('dc').value, delay: document.getElementById('dl').value };
                const res = await fetch('/update-settings?key=${process.env.WEBHOOK_KEY}', { 
                    method: 'POST', headers: {'Content-Type': 'application/json'}, 
                    body: JSON.stringify(d) 
                });
                if(res.ok) { alert('✅ تم حفظ الإعدادات بنجاح'); location.reload(); }
            }
        </script>
    </body>
    </html>
    `);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { 
    await initMongo(); 
    await connectToWhatsApp(); 
    console.log('🚀 RepuSystem v6.2 Stable on Starter Tier'); 
});