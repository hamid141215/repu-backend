/**
 * نظام سُمعة (RepuSystem) - النسخة v5.6 (إصلاح مشكلة Crypto & Subtle)
 */

// --- إصلاح مشكلة Crypto لنسخ Node القديمة ---
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
            console.log("🔗 MongoDB Atlas connected.");
        } catch (e) { console.error("❌ MongoDB connection error."); }
    }
};

// --- وظائف الإعدادات والإحصائيات ---
async function getSettings() {
    if (!dbConnected) return { googleLink: "#", discountCode: "REPU10", delay: 20 };
    try {
        const settings = await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' });
        return settings || { googleLink: "https://maps.google.com", discountCode: "REPU10", delay: 20 };
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

// --- محرك الواتساب ---
async function connectToWhatsApp() {
    const { 
        default: makeWASocket, 
        useMultiFileAuthState, 
        DisconnectReason, 
        fetchLatestBaileysVersion,
        Browsers 
    } = await import('@whiskeysockets/baileys');

    if (sock) {
        try { sock.terminate(); } catch (e) {}
        sock = null;
    }

    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
        const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: Browsers.macOS('Desktop'),
            printQRInTerminal: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (u) => {
            const { connection, lastDisconnect, qr } = u;
            if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
            
            if (connection === 'open') { isReady = true; lastQR = null; console.log('✅ WhatsApp Active.'); }
            if (connection === 'close') {
                isReady = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode !== DisconnectReason.loggedOut) setTimeout(connectToWhatsApp, 5000);
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
            } 
            else if (/^[2٢]/.test(text)) {
                await updateStats('negative');
                await sock.sendMessage(remoteJid, { text: `نعتذر منك 😔، نهديك كود خصم لطلبك القادم:\n🎫 كود: *${settings.discountCode}*` });
                
                if (process.env.MANAGER_PHONE) {
                    const manager = process.env.MANAGER_PHONE.replace(/[^0-9]/g, '');
                    const customer = remoteJid.split('@')[0];
                    await sock.sendMessage(`${manager}@s.whatsapp.net`, { text: `⚠️ تقييم سلبي من: ${customer}\nتواصل معه: https://wa.me/${customer}` });
                }
            }
            else if (/(شكرا|شكراً|تسلم|يعطيك|تمام|اوكي|ok|thanks)/i.test(text)) {
                await sock.sendMessage(remoteJid, { text: "في خدمتك دائماً، نورتنا! ❤️" });
            }
        });
    } catch (e) { 
        console.error("WhatsApp Error:", e);
        setTimeout(connectToWhatsApp, 10000); 
    }
}

// --- الجدولة والـ Webhooks ---
const scheduleMessage = async (phone, name) => {
    const settings = await getSettings();
    const cleanP = phone.replace(/[^0-9]/g, '');
    const delayMs = (settings.delay || 20) * 60 * 1000;
    setTimeout(async () => {
        if (isReady && sock) {
            try {
                await sock.sendMessage(`${cleanP}@s.whatsapp.net`, { 
                    text: `مرحباً ${name || 'عميلنا العزيز'}، نورتنا! 🌸\n\nكيف كانت تجربة طلبك اليوم؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` 
                });
            } catch (e) {}
        }
    }, delayMs);
};

app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { phone, name } = req.body;
    if (!phone) return res.status(400).send("Phone required");
    await updateStats('order');
    scheduleMessage(phone, name);
    res.json({ success: true });
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { googleLink, discountCode, delay } = req.body;
    if (dbConnected) {
        await client.db('whatsapp_bot').collection('config').updateOne(
            { _id: 'global_settings' },
            { $set: { googleLink, discountCode, delay: parseInt(delay) || 20 } },
            { upsert: true }
        );
        res.json({ success: true });
    } else res.status(500).send("DB Error");
});

// --- واجهة الإدارة ---
app.get('/admin', async (req, res) => {
    const settings = await getSettings();
    let stats = { totalOrders: 0, positive: 0, negative: 0 };
    if (dbConnected) {
        stats = await client.db('whatsapp_bot').collection('analytics').findOne({ _id: 'daily_stats' }) || stats;
    }
    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>لوحة تحكم RepuSystem</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    </head>
    <body class="bg-gray-50 p-4 md:p-10 font-sans text-right">
        <div class="max-w-4xl mx-auto">
            <header class="flex justify-between items-center mb-8">
                <h1 class="text-3xl font-black italic tracking-tighter text-gray-800">REPU<span class="text-green-600 font-normal">SYSTEM</span></h1>
                <div class="px-4 py-2 rounded-full shadow-sm bg-white border font-bold text-xs uppercase">
                    الحالة: ${isReady ? '<span class="text-green-600 font-bold">نشط ✅</span>' : '<span class="text-red-500 font-bold">جاري الربط ⏳</span>'}
                </div>
            </header>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 text-center">
                <div class="bg-white p-6 rounded-3xl shadow-sm border-b-4 border-blue-500"><p class="text-xs text-gray-400 font-bold mb-1 uppercase">الطلبات</p><h2 class="text-3xl font-black">${stats.totalOrders}</h2></div>
                <div class="bg-white p-6 rounded-3xl shadow-sm border-b-4 border-green-500"><p class="text-xs text-gray-400 font-bold mb-1 uppercase">ممتاز</p><h2 class="text-3xl font-black text-green-600">${stats.positive}</h2></div>
                <div class="bg-white p-6 rounded-3xl shadow-sm border-b-4 border-red-500"><p class="text-xs text-gray-400 font-bold mb-1 uppercase">شكاوى</p><h2 class="text-3xl font-black text-red-600">${stats.negative}</h2></div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                <div class="bg-white p-8 rounded-3xl shadow-sm border">
                    <h3 class="font-bold mb-6 text-blue-600 border-b pb-2 italic"><i class="fas fa-paper-plane ml-2"></i>إرسال يدوي</h3>
                    <input id="p" type="text" placeholder="9665..." class="w-full p-4 mb-3 bg-gray-50 rounded-2xl border font-bold">
                    <input id="n" type="text" placeholder="الاسم (اختياري)" class="w-full p-4 mb-6 bg-gray-50 rounded-2xl border font-bold">
                    <button onclick="send()" id="btnS" class="w-full bg-blue-600 text-white p-4 rounded-2xl font-bold hover:bg-blue-700 transition">إرسال الآن</button>
                </div>
                <div class="bg-white p-8 rounded-3xl shadow-sm border">
                    <h3 class="font-bold mb-6 text-green-600 border-b pb-2 italic"><i class="fas fa-cog ml-2"></i>الإعدادات</h3>
                    <label class="text-xs font-bold text-gray-400">رابط جوجل</label>
                    <input id="gl" type="text" value="${settings.googleLink}" class="w-full p-3 mb-4 bg-gray-50 rounded-xl border text-sm">
                    <div class="flex gap-4">
                        <div class="w-1/2"><label class="text-xs font-bold text-gray-400 uppercase text-center block">الكود</label><input id="dc" type="text" value="${settings.discountCode}" class="w-full p-3 bg-gray-50 rounded-xl border text-sm font-bold uppercase text-center"></div>
                        <div class="w-1/2"><label class="text-xs font-bold text-gray-400 uppercase text-center block">الدقائق</label><input id="dl" type="number" value="${settings.delay}" class="w-full p-3 bg-gray-50 rounded-xl border text-sm font-bold text-center"></div>
                    </div>
                    <button onclick="save()" id="btnV" class="w-full bg-green-600 text-white p-4 mt-6 rounded-2xl font-bold hover:bg-green-700 transition">حفظ</button>
                </div>
            </div>
            <div class="bg-white p-10 rounded-3xl shadow-sm border text-center">
                 ${lastQR ? `<p class="mb-6 font-bold text-amber-600 animate-pulse italic">⚠️ يرجى مسح الرمز للربط</p><div class="p-4 inline-block bg-white rounded-2xl shadow-inner border-8 border-gray-50"><img src="${lastQR}" class="mx-auto w-48"></div>` : isReady ? `<div class="text-green-600 py-6"><i class="fas fa-check-circle text-7xl mb-4"></i><p class="text-xl font-black">الواتساب متصل</p></div>` : '<p class="py-10 text-gray-400 animate-pulse font-bold italic">⏳ جاري التحميل...</p>'}
            </div>
        </div>
        <script>
            async function send() {
                const phone = document.getElementById('p').value; const name = document.getElementById('n').value;
                if(!phone) return alert('أدخل الرقم');
                const res = await fetch('/send-evaluation?key=${process.env.WEBHOOK_KEY}', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({phone, name}) });
                if(res.ok) alert('✅ تمت الجدولة'); else alert('❌ خطأ');
            }
            async function save() {
                const googleLink = document.getElementById('gl').value; const discountCode = document.getElementById('dc').value; const delay = document.getElementById('dl').value;
                const res = await fetch('/update-settings?key=${process.env.WEBHOOK_KEY}', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({googleLink, discountCode, delay}) });
                if(res.ok) { alert('✅ تم التحديث'); location.reload(); } else alert('❌ فشل الحفظ');
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
    console.log(`🚀 RepuSystem v5.6 Ready on Port ${PORT}`);
});