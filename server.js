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

// --- MongoDB Setup ---
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
            console.log("🔗 MongoDB Connected.");
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

// --- WhatsApp Logic ---
async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await import('@whiskeysockets/baileys');
    await loadSessionFromMongo();
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
        markOnlineOnConnect: false,
        connectTimeoutMs: 60000
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
        
        const settings = await (async () => {
            const def = { googleLink: "#", discountCode: "OFFER10" };
            if (!dbConnected) return def;
            const s = await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' });
            return s ? s : def;
        })();

        if (text === "1") {
            await client.db('whatsapp_bot').collection('analytics').updateOne({ _id: 'daily_stats' }, { $inc: { positive: 1 } }, { upsert: true });
            await sock.sendMessage(remoteJid, { text: `يسعدنا جداً أن التجربة نالت إعجابك! 😍\n📍 ${settings.googleLink}` });
        } else if (text === "2") {
            await client.db('whatsapp_bot').collection('analytics').updateOne({ _id: 'daily_stats' }, { $inc: { negative: 1 } }, { upsert: true });
            await sock.sendMessage(remoteJid, { text: `نعتذر منك 😔، نعدك بتجربة أفضل قادماً.\n🎫 كود الخصم: ${settings.discountCode}` });
        }
    });
}

// --- Endpoints ---
app.get('/', (req, res) => res.redirect('/admin'));

app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { phone, name, branch } = req.body;
    await client.db('whatsapp_bot').collection('branches').updateOne({ branchName: branch || "الرئيسي" }, { $inc: { totalOrders: 1 } }, { upsert: true });
    
    const s = await (async () => {
        if (!dbConnected) return { delay: 0 };
        const r = await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' });
        return r ? r : { delay: 0 };
    })();

    setTimeout(async () => {
        if (isReady && sock) {
            let p = phone.replace(/[^0-9]/g, '');
            if (p.startsWith('05')) p = '966' + p.substring(1);
            await sock.sendMessage(p + "@s.whatsapp.net", { text: `مرحباً ${name || 'عميلنا'}، نورتنا في (${branch || 'الفرع'})! 🌸\n\nكيف كانت تجربتك؟\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` });
        }
    }, (parseInt(s.delay) || 0) * 60000 + 3000);
    res.json({ success: true });
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { googleLink, discountCode, delay } = req.body;
    await client.db('whatsapp_bot').collection('config').updateOne({ _id: 'global_settings' }, { $set: { googleLink, discountCode, delay: parseInt(delay) || 0 } }, { upsert: true });
    res.json({ success: true });
});

// --- UI (Fixed Rendering) ---
app.get('/admin', async (req, res) => {
    const s = await (async () => {
        const def = { googleLink: "#", discountCode: "OFFER10", delay: 0 };
        if (!dbConnected) return def;
        const r = await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' });
        return r ? r : def;
    })();
    const br = dbConnected ? await client.db('whatsapp_bot').collection('branches').find().toArray() : [];

    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>MAWJAT AL SAMT | لوحة التحكم</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style> @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap'); body { font-family: 'Cairo', sans-serif; background-color: #f8fafc; } </style>
    </head>
    <body class="p-4 md:p-8">
        <div class="max-w-4xl mx-auto">
            <header class="flex justify-between items-center mb-10">
                <h1 class="text-3xl font-black italic tracking-tighter uppercase">MAWJAT<span class="text-blue-600 font-normal">AL SAMT</span></h1>
                <div class="bg-white px-5 py-2 rounded-2xl shadow-sm border flex items-center gap-2 font-bold text-xs">
                    <div class="w-2 h-2 rounded-full ${isReady ? 'bg-green-500 animate-pulse' : 'bg-red-500'}"></div>
                    ${isReady ? 'متصل ✅' : 'جاري الربط...'}
                </div>
            </header>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
                ${br.map(b => `
                    <div class="bg-white p-5 rounded-3xl border-r-4 border-blue-500 shadow-sm">
                        <p class="text-[10px] font-bold text-gray-400 mb-1">${b.branchName}</p>
                        <h3 class="text-xl font-black text-gray-800">${b.totalOrders || 0} طلب</h3>
                    </div>
                `).join('')}
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
                <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border text-center space-y-4">
                    <h3 class="font-bold text-blue-600 italic">📥 جدولة طلب</h3>
                    <select id="branch" class="w-full p-4 bg-gray-50 rounded-2xl border-none ring-1 ring-gray-200 font-bold outline-none">
                        <option value="الفرع الرئيسي">الفرع الرئيسي</option>
                        <option value="فرع مكة">فرع مكة</option>
                        <option value="فرع جدة">فرع جدة</option>
                    </select>
                    <input id="p" placeholder="05xxxxxxxx" class="w-full p-4 bg-gray-50 rounded-2xl border-none ring-1 ring-gray-200 font-bold text-center outline-none">
                    <input id="n" placeholder="اسم العميل" class="w-full p-4 bg-gray-50 rounded-2xl border-none ring-1 ring-gray-200 font-bold text-center outline-none">
                    <button onclick="send()" id="sb" class="w-full bg-blue-600 text-white p-4 rounded-2xl font-bold shadow-lg shadow-blue-100 transition">إرسال التقييم</button>
                </div>

                <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border text-center space-y-4">
                    <h3 class="font-bold text-green-600 italic">⚙️ الإعدادات</h3>
                    <input id="gl" value="${s.googleLink}" class="w-full p-3 bg-gray-50 rounded-xl border-none ring-1 ring-gray-200 text-xs font-mono outline-none text-center">
                    <div class="flex gap-4">
                        <div class="w-1/2">
                            <label class="text-[10px] font-bold text-gray-400 block mb-1 uppercase">كود الخصم</label>
                            <input id="dc" value="${s.discountCode}" class="w-full p-3 bg-gray-50 rounded-xl border-none ring-1 ring-gray-200 font-bold text-center uppercase outline-none text-blue-600">
                        </div>
                        <div class="w-1/2 text-center">
                            <label class="text-[10px] font-bold text-gray-400 block mb-1">التأخير (د)</label>
                            <input id="dl" value="${s.delay}" class="w-full p-3 bg-gray-50 rounded-xl border-none ring-1 ring-gray-200 font-bold text-center outline-none">
                        </div>
                    </div>
                    <button onclick="save()" class="w-full bg-gray-900 text-white p-4 rounded-2xl font-bold transition">حفظ التغييرات</button>
                </div>
            </div>

            <div class="bg-white p-8 rounded-[2.5rem] text-center border-2 border-dashed border-gray-200">
                ${lastQR ? `<img src="${lastQR}" class="mx-auto w-40 border-4 border-white shadow-xl rounded-2xl"><p class="text-amber-600 font-bold mt-4 animate-pulse">امسح الكود للربط</p>` : isReady ? '<p class="text-green-600 font-black tracking-widest uppercase">System Connected Successfully ✅</p>' : '<p class="text-gray-400 animate-pulse uppercase tracking-widest font-bold text-xs">Awaiting connection...</p>'}
            </div>
        </div>
        <script>
            async function send() {
                const p = document.getElementById('p').value; const n = document.getElementById('n').value; const b = document.getElementById('branch').value;
                if(!p) return alert('أدخل الرقم');
                const res = await fetch('/send-evaluation?key=${process.env.WEBHOOK_KEY}', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({phone:p, name:n, branch:b}) });
                if(res.ok) alert('✅ تمت الجدولة لفرع ' + b);
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