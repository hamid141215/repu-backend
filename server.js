/**
 * نظام سُمعة (RepuSystem) - النسخة الماستر v5.2 (النهائية)
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

// --- وظائف الإعدادات والإحصائيات ---
async function getSettings() {
    if (!dbConnected) return { googleLink: "#", discountCode: "REPU10", delay: 20 };
    const settings = await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' });
    return settings || { googleLink: "https://maps.google.com", discountCode: "REPU10", delay: 20 };
}

async function updateStats(type) {
    if (!dbConnected) return;
    const update = {};
    if (type === 'order') update.$inc = { totalOrders: 1 };
    if (type === 'positive') update.$inc = { positive: 1 };
    if (type === 'negative') update.$inc = { negative: 1 };
    await client.db('whatsapp_bot').collection('analytics').updateOne({ _id: 'daily_stats' }, update, { upsert: true });
}

// --- محرك الواتساب (نفس المنطق الأساسي) ---
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.appropriate('Chrome'),
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => {
        const { connection, qr } = u;
        if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
        if (connection === 'open') { isReady = true; lastQR = null; }
        if (connection === 'close') { isReady = false; setTimeout(connectToWhatsApp, 5000); }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const remoteJid = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        const settings = await getSettings();

        if (/^[1١]/.test(text)) {
            await updateStats('positive');
            await sock.sendMessage(remoteJid, { text: `يسعدنا جداً! 😍 شاركنا تقييمك هنا:\n📍 ${settings.googleLink}` });
        } else if (/^[2٢]/.test(text)) {
            await updateStats('negative');
            await sock.sendMessage(remoteJid, { text: `نعتذر منك 😔، نهديك كود خصم:\n🎫 الكود: *${settings.discountCode}*` });
            if (process.env.MANAGER_PHONE) {
                const manager = process.env.MANAGER_PHONE.replace(/[^0-9]/g, '');
                await sock.sendMessage(`${manager}@s.whatsapp.net`, { text: `⚠️ تقييم سلبي من https://wa.me/${remoteJid.split('@')[0]}` });
            }
        }
    });
}

// --- الجدولة ---
const scheduleMessage = async (phone, name) => {
    const settings = await getSettings();
    const cleanP = phone.replace(/[^0-9]/g, '');
    setTimeout(async () => {
        if (isReady && sock) {
            await sock.sendMessage(`${cleanP}@s.whatsapp.net`, { 
                text: `مرحباً ${name || 'عميلنا العزيز'}، نورتنا! 🌸\n\nكيف كانت تجربة طلبك اليوم؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` 
            });
        }
    }, settings.delay * 60 * 1000);
};

// --- Webhooks ---
app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    await updateStats('order');
    scheduleMessage(req.body.phone, req.body.name);
    res.json({ success: true });
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { googleLink, discountCode, delay } = req.body;
    await client.db('whatsapp_bot').collection('config').updateOne(
        { _id: 'global_settings' },
        { $set: { googleLink, discountCode, delay: parseInt(delay) } },
        { upsert: true }
    );
    res.json({ success: true });
});

// --- واجهة الإدارة ---
app.get('/admin', async (req, res) => {
    const settings = await getSettings();
    const stats = dbConnected ? await client.db('whatsapp_bot').collection('analytics').findOne({ _id: 'daily_stats' }) : {};
    
    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>RepuSystem Admin</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    </head>
    <body class="bg-gray-50 p-4 md:p-10 font-sans">
        <div class="max-w-4xl mx-auto">
            <h1 class="text-3xl font-black mb-8 italic">REPU<span class="text-green-600">SYSTEM</span></h1>
            
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <div class="bg-white p-6 rounded-2xl shadow-sm border-r-4 border-blue-500">
                    <p class="text-xs text-gray-400 font-bold uppercase">إجمالي الإرسال</p>
                    <h2 class="text-2xl font-black">${stats?.totalOrders || 0}</h2>
                </div>
                <div class="bg-white p-6 rounded-2xl shadow-sm border-r-4 border-green-500">
                    <p class="text-xs text-gray-400 font-bold uppercase">تقييم ممتاز</p>
                    <h2 class="text-2xl font-black text-green-600">${stats?.positive || 0}</h2>
                </div>
                <div class="bg-white p-6 rounded-2xl shadow-sm border-r-4 border-red-500">
                    <p class="text-xs text-gray-400 font-bold uppercase">شكاوى</p>
                    <h2 class="text-2xl font-black text-red-600">${stats?.negative || 0}</h2>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div class="bg-white p-6 rounded-2xl shadow-sm border">
                    <h3 class="font-bold mb-4 border-b pb-2 italic">إرسال سريع (هايبرد)</h3>
                    <input id="p" type="text" placeholder="رقم الجوال" class="w-full p-3 mb-3 bg-gray-50 rounded-xl outline-none">
                    <input id="n" type="text" placeholder="اسم العميل (اختياري)" class="w-full p-3 mb-4 bg-gray-50 rounded-xl outline-none">
                    <button onclick="send()" class="w-full bg-black text-white p-3 rounded-xl font-bold">جدولة الرسالة</button>
                </div>

                <div class="bg-white p-6 rounded-2xl shadow-sm border">
                    <h3 class="font-bold mb-4 border-b pb-2 italic">إعدادات النظام</h3>
                    <label class="text-xs font-bold text-gray-400">رابط جوجل ماب</label>
                    <input id="gl" type="text" value="${settings.googleLink}" class="w-full p-2 mb-3 bg-gray-50 rounded-lg outline-none text-sm">
                    <label class="text-xs font-bold text-gray-400">كود الخصم</label>
                    <input id="dc" type="text" value="${settings.discountCode}" class="w-full p-2 mb-4 bg-gray-50 rounded-lg outline-none text-sm font-mono">
                    <button onclick="save()" class="w-full bg-green-600 text-white p-2 rounded-xl text-sm font-bold">حفظ التغييرات</button>
                </div>
            </div>
            
            <div class="mt-8 bg-white p-6 rounded-2xl shadow-sm border text-center">
                 ${lastQR ? `<p class="mb-4 font-bold text-amber-600 italic text-sm">يرجى مسح الرمز للربط</p><img src="${lastQR}" class="mx-auto w-40">` : isReady ? `<p class="text-green-600 font-bold"><i class="fas fa-check-circle"></i> النظام متصل ونشط</p>` : 'جاري التحميل...'}
            </div>
        </div>

        <script>
            async function send() {
                const phone = document.getElementById('p').value;
                const name = document.getElementById('n').value;
                await fetch('/send-evaluation?key=${process.env.WEBHOOK_KEY}', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({phone, name})
                });
                alert('تمت الجدولة');
            }
            async function save() {
                const googleLink = document.getElementById('gl').value;
                const discountCode = document.getElementById('dc').value;
                await fetch('/update-settings?key=${process.env.WEBHOOK_KEY}', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({googleLink, discountCode, delay: ${settings.delay}})
                });
                alert('تم حفظ الإعدادات');
                location.reload();
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
    console.log("RepuSystem v5.2 Ready.");
});