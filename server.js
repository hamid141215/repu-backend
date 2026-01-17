if (!globalThis.crypto) { globalThis.crypto = require('crypto').webcrypto; }
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());

const CONFIG = {
    mongoUrl: process.env.MONGO_URL,
    webhookKey: process.env.WEBHOOK_KEY,
    googleLink: process.env.GOOGLE_MAPS_LINK || "#",
    discountCode: process.env.DISCOUNT_CODE || "MAWJA2026",
    delay: (parseInt(process.env.DELAY_MINUTES) || 0) * 60000
};

const SESSION_DIR = path.join(__dirname, 'auth_session');
let sock = null, isReady = false, lastQR = null, db = null;

const initMongo = async () => {
    try {
        const client = new MongoClient(CONFIG.mongoUrl);
        await client.connect();
        db = client.db('whatsapp_bot');
        await db.collection('evaluations').createIndex({ phone: 1, status: 1 });
        console.log("🔗 MongoDB Connected.");
    } catch (e) { setTimeout(initMongo, 5000); }
};

async function syncSession(action) {
    if (!db) return;
    const credsFile = path.join(SESSION_DIR, 'creds.json');
    try {
        if (action === 'save' && fs.existsSync(credsFile)) {
            await db.collection('session').updateOne({ _id: 'creds' }, { $set: { data: fs.readFileSync(credsFile, 'utf-8') } }, { upsert: true });
        } else if (action === 'restore') {
            const res = await db.collection('session').findOne({ _id: 'creds' });
            if (res) {
                if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
                fs.writeFileSync(credsFile, res.data);
            }
        }
    } catch (e) {}
}

async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = await import('@whiskeysockets/baileys');
    await syncSession('restore');
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

    sock = makeWASocket({
        auth: state, version,
        browser: Browsers.macOS('Desktop'),
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', async () => { await saveCreds(); await syncSession('save'); });
    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
        if (connection === 'open') { isReady = true; lastQR = null; }
        if (connection === 'close') {
            isReady = false;
            const status = lastDisconnect?.error?.output?.statusCode;
            if (status === 401 || status === 405) {
                fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                db.collection('session').deleteOne({ _id: 'creds' });
            }
            setTimeout(connectToWhatsApp, 5000);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        if (["1", "2"].includes(text)) {
            const phone = msg.key.remoteJid.split('@')[0].slice(-9);
            const res = await db.collection('evaluations').findOneAndUpdate(
                { phone: { $regex: phone + "$" }, status: 'sent' },
                { $set: { status: 'replied', answer: text, repliedAt: new Date() } },
                { sort: { sentAt: -1 } }
            );
            if (res) {
                const reply = text === "1" ? `شكراً لتقييمك! 😍\n📍 ${CONFIG.googleLink}` : `نعتذر منك 😔\n🎫 كود الخصم: ${CONFIG.discountCode}`;
                await sock.sendMessage(msg.key.remoteJid, { text: reply });
            }
        }
    });
}

// --- تنظيف واجهة الأدمن ---
app.get('/admin', async (req, res) => {
    if (!db) return res.send("جاري الاتصال...");
    const settings = await db.collection('config').findOne({ _id: 'global_settings' }) || { branches: "فرع الرياض, فرع جدة" };
    const branches = settings.branches.split(',').map(b => b.trim());
    const stats = {
        total: await db.collection('evaluations').countDocuments(),
        pos: await db.collection('evaluations').countDocuments({ answer: '1' }),
        neg: await db.collection('evaluations').countDocuments({ answer: '2' })
    };

    // حل مشكلة اللخبطة: استخدام متغيرات صريحة
    const statusText = isReady ? 'متصل' : 'غير متصل';
    const statusColor = isReady ? 'bg-green-500' : 'bg-red-500';
    const qrSection = isReady ? '<div class="py-10 text-green-500 font-bold">بنجاح ✅</div>' : 
                      (lastQR ? `<img src="${lastQR}" class="mx-auto w-40 rounded-2xl shadow-lg border-4 border-white">` : '<div class="py-10 text-gray-300 font-bold">جاري التحميل...</div>');

    res.send(`
    <!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>Mawja Admin</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">
    <style>body{font-family:'Cairo',sans-serif;}</style></head>
    <body class="bg-slate-50 p-4 md:p-10">
        <div class="max-w-5xl mx-auto space-y-6">
            <header class="bg-white p-6 rounded-3xl shadow-sm border flex justify-between items-center">
                <h1 class="text-2xl font-black text-blue-600 italic">MAWJA</h1>
                <div class="flex items-center gap-3 bg-slate-100 px-4 py-2 rounded-2xl border">
                    <div class="w-3 h-3 rounded-full ${statusColor}"></div>
                    <span class="text-xs font-bold">${statusText}</span>
                </div>
            </header>
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div class="lg:col-span-2 bg-white p-8 rounded-[2.5rem] shadow-sm border">
                    <h3 class="font-bold mb-6 text-blue-700">🚀 إرسال طلب تقييم</h3>
                    <div class="space-y-4">
                        <input id="name" placeholder="اسم العميل" class="w-full p-4 bg-slate-50 border rounded-2xl outline-none">
                        <input id="phone" placeholder="05xxxxxxxx" class="w-full p-4 bg-slate-50 border rounded-2xl text-center font-bold outline-none">
                        <select id="branch" class="w-full p-4 bg-slate-50 border rounded-2xl outline-none">
                            ${branches.map(b => `<option value="${b}">${b}</option>`).join('')}
                        </select>
                        <button onclick="sendEval()" class="w-full bg-blue-600 text-white p-4 rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100">إرسال عبر واتساب</button>
                    </div>
                </div>
                <div class="space-y-6">
                    <div class="bg-white p-6 rounded-[2.5rem] shadow-sm border text-center">
                        <h3 class="text-xs font-bold mb-4">كود الربط</h3>
                        ${qrSection}
                    </div>
                    <div class="bg-slate-900 p-6 rounded-[2.5rem] text-white shadow-xl">
                        <h3 class="text-xs font-bold mb-4 text-blue-400">إدارة الفروع</h3>
                        <textarea id="branchesInput" class="w-full bg-slate-800 p-3 rounded-xl text-[10px] outline-none h-24 mb-3 border-none">${settings.branches}</textarea>
                        <button onclick="updateBranches()" class="w-full bg-blue-500 p-3 rounded-xl text-[10px] font-bold">حفظ الفروع</button>
                    </div>
                </div>
            </div>
            <div class="grid grid-cols-3 gap-4 text-center">
                <div class="bg-white p-5 rounded-3xl border"><p class="text-[10px] font-bold text-gray-400 mb-1">الطلبات</p><h2 class="text-2xl font-black">${stats.total}</h2></div>
                <div class="bg-white p-5 rounded-3xl border-b-4 border-green-500"><p class="text-[10px] font-bold text-green-500 mb-1">ممتاز</p><h2 class="text-2xl font-black">${stats.pos}</h2></div>
                <div class="bg-white p-5 rounded-3xl border-b-4 border-red-500"><p class="text-[10px] font-bold text-red-500 mb-1">شكوى</p><h2 class="text-2xl font-black">${stats.neg}</h2></div>
            </div>
        </div>
        <script>
            async function sendEval() {
                const n=document.getElementById('name').value, p=document.getElementById('phone').value, b=document.getElementById('branch').value;
                if(!p) return alert('الرقم مطلوب');
                const res = await fetch('/api/send?key=${CONFIG.webhookKey}', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({phone:p, name:n, branch:b})
                });
                if(res.ok) { alert('✅ تم الإرسال'); location.reload(); } else alert('❌ خطأ');
            }
            async function updateBranches() {
                const b = document.getElementById('branchesInput').value;
                const res = await fetch('/api/settings?key=${CONFIG.webhookKey}', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({branches: b})
                });
                if(res.ok) { alert('✅ تم الحفظ'); location.reload(); }
            }
        </script>
    </body></html>`);
});

app.post('/api/send', async (req, res) => {
    if (req.query.key !== CONFIG.webhookKey) return res.sendStatus(401);
    let { phone, name, branch } = req.body;
    let p = phone.replace(/\D/g, '');
    if (p.startsWith('05')) p = '966' + p.substring(1);
    await db.collection('evaluations').insertOne({ phone: p, name, branch, status: 'sent', sentAt: new Date() });
    setTimeout(async () => {
        if (isReady && sock) {
            const msg = `أهلاً بك ${name || ''}، كيف كانت تجربتك في ${branch || 'فرعنا'}؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين`;
            await sock.sendMessage(p + "@s.whatsapp.net", { text: msg });
        }
    }, CONFIG.delay + 1000);
    res.json({ success: true });
});

app.post('/api/settings', async (req, res) => {
    if (req.query.key !== CONFIG.webhookKey) return res.sendStatus(401);
    await db.collection('config').updateOne({ _id: 'global_settings' }, { $set: { branches: req.body.branches } }, { upsert: true });
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); await connectToWhatsApp(); });