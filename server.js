if (!globalThis.crypto) { globalThis.crypto = require('crypto').webcrypto; }
require('dotenv').config();
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());

const CONFIG = {
    mongoUrl: process.env.MONGO_URL,
    webhookKey: process.env.WEBHOOK_KEY,
    googleLink: process.env.Maps_LINK || "#",
    discountCode: process.env.DISCOUNT_CODE || "MAWJA2026",
    managerPhone: process.env.MANAGER_PHONE,
    delay: (parseInt(process.env.DELAY_MINUTES) || 0) * 60000
};

const SESSION_DIR = path.join(__dirname, 'auth_session');
let sock = null, isReady = false, lastQR = null, db = null, isSyncing = false;

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
    if (!db || isSyncing) return;
    isSyncing = true;
    const credsFile = path.join(SESSION_DIR, 'creds.json');
    try {
        if (action === 'save' && fs.existsSync(credsFile)) {
            await db.collection('session').updateOne({ _id: 'creds' }, { $set: { data: fs.readFileSync(credsFile, 'utf-8'), lastUpdate: new Date() } }, { upsert: true });
        } else if (action === 'restore') {
            const res = await db.collection('session').findOne({ _id: 'creds' });
            if (res) {
                if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
                fs.writeFileSync(credsFile, res.data);
            }
        }
    } catch (e) { console.error("Sync Error"); } finally { isSyncing = false; }
}

async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, Browsers, fetchLatestBaileysVersion } = await import('@whiskeysockets/baileys');
    await syncSession('restore');
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

    sock = makeWASocket({
        auth: state, version,
        browser: Browsers.macOS('Desktop'),
        logger: pino({ level: 'silent' }),
        syncFullHistory: false,
        maxMsgRetryCount: 15,
        getMessage: async () => ({ conversation: 'Mawjat Analytics' })
    });

    sock.ev.on('creds.update', async () => { await saveCreds(); await syncSession('save'); });
    sock.ev.on('connection.update', (u) => {
        const { connection, qr } = u;
        // تعديل الرابط لضمان عدم شطف الحواف ووضوح المربعات الجانبية
        if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300&margin=0&format=png`;
        if (connection === 'open') { isReady = true; lastQR = null; console.log("✅ Live"); }
        if (connection === 'close') { isReady = false; setTimeout(connectToWhatsApp, 5000); }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        if (["1", "2"].includes(text)) {
            const rawPhone = msg.key.remoteJid.split('@')[0];
            const evaluation = await db.collection('evaluations').findOneAndUpdate(
                { phone: { $regex: rawPhone.slice(-9) + "$" }, status: 'sent' },
                { $set: { status: 'replied', answer: text, repliedAt: new Date() } },
                { sort: { sentAt: -1 }, returnDocument: 'after' }
            );
            if (evaluation) {
                if (text === "1") {
                    await sock.sendMessage(msg.key.remoteJid, { text: `يسعدنا تقييمك! 😍\n📍 ${CONFIG.googleLink}` });
                } else if (text === "2") {
                    await sock.sendMessage(msg.key.remoteJid, { text: `نعتذر منك 😔\n🎫 كود الخصم: ${CONFIG.discountCode}` });
                    if (CONFIG.managerPhone) {
                        const mJid = CONFIG.managerPhone.replace(/\D/g, '') + "@s.whatsapp.net";
                        await sock.sendMessage(mJid, { text: `⚠️ شكوى جديدة من ${evaluation.name}\nالفرع: ${evaluation.branch}\nالرقم: ${rawPhone}` });
                    }
                }
            }
        }
    });
}

app.get('/admin', async (req, res) => {
    if (!db) return res.send("جاري الاتصال...");
    const settings = await db.collection('config').findOne({ _id: 'global_settings' }) || { branches: "جدة, الرياض" };
    const total = await db.collection('evaluations').countDocuments();
    let html = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
    const map = {
        '{{statusText}}': isReady ? 'Active' : 'Disconnected',
        '{{statusColor}}': isReady ? 'bg-green-500' : 'bg-red-500',
        '{{branches}}': settings.branches.split(',').map(b => `<option value="${b.trim()}">${b.trim()}</option>`).join(''),
        '{{qrSection}}': isReady ? '<div class="text-green-500 font-black py-10">Connected ✅</div>' : (lastQR ? `<img src="${lastQR}" style="width:300px; height:300px; display:block; margin:0 auto;">` : 'Loading...'),
        '{{total}}': total, '{{webhookKey}}': CONFIG.webhookKey
    };
    Object.keys(map).forEach(key => { html = html.split(key).join(map[key]); });
    res.send(html);
});

app.post('/api/send', async (req, res) => {
    if (req.query.key !== CONFIG.webhookKey) return res.sendStatus(401);
    let { phone, name, branch } = req.body;
    let p = String(phone).replace(/\D/g, '');
    if (p.startsWith('05')) p = '966' + p.substring(1);
    if (p.length === 9) p = '966' + p;
    await db.collection('evaluations').insertOne({ phone: p, name, branch, status: 'sent', sentAt: new Date() });
    if (isReady && sock) {
        setTimeout(async () => {
            const msg = `أهلاً بك ${name || ''}، كيف كانت تجربتك في ${branch || 'فرعنا'}؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين`;
            await sock.sendMessage(p + "@s.whatsapp.net", { text: msg });
        }, CONFIG.delay + 1000);
        res.json({ success: true });
    } else { res.status(503).send("Disconnected"); }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); await connectToWhatsApp(); });