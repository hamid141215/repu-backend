if (!globalThis.crypto) { globalThis.crypto = require('crypto').webcrypto; }
require('dotenv').config();
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());

const SESSION_PATH = 'auth_new_session';
let sock = null, isReady = false, lastQR = null;

const { MongoClient } = require('mongodb');
const MONGO_URL = process.env.MONGO_URL;
let client = null, dbConnected = false;

const initMongo = async () => {
    try {
        client = new MongoClient(MONGO_URL);
        await client.connect();
        dbConnected = true;
        console.log("🔗 MongoDB Connected.");
    } catch (e) { console.error("❌ MongoDB Fail"); }
};

async function syncSession() {
    if (!dbConnected) return;
    const credsPath = path.join(SESSION_PATH, 'creds.json');
    if (fs.existsSync(credsPath)) {
        const data = fs.readFileSync(credsPath, 'utf-8');
        await client.db('whatsapp_bot').collection('session').updateOne({ _id: 'creds' }, { $set: { data } }, { upsert: true });
    }
}
async function restoreSession() {
    if (!dbConnected) return;
    const res = await client.db('whatsapp_bot').collection('session').findOne({ _id: 'creds' });
    if (res) {
        if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });
        fs.writeFileSync(path.join(SESSION_PATH, 'creds.json'), res.data);
    }
}

async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await import('@whiskeysockets/baileys');
    await restoreSession();
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

    sock = makeWASocket({
        version, auth: state,
        logger: pino({ level: 'error' }),
        browser: Browsers.macOS('Desktop'),
        printQRInTerminal: false,
        shouldSyncHistoryMessage: () => false,
        connectTimeoutMs: 60000
    });

    sock.ev.on('creds.update', async () => { await saveCreds(); await syncSession(); });
    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
        if (connection === 'open') { isReady = true; lastQR = null; }
        if (connection === 'close') {
            isReady = false;
            const code = lastDisconnect?.error?.output?.statusCode;
            // إذا كان السبب تعارض (Conflict) ننتظر فترة أطول قبل المحاولة لمنع الحلقة المفرغة
            const delay = code === 409 ? 15000 : 5000;
            if (code !== DisconnectReason.loggedOut) setTimeout(connectToWhatsApp, delay);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            // سطر الحماية الجديد: تجاهل الحالات والرسائل غير النصية
            if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.fromMe) return;
    
            const phone = msg.key.remoteJid.split('@')[0];
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

            if (text === "1" || text === "2") {
                const s = dbConnected ? await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' }) : null;
                const config = s || { googleLink: "#", discountCode: "OFFER10" };
                
                if(dbConnected) {
                    await client.db('whatsapp_bot').collection('evaluations').updateOne(
                        { phone: phone, status: 'sent' },
                        { $set: { status: 'replied', answer: text, repliedAt: new Date() } },
                        { sort: { sentAt: -1 } }
                    );
                }

                if (text === "1") {
                    await sock.sendMessage(msg.key.remoteJid, { text: `يسعدنا تقييمك! 😍\n📍 ${config.googleLink}` });
                } else {
                    await sock.sendMessage(msg.key.remoteJid, { text: `نعتذر منك 😔\n🎫 كود الخصم: ${config.discountCode}` });
                }
            }
        } catch (e) {
            // منع الانهيار عند حدوث خطأ في فك التشفير
            console.log("🛡️ Decryption skip (Normal during deploy)");
        }
    });
}

// --- Landing Page ---
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>موجة الصمت</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-white flex flex-col items-center justify-center h-screen space-y-6"><h1 class="text-5xl font-black italic uppercase">MAWJAT <span class="text-blue-600">ALSAMT</span></h1><p class="text-xl text-gray-500">الحل الذكي لتقييمات المطاعم</p><a href="/admin" class="bg-blue-600 text-white px-10 py-4 rounded-2xl font-bold shadow-xl">دخول النظام</a></body></html>`);
});

// --- Admin Dashboard ---
app.get('/admin', async (req, res) => {
    const s = dbConnected ? await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' }) : { googleLink: "#", discountCode: "OFFER10", delay: 0 };
    const evals = dbConnected ? await client.db('whatsapp_bot').collection('evaluations').find().sort({ sentAt: -1 }).limit(10).toArray() : [];

    // تنظيف شامل للـ Template لضمان عدم ظهور الأكواد
    const tableRows = evals.map(e => `
        <tr class="border-b hover:bg-gray-50 transition">
            <td class="py-4 font-bold text-gray-700">${e.phone}</td>
            <td class="py-4 text-xs font-bold ${e.status === 'replied' ? 'text-green-500' : 'text-blue-500'} uppercase">${e.status === 'replied' ? 'تم الرد' : 'بالانتظار'}</td>
            <td class="py-4 font-black">${e.answer ? (e.answer === '1' ? 'ممتاز 😍' : 'تحسين 😔') : '-'}</td>
            <td class="py-4 text-[10px] text-gray-400 font-mono">${new Date(e.sentAt).toLocaleString('ar-SA')}</td>
        </tr>`).join('');

    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>لوحة التحكم | موجة الصمت</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style> @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap'); body { font-family: 'Cairo', sans-serif; background-color: #f8fafc; } </style>
    </head>
    <body class="p-4 md:p-8">
        <div class="max-w-5xl mx-auto space-y-8">
            <header class="flex justify-between items-center mb-10">
                <h1 class="text-2xl font-black italic">MAWJAT <span class="text-blue-600">ALSAMT</span></h1>
                <div class="bg-white px-5 py-2 rounded-2xl border text-xs font-bold flex items-center gap-2">
                    <div class="w-2 h-2 rounded-full ${isReady ? 'bg-green-500 animate-pulse' : 'bg-red-500'}"></div>
                    ${isReady ? 'متصل ✅' : 'جاري الربط...'}
                </div>
            </header>

            <div class="grid md:grid-cols-2 gap-8">
                <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border text-center space-y-4">
                    <h3 class="font-bold text-blue-600 italic tracking-tighter">📥 إرسال تقييم جديد</h3>
                    <input id="p" placeholder="05xxxxxxxx" class="w-full p-4 bg-gray-50 rounded-2xl border-none ring-1 ring-gray-100 font-bold text-center outline-none">
                    <button onclick="send()" id="sb" class="w-full bg-blue-600 text-white p-4 rounded-2xl font-bold shadow-lg shadow-blue-50 active:scale-95 transition">إرسال التقييم الآن</button>
                </div>

                <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border text-center space-y-4">
                    <h3 class="font-bold text-green-600 italic tracking-tighter">⚙️ الإعدادات</h3>
                    <input id="gl" value="${s?.googleLink}" class="w-full p-3 bg-gray-50 rounded-xl text-center text-[10px] outline-none border-none ring-1 ring-gray-100">
                    <div class="flex gap-2">
                        <input id="dc" value="${s?.discountCode}" class="w-1/2 p-3 bg-gray-50 rounded-xl text-center font-bold text-blue-600 border-none ring-1 ring-gray-100">
                        <input id="dl" value="${s?.delay}" class="w-1/2 p-3 bg-gray-50 rounded-xl text-center font-bold border-none ring-1 ring-gray-100">
                    </div>
                    <button onclick="save()" class="w-full bg-gray-900 text-white p-4 rounded-2xl font-bold transition">حفظ</button>
                </div>
            </div>

            <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border">
                <h3 class="font-bold mb-6 text-gray-800">📊 تقارير العمليات</h3>
                <div class="overflow-x-auto"><table class="w-full text-right text-sm"><thead><tr class="border-b text-gray-400"><th class="pb-4">العميل</th><th class="pb-4">الحالة</th><th class="pb-4">الرد</th><th class="pb-4">الوقت</th></tr></thead><tbody>${tableRows}</tbody></table></div>
            </div>

            <div class="bg-white p-6 rounded-[2.5rem] text-center border-2 border-dashed border-gray-100">
                ${lastQR ? `<img src="${lastQR}" class="mx-auto w-32 rounded-xl shadow-lg border">` : isReady ? '<p class="text-green-600 font-bold uppercase tracking-widest">Connected ✅</p>' : '<p class="animate-pulse">Loading QR...</p>'}
            </div>
        </div>
        <script>
            async function send() {
                const p = document.getElementById('p').value; const btn = document.getElementById('sb');
                if(!p) return alert('أدخل الرقم');
                btn.disabled = true; btn.innerText = 'جاري الإرسال...';
                const res = await fetch('/send-evaluation?key=${process.env.WEBHOOK_KEY}', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({phone:p}) });
                if(res.ok) { alert('✅ تم الإرسال'); location.reload(); }
            }
            async function save() {
                const d = { googleLink: document.getElementById('gl').value, discountCode: document.getElementById('dc').value, delay: document.getElementById('dl').value };
                const res = await fetch('/update-settings?key=${process.env.WEBHOOK_KEY}', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(d) });
                if(res.ok) alert('✅ تم الحفظ');
            }
        </script>
    </body>
    </html>`);
});

app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { phone } = req.body;
    if(dbConnected) await client.db('whatsapp_bot').collection('evaluations').insertOne({ phone: phone, status: 'sent', sentAt: new Date() });
    setTimeout(async () => {
        if (isReady && sock) {
            let p = phone.replace(/[^0-9]/g, '');
            if (p.startsWith('05')) p = '966' + p.substring(1);
            await sock.sendMessage(p + "@s.whatsapp.net", { text: "مرحباً بك! ✨ كيف كانت تجربتك معنا؟\\n1️⃣ ممتاز\\n2️⃣ يحتاج تحسين" });
        }
    }, 3000);
    res.json({ success: true });
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { googleLink, discountCode, delay } = req.body;
    if(dbConnected) await client.db('whatsapp_bot').collection('config').updateOne({ _id: 'global_settings' }, { $set: { googleLink, discountCode, delay: parseInt(delay) || 0 } }, { upsert: true });
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); await connectToWhatsApp(); });