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
        } catch (e) { console.error("❌ MongoDB Connection Error"); }
    }
};

// --- WhatsApp Core (The Balanced Version) ---
async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await import('@whiskeysockets/baileys');
    
    if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

    if (sock) { try { sock.terminate(); } catch (e) {} sock = null; }

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'error' }),
        browser: Browsers.macOS('Desktop'),
        printQRInTerminal: false,
        shouldSyncHistoryMessage: () => false, // منع الانهيار بسبب الرسائل القديمة
        syncFullHistory: false,
        connectTimeoutMs: 60000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
        if (connection === 'open') { isReady = true; lastQR = null; console.log('✅ Connected.'); }
        if (connection === 'close') {
            isReady = false;
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code !== DisconnectReason.loggedOut) setTimeout(connectToWhatsApp, 5000);
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
        } catch (e) { console.log("⚠️ Ignored Decryption Error"); }
    });
}

// --- Endpoints ---
app.get('/', (req, res) => res.redirect('/admin'));

app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { phone, name, branch } = req.body;
    
    // 1. إضافة سجل للفرع في MongoDB
    if(dbConnected) await client.db('whatsapp_bot').collection('branches').updateOne({ branchName: branch || "الرئيسي" }, { $inc: { totalOrders: 1 } }, { upsert: true });
    
    const settings = dbConnected ? await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' }) : { delay: 0 };

    // 2. مصفوفة من التحيات المختلفة لجعل كل رسالة فريدة (تجنب الحظر)
    const greetings = [
        `مرحباً ${name || 'عميلنا العزيز'}، نورتنا في ${branch || 'فرعنا'}! 🌸`,
        `أهلاً بك ${name || 'يا غالي'}، سعدنا بزيارتك لـ ${branch || 'مطعمنا'} اليوم. ✨`,
        `حيّاك الله ${name || 'عزيزنا'}، نشكرك على اختيارك ${branch || 'لنا'}. 😊`
    ];
    const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];

    // 3. حساب وقت التأخير (تأخير المستخدم + تأخير عشوائي بسيط 3-7 ثواني)
    const randomExtraDelay = Math.floor(Math.random() * 4000) + 3000; 
    const totalDelay = (parseInt(settings?.delay) || 0) * 60000 + randomExtraDelay;

    setTimeout(async () => {
        if (isReady && sock) {
            try {
                let p = phone.replace(/[^0-9]/g, '');
                if (p.startsWith('05')) p = '966' + p.substring(1);
                
                // 3. تأكد من استخدام علامة ` (Backtick) وليس ' (Single Quote)
await sock.sendMessage(p + "@s.whatsapp.net", { 
    text: `${randomGreeting}\n\nكيف كانت تجربتك معنا؟ نرجو منك اختيار رقم:\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` 
});
                console.log(`✅ Message sent to ${p} with randomized content.`);
            } catch (e) { console.error("❌ Failed to send:", e.message); }
        }
    }, totalDelay);

    res.json({ success: true, message: "Scheduled with anti-ban logic" });
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { googleLink, discountCode, delay } = req.body;
    if(dbConnected) await client.db('whatsapp_bot').collection('config').updateOne({ _id: 'global_settings' }, { $set: { googleLink, discountCode, delay: parseInt(delay) || 0 } }, { upsert: true });
    res.json({ success: true });
});

// --- UI (The Full Version Re-built) ---
app.get('/admin', async (req, res) => {
    const s = dbConnected ? await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' }) : { googleLink: "#", discountCode: "OFFER10", delay: 0 };
    const br = dbConnected ? await client.db('whatsapp_bot').collection('branches').find().toArray() : [];
    const stats = dbConnected ? await client.db('whatsapp_bot').collection('analytics').findOne({ _id: 'daily_stats' }) : { positive: 0, negative: 0 };

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
            <header class="flex justify-between items-center mb-8 text-right">
                <div>
                    <h1 class="text-3xl font-black italic uppercase">MAWJAT<span class="text-blue-600 font-normal text-2xl">ALSAMT</span></h1>
                    <p class="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Enterprise Edition v7.5</p>
                </div>
                <div class="bg-white px-4 py-2 rounded-2xl shadow-sm border flex items-center gap-2 font-bold text-xs">
                    <div class="w-2 h-2 rounded-full ${isReady ? 'bg-green-500 animate-pulse' : 'bg-red-500'}"></div>
                    ${isReady ? 'متصل ✅' : 'جاري الربط...'}
                </div>
            </header>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 text-right">
                <div class="bg-white p-5 rounded-3xl border shadow-sm">
                    <p class="text-[10px] font-bold text-green-500 uppercase">تقييم ممتاز</p>
                    <h3 class="text-xl font-black">${stats?.positive || 0}</h3>
                </div>
                <div class="bg-white p-5 rounded-3xl border shadow-sm">
                    <p class="text-[10px] font-bold text-red-500 uppercase">يحتاج تحسين</p>
                    <h3 class="text-xl font-black">${stats?.negative || 0}</h3>
                </div>
                ${br.slice(0, 2).map(b => `
                    <div class="bg-white p-5 rounded-3xl border-r-4 border-blue-500 shadow-sm">
                        <p class="text-[10px] font-bold text-gray-400 mb-1">${b.branchName}</p>
                        <h3 class="text-xl font-black">${b.totalOrders || 0} طلب</h3>
                    </div>
                `).join('')}
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            // ابحث عن الجزء الخاص بـ <div class="bg-white p-8 rounded-[2.5rem] ..."> الخاص بجدولة الطلب
            // واستبدله بهذا الكود المطور:
            
            <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border space-y-4 text-center">
                <h3 class="font-bold text-blue-600 italic">📥 إرسال طلب جديد</h3>
                
                <select id="branch" class="w-full p-4 bg-gray-50 rounded-2xl border-none ring-1 ring-gray-100 font-bold outline-none focus:ring-2 focus:ring-blue-500 transition">
                    <option value="الفرع الرئيسي">الفرع الرئيسي</option>
                    <option value="فرع مكة">فرع مكة</option>
                    <option value="فرع جدة">فرع جدة</option>
                    <option value="فرع الرياض">فرع الرياض</option>
                </select>
            
                <input id="p" placeholder="رقم الجوال 05xxxxxxxx" class="w-full p-4 bg-gray-50 rounded-2xl border-none ring-1 ring-gray-100 font-bold text-center outline-none">
                <input id="n" placeholder="اسم العميل (اختياري)" class="w-full p-4 bg-gray-50 rounded-2xl border-none ring-1 ring-gray-100 font-bold text-center outline-none">
                
                <button onclick="send()" id="sb" class="w-full bg-blue-600 text-white p-4 rounded-2xl font-bold shadow-lg shadow-blue-50 transition active:scale-95">إرسال التقييم</button>
            </div>

                <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border space-y-4 text-center">
                    <h3 class="font-bold text-green-600 italic">⚙️ الإعدادات الذكية</h3>
                    <input id="gl" value="${s?.googleLink}" class="w-full p-3 bg-gray-50 rounded-xl border-none ring-1 ring-gray-100 text-[10px] text-center">
                    <div class="flex gap-2">
                        <input id="dc" value="${s?.discountCode}" class="w-1/2 p-3 bg-gray-50 rounded-xl border-none ring-1 ring-gray-100 font-bold text-center text-blue-600">
                        <input id="dl" value="${s?.delay}" class="w-1/2 p-3 bg-gray-50 rounded-xl border-none ring-1 ring-gray-100 font-bold text-center">
                    </div>
                    <button onclick="save()" class="w-full bg-gray-900 text-white p-4 rounded-2xl font-bold transition active:scale-95">حفظ الإعدادات</button>
                </div>
            </div>

            <div class="bg-white p-8 rounded-[2.5rem] text-center border-2 border-dashed border-gray-100">
                ${lastQR ? `<img src="${lastQR}" class="mx-auto w-40 border-4 border-white shadow-xl rounded-2xl"><p class="text-amber-600 font-bold mt-4 animate-pulse">امسح الكود للربط</p>` : isReady ? '<p class="text-green-600 font-black tracking-widest uppercase">System Live ✅</p>' : '<p class="text-gray-300 animate-pulse uppercase font-bold text-xs text-center">Awaiting connection...</p>'}
            </div>
        </div>
        <script>
            async function send() {
                const p = document.getElementById('p').value; const n = document.getElementById('n').value;
                if(!p) return alert('أدخل الرقم');
                const btn = document.getElementById('sb'); btn.disabled = true; btn.innerText = 'جاري الإرسال...';
                const res = await fetch('/send-evaluation?key=${process.env.WEBHOOK_KEY}', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({phone:p, name:n}) });
                if(res.ok) alert('✅ تم إرسال الطلب');
                btn.disabled = false; btn.innerText = 'إرسال التقييم';
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

process.on('uncaughtException', (err) => { console.error('💥 Exception:', err.message); });