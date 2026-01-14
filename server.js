if (!globalThis.crypto) { globalThis.crypto = require('crypto').webcrypto; }
require('dotenv').config();
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());

const SESSION_PATH = 'auth_stable_v104'; 
const MONGO_URL = process.env.MONGO_URL;
const WEBHOOK_KEY = process.env.WEBHOOK_KEY;

let sock = null, isReady = false, lastQR = null;
let client = null, db = null, dbConnected = false;

// --- Database Logic ---
const initMongo = async () => {
    try {
        client = new MongoClient(MONGO_URL);
        await client.connect();
        db = client.db('whatsapp_bot');
        dbConnected = true;
        console.log("🔗 MongoDB Connected.");
    } catch (e) { console.error("❌ MongoDB Fail:", e.message); }
};

async function syncSession() {
    if (!dbConnected) return;
    try {
        const credsPath = path.join(SESSION_PATH, 'creds.json');
        if (fs.existsSync(credsPath)) {
            const data = fs.readFileSync(credsPath, 'utf-8');
            await db.collection('final_v104').updateOne({ _id: 'creds' }, { $set: { data, lastUpdate: new Date() } }, { upsert: true });
        }
    } catch (e) {}
}

async function restoreSession() {
    if (!dbConnected) return;
    try {
        const res = await db.collection('final_v104').findOne({ _id: 'creds' });
        if (res) {
            if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });
            fs.writeFileSync(path.join(SESSION_PATH, 'creds.json'), res.data);
        }
    } catch (e) {}
}

// --- WhatsApp Logic ---
async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await import('@whiskeysockets/baileys');
    await restoreSession();
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

    sock = makeWASocket({
        auth: state, version,
        logger: pino({ level: 'error' }),
        browser: Browsers.macOS('Desktop'), 
        printQRInTerminal: false,
        keepAliveIntervalMs: 30000,
        shouldSyncHistoryMessage: () => false
    });

    sock.ev.on('creds.update', async () => { await saveCreds(); await syncSession(); });

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
        if (connection === 'open') { isReady = true; lastQR = null; console.log("✅ WhatsApp Ready"); }
        if (connection === 'close') {
            isReady = false;
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code !== DisconnectReason.loggedOut) setTimeout(connectToWhatsApp, 5000);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.fromMe) return;
            
            const remoteJid = msg.key.remoteJid;
            const rawPhone = remoteJid.split('@')[0];
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

            if (text === "1" || text === "2") {
                const s = dbConnected ? await db.collection('config').findOne({ _id: 'global_settings' }) : null;
                const config = s || { googleLink: "#", discountCode: "OFFER10" };
                
                if (dbConnected) {
                    await db.collection('evaluations').findOneAndUpdate(
                        { phone: { $regex: rawPhone }, status: 'sent' },
                        { $set: { status: 'replied', answer: text, repliedAt: new Date() } },
                        { sort: { sentAt: -1 } }
                    );
                }
                
                const reply = text === "1" ? `يسعدنا تقييمك! 😍\n📍 ${config.googleLink}` : `نعتذر منك 😔\n🎫 كود الخصم: ${config.discountCode}`;
                await sock.sendMessage(remoteJid, { text: reply });
            }
        } catch (e) { console.log("Upsert Error:", e.message); }
    });
}

// --- API & Routes ---
app.get('/api/status', (req, res) => res.json({ isReady, lastQR }));

app.get('/admin', async (req, res) => {
    const s = dbConnected ? await db.collection('config').findOne({ _id: 'global_settings' }) : { googleLink: "#", discountCode: "OFFER10", delay: 0 };
    const evals = dbConnected ? await db.collection('evaluations').find().sort({ sentAt: -1 }).limit(15).toArray() : [];
    
    res.send(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>لوحة التحكم</title><script src="https://cdn.tailwindcss.com"></script><style>@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');body{font-family:'Cairo',sans-serif;background-color:#f8fafc;}</style></head>
    <body class="p-4 md:p-8 text-right text-gray-800">
        <div class="max-w-5xl mx-auto space-y-8">
            <header class="flex justify-between items-center bg-white p-6 rounded-3xl shadow-sm border">
                <h1 class="text-2xl font-black italic uppercase">MAWJAT <span class="text-blue-600 font-normal">ALSAMT</span></h1>
                <div class="flex items-center gap-4">
                    <input type="password" id="accessKey" placeholder="مفتاح الوصول" class="text-[10px] p-2 border rounded-lg outline-none focus:border-blue-500">
                    <div class="bg-gray-50 px-4 py-2 rounded-2xl border text-[10px] font-bold flex items-center gap-2">
                        <div id="dot" class="w-2 h-2 rounded-full bg-red-500"></div><span id="stat">Checking...</span>
                    </div>
                </div>
            </header>

            <div class="grid md:grid-cols-2 gap-8">
                <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border space-y-4">
                    <h3 class="font-bold text-blue-600 italic">📥 إرسال تقييم جديد</h3>
                    <input id="p" placeholder="05xxxxxxxx" class="w-full p-4 bg-gray-50 rounded-2xl border font-bold text-center outline-none focus:ring-2 ring-blue-100">
                    <input id="n" placeholder="اسم العميل" class="w-full p-4 bg-gray-50 rounded-2xl border font-bold text-center outline-none focus:ring-2 ring-blue-100">
                    <button onclick="send()" id="sb" class="w-full bg-blue-600 text-white p-4 rounded-2xl font-bold hover:bg-blue-700 transition shadow-lg">إرسال الآن</button>
                </div>

                <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border space-y-4">
                    <h3 class="font-bold text-green-600 italic">⚙️ الإعدادات العامة</h3>
                    <label class="block text-[10px] text-gray-400 mr-2">رابط قوقل ماب</label>
                    <input id="gl" value="${s.googleLink}" class="w-full p-3 bg-gray-50 rounded-xl text-[12px] border outline-none">
                    <div class="flex gap-2">
                        <div class="w-1/2">
                            <label class="block text-[10px] text-gray-400 mr-2">كود الخصم</label>
                            <input id="dc" value="${s.discountCode}" class="w-full p-3 bg-gray-50 rounded-xl text-center font-bold text-blue-600 border">
                        </div>
                        <div class="w-1/2">
                            <label class="block text-[10px] text-gray-400 mr-2">تأخير (بالدقائق)</label>
                            <input id="dl" value="${s.delay}" class="w-full p-3 bg-gray-50 rounded-xl text-center font-bold border">
                        </div>
                    </div>
                    <button onclick="save()" class="w-full bg-black text-white p-4 rounded-2xl font-bold hover:opacity-80 transition">حفظ التغييرات</button>
                </div>
            </div>

            <div id="qrc" class="bg-white p-8 rounded-[2.5rem] border-2 border-dashed flex items-center justify-center min-h-[250px]">
                <p class="animate-pulse">جاري التحميل...</p>
            </div>

            <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border overflow-hidden">
                <h3 class="font-bold mb-6 text-gray-800">📊 آخر 15 تقييم</h3>
                <div class="overflow-x-auto">
                    <table class="w-full text-right text-sm">
                        <thead><tr class="border-b text-gray-400"><th class="pb-4">العميل</th><th class="pb-4 text-center">الحالة</th><th class="pb-4 text-left">الرد</th></tr></thead>
                        <tbody>${evals.map(e => `<tr class="border-b hover:bg-gray-50"><td class="py-4 font-bold text-gray-700">${e.phone}<br><span class="text-[9px] font-normal text-gray-400">${new Date(e.sentAt).toLocaleString('ar-SA')}</span></td><td class="py-4 text-center"><span class="px-3 py-1 rounded-full text-[10px] font-bold ${e.status === 'replied' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}">${e.status === 'replied' ? 'تم الرد' : 'بانتظار'}</span></td><td class="py-4 font-black text-left ${e.answer === '1' ? 'text-green-500' : 'text-red-500'}">${e.answer ? (e.answer === '1' ? 'ممتاز 😍' : 'تحسين 😔') : '-'}</td></tr>`).join('')}</tbody>
                    </table>
                </div>
            </div>
        </div>

        <script>
            // استعادة المفتاح من التخزين المحلي
            document.getElementById('accessKey').value = localStorage.getItem('bot_key') || '';

            async function chk(){
                try {
                    const r = await fetch('/api/status');
                    const d = await r.json();
                    const o = document.getElementById('dot');
                    const t = document.getElementById('stat');
                    const q = document.getElementById('qrc');
                    if(d.isReady){
                        o.className='w-2 h-2 rounded-full bg-green-500 animate-pulse';
                        t.innerText='متصل الآن';
                        q.innerHTML='<div class="text-center"><p class="text-green-600 font-bold text-lg uppercase tracking-widest">System Active ✅</p><p class="text-gray-400 text-xs mt-2">البوت يعمل ويستقبل الرسائل</p></div>';
                    } else if(d.lastQR){
                        o.className='w-2 h-2 rounded-full bg-amber-500';
                        t.innerText='بانتظار المسح';
                        q.innerHTML='<div><img src="'+d.lastQR+'" class="mx-auto w-44 rounded-xl shadow-2xl border-4 border-white"><p class="text-center mt-4 text-xs text-gray-500">امسح الكود لربط الواتساب</p></div>';
                    }
                } catch(e){}
            }
            setInterval(chk, 5000); chk();

            async function send(){
                const p = document.getElementById('p').value;
                const n = document.getElementById('n').value;
                const key = document.getElementById('accessKey').value;
                if(!p || !key) return alert('أدخل الرقم ومفتاح الوصول');
                
                localStorage.setItem('bot_key', key);
                const res = await fetch('/send-evaluation?key=' + key, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({phone: p, name: n})
                });
                if(res.ok) { alert('✅ تم الإرسال'); location.reload(); }
                else alert('❌ فشل: تأكد من مفتاح الوصول');
            }

            async function save(){
                const key = document.getElementById('accessKey').value;
                const d = {
                    googleLink: document.getElementById('gl').value,
                    discountCode: document.getElementById('dc').value,
                    delay: document.getElementById('dl').value
                };
                const res = await fetch('/update-settings?key=' + key, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(d)
                });
                if(res.ok) alert('✅ تم حفظ الإعدادات');
                else alert('❌ فشل الحفظ');
            }
        </script>
    </body></html>`);
});

app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== WEBHOOK_KEY) return res.status(401).json({error: 'Unauthorized'});
    const { phone, name } = req.body;
    let p = phone.replace(/\D/g, ''); 
    if (p.startsWith('05')) p = '966' + p.substring(1);
    else if (p.startsWith('5') && p.length === 9) p = '966' + p;

    if (dbConnected) {
        await db.collection('evaluations').insertOne({ phone: p, name, status: 'sent', sentAt: new Date() });
    }
    
    const greetings = [`مرحباً ${name || 'عزيزنا'}، نورتنا اليوم! ✨`,`أهلاً بك ${name || 'يا غالي'}، سعدنا بزيارتك لنا. 😊`,`حيّاك الله ${name || 'عميلنا العزيز'}، نشكرك على اختيارك لنا. 🌸`];
    const randomMsg = greetings[Math.floor(Math.random() * greetings.length)];
    const config = dbConnected ? await db.collection('config').findOne({ _id: 'global_settings' }) : { delay: 0 };

    setTimeout(async () => {
        if (isReady && sock) {
            try {
                await sock.sendMessage(p + "@s.whatsapp.net", { text: `${randomMsg}\n\nكيف كانت تجربتك معنا؟\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` });
            } catch (err) { console.error("Send Error:", err.message); }
        }
    }, (parseInt(config?.delay) || 0) * 60000 + 2000);
    res.json({ success: true });
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== WEBHOOK_KEY) return res.sendStatus(401);
    const { googleLink, discountCode, delay } = req.body;
    if (dbConnected) {
        await db.collection('config').updateOne({ _id: 'global_settings' }, { $set: { googleLink, discountCode, delay: parseInt(delay) || 0 } }, { upsert: true });
    }
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { 
    await initMongo(); 
    await connectToWhatsApp(); 
});