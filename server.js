/**
 * نظام سُمعة (RepuSystem) - النسخة v7.3 المستقرة
 * تحديث: إشعارات المدير الفورية + دعم الأرقام (1/١) | باقة Starter
 * الدومين: mawjatalsamt.com
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

// --- MongoDB Atlas Setup ---
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

// --- Stats & Settings Logic ---
async function updateStats(type, branch = "الرئيسي") {
    if (!dbConnected) return;
    try {
        const update = {};
        if (type === 'order') update.totalOrders = 1;
        if (type === 'positive') update.positive = 1;
        if (type === 'negative') update.negative = 1;
        
        await client.db('whatsapp_bot').collection('branches').updateOne(
            { branchName: branch },
            { $inc: update },
            { upsert: true }
        );
        await client.db('whatsapp_bot').collection('analytics').updateOne(
            { _id: 'daily_stats' },
            { $inc: update },
            { upsert: true }
        );
    } catch (e) {}
}

async function getSettings() {
    const defaultSettings = { googleLink: "#", discountCode: "OFFER10", delay: 0 };
    if (!dbConnected) return defaultSettings;
    try {
        const settings = await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' });
        return settings ? settings : defaultSettings;
    } catch (e) { return defaultSettings; }
}

// --- WhatsApp Core (v7.3) ---
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
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code === DisconnectReason.loggedOut || code === 401) {
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
        const customerName = msg.pushName || "عميل";
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        const settings = await getSettings();

        // إعداد رقم المدير من ملف .env
        const manager = process.env.MANAGER_PHONE ? process.env.MANAGER_PHONE.replace(/[^0-9]/g, '') + "@s.whatsapp.net" : null;

        if (/^[1١]/.test(text)) {
            await updateStats('positive');
            await sock.sendMessage(remoteJid, { text: `يسعدنا جداً أن التجربة نالت إعجابك! 😍\n\n📍 ${settings.googleLink}` });
            
            if (manager) {
                await sock.sendMessage(manager, { text: `✅ تقييم ممتاز من: ${customerName}\n📞 الرقم: ${remoteJid.split('@')[0]}` });
            }
        } 
        else if (/^[2٢]/.test(text)) {
            await updateStats('negative');
            await sock.sendMessage(remoteJid, { text: `نعتذر منك جداً 😔\n\n🎫 كود الخصم: *${settings.discountCode}*` });
            
            if (manager) {
                await sock.sendMessage(manager, { 
                    text: `⚠️ تنبيه: تقييم سلبي!\n👤 العميل: ${customerName}\n📞 للتواصل: https://wa.me/${remoteJid.split('@')[0]}` 
                });
            }
        }
    });
}

// --- Endpoints ---
app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { phone, name, branch } = req.body;
    const br = branch || "الرئيسي";
    await updateStats('order', br);

    const settings = await getSettings();
    let cleanP = phone.replace(/[^0-9]/g, '');
    if (cleanP.startsWith('05')) cleanP = '966' + cleanP.substring(1);
    
    const delayMins = parseInt(settings.delay) || 0;
    const finalDelayMs = (delayMins * 60000) + 3000;

    setTimeout(async () => {
        if (isReady && sock) {
            await sock.sendMessage(cleanP + "@s.whatsapp.net", { 
                text: `مرحباً ${name || 'عميلنا'}، نورتنا في (${br})! 🌸\n\nكيف كانت تجربة طلبك اليوم؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` 
            });
        }
    }, finalDelayMs);
    res.json({ success: true });
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { googleLink, discountCode, delay } = req.body;
    await client.db('whatsapp_bot').collection('config').updateOne(
        { _id: 'global_settings' }, 
        { $set: { googleLink, discountCode, delay: parseInt(delay) || 0 } }, 
        { upsert: true }
    );
    res.json({ success: true });
});

app.get('/admin', async (req, res) => {
    const settings = await getSettings();
    const branches = dbConnected ? await client.db('whatsapp_bot').collection('branches').find().toArray() : [];
    const stats = dbConnected ? await client.db('whatsapp_bot').collection('analytics').findOne({ _id: 'daily_stats' }) : { positive: 0, negative: 0 };

    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MAWJAT AL SAMT | لوحة التحكم</title>
    
    <link rel="icon" href="https://cdn-icons-png.flaticon.com/512/3159/3159066.png">
    
    <script src="https://cdn.tailwindcss.com"></script>
    <style> 
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap'); 
        body { font-family: 'Cairo', sans-serif; background-color: #f8fafc; } 
    </style>
</head>
    <body class="bg-gray-50 p-4 md:p-8">
        <div class="max-w-5xl mx-auto">
            <header class="flex justify-between items-center mb-8">
                <h1 class="text-2xl font-black italic">MAWJAT <span class="text-blue-600 font-normal">AL SAMT</span></h1>
                <div class="bg-white px-4 py-2 rounded-xl border text-xs font-bold">${isReady ? '✅ متصل' : '⏳ جاري الربط'}</div>
            </header>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <div class="bg-blue-600 text-white p-5 rounded-3xl shadow-lg">
                    <p class="text-xs opacity-80">إجمالي الراضين</p>
                    <h3 class="text-2xl font-black">${stats?.positive || 0} 😍</h3>
                </div>
                <div class="bg-red-500 text-white p-5 rounded-3xl shadow-lg">
                    <p class="text-xs opacity-80">يحتاج تحسين</p>
                    <h3 class="text-2xl font-black">${stats?.negative || 0} 😔</h3>
                </div>
                ${branches.map(b => `
                    <div class="bg-white p-5 rounded-3xl border shadow-sm">
                        <p class="text-[10px] text-gray-400 font-bold uppercase">${b.branchName}</p>
                        <h3 class="text-lg font-black">${b.totalOrders || 0} طلب</h3>
                    </div>
                `).join('')}
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div class="bg-white p-8 rounded-[2.5rem] border shadow-sm space-y-4">
                    <h3 class="font-bold text-blue-600 italic">📥 إرسال تجريبي</h3>
                    <select id="branch" class="w-full p-4 bg-gray-50 rounded-2xl outline-none">
                        <option value="الرئيسي">الفرع الرئيسي</option>
                        <option value="فرع مكة">فرع مكة</option>
                        <option value="فرع جدة">فرع جدة</option>
                    </select>
                    <input id="p" placeholder="05xxxxxxxx" class="w-full p-4 bg-gray-50 rounded-2xl text-center font-bold outline-none">
                    <input id="n" placeholder="اسم العميل" class="w-full p-4 bg-gray-50 rounded-2xl text-center outline-none">
                    <button onclick="send()" class="w-full bg-blue-600 text-white p-4 rounded-2xl font-bold active:scale-95 transition">جدولة الرسالة</button>
                </div>

                <div class="bg-white p-8 rounded-[2.5rem] border shadow-sm space-y-4">
                    <h3 class="font-bold text-green-600 italic">⚙️ الإعدادات</h3>
                    <input id="gl" value="${settings.googleLink}" class="w-full p-4 bg-gray-50 rounded-2xl text-xs outline-none">
                    <div class="flex gap-2">
                        <input id="dc" value="${settings.discountCode}" class="w-1/2 p-4 bg-gray-50 rounded-2xl text-center font-bold uppercase text-blue-600">
                        <input id="dl" type="number" value="${settings.delay}" class="w-1/2 p-4 bg-gray-50 rounded-2xl text-center font-bold">
                    </div>
                    <button onclick="save()" class="w-full bg-black text-white p-4 rounded-2xl font-bold active:scale-95 transition">حفظ التغييرات</button>
                </div>
            </div>

            <div class="mt-8 bg-white p-6 rounded-[2rem] text-center border-2 border-dashed">
                ${lastQR ? `<img src="${lastQR}" class="mx-auto w-32 border p-2 bg-white rounded-xl shadow-sm">` : isReady ? '<p class="text-green-600 font-black tracking-widest uppercase text-xs">System Live & Verified ✅</p>' : '<p class="text-gray-400 animate-pulse uppercase text-xs">Waiting for Connection...</p>'}
            </div>
        </div>
        <script>
            async function send() {
                const p = document.getElementById('p').value;
                const n = document.getElementById('n').value;
                const b = document.getElementById('branch').value;
                const res = await fetch('/send-evaluation?key=${process.env.WEBHOOK_KEY}', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({phone:p, name:n, branch:b}) });
                if(res.ok) alert('✅ تمت الجدولة بنجاح');
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
app.listen(PORT, async () => { await initMongo(); await connectToWhatsApp(); console.log('🚀 Mawjat Al Samt v7.3 Online'); });