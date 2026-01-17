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

// --- الإعدادات (ثوابت ومتغيرات بيئة) ---
const CONFIG = {
    mongoUrl: process.env.MONGO_URL,
    webhookKey: process.env.WEBHOOK_KEY,
    googleLink: "https://maps.google.com/?q=YourBusiness", // الرابط الثابت
    discountCode: "MAWJA2026", // كود الخصم الثابت
    delay: (parseInt(process.env.DELAY_MINUTES) || 0) * 60000 // تحويل الدقائق لميلي ثانية
};

const SESSION_DIR = path.join(__dirname, 'auth_session');
let sock = null, isReady = false, lastQR = null, db = null;

// --- قاعدة البيانات ---
const initMongo = async () => {
    try {
        const client = new MongoClient(CONFIG.mongoUrl);
        await client.connect();
        db = client.db('whatsapp_bot');
        await db.collection('evaluations').createIndex({ phone: 1, status: 1 });
        console.log("🔗 MongoDB Connected.");
    } catch (e) { setTimeout(initMongo, 5000); }
};

// --- مزامنة الجلسة لبيئة Render ---
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

// --- اتصال واتساب ---
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
        if (connection === 'open') { isReady = true; lastQR = null; console.log("✅ Bot Ready"); }
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
                const reply = text === "1" ? `يسعدنا تقييمك! 😍\n📍 ${CONFIG.googleLink}` : `نعتذر منك 😔\n🎫 كود الخصم لزيارتك القادمة: ${CONFIG.discountCode}`;
                await sock.sendMessage(msg.key.remoteJid, { text: reply });
            }
        }
    });
}

// --- واجهة MAWJAT ANALYTICS ---
app.get('/admin', async (req, res) => {
    if (!db) return res.send("جاري الاتصال بقاعدة البيانات...");
    const settings = await db.collection('config').findOne({ _id: 'global_settings' }) || { branches: "فرع جدة, فرع الرياض, فرع الخبر" };
    const branches = settings.branches.split(',').map(b => b.trim());
    const stats = {
        total: await db.collection('evaluations').countDocuments(),
        pos: await db.collection('evaluations').countDocuments({ answer: '1' }),
        neg: await db.collection('evaluations').countDocuments({ answer: '2' })
    };

    const statusText = isReady ? 'Active' : 'Disconnected';
    const statusColor = isReady ? 'bg-green-500' : 'bg-red-500';
    const qrSection = isReady ? '<div class="py-10 text-green-500 font-black text-xs uppercase tracking-widest">WhatsApp Linked ✅</div>' : 
                      (lastQR ? `<div class="text-center"><p class="text-[8px] font-black text-gray-400 mb-3 uppercase italic">Scan for Link</p><img src="${lastQR}" class="mx-auto w-40 rounded-[2rem] shadow-2xl border-4 border-white"></div>` : '<div class="py-10 text-gray-300 font-bold animate-pulse text-xs">Generating QR...</div>');

    res.send(`
    <!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>Mawjat Analytics</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">
    <style>body{font-family:'Cairo',sans-serif; background-color:#f8fafc;}</style></head>
    <body class="p-4 md:p-8">
        <div class="max-w-6xl mx-auto space-y-6">
            <header class="bg-white p-6 rounded-[2.5rem] shadow-sm flex justify-between items-center border border-gray-100">
                <div class="flex items-center gap-4">
                    <div class="bg-blue-600 p-3 rounded-2xl text-white shadow-lg shadow-blue-200">
                        <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    </div>
                    <div>
                        <h1 class="text-2xl font-black italic text-slate-800 tracking-tighter uppercase">MAWJAT <span class="text-blue-600">ANALYTICS</span></h1>
                        <p class="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Branch Reputation Monitor</p>
                    </div>
                </div>
                <div class="flex items-center gap-3 bg-slate-50 px-5 py-2.5 rounded-2xl border">
                    <div class="w-2.5 h-2.5 rounded-full ${statusColor}"></div>
                    <span class="text-[10px] font-black uppercase text-slate-500 tracking-widest">${statusText}</span>
                </div>
            </header>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div class="lg:col-span-2 bg-white p-10 rounded-[3rem] shadow-sm border border-gray-100">
                    <h3 class="font-black text-blue-900 text-lg mb-8 flex items-center gap-3"><span>🚀</span> إرسال طلب تقييم فوري</h3>
                    <div class="grid md:grid-cols-2 gap-6 mb-6">
                        <div class="space-y-2 text-right">
                            <label class="text-[10px] font-black text-gray-400 mr-2 uppercase italic tracking-widest">Client Name</label>
                            <input id="name" placeholder="اسم العميل" class="w-full p-4 bg-gray-50 border rounded-2xl outline-none focus:ring-4 ring-blue-50 transition-all font-bold">
                        </div>
                        <div class="space-y-2 text-right">
                            <label class="text-[10px] font-black text-gray-400 mr-2 uppercase italic tracking-widest">Phone Number</label>
                            <input id="phone" placeholder="05xxxxxxxx" class="w-full p-4 bg-gray-50 border rounded-2xl outline-none focus:ring-4 ring-blue-50 transition-all font-bold text-center">
                        </div>
                    </div>
                    <div class="space-y-2 text-right mb-8">
                        <label class="text-[10px] font-black text-gray-400 mr-2 uppercase italic tracking-widest">Select Branch</label>
                        <select id="branch" class="w-full p-4 bg-blue-50 text-blue-900 border border-blue-100 rounded-2xl font-black outline-none cursor-pointer">
                            ${branches.map(b => `<option value="${b}">${b}</option>`).join('')}
                        </select>
                    </div>
                    <button onclick="sendEval()" class="w-full bg-blue-600 text-white p-5 rounded-[2rem] font-black text-lg shadow-2xl shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all uppercase tracking-tighter">Send Feedback Request</button>
                </div>

                <div class="space-y-6">
                    <div class="bg-white p-8 rounded-[3rem] shadow-sm border border-dashed border-slate-200 text-center">
                        <h3 class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 italic">Link WhatsApp</h3>
                        ${qrSection}
                    </div>
                    <div class="bg-slate-900 p-8 rounded-[3rem] text-white shadow-xl">
                        <h4 class="text-[10px] font-black uppercase tracking-widest text-blue-400 mb-6 flex justify-between items-center">إدارة الفروع <span>Branches</span></h4>
                        <textarea id="branchesInput" class="w-full bg-slate-800 p-4 rounded-2xl text-[10px] font-bold outline-none border-none h-28 mb-4 focus:ring-2 ring-blue-500 transition-all">${settings.branches}</textarea>
                        <button onclick="updateBranches()" class="w-full bg-blue-500 text-white p-4 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-900/50">Save Branches</button>
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-3 gap-6">
                <div class="bg-white p-8 rounded-[2rem] shadow-sm border text-center">
                    <p class="text-[10px] font-black text-gray-400 uppercase mb-1 tracking-widest">Total Sent</p>
                    <h2 class="text-3xl font-black text-slate-800">${stats.total}</h2>
                </div>
                <div class="bg-white p-8 rounded-[2rem] shadow-sm border-b-4 border-green-500 text-center">
                    <p class="text-[10px] font-black text-green-500 uppercase mb-1 tracking-widest">Excellent 😍</p>
                    <h2 class="text-3xl font-black text-green-600">${stats.pos}</h2>
                </div>
                <div class="bg-white p-8 rounded-[2rem] shadow-sm border-b-4 border-red-500 text-center">
                    <p class="text-[10px] font-black text-red-500 uppercase mb-1 tracking-widest">Improve 😔</p>
                    <h2 class="text-3xl font-black text-red-600">${stats.neg}</h2>
                </div>
            </div>
        </div>

        <script>
            async function sendEval() {
                const n=document.getElementById('name').value, p=document.getElementById('phone').value, b=document.getElementById('branch').value;
                if(!p) return alert('برجاء إدخال رقم الهاتف');
                const res = await fetch('/api/send?key=${CONFIG.webhookKey}', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({phone:p, name:n, branch:b})
                });
                if(res.ok) { alert('✅ تم الإرسال للعميل'); location.reload(); }
                else alert('❌ خطأ: تأكد من ربط واتساب أولاً');
            }
            async function updateBranches() {
                const b = document.getElementById('branchesInput').value;
                const res = await fetch('/api/settings?key=${CONFIG.webhookKey}', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({branches: b})
                });
                if(res.ok) { alert('✅ تم تحديث الفروع'); location.reload(); }
            }
        </script>
    </body></html>`);
});

// --- API الإرسال المصلح (Fix Sending Logic) ---
app.post('/api/send', async (req, res) => {
    if (req.query.key !== CONFIG.webhookKey) return res.sendStatus(401);
    let { phone, name, branch } = req.body;
    let p = phone.replace(/\D/g, ''); 
    if (p.startsWith('05')) p = '966' + p.substring(1);
    if (p.length === 9) p = '966' + p;

    const jid = p + "@s.whatsapp.net";

    await db.collection('evaluations').insertOne({ phone: p, name, branch, status: 'sent', sentAt: new Date() });
    
    if (isReady && sock) {
        setTimeout(async () => {
            try {
                const msg = `أهلاً بك ${name || ''}، سعدنا بزيارتك لنا في ${branch || 'فرعنا'}! ✨\n\nكيف كانت تجربتك معنا؟\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين`;
                await sock.sendMessage(jid, { text: msg });
                console.log("✅ Sent to: " + jid);
            } catch (err) { console.error("❌ Send Fail"); }
        }, CONFIG.delay + 1000);
        res.json({ success: true });
    } else {
        res.status(503).json({ error: 'Disconnected' });
    }
});

app.post('/api/settings', async (req, res) => {
    if (req.query.key !== CONFIG.webhookKey) return res.sendStatus(401);
    await db.collection('config').updateOne({ _id: 'global_settings' }, { $set: { branches: req.body.branches } }, { upsert: true });
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); await connectToWhatsApp(); });