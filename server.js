/**
 * MAWJA BOT PRO v12.5
 * الميزات: مزامنة MongoDB، لوحة تحكم كاملة، أمان عالي
 */

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

// --- الإعدادات الفنية ---
const CONFIG = {
    mongoUrl: process.env.MONGO_URL,
    webhookKey: process.env.WEBHOOK_KEY,
    googleLink: process.env.GOOGLE_MAPS_LINK || "#",
    discountCode: process.env.DISCOUNT_CODE || "MAWJA2026",
    delay: (parseInt(process.env.DELAY_MINUTES) || 0) * 60000
};

const SESSION_DIR = path.join(__dirname, 'auth_session');
let sock = null, isReady = false, lastQR = null, db = null;

// --- نظام قاعدة البيانات ---
const initMongo = async () => {
    try {
        const client = new MongoClient(CONFIG.mongoUrl);
        await client.connect();
        db = client.db('whatsapp_bot');
        // إنشاء كشافات لسرعة البحث
        await db.collection('evaluations').createIndex({ phone: 1, status: 1 });
        await db.collection('evaluations').createIndex({ sentAt: -1 });
        console.log("🔗 MongoDB Connected & Optimized.");
    } catch (e) {
        console.error("❌ MongoDB Error:", e.message);
        setTimeout(initMongo, 5000);
    }
};

// --- مزامنة الجلسة لبيئة Render ---
async function syncSession(action) {
    if (!db) return;
    const credsFile = path.join(SESSION_DIR, 'creds.json');
    try {
        if (action === 'save' && fs.existsSync(credsFile)) {
            const data = fs.readFileSync(credsFile, 'utf-8');
            await db.collection('session').updateOne({ _id: 'creds' }, { $set: { data, updated: new Date() } }, { upsert: true });
        } else if (action === 'restore') {
            const res = await db.collection('session').findOne({ _id: 'creds' });
            if (res) {
                if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
                fs.writeFileSync(credsFile, res.data);
                console.log("📂 Session restored from MongoDB.");
            }
        }
    } catch (e) { console.error("⚠️ Session Sync Error"); }
}

// --- اتصال واتساب (Baileys) ---
async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = await import('@whiskeysockets/baileys');
    
    await syncSession('restore');
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    sock = makeWASocket({
        auth: state,
        browser: Browsers.macOS('Desktop'),
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', async () => { 
        await saveCreds(); 
        await syncSession('save'); 
    });

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
        if (connection === 'open') { isReady = true; lastQR = null; console.log("✅ WhatsApp Connected."); }
        if (connection === 'close') {
            isReady = false;
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (!shouldReconnect) {
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
            const evaluation = await db.collection('evaluations').findOneAndUpdate(
                { phone: { $regex: phone + "$" }, status: 'sent' },
                { $set: { status: 'replied', answer: text, repliedAt: new Date() } },
                { sort: { sentAt: -1 } }
            );

            if (evaluation) {
                const reply = text === "1" ? `يسعدنا تقييمك! 😍\n📍 ${CONFIG.googleLink}` : `نعتذر منك 😔\n🎫 كود الخصم: ${CONFIG.discountCode}`;
                await sock.sendMessage(msg.key.remoteJid, { text: reply });
            }
        }
    });
}

// --- لوحة التحكم (Admin Dashboard) ---
app.get('/admin', async (req, res) => {
    if (!db) return res.send("جاري الاتصال بقاعدة البيانات...");
    
    const settings = await db.collection('config').findOne({ _id: 'global_settings' }) || { branches: "فرع الرياض, فرع جدة" };
    const branches = settings.branches.split(',').map(b => b.trim());
    const recentEvals = await db.collection('evaluations').find().sort({ sentAt: -1 }).limit(10).toArray();
    
    const stats = {
        total: await db.collection('evaluations').countDocuments(),
        pos: await db.collection('evaluations').countDocuments({ answer: '1' }),
        neg: await db.collection('evaluations').countDocuments({ answer: '2' })
    };

    res.send(`
    <!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>لوحة التحكم | Mawja</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">
    <style>body{font-family:'Cairo',sans-serif; background-color:#f8fafc;}</style></head>
    <body class="p-4 md:p-10">
        <div class="max-w-6xl mx-auto space-y-8">
            <div class="bg-white p-6 rounded-[2rem] shadow-sm flex justify-between items-center border">
                <div><h1 class="text-2xl font-black text-blue-600 italic">MAWJA <span class="text-slate-800 not-italic">ADMIN</span></h1></div>
                <div class="flex items-center gap-4">
                    <div class="flex items-center gap-2 bg-slate-50 px-4 py-2 rounded-2xl border text-xs font-bold">
                        <div class="w-3 h-3 rounded-full ${isReady ? 'bg-green-500 animate-pulse' : 'bg-red-500'}"></div>
                        ${isReady ? 'متصل' : 'غير متصل'}
                    </div>
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div class="lg:col-span-2 space-y-8">
                    <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border border-blue-50">
                        <h3 class="font-black text-lg mb-6 flex items-center gap-3"><span>📩</span> إرسال طلب تقييم</h3>
                        <div class="grid md:grid-cols-2 gap-4 mb-4">
                            <input id="name" placeholder="اسم العميل" class="p-4 bg-slate-50 border rounded-2xl outline-none focus:ring-2 ring-blue-100 transition-all">
                            <input id="phone" placeholder="05xxxxxxxx" class="p-4 bg-slate-50 border rounded-2xl outline-none focus:ring-2 ring-blue-100 text-center font-bold">
                        </div>
                        <select id="branch" class="w-full p-4 bg-slate-50 border rounded-2xl mb-4 outline-none cursor-pointer">
                            ${branches.map(b => `<option value="${b}">${b}</option>`).join('')}
                        </select>
                        <button onclick="sendEval()" class="w-full bg-blue-600 text-white p-4 rounded-2xl font-black shadow-lg shadow-blue-100 hover:bg-blue-700 active:scale-95 transition-all">إرسال عبر واتساب</button>
                    </div>

                    <div class="bg-white rounded-[2.5rem] shadow-sm border overflow-hidden">
                        <div class="p-6 bg-slate-50 font-bold border-b text-sm">آخر 10 عمليات</div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-right text-xs">
                                <thead class="bg-slate-50 text-slate-400 uppercase font-black">
                                    <tr><th class="p-4">العميل</th><th class="p-4">الفرع</th><th class="p-4 text-center">الحالة</th><th class="p-4 text-center">الرد</th></tr>
                                </thead>
                                <tbody>
                                    ${recentEvals.map(e => `
                                        <tr class="border-b last:border-0 hover:bg-slate-50/50 transition-all">
                                            <td class="p-4"><div class="font-bold">${e.name || 'عميل'}</div><div class="text-[10px] text-slate-400">${e.phone}</div></td>
                                            <td class="p-4 text-slate-500">${e.branch}</td>
                                            <td class="p-4 text-center"><span class="px-3 py-1 rounded-full ${e.status === 'replied' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'} font-bold">${e.status}</span></td>
                                            <td class="p-4 text-center font-black text-lg">${e.answer || '-'}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div class="space-y-8">
                    <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border border-dashed border-slate-300 text-center">
                        <h3 class="text-sm font-black mb-6">ربط الواتساب</h3>
                        ${isReady ? '<div class="py-10 text-green-500 font-black">✅ الجهاز مرتبط</div>' : (lastQR ? `<img src="${lastQR}" class="mx-auto w-48 shadow-2xl rounded-3xl border-4 border-white">` : '<div class="py-10 text-slate-300 animate-pulse">جاري تحضير الكود...</div>')}
                    </div>

                    <div class="bg-slate-900 p-8 rounded-[2.5rem] shadow-xl text-white">
                        <h3 class="text-sm font-black mb-4 text-blue-400 uppercase italic">إدارة الفروع</h3>
                        <p class="text-[10px] text-slate-400 mb-4 font-bold leading-relaxed italic">افصل بين أسماء الفروع بفاصلة (,)</p>
                        <textarea id="branchesInput" class="w-full bg-slate-800 p-4 rounded-2xl text-xs outline-none border border-slate-700 h-28 focus:border-blue-500 transition-all">${settings.branches}</textarea>
                        <button onclick="updateBranches()" class="w-full bg-blue-600 mt-4 p-3 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-blue-900/50">تحديث القائمة</button>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div class="bg-white p-6 rounded-3xl border text-center">
                            <p class="text-[9px] font-black text-slate-400 mb-1">راضٍ 😍</p>
                            <h2 class="text-2xl font-black text-green-600">${stats.pos}</h2>
                        </div>
                        <div class="bg-white p-6 rounded-3xl border text-center">
                            <p class="text-[9px] font-black text-slate-400 mb-1">شكوى 😔</p>
                            <h2 class="text-2xl font-black text-red-600">${stats.neg}</h2>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <script>
            async function sendEval() {
                const n = document.getElementById('name').value;
                const p = document.getElementById('phone').value;
                const b = document.getElementById('branch').value;
                if(!p) return alert('الرقم مطلوب');
                const res = await fetch('/api/send?key=${CONFIG.webhookKey}', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({phone: p, name: n, branch: b})
                });
                if(res.ok) { alert('✅ تم الإرسال'); location.reload(); }
                else alert('❌ خطأ في الإرسال');
            }
            async function updateBranches() {
                const b = document.getElementById('branchesInput').value;
                await fetch('/api/settings?key=${CONFIG.webhookKey}', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({branches: b})
                });
                alert('✅ تم التحديث'); location.reload();
            }
        </script>
    </body></html>`);
});

// --- API Endpoints ---
app.post('/api/send', async (req, res) => {
    if (req.query.key !== CONFIG.webhookKey) return res.sendStatus(401);
    let { phone, name, branch } = req.body;
    let p = phone.replace(/\D/g, '');
    if (p.startsWith('05')) p = '966' + p.substring(1);

    await db.collection('evaluations').insertOne({ phone: p, name, branch, status: 'sent', sentAt: new Date() });

    setTimeout(async () => {
        if (isReady && sock) {
            const message = `أهلاً بك ${name || ''}، سعدنا بزيارتك لنا في ${branch || 'فرعنا'}! ✨\n\nكيف كانت تجربتك معنا؟\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين`;
            await sock.sendMessage(p + "@s.whatsapp.net", { text: message });
        }
    }, CONFIG.delay + 1000);
    res.json({ success: true });
});

app.post('/api/settings', async (req, res) => {
    if (req.query.key !== CONFIG.webhookKey) return res.sendStatus(401);
    await db.collection('config').updateOne({ _id: 'global_settings' }, { $set: { branches: req.body.branches } }, { upsert: true });
    res.json({ success: true });
});

// تشغيل النظام
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
    await initMongo();
    await connectToWhatsApp();
    console.log(`🚀 Server on port ${PORT}`);
});