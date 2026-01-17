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

// --- الإعدادات من البيئة ---
const CONFIG = {
    googleLink: process.env.GOOGLE_MAPS_LINK || "#",
    discountCode: process.env.DISCOUNT_CODE || "MAWJA2026",
    delayMinutes: parseInt(process.env.DELAY_MINUTES) || 0,
    webhookKey: process.env.WEBHOOK_KEY
};

const SESSION_PATH = path.join(__dirname, 'auth_stable_v111');
let sock = null, isReady = false, lastQR = null, db = null;

// --- قاعدة البيانات ---
const initMongo = async () => {
    try {
        const client = new MongoClient(process.env.MONGO_URL);
        await client.connect();
        db = client.db('whatsapp_bot');
        await db.collection('evaluations').createIndex({ phone: 1, status: 1 });
        console.log("🔗 MongoDB Connected.");
    } catch (e) { setTimeout(initMongo, 5000); }
};

// --- إدارة الجلسة لـ Render ---
async function syncSession(type) {
    if (!db) return;
    try {
        const file = path.join(SESSION_PATH, 'creds.json');
        if (type === 'save' && fs.existsSync(file)) {
            const data = fs.readFileSync(file, 'utf-8');
            await db.collection('session').updateOne({ _id: 'creds' }, { $set: { data } }, { upsert: true });
        } else if (type === 'restore') {
            const res = await db.collection('session').findOne({ _id: 'creds' });
            if (res) {
                if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });
                fs.writeFileSync(file, res.data);
            }
        }
    } catch (e) { console.error("Session sync failed"); }
}

// --- اتصال واتساب ---
async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = await import('@whiskeysockets/baileys');
    await syncSession('restore');
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);

    sock = makeWASocket({
        auth: state,
        browser: Browsers.macOS('Desktop'),
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', async () => { await saveCreds(); await syncSession('save'); });

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
        if (connection === 'open') { isReady = true; lastQR = null; }
        if (connection === 'close') {
            isReady = false;
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                setTimeout(connectToWhatsApp, 5000);
            }
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

// --- الواجهة الأمامية (Dashboard) ---
app.get('/admin', async (req, res) => {
    if (!db) return res.send("Connecting...");
    const evals = await db.collection('evaluations').find().sort({ sentAt: -1 }).limit(10).toArray();
    const stats = {
        total: await db.collection('evaluations').countDocuments(),
        pos: await db.collection('evaluations').countDocuments({ answer: '1' }),
        neg: await db.collection('evaluations').countDocuments({ answer: '2' })
    };

    res.send(`
    <!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>Mawja Admin</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap" rel="stylesheet">
    <style>body{font-family:'Cairo',sans-serif;}</style></head>
    <body class="bg-gray-50 p-5">
        <div class="max-w-4xl mx-auto">
            <div class="flex justify-between items-center mb-10 bg-white p-6 rounded-2xl shadow-sm">
                <div><h1 class="text-2xl font-bold text-blue-600">Mawja Control</h1><p class="text-gray-400 text-sm">نظام إدارة التقييمات الذكي</p></div>
                <div class="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-full">
                    <div class="w-3 h-3 rounded-full ${isReady ? 'bg-green-500' : 'bg-red-500'}"></div>
                    <span class="text-xs font-bold">${isReady ? 'متصل' : 'جاري الربط'}</span>
                </div>
            </div>

            <div class="grid grid-cols-3 gap-4 mb-8">
                <div class="bg-white p-6 rounded-2xl border-b-4 border-blue-500 shadow-sm text-center">
                    <p class="text-gray-400 text-xs mb-1">إجمالي الطلبات</p>
                    <h2 class="text-3xl font-bold">${stats.total}</h2>
                </div>
                <div class="bg-white p-6 rounded-2xl border-b-4 border-green-500 shadow-sm text-center">
                    <p class="text-gray-400 text-xs mb-1">تقييم ممتاز</p>
                    <h2 class="text-3xl font-bold text-green-600">${stats.pos}</h2>
                </div>
                <div class="bg-white p-6 rounded-2xl border-b-4 border-red-500 shadow-sm text-center">
                    <p class="text-gray-400 text-xs mb-1">شكاوى</p>
                    <h2 class="text-3xl font-bold text-red-600">${stats.neg}</h2>
                </div>
            </div>

            <div class="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div class="p-6 border-b border-gray-100 flex justify-between items-center">
                    <h3 class="font-bold">آخر العمليات</h3>
                    ${lastQR ? '<button onclick="window.open(\''+lastQR+'\')" class="text-xs bg-blue-600 text-white px-4 py-2 rounded-lg">إظهار QR Code</button>' : ''}
                </div>
                <table class="w-full text-right text-sm">
                    <thead class="bg-gray-50 text-gray-500"><tr><th class="p-4">الهاتف</th><th class="p-4 text-center">الحالة</th><th class="p-4 text-center">الرد</th></tr></thead>
                    <tbody>
                        ${evals.map(e => `
                            <tr class="border-b border-gray-50">
                                <td class="p-4 font-mono">${e.phone}</td>
                                <td class="p-4 text-center"><span class="px-2 py-1 rounded-md text-[10px] ${e.status === 'replied' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}">${e.status}</span></td>
                                <td class="p-4 text-center font-bold">${e.answer || '-'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    </body></html>`);
});

// --- API ---
app.post('/send-evaluation', async (req, res) => {
    if (req.headers['x-api-key'] !== CONFIG.webhookKey) return res.sendStatus(401);
    let { phone, branch } = req.body;
    let p = phone.replace(/\D/g, '');
    if (p.startsWith('05')) p = '966' + p.substring(1);
    
    await db.collection('evaluations').insertOne({ phone: p, branch, status: 'sent', sentAt: new Date() });
    
    setTimeout(async () => {
        if (isReady) {
            const msg = `أهلاً بك، كيف كانت تجربتك في ${branch || 'فرعنا'}؟\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين`;
            await sock.sendMessage(p + "@s.whatsapp.net", { text: msg });
        }
    }, (CONFIG.delayMinutes * 60000) + 1000);
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { 
    await initMongo(); 
    await connectToWhatsApp(); 
    console.log("🚀 Server Running on " + PORT);
});