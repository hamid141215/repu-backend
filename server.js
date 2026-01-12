/**
 * نظام سُمعة (RepuSystem) - النسخة الماستر v5.8
 * تشمل: ثبات الجلسة (MongoDB Persistence)، حماية الذروة (Anti-Ban Jitter)،
 * وتوافق البيئة السحابية (ESM & Crypto Fix).
 */

// 1. إصلاح مشكلة التشفير لبيئات Node القديمة (مثل Render v18)
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

// --- وظائف المزامنة لضمان عدم طلب الباركود عند كل تحديث ---
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
            console.log("💾 Session backed up to MongoDB.");
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
            console.log("📥 Session restored from MongoDB.");
            return true;
        }
    } catch (err) {}
    return false;
}

// --- وظائف الإعدادات والإحصائيات ---
async function getSettings() {
    if (!dbConnected) return { googleLink: "#", discountCode: "REPU10", delay: 20 };
    try {
        const settings = await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' });
        return settings || { googleLink: "#", discountCode: "REPU10", delay: 20 };
    } catch (e) { return { googleLink: "#", discountCode: "REPU10", delay: 20 }; }
}

async function updateStats(type) {
    if (!dbConnected) return;
    try {
        const update = {};
        if (type === 'order') update.totalOrders = 1;
        if (type === 'positive') update.positive = 1;
        if (type === 'negative') update.negative = 1;
        await client.db('whatsapp_bot').collection('analytics').updateOne(
            { _id: 'daily_stats' }, 
            { $inc: update }, 
            { upsert: true }
        );
    } catch (e) {}
}

// --- محرك الواتساب المتوافق والمستقر ---
async function connectToWhatsApp() {
    const { 
        default: makeWASocket, 
        useMultiFileAuthState, 
        DisconnectReason, 
        fetchLatestBaileysVersion,
        Browsers 
    } = await import('@whiskeysockets/baileys');

    // استعادة الجلسة من السحاب قبل البدء لتجنب طلب QR Code مجدداً
    if (!fs.existsSync(path.join(SESSION_PATH, 'creds.json'))) {
        await loadSessionFromMongo();
    }

    if (sock) { try { sock.terminate(); } catch (e) {} sock = null; }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

    sock = makeWASocket({
        version, auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop'),
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', async () => {
        await saveCreds();
        await syncSessionToMongo(); // حفظ في السحاب عند كل تغيير
    });

    sock.ev.on('connection.update', async (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
        
        if (connection === 'open') { 
            isReady = true; lastQR = null; 
            console.log('✅ WhatsApp Active & Persisted.'); 
            await syncSessionToMongo(); 
        }
        
        if (connection === 'close') {
            isReady = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                setTimeout(connectToWhatsApp, 5000);
            } else {
                // مسح الجلسة في حال تم تسجيل الخروج يدوياً
                if (dbConnected) await client.db('whatsapp_bot').collection('session_data').deleteOne({ _id: 'whatsapp_creds' });
                if (fs.existsSync(SESSION_PATH)) fs.rmSync(SESSION_PATH, { recursive: true, force: true });
                setTimeout(connectToWhatsApp, 5000);
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const remoteJid = msg.key.remoteJid;
        if (remoteJid.endsWith('@g.us')) return;

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        const settings = await getSettings();

        if (/^[1١]/.test(text)) {
            await updateStats('positive');
            await sock.sendMessage(remoteJid, { text: `يسعدنا جداً! 😍 تقييمك يدعمنا:\n📍 ${settings.googleLink}` });
        } else if (/^[2٢]/.test(text)) {
            await updateStats('negative');
            await sock.sendMessage(remoteJid, { text: `نعتذر منك 😔، نهديك كود خصم لطلبك القادم:\n🎫 كود: *${settings.discountCode}*` });
            if (process.env.MANAGER_PHONE) {
                const manager = process.env.MANAGER_PHONE.replace(/[^0-9]/g, '');
                await sock.sendMessage(`${manager}@s.whatsapp.net`, { text: `⚠️ تقييم سلبي من: ${remoteJid.split('@')[0]}\nتواصل معه: https://wa.me/${remoteJid.split('@')[0]}` });
            }
        } else if (/(شكرا|شكراً|تسلم|يعطيك|تمام|اوكي|ok|thanks)/i.test(text)) {
            await sock.sendMessage(remoteJid, { text: "في خدمتك دائماً، نورتنا! ❤️" });
        }
    });
}

// --- الجدولة الذكية (مع ميزة Anti-Ban Jitter) ---
const scheduleMessage = async (phone, name) => {
    const settings = await getSettings();
    const cleanP = phone.replace(/[^0-9]/g, '');
    
    // تفاوت عشوائي (1-5 دقائق) + تأخير أساسي
    const jitter = Math.floor(Math.random() * (5 * 60 * 1000));
    const delayMs = ((settings.delay || 20) * 60 * 1000) + jitter;

    setTimeout(async () => {
        if (isReady && sock) {
            try {
                // تأخير ثواني عشوائي إضافي قبل الإرسال لمحاكاة السلوك البشري
                await new Promise(r => setTimeout(r, Math.random() * 10000));
                await sock.sendMessage(`${cleanP}@s.whatsapp.net`, { 
                    text: `مرحباً ${name || 'عميلنا العزيز'}، نورتنا! 🌸\n\nكيف كانت تجربة طلبك اليوم؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` 
                });
            } catch (e) {}
        }
    }, delayMs);
};

// --- Webhooks & Admin Panel ---
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
        await client.db('whatsapp_bot').collection('config').updateOne({ _id: 'global_settings' }, { $set: { googleLink, discountCode, delay: parseInt(delay) || 20 } }, { upsert: true });
        res.json({ success: true });
    } else res.status(500).send("DB Error");
});

app.get('/admin', async (req, res) => {
    const settings = await getSettings();
    let stats = { totalOrders: 0, positive: 0, negative: 0 };
    if (dbConnected) stats = await client.db('whatsapp_bot').collection('analytics').findOne({ _id: 'daily_stats' }) || stats;
    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8"><title>لوحة تحكم RepuSystem</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    </head>
    <body class="bg-gray-50 p-4 md:p-10 font-sans text-right">
        <div class="max-w-4xl mx-auto">
            <header class="flex justify-between items-center mb-10">
                <h1 class="text-3xl font-black italic">REPU<span class="text-green-600 font-normal">SYSTEM</span></h1>
                <div class="bg-white px-5 py-2 rounded-full border shadow-sm font-bold text-sm">
                    حالة الواتساب: ${isReady ? '<span class="text-green-600">نشط ✅</span>' : '<span class="text-red-500 font-bold text-xs underline animate-pulse">يجب مسح الكود ⏳</span>'}
                </div>
            </header>
            
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10 text-center">
                <div class="bg-white p-6 rounded-3xl border-b-4 border-blue-500 shadow-sm"><p class="text-xs text-gray-400 font-bold mb-1 uppercase">إجمالي الطلبات</p><h2 class="text-3xl font-black italic text-gray-800">${stats.totalOrders}</h2></div>
                <div class="bg-white p-6 rounded-3xl border-b-4 border-green-500 shadow-sm"><p class="text-xs text-gray-400 font-bold mb-1 uppercase">عملاء راضون</p><h2 class="text-3xl font-black text-green-600 italic">${stats.positive}</h2></div>
                <div class="bg-white p-6 rounded-3xl border-b-4 border-red-500 shadow-sm"><p class="text-xs text-gray-400 font-bold mb-1 uppercase">شكاوى عملاء</p><h2 class="text-3xl font-black text-red-600 italic">${stats.negative}</h2></div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
                <div class="bg-white p-8 rounded-3xl border shadow-sm">
                    <h3 class="font-bold mb-6 text-blue-600 italic border-b pb-2"><i class="fas fa-paper-plane ml-2"></i>إرسال يدوي سريع</h3>
                    <input id="p" type="text" placeholder="رقم الجوال (9665...)" class="w-full p-4 mb-3 bg-gray-50 rounded-2xl border outline-none font-bold">
                    <input id="n" type="text" placeholder="اسم العميل (اختياري)" class="w-full p-4 mb-6 bg-gray-50 rounded-2xl border outline-none font-bold">
                    <button onclick="send()" id="btnS" class="w-full bg-blue-600 text-white p-4 rounded-2xl font-bold hover:bg-blue-700 transition shadow-lg">جدولة الإرسال</button>
                </div>
                <div class="bg-white p-8 rounded-3xl border shadow-sm">
                    <h3 class="font-bold mb-6 text-green-600 italic border-b pb-2"><i class="fas fa-cog ml-2"></i>الإعدادات المركزية</h3>
                    <label class="text-xs font-bold text-gray-400 mr-2 uppercase">رابط جوجل ماب</label>
                    <input id="gl" type="text" value="${settings.googleLink}" class="w-full p-3 mb-4 bg-gray-50 rounded-xl border text-xs font-mono">
                    <div class="flex gap-4">
                        <div class="w-1/2 text-center"><label class="text-xs font-bold text-gray-400 block mb-1">كود الخصم</label><input id="dc" type="text" value="${settings.discountCode}" class="w-full p-3 bg-gray-50 rounded-xl border text-sm font-bold uppercase text-center"></div>
                        <div class="w-1/2 text-center"><label class="text-xs font-bold text-gray-400 block mb-1">وقت التأخير</label><input id="dl" type="number" value="${settings.delay}" class="w-full p-3 bg-gray-50 rounded-xl border text-sm font-bold text-center"></div>
                    </div>
                    <button onclick="save()" id="btnV" class="w-full bg-green-600 text-white p-4 mt-6 rounded-2xl font-bold hover:bg-green-700 transition shadow-lg">حفظ البيانات</button>
                </div>
            </div>
            
            <div class="bg-white p-10 rounded-3xl border shadow-sm text-center">
                 ${lastQR ? `<p class="mb-6 font-bold text-amber-600 animate-pulse italic underline">⚠️ يرجى مسح الرمز من واتساب الجوال</p><div class="p-4 inline-block bg-white rounded-2xl border-8 border-gray-50 shadow-inner"><img src="${lastQR}" class="mx-auto w-48"></div>` : isReady ? `<div class="text-green-600 py-6 font-black italic"><i class="fas fa-shield-alt text-7xl mb-4"></i><p class="text-2xl italic tracking-tighter">النظام محمي ومتصل بالسحاب</p></div>` : '<p class="py-10 text-gray-400 animate-pulse font-bold italic">⏳ جاري استرجاع الجلسة من السحاب...</p>'}
            </div>
        </div>
        <script>
            async function send() {
                const phone = document.getElementById('p').value; const name = document.getElementById('n').value;
                if(!phone) return alert('أدخل الرقم');
                const res = await fetch('/send-evaluation?key=${process.env.WEBHOOK_KEY}', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({phone, name}) });
                if(res.ok) alert('✅ تمت الجدولة');
            }
            async function save() {
                const googleLink = document.getElementById('gl').value; const discountCode = document.getElementById('dc').value; const delay = document.getElementById('dl').value;
                const res = await fetch('/update-settings?key=${process.env.WEBHOOK_KEY}', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({googleLink, discountCode, delay}) });
                if(res.ok) { alert('✅ تم التحديث'); location.reload(); }
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
    console.log(`🚀 RepuSystem v5.8 Live & Persisted`);
});