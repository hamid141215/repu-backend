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

// --- Sync Session ---
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

// --- WhatsApp Core ---
async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await import('@whiskeysockets/baileys');
    await restoreSession();
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
        if (connection === 'open') { isReady = true; lastQR = null; }
        if (connection === 'close') {
            isReady = false;
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) setTimeout(connectToWhatsApp, 5000);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg || !msg.message || msg.key.fromMe) return;
            const phone = msg.key.remoteJid.split('@')[0];
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

            if (text === "1" || text === "2") {
                const s = dbConnected ? await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' }) : null;
                const config = s || { googleLink: "#", discountCode: "OFFER10" };
                
                // تحديث حالة التقرير في MongoDB
                if(dbConnected) {
                    await client.db('whatsapp_bot').collection('evaluations').updateOne(
                        { phone: phone, status: 'sent' },
                        { $set: { status: 'replied', answer: text, repliedAt: new Date() } },
                        { sort: { sentAt: -1 } }
                    );
                }

                if (text === "1") {
                    await sock.sendMessage(msg.key.remoteJid, { text: `يسعدنا تقييمك! 😍\n📍 ${config.googleLink}` });
                } else {
                    await sock.sendMessage(msg.key.remoteJid, { text: `نعتذر منك 😔\n🎫 كود الخصم: ${config.discountCode}` });
                }
            }
        } catch (e) {}
    });
}

// --- 1. Landing Page (تعديل المسار الرئيسي) ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>موجة الصمت | الحل الذكي لتقييمات المطاعم</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style> @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap'); body { font-family: 'Cairo', sans-serif; } </style>
    </head>
    <body class="bg-white text-gray-900">
        <nav class="p-6 flex justify-between items-center max-w-6xl mx-auto">
            <h1 class="text-2xl font-black italic">MAWJAT <span class="text-blue-600 font-normal">ALSAMT</span></h1>
            <a href="/admin" class="bg-gray-100 px-5 py-2 rounded-full font-bold text-sm hover:bg-gray-200 transition">دخول العملاء</a>
        </nav>
        
        <header class="py-20 text-center px-4">
            <h2 class="text-5xl md:text-7xl font-black mb-6 leading-tight">سيطر على سمعة مطعمك <br><span class="text-blue-600">بصمت واحترافية</span></h2>
            <p class="text-xl text-gray-500 max-w-2xl mx-auto mb-10">حوّل تجارب عملائك إلى تقييمات 5 نجوم على جوجل ماب، واستقبل الشكاوى داخلياً قبل أن يراها الجميع.</p>
            <div class="flex gap-4 justify-center">
                <button class="bg-blue-600 text-white px-8 py-4 rounded-2xl font-bold text-lg shadow-xl shadow-blue-100">ابدأ تجربتك المجانية</button>
            </div>
        </header>

        <section class="max-w-6xl mx-auto grid md:grid-cols-3 gap-8 px-6 py-20">
            <div class="p-8 bg-blue-50 rounded-[2.5rem] space-y-4">
                <div class="text-3xl">⭐</div>
                <h3 class="font-bold text-xl">زيادة تقييمات جوجل</h3>
                <p class="text-gray-600">نوجه العملاء الراضين تلقائياً لتقييم مطعمك بـ 5 نجوم.</p>
            </div>
            <div class="p-8 bg-red-50 rounded-[2.5rem] space-y-4">
                <div class="text-3xl">🛡️</div>
                <h3 class="font-bold text-xl">حماية من التقييم السلبي</h3>
                <p class="text-gray-600">العملاء غير الراضين يتم توجيهم لنظام شكاوى خاص لترضيتهم داخلياً.</p>
            </div>
            <div class="p-8 bg-gray-50 rounded-[2.5rem] space-y-4">
                <div class="text-3xl">📊</div>
                <h3 class="font-bold text-xl">تقارير يومية</h3>
                <p class="text-gray-600">لوحة تحكم ذكية توضح لك أداء فروعك ورضا عملائك لحظة بلحظة.</p>
            </div>
        </section>

        <footer class="py-10 text-center border-t text-gray-400 text-sm">
            © 2026 موجة الصمت. جميع الحقوق محفوظة.
        </footer>
    </body>
    </html>
    `);
});

// --- 2. Admin & Reporting (لوحة التحكم مع التقارير) ---
app.get('/admin', async (req, res) => {
    const s = dbConnected ? await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' }) : { googleLink: "#", discountCode: "OFFER10", delay: 0 };
    const evals = dbConnected ? await client.db('whatsapp_bot').collection('evaluations').find().sort({ sentAt: -1 }).limit(10).toArray() : [];

    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8"><title>لوحة التحكم | موجة الصمت</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style> @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap'); body { font-family: 'Cairo', sans-serif; background-color: #f8fafc; } </style>
    </head>
    <body class="p-4 md:p-8">
        <div class="max-w-5xl mx-auto space-y-8">
            <header class="flex justify-between items-center">
                <h1 class="text-2xl font-black italic">MAWJAT <span class="text-blue-600">ALSAMT</span></h1>
                <div class="flex items-center gap-2 bg-white px-4 py-2 rounded-xl border text-xs font-bold">
                    <div class="w-2 h-2 rounded-full \${isReady ? 'bg-green-500 animate-pulse' : 'bg-red-500'}"></div>
                    \${isReady ? 'متصل' : 'جاري الربط'}
                </div>
            </header>

            <div class="grid md:grid-cols-2 gap-8">
                <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border space-y-4 text-center">
                    <h3 class="font-bold text-blue-600">📥 إرسال تقييم جديد</h3>
                    <input id="p" placeholder="رقم الجوال 05xxxxxxxx" class="w-full p-4 bg-gray-50 rounded-2xl border-none ring-1 ring-gray-100 font-bold text-center outline-none">
                    <input id="n" placeholder="اسم العميل" class="w-full p-4 bg-gray-50 rounded-2xl border-none ring-1 ring-gray-100 font-bold text-center outline-none">
                    <button onclick="send()" id="sb" class="w-full bg-blue-600 text-white p-4 rounded-2xl font-bold active:scale-95 transition">إرسال التقييم</button>
                </div>

                <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border space-y-4 text-center text-right">
                    <h3 class="font-bold text-green-600">⚙️ الإعدادات</h3>
                    <input id="gl" value="\${s?.googleLink}" class="w-full p-3 bg-gray-50 rounded-xl text-xs text-center border-none ring-1 ring-gray-100">
                    <div class="flex gap-2">
                        <input id="dc" value="\${s?.discountCode}" class="w-1/2 p-3 bg-gray-50 rounded-xl text-center font-bold text-blue-600">
                        <input id="dl" value="\${s?.delay}" class="w-1/2 p-3 bg-gray-50 rounded-xl text-center font-bold">
                    </div>
                    <button onclick="save()" class="w-full bg-black text-white p-4 rounded-2xl font-bold active:scale-95 transition">حفظ</button>
                </div>
            </div>

            <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border overflow-hidden">
                <h3 class="font-bold mb-6 text-gray-800">📊 تقارير آخر العمليات</h3>
                <div class="overflow-x-auto">
                    <table class="w-full text-right text-sm">
                        <thead>
                            <tr class="border-b text-gray-400"><th class="pb-4">العميل</th><th class="pb-4">الحالة</th><th class="pb-4">الرد</th><th class="pb-4">الوقت</th></tr>
                        </thead>
                        <tbody>
                            \${evals.map(e => \`
                                <tr class="border-b last:border-0 hover:bg-gray-50">
                                    <td class="py-4 font-bold">\${e.phone}</td>
                                    <td class="py-4"><span class="px-2 py-1 rounded-lg text-[10px] font-bold \${e.status === 'replied' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}">\${e.status === 'replied' ? 'تم الرد' : 'بانتظار الرد'}</span></td>
                                    <td class="py-4 font-black \${e.answer === '1' ? 'text-green-500' : 'text-red-500'}">\${e.answer ? (e.answer === '1' ? 'ممتاز 😍' : 'يحتاج تحسين 😔') : '-'}</td>
                                    <td class="py-4 text-gray-400 text-[10px] font-mono">\${new Date(e.sentAt).toLocaleString('ar-SA')}</td>
                                </tr>
                            \`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="bg-white p-6 rounded-[2.5rem] text-center border-2 border-dashed border-gray-100">
                \${lastQR ? \`<img src="\${lastQR}" class="mx-auto w-32 border p-2 bg-white rounded-xl shadow-sm">\` : isReady ? '<p class="text-green-600 font-bold uppercase tracking-widest">Connected ✅</p>' : '<p class="animate-pulse">Loading...</p>'}
            </div>
        </div>
        <script>
            async function send() {
                const p = document.getElementById('p').value; const n = document.getElementById('n').value;
                if(!p) return alert('أدخل الرقم');
                const res = await fetch('/send-evaluation?key=\${process.env.WEBHOOK_KEY}', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({phone:p, name:n}) });
                if(res.ok) { alert('✅ تم الإرسال'); location.reload(); }
            }
            async function save() {
                const d = { googleLink: document.getElementById('gl').value, discountCode: document.getElementById('dc').value, delay: document.getElementById('dl').value };
                const res = await fetch('/update-settings?key=\${process.env.WEBHOOK_KEY}', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(d) });
                if(res.ok) alert('✅ تم الحفظ');
            }
        </script>
    </body>
    </html>
    `);
});

// --- API ---
app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { phone, name } = req.body;
    
    // تسجيل في التقرير
    if(dbConnected) {
        await client.db('whatsapp_bot').collection('evaluations').insertOne({
            phone: phone, name: name, status: 'sent', sentAt: new Date()
        });
    }

    setTimeout(async () => {
        if (isReady && sock) {
            let p = phone.replace(/[^0-9]/g, '');
            if (p.startsWith('05')) p = '966' + p.substring(1);
            await sock.sendMessage(p + "@s.whatsapp.net", { text: `مرحباً ${name || 'عزيزنا'}، نورتنا اليوم! ✨\n\nكيف كانت تجربتك معنا؟\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` });
        }
    }, 3000);
    res.json({ success: true });
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { googleLink, discountCode, delay } = req.body;
    if(dbConnected) await client.db('whatsapp_bot').collection('config').updateOne({ _id: 'global_settings' }, { $set: { googleLink, discountCode, delay: parseInt(delay) || 0 } }, { upsert: true });
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); await connectToWhatsApp(); });