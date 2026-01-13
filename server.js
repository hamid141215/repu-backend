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

// --- MongoDB Setup (Cloud Sync) ---
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

// دالة لمزامنة الجلسة مع السحاب لعدم طلب الباركود مجدداً
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

// --- WhatsApp Logic ---
async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await import('@whiskeysockets/baileys');
    
    await restoreSession(); // استعادة الجلسة من MongoDB قبل التشغيل
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

    sock = makeWASocket({
        version, auth: state,
        logger: pino({ level: 'error' }),
        browser: Browsers.macOS('Desktop'),
        printQRInTerminal: false,
        shouldSyncHistoryMessage: () => false
    });

    sock.ev.on('creds.update', async () => { await saveCreds(); await syncSession(); });
    
    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
        if (connection === 'open') { isReady = true; lastQR = null; console.log('✅ Connected.'); }
        if (connection === 'close') {
            isReady = false;
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) setTimeout(connectToWhatsApp, 5000);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg || !msg.message || msg.key.fromMe) return;
            const remoteJid = msg.key.remoteJid;
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

            if (text === "1" || text === "2") {
                const s = dbConnected ? await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' }) : null;
                const config = s || { googleLink: "#", discountCode: "OFFER10" };
                
                if (text === "1") {
                    await sock.sendMessage(remoteJid, { text: `يسعدنا تقييمك! 😍\n📍 ${config.googleLink}` });
                    if(dbConnected) await client.db('whatsapp_bot').collection('analytics').updateOne({ _id: 'daily_stats' }, { $inc: { positive: 1 } }, { upsert: true });
                } else {
                    await sock.sendMessage(remoteJid, { text: `نعتذر منك 😔\n🎫 كود الخصم: ${config.discountCode}` });
                    if(dbConnected) await client.db('whatsapp_bot').collection('analytics').updateOne({ _id: 'daily_stats' }, { $inc: { negative: 1 } }, { upsert: true });
                }
            }
        } catch (e) { console.log("⚠️ Decryption Error Handled"); }
    });
}

// --- API ---
app.get('/', (req, res) => res.redirect('/admin'));

app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { phone, name, branch } = req.body;
    
    const settings = dbConnected ? await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' }) : { delay: 0 };
    const greetings = [
        `مرحباً ${name || 'عميلنا العزيز'}، نورتنا في ${branch || 'فرعنا'}! 🌸`,
        `أهلاً بك ${name || 'يا غالي'}، سعدنا بزيارتك لـ ${branch || 'مطعمنا'} اليوم. ✨`,
        `حيّاك الله ${name || 'عزيزنا'}، نشكرك على اختيارك لـ ${branch || 'لنا'}. 😊`
    ];
    const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
    const totalDelay = (parseInt(settings?.delay) || 0) * 60000 + 3000;

    setTimeout(async () => {
        if (isReady && sock) {
            let p = phone.replace(/[^0-9]/g, '');
            if (p.startsWith('05')) p = '966' + p.substring(1);
            await sock.sendMessage(p + "@s.whatsapp.net", { 
                text: `${randomGreeting}\n\nكيف كانت تجربتك معنا؟ نرجو منك اختيار رقم:\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` 
            });
        }
    }, totalDelay);
    res.json({ success: true });
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { googleLink, discountCode, delay } = req.body;
    if(dbConnected) await client.db('whatsapp_bot').collection('config').updateOne({ _id: 'global_settings' }, { $set: { googleLink, discountCode, delay: parseInt(delay) || 0 } }, { upsert: true });
    res.json({ success: true });
});

// --- UI (Cleaned & Corrected) ---
app.get('/admin', async (req, res) => {
    const s = dbConnected ? await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' }) : { googleLink: "#", discountCode: "OFFER10", delay: 0 };
    const br = dbConnected ? await client.db('whatsapp_bot').collection('branches').find().toArray() : [];
    const stats = dbConnected ? await client.db('whatsapp_bot').collection('analytics').findOne({ _id: 'daily_stats' }) : { positive: 0, negative: 0 };

    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8"><title>لوحة تحكم موجة الصمت</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style> @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap'); body { font-family: 'Cairo', sans-serif; background-color: #f8fafc; } </style>
    </head>
    <body class="p-4 md:p-8">
        <div class="max-w-4xl mx-auto text-right">
            <header class="flex justify-between items-center mb-8">
                <h1 class="text-3xl font-black italic">MAWJAT <span class="text-blue-600">ALSAMT</span></h1>
                <div class="bg-white px-4 py-2 rounded-2xl border flex items-center gap-2 font-bold text-xs uppercase">
                    <div class="w-2 h-2 rounded-full ${isReady ? 'bg-green-500 animate-pulse' : 'bg-red-500'}"></div>
                    ${isReady ? 'متصل ✅' : 'جاري الربط...'}
                </div>
            </header>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <div class="bg-white p-5 rounded-3xl border shadow-sm"><p class="text-[10px] font-bold text-green-500">ممتاز</p><h3 class="text-xl font-black">${stats?.positive || 0}</h3></div>
                <div class="bg-white p-5 rounded-3xl border shadow-sm"><p class="text-[10px] font-bold text-red-500">تحسين</p><h3 class="text-xl font-black">${stats?.negative || 0}</h3></div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border space-y-4 text-center">
                    <h3 class="font-bold text-blue-600 italic tracking-tighter">📥 جدولة طلب</h3>
                    <select id="branch" class="w-full p-4 bg-gray-50 rounded-2xl border-none ring-1 ring-gray-100 font-bold outline-none">
                        <option value="الفرع الرئيسي">الفرع الرئيسي</option>
                        <option value="فرع مكة">فرع مكة</option>
                        <option value="فرع جدة">فرع جدة</option>
                    </select>
                    <input id="p" placeholder="05xxxxxxxx" class="w-full p-4 bg-gray-50 rounded-2xl border-none ring-1 ring-gray-100 font-bold text-center outline-none">
                    <button onclick="send()" id="sb" class="w-full bg-blue-600 text-white p-4 rounded-2xl font-bold shadow-lg transition active:scale-95">إرسال الآن</button>
                </div>

                <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border space-y-4 text-center">
                    <h3 class="font-bold text-green-600 italic tracking-tighter">⚙️ الإعدادات</h3>
                    <input id="gl" value="${s?.googleLink}" class="w-full p-3 bg-gray-50 rounded-xl border-none ring-1 ring-gray-100 text-[10px] text-center outline-none">
                    <div class="flex gap-2">
                        <input id="dc" value="${s?.discountCode}" class="w-1/2 p-3 bg-gray-50 rounded-xl border-none ring-1 ring-gray-100 font-bold text-center text-blue-600 outline-none">
                        <input id="dl" value="${s?.delay}" class="w-1/2 p-3 bg-gray-50 rounded-xl border-none ring-1 ring-gray-100 font-bold text-center outline-none">
                    </div>
                    <button onclick="save()" class="w-full bg-gray-900 text-white p-4 rounded-2xl font-bold transition active:scale-95">حفظ</button>
                </div>
            </div>

            <div class="mt-8 bg-white p-8 rounded-[2.5rem] text-center border-2 border-dashed border-gray-100">
                ${lastQR ? `<img src="${lastQR}" class="mx-auto w-40 border-4 border-white shadow-xl rounded-2xl">` : isReady ? '<p class="text-green-600 font-black tracking-widest uppercase">System Connected SCloud ✅</p>' : '<p class="animate-pulse">Awaiting connection...</p>'}
            </div>
        </div>
        <script>
            async function send() {
                const p = document.getElementById('p').value; const b = document.getElementById('branch').value;
                if(!p) return alert('أدخل الرقم');
                const btn = document.getElementById('sb'); btn.disabled = true; btn.innerText = 'جاري الإرسال...';
                const res = await fetch('/send-evaluation?key=${process.env.WEBHOOK_KEY}', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({phone:p, branch:b}) });
                if(res.ok) alert('✅ تم الإرسال لفرع ' + b);
                btn.disabled = false; btn.innerText = 'إرسال الآن';
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