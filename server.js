if (!globalThis.crypto) { globalThis.crypto = require('crypto').webcrypto; }
require('dotenv').config();
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());

// تثبيت مسار واحد نهائي ونظيف
const SESSION_PATH = 'auth_final_stable'; 
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
    try {
        const credsPath = path.join(SESSION_PATH, 'creds.json');
        if (fs.existsSync(credsPath)) {
            const data = fs.readFileSync(credsPath, 'utf-8');
            await client.db('whatsapp_bot').collection('final_session').updateOne({ _id: 'creds' }, { $set: { data } }, { upsert: true });
        }
    } catch (e) { console.log("Sync Error"); }
}

async function restoreSession() {
    if (!dbConnected) return;
    try {
        const res = await client.db('whatsapp_bot').collection('final_session').findOne({ _id: 'creds' });
        if (res) {
            if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });
            fs.writeFileSync(path.join(SESSION_PATH, 'creds.json'), res.data);
            console.log("📥 Session Restored from Cloud");
        }
    } catch (e) { console.log("Restore Error"); }
}

async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = await import('@whiskeysockets/baileys');
    
    await restoreSession();
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'error' }),
        browser: Browsers.macOS('Mawjat-Final'),
        printQRInTerminal: false,
        shouldSyncHistoryMessage: () => false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0
    });

    sock.ev.on('creds.update', async () => { 
        await saveCreds(); 
        await syncSession(); 
    });

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        
        if (qr) {
            lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
            console.log("💡 New QR Ready");
        }
        
        if (connection === 'open') {
            isReady = true;
            lastQR = null;
            console.log("✅ Connected Successfully");
        }

        if (connection === 'close') {
            isReady = false;
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log("❌ Connection Closed. Code:", code);
            
            // إذا كان الخطأ بسبب انتهاء الجلسة أو تعارض، نحذف المجلد تماماً
            if (code === DisconnectReason.loggedOut || code === 401 || code === 408) {
                console.log("🧹 Clearing corrupted session...");
                fs.rmSync(SESSION_PATH, { recursive: true, force: true });
                if(dbConnected) client.db('whatsapp_bot').collection('final_session').deleteOne({ _id: 'creds' });
            }
            setTimeout(connectToWhatsApp, 5000);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.fromMe) return;
            const phone = msg.key.remoteJid.split('@')[0];
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

            if (text === "1" || text === "2") {
                const s = dbConnected ? await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' }) : null;
                const config = s || { googleLink: "#", discountCode: "OFFER10" };
                
                if (dbConnected) {
                    await client.db('whatsapp_bot').collection('evaluations').updateOne(
                        { phone: phone, status: 'sent' },
                        { $set: { status: 'replied', answer: text, repliedAt: new Date() } },
                        { sort: { sentAt: -1 } }
                    );
                }
                const reply = text === "1" ? `يسعدنا تقييمك! 😍\n📍 ${config.googleLink}` : `نعتذر منك 😔\n🎫 كود الخصم: ${config.discountCode}`;
                await sock.sendMessage(msg.key.remoteJid, { text: reply });
            }
        } catch (e) {}
    });
}

// --- API ---
app.get('/api/status', (req, res) => res.json({ isReady, lastQR }));

// --- UI ---
app.get('/', (req, res) => res.redirect('/admin'));

app.get('/admin', async (req, res) => {
    const s = dbConnected ? await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' }) : { googleLink: "#", discountCode: "OFFER10", delay: 0 };
    const evals = dbConnected ? await client.db('whatsapp_bot').collection('evaluations').find().sort({ sentAt: -1 }).limit(10).toArray() : [];

    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8"><title>التحكم | موجة الصمت</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style> @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap'); body { font-family: 'Cairo', sans-serif; background-color: #f8fafc; } </style>
    </head>
    <body class="p-4 md:p-8 text-right">
        <div class="max-w-5xl mx-auto space-y-8">
            <header class="flex justify-between items-center">
                <h1 class="text-2xl font-black italic">MAWJAT <span class="text-blue-600 font-normal">ALSAMT</span></h1>
                <div id="status-badge" class="bg-white px-5 py-2 rounded-2xl border text-[10px] font-bold flex items-center gap-2">
                    <div id="status-dot" class="w-2 h-2 rounded-full bg-gray-300"></div>
                    <span id="status-text">جاري التحميل...</span>
                </div>
            </header>

            <div class="grid md:grid-cols-2 gap-8">
                <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border text-center space-y-4">
                    <h3 class="font-bold text-blue-600 italic">📥 إرسال تقييم جديد</h3>
                    <input id="p" placeholder="رقم الجوال" class="w-full p-4 bg-gray-50 rounded-2xl border font-bold text-center outline-none">
                    <input id="n" placeholder="اسم العميل (اختياري)" class="w-full p-4 bg-gray-50 rounded-2xl border font-bold text-center outline-none">
                    <button onclick="send()" id="sb" class="w-full bg-blue-600 text-white p-4 rounded-2xl font-bold shadow-lg transition active:scale-95">إرسال الآن</button>
                </div>
                <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border text-center space-y-4">
                    <h3 class="font-bold text-green-600 italic">⚙️ الإعدادات</h3>
                    <input id="gl" value="${s.googleLink}" class="w-full p-3 bg-gray-50 rounded-xl text-xs border text-center outline-none">
                    <div class="flex gap-2">
                        <input id="dc" value="${s.discountCode}" class="w-1/2 p-3 bg-gray-50 rounded-xl text-center font-bold text-blue-600 border outline-none">
                        <input id="dl" value="${s.delay}" class="w-1/2 p-3 bg-gray-50 rounded-xl text-center font-bold border outline-none">
                    </div>
                    <button onclick="save()" class="w-full bg-black text-white p-4 rounded-2xl font-bold">حفظ</button>
                </div>
            </div>

            <div id="qr-container" class="bg-white p-8 rounded-[2.5rem] border-2 border-dashed flex flex-col items-center justify-center min-h-[300px]">
                <p class="text-gray-400 animate-pulse">بانتظار السيرفر...</p>
            </div>

            <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border">
                <h3 class="font-bold mb-6 text-gray-800">📊 التقرير المباشر</h3>
                <div class="overflow-x-auto"><table class="w-full text-right text-sm">
                <thead><tr class="border-b text-gray-400"><th class="pb-4">العميل</th><th class="pb-4 text-center">الحالة</th><th class="pb-4 text-left">الرد</th></tr></thead>
                <tbody>
                ${evals.map(e => `
                    <tr class="border-b hover:bg-gray-50">
                        <td class="py-4 font-bold text-gray-700">${e.phone}</td>
                        <td class="py-4 text-center">
                            <span class="px-2 py-1 rounded-lg text-[10px] font-bold ${e.status === 'replied' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}">
                                ${e.status === 'replied' ? 'تم الرد' : 'بانتظار الرد'}
                            </span>
                        </td>
                        <td class="py-4 font-black text-left ${e.answer === '1' ? 'text-green-500' : 'text-red-500'}">
                            ${e.answer ? (e.answer === '1' ? 'ممتاز 😍' : 'تحسين 😔') : '-'}
                        </td>
                    </tr>`).join('')}
                </tbody></table></div>
            </div>
        </div>
        <script>
            async function checkStatus() {
                try {
                    const res = await fetch('/api/status'); const data = await res.json();
                    const dot = document.getElementById('status-dot'); const text = document.getElementById('status-text');
                    const qrContainer = document.getElementById('qr-container');
                    if(data.isReady) {
                        dot.className = 'w-2 h-2 rounded-full bg-green-500 animate-pulse'; text.innerText = 'متصل';
                        qrContainer.innerHTML = '<p class="text-green-600 font-black text-lg">System Active ✅</p>';
                    } else if(data.lastQR) {
                        dot.className = 'w-2 h-2 rounded-full bg-amber-500'; text.innerText = 'بانتظار المسح';
                        qrContainer.innerHTML = '<div><img src="' + data.lastQR + '" class="mx-auto w-48 rounded-xl shadow-2xl border-4 border-white"><p class="text-amber-600 font-bold mt-4 animate-bounce text-center uppercase text-xs font-mono">Scan the QR code</p></div>';
                    }
                } catch(e) {}
            }
            setInterval(checkStatus, 3000);

            async function send(){
                const p = document.getElementById('p').value; const n = document.getElementById('n').value;
                if(!p) return alert('أدخل الرقم');
                const res = await fetch('/send-evaluation?key=${process.env.WEBHOOK_KEY}', {
                    method: 'POST', 
                    headers: {'Content-Type': 'application/json'}, 
                    body: JSON.stringify({phone:p, name:n})
                });
                if(res.ok) { alert('✅ تم الإرسال'); location.reload(); }
            }

            async function save(){
                const d = { 
                    googleLink: document.getElementById('gl').value, 
                    discountCode: document.getElementById('dc').value, 
                    delay: document.getElementById('dl').value 
                };
                const res = await fetch('/update-settings?key=${process.env.WEBHOOK_KEY}', {
                    method: 'POST', 
                    headers: {'Content-Type': 'application/json'}, 
                    body: JSON.stringify(d)
                });
                if(res.ok) alert('✅ تم حفظ الإعدادات');
            }
        </script>
    </body>
    </html>
    `);
});

// --- API Endpoints ---
app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { phone, name } = req.body;
    if (dbConnected) await client.db('whatsapp_bot').collection('evaluations').insertOne({ phone, status: 'sent', sentAt: new Date() });
    
    const greetings = [
        `مرحباً \${name || 'عزيزنا'}، نورتنا اليوم! ✨`,
        `أهلاً بك \${name || 'يا غالي'}، سعدنا بزيارتك لنا. 😊`,
        `حيّاك الله \${name || 'عميلنا العزيز'}، نشكرك على اختيارك لنا. 🌸`
    ];
    const randomMsg = greetings[Math.floor(Math.random() * greetings.length)];
    const s = dbConnected ? await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' }) : { delay: 0 };

    setTimeout(async () => {
        if (isReady && sock) {
            let p = phone.replace(/[^0-9]/g, '');
            if (p.startsWith('05')) p = '966' + p.substring(1);
            await sock.sendMessage(p + "@s.whatsapp.net", { text: `\${randomMsg}\n\nكيف كانت تجربتك معنا؟\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` });
        }
    }, (parseInt(s.delay) || 0) * 60000 + 2000);
    res.json({ success: true });
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { googleLink, discountCode, delay } = req.body;
    if (dbConnected) await client.db('whatsapp_bot').collection('config').updateOne({ _id: 'global_settings' }, { $set: { googleLink, discountCode, delay: parseInt(delay) || 0 } }, { upsert: true });
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { 
    await initMongo(); 
    await connectToWhatsApp(); 
});