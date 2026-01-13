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
        } catch (e) { console.error("❌ MongoDB Error:", e.message); }
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
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0
    });

    sock.ev.on('creds.update', async () => { await saveCreds(); await syncSessionToMongo(); });
    
    sock.ev.on('connection.update', async (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) {
            lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
        }
        if (connection === 'open') { 
            isReady = true; lastQR = null; 
            console.log('✅ WhatsApp Active.'); 
            await syncSessionToMongo(); 
        }
        if (connection === 'close') {
            isReady = false;
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code === DisconnectReason.loggedOut || code === 401) {
                console.log("⚠️ Session Expired, Cleaning...");
                if (fs.existsSync(SESSION_PATH)) fs.rmSync(SESSION_PATH, { recursive: true, force: true });
                setTimeout(connectToWhatsApp, 10000); 
            } else {
                setTimeout(connectToWhatsApp, 5000);
            }
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

        try {
            if (text === "1") {
                await client.db('whatsapp_bot').collection('analytics').updateOne({ _id: 'daily_stats' }, { $inc: { positive: 1 } }, { upsert: true });
                await sock.sendMessage(remoteJid, { text: `يسعدنا جداً أن التجربة نالت إعجابك! 😍\n📍 ${settings.googleLink}` });
            } else if (text === "2") {
                await client.db('whatsapp_bot').collection('analytics').updateOne({ _id: 'daily_stats' }, { $inc: { negative: 1 } }, { upsert: true });
                await sock.sendMessage(remoteJid, { text: `نعتذر منك جداً 😔، نعدك بتجربة أفضل قادماً.\n🎫 كود الخصم: ${settings.discountCode}` });
            }
        } catch (err) { console.error("❌ Reply Error:", err.message); }
    });
}

// --- API Endpoints ---
app.get('/', (req, res) => res.redirect('/admin'));

app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { phone, name, branch } = req.body;
    if (!phone) return res.status(400).send("Phone Required");

    await client.db('whatsapp_bot').collection('branches').updateOne({ branchName: branch || "الرئيسي" }, { $inc: { totalOrders: 1 } }, { upsert: true });
    
    const s = await (async () => {
        const r = await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' });
        return r ? r : { delay: 0 };
    })();

    const finalDelay = (parseInt(s.delay) || 0) * 60000 + 2000;
    
    setTimeout(async () => {
        if (isReady && sock) {
            try {
                let p = phone.replace(/[^0-9]/g, '');
                if (p.startsWith('05')) p = '966' + p.substring(1);
                await sock.sendMessage(p + "@s.whatsapp.net", { text: `مرحباً ${name || 'عميلنا'}، نورتنا في (${branch || 'الفرع الرئيسي'})! 🌸\n\nكيف كانت تجربتك؟\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` });
            } catch (e) { console.error("❌ Send Error:", e.message); }
        }
    }, finalDelay);
    res.json({ success: true });
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { googleLink, discountCode, delay } = req.body;
    await client.db('whatsapp_bot').collection('config').updateOne({ _id: 'global_settings' }, { $set: { googleLink, discountCode, delay: parseInt(delay) || 0 } }, { upsert: true });
    res.json({ success: true });
});

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
        <link rel="icon" href="https://cdn-icons-png.flaticon.com/512/3159/3159066.png">
        <script src="https://cdn.tailwindcss.com"></script>
        <style> @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap'); body { font-family: 'Cairo', sans-serif; background-color: #f8fafc; } </style>
    </head>
    <body class="bg-gray-50 p-5 md:p-10">
        <div class="max-w-4xl mx-auto">
            <header class="flex justify-between items-center mb-10 text-right">
                <div>
                    <h1 class="text-3xl font-black italic">MAWJAT <span class="text-blue-600 font-normal">AL SAMT</span></h1>
                    <p class="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Enterprise v7.3</p>
                </div>
                <div class="bg-white px-5 py-2 rounded-2xl shadow-sm border flex items-center gap-2 font-bold text-xs uppercase">
                    <div class="w-2 h-2 rounded-full \${isReady ? 'bg-green-500 animate-pulse' : 'bg-red-500'}"></div>
                    \${isReady ? 'متصل ✅' : 'جاري الربط...'}
                </div>
            </header>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10 text-right">
                \${br.length > 0 ? br.map(b => \`
                    <div class="bg-white p-5 rounded-3xl border-r-4 border-blue-500 shadow-sm">
                        <p class="text-[10px] font-bold text-gray-400 mb-1">\${b.branchName}</p>
                        <h3 class="text-xl font-black text-gray-800">\${b.totalOrders || 0} طلب</h3>
                    </div>
                \`).join('') : '<p class="text-gray-400 text-xs italic w-full col-span-4">لا توجد بيانات فروع حالية</p>'}
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100 text-center space-y-5">
                    <h3 class="font-bold text-blue-600 italic">📥 إرسال تقييم</h3>
                    <select id="branch" class="w-full p-4 bg-gray-50 rounded-2xl border-none ring-1 ring-gray-200 font-bold outline-none focus:ring-2 focus:ring-blue-500 transition">
                        <option value="الفرع الرئيسي">الفرع الرئيسي</option>
                        <option value="فرع مكة">فرع مكة</option>
                        <option value="فرع جدة">فرع جدة</option>
                    </select>
                    <input id="p" placeholder="رقم الجوال (05xxxxxxxx)" class="w-full p-4 bg-gray-50 rounded-2xl border-none ring-1 ring-gray-200 font-bold text-center outline-none">
                    <input id="n" placeholder="اسم العميل (اختياري)" class="w-full p-4 bg-gray-50 rounded-2xl border-none ring-1 ring-gray-200 font-bold text-center outline-none">
                    <button onclick="send()" id="sb" class="w-full bg-blue-600 text-white p-4 rounded-2xl font-bold shadow-lg shadow-blue-100 active:scale-95 transition">إرسال التقييم الآن</button>
                </div>

                <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border border-gray-100 text-center space-y-5">
                    <h3 class="font-bold text-green-600 italic">⚙️ الإعدادات</h3>
                    <div class="text-right">
                        <label class="text-[10px] font-bold text-gray-400 mr-2 uppercase">رابط جوجل ماب</label>
                        <input id="gl" value="\${s.googleLink}" class="w-full p-3 bg-gray-50 rounded-xl border-none ring-1 ring-gray-200 text-xs font-mono outline-none">
                    </div>
                    <div class="flex gap-4">
                        <div class="w-1/2">
                            <label class="text-[10px] font-bold text-gray-400 block mb-1 uppercase">كود الخصم</label>
                            <input id="dc" value="\${s.discountCode}" class="w-full p-3 bg-gray-50 rounded-xl border-none ring-1 ring-gray-200 font-bold text-center uppercase outline-none text-blue-600">
                        </div>
                        <div class="w-1/2">
                            <label class="text-[10px] font-bold text-gray-400 block mb-1 uppercase text-center">التأخير (د)</label>
                            <input id="dl" value="\${s.delay}" class="w-full p-3 bg-gray-50 rounded-xl border-none ring-1 ring-gray-200 font-bold text-center outline-none">
                        </div>
                    </div>
                    <button onclick="save()" class="w-full bg-gray-900 text-white p-4 rounded-2xl font-bold active:scale-95 transition">حفظ التغييرات</button>
                </div>
            </div>

            <div class="mt-10 bg-white p-8 rounded-[2.5rem] text-center border-2 border-dashed border-gray-200">
                \${lastQR ? \`<img src="\${lastQR}" class="mx-auto w-40 border-4 border-white shadow-xl rounded-2xl"><p class="text-amber-600 font-bold mt-4 animate-pulse">امسح الكود لتفعيل البوت</p>\` : isReady ? '<p class="text-green-600 font-black tracking-widest uppercase">System Connected Successfully ✅</p>' : '<p class="text-gray-400 animate-pulse uppercase tracking-widest font-bold">Awaiting Connection...</p>'}
            </div>
        </div>

        <script>
            async function send() {
                const p = document.getElementById('p').value; const n = document.getElementById('n').value; const b = document.getElementById('branch').value;
                const btn = document.getElementById('sb');
                if(!p) return alert('أدخل رقم الجوال');
                btn.disabled = true; btn.innerHTML = "جاري الجدولة...";
                try {
                    const res = await fetch('/send-evaluation?key=\${process.env.WEBHOOK_KEY}', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({phone:p, name:n, branch:b}) });
                    if(res.ok) alert('✅ تمت جدولة التقييم لفرع ' + b);
                } catch(e) { alert('❌ خطأ في الاتصال'); }
                btn.disabled = false; btn.innerHTML = "إرسال التقييم الآن";
            }
            async function save() {
                const d = { googleLink: document.getElementById('gl').value, discountCode: document.getElementById('dc').value, delay: document.getElementById('dl').value };
                const res = await fetch('/update-settings?key=\${process.env.WEBHOOK_KEY}', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(d) });
                if(res.ok) { alert('✅ تم حفظ الإعدادات'); location.reload(); }
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
});