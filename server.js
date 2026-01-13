/**
 * نظام سُمعة (RepuSystem) - النسخة الاحترافية v5.9
 * (Persistence + Anti-Ban + Fixed Admin Dashboard)
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

// --- مزامنة الجلسة مع السحاب ---
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

// --- الإعدادات والإحصائيات ---
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

        // --- منطق الرد الذكي على العميل ---
        if (/^[1١]/.test(text)) {
            await updateStats('positive');
            // النص الجديد والمحفز للعميل الراضي
            const successMsg = `يسعدنا جداً أن التجربة نالت إعجابك! 😍\n\nتقييمك بـ 5 نجوم يعني لنا الكثير ويستغرق ثانية واحدة فقط:\n📍 ${settings.googleLink}`;
            await sock.sendMessage(remoteJid, { text: successMsg });

        } else if (/^[2٢]/.test(text)) {
            await updateStats('negative');
            // نص العميل المستاء مع كود الخصم
            const sorryMsg = `نعتذر منك جداً 😔، نعدك بأن تجربتك القادمة ستكون أفضل.\n\nنهديك كود خصم لطلبك القادم:\n🎫 كود: *${settings.discountCode}*`;
            await sock.sendMessage(remoteJid, { text: sorryMsg });

            // تنبيه المدير (إذا كان الرقم مضافاً في الإعدادات)
            if (process.env.MANAGER_PHONE) {
                const manager = process.env.MANAGER_PHONE.replace(/[^0-9]/g, '');
                const alertMsg = `⚠️ *تنبيه: تقييم سلبي جديد*\n\nالعميل: ${remoteJid.split('@')[0]}\nالحالة: اختار "يحتاج تحسين"\n\nيرجى التواصل معه للاحتواء: https://wa.me/${remoteJid.split('@')[0]}`;
                await sock.sendMessage(`${manager}@s.whatsapp.net`, { text: alertMsg });
            }
        }
    });
}

// --- الجدولة والأمان ---
const scheduleMessage = async (phone, name) => {
    const settings = await getSettings();
    const cleanP = phone.replace(/[^0-9]/g, '');
    const jitter = Math.floor(Math.random() * (5 * 60 * 1000));
    const delayMs = ((parseInt(settings.delay) || 20) * 60 * 1000) + jitter;

    setTimeout(async () => {
        if (isReady && sock) {
            try {
                await new Promise(r => setTimeout(r, Math.random() * 10000));
                await sock.sendMessage(`${cleanP}@s.whatsapp.net`, { 
                    text: `مرحباً ${name || 'عميلنا العزيز'}، نورتنا! 🌸\n\nكيف كانت تجربة طلبك اليوم؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` 
                });
            } catch (e) {}
        }
    }, delayMs);
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
        await client.db('whatsapp_bot').collection('config').updateOne(
            { _id: 'global_settings' },
            { $set: { googleLink, discountCode, delay: parseInt(delay) || 20 } },
            { upsert: true }
        );
        res.json({ success: true });
    } else res.sendStatus(500);
});

app.get('/admin', async (req, res) => {
    const settings = await getSettings();
    let stats = { totalOrders: 0, positive: 0, negative: 0 };
    if (dbConnected) stats = await client.db('whatsapp_bot').collection('analytics').findOne({ _id: 'daily_stats' }) || stats;
    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><script src="https://cdn.tailwindcss.com"></script></head>
    <body class="bg-gray-100 p-5 md:p-10 text-right font-sans">
        <div class="max-w-4xl mx-auto text-gray-800">
            <header class="flex justify-between items-center mb-10">
                <h1 class="text-3xl font-black italic">REPU<span class="text-green-600 font-normal">SYSTEM</span></h1>
                <div class="bg-white px-5 py-2 rounded-full shadow-sm font-bold text-xs uppercase border">
                    ${isReady ? '<span class="text-green-600">نشط ✅</span>' : '<span class="text-red-500 animate-pulse font-bold">جاري الربط...</span>'}
                </div>
            </header>

            <div class="grid grid-cols-3 gap-6 mb-10">
                <div class="bg-white p-6 rounded-3xl shadow-sm border-b-4 border-blue-500"><p class="text-[10px] font-bold text-gray-400">إجمالي الطلبات</p><h2 class="text-2xl font-black">${stats.totalOrders}</h2></div>
                <div class="bg-white p-6 rounded-3xl shadow-sm border-b-4 border-green-500"><p class="text-[10px] font-bold text-gray-400">تقييم ممتاز</p><h2 class="text-2xl font-black text-green-600">${stats.positive}</h2></div>
                <div class="bg-white p-6 rounded-3xl shadow-sm border-b-4 border-red-500"><p class="text-[10px] font-bold text-gray-400">تقييم سلبي</p><h2 class="text-2xl font-black text-red-600">${stats.negative}</h2></div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
                <div class="bg-white p-8 rounded-3xl shadow-sm border">
                    <h3 class="font-bold mb-6 text-blue-600 border-b pb-2 italic">إرسال يدوي للطلبات</h3>
                    <input id="p" type="text" placeholder="رقم الجوال (966...)" class="w-full p-4 mb-3 bg-gray-50 rounded-2xl border font-bold text-center">
                    <input id="n" type="text" placeholder="اسم العميل (اختياري)" class="w-full p-4 mb-6 bg-gray-50 rounded-2xl border font-bold text-center">
                    <button onclick="send()" id="sb" class="w-full bg-blue-600 text-white p-4 rounded-2xl font-bold shadow-lg">جدولة الرسالة</button>
                </div>
                <div class="bg-white p-8 rounded-3xl shadow-sm border">
                    <h3 class="font-bold mb-6 text-green-600 border-b pb-2 italic">إعدادات النظام</h3>
                    <label class="text-[10px] font-bold text-gray-400">رابط جوجل ماب</label>
                    <input id="gl" type="text" value="${settings.googleLink}" class="w-full p-3 mb-4 bg-gray-50 rounded-xl border text-xs font-mono">
                    <div class="flex gap-4">
                        <div class="w-1/2 text-center"><label class="text-[10px] font-bold text-gray-400 block">كود الخصم</label><input id="dc" type="text" value="${settings.discountCode}" class="w-full p-3 bg-gray-50 rounded-xl border text-sm font-bold text-center uppercase"></div>
                        <div class="w-1/2 text-center"><label class="text-[10px] font-bold text-gray-400 block">التأخير (د)</label><input id="dl" type="number" value="${settings.delay}" class="w-full p-3 bg-gray-50 rounded-xl border text-sm font-bold text-center"></div>
                    </div>
                    <button onclick="save()" id="vb" class="w-full bg-green-600 text-white p-4 mt-6 rounded-2xl font-bold shadow-lg">حفظ الإعدادات</button>
                </div>
            </div>

            <div class="bg-white p-10 rounded-3xl shadow-sm border text-center">
                 ${lastQR ? `<img src="${lastQR}" class="mx-auto w-40 mb-4 border-4 p-2 rounded-xl"><p class="text-amber-600 font-bold">امسح الكود لتفعيل الواتساب</p>` : isReady ? '<p class="text-green-600 font-black text-xl italic">نظام سُمعة مؤمن ويعمل بالكامل ✅</p>' : '<p class="text-gray-400 animate-pulse">جاري الاتصال بالسحاب...</p>'}
            </div>
        </div>
        <script>
            async function send() {
                const p = document.getElementById('p').value; const n = document.getElementById('n').value;
                if(!p) return alert('أدخل الرقم');
                const res = await fetch('/send-evaluation?key=${process.env.WEBHOOK_KEY}', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({phone:p, name:n}) });
                if(res.ok) alert('✅ تمت الجدولة');
            }
            async function save() {
                const d = { googleLink: document.getElementById('gl').value, discountCode: document.getElementById('dc').value, delay: document.getElementById('dl').value };
                const res = await fetch('/update-settings?key=${process.env.WEBHOOK_KEY}', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(d) });
                if(res.ok) { alert('✅ تم التحديث'); location.reload(); }
            }
        </script>
    </body>
    </html>
    `);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); await connectToWhatsApp(); console.log('🚀 System v5.9 Live'); });