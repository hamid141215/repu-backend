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

// --- 1. إعداد MongoDB ---
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
        } catch (e) { console.error("❌ MongoDB Error"); }
    }
};

// --- 2. تعريف الدوال الأساسية (يجب أن تكون هنا قبل بدء الواتساب) ---
async function getSettings() {
    const def = { googleLink: "#", discountCode: "OFFER10", delay: 0 };
    if (!dbConnected) return def;
    try {
        const s = await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' });
        return s || def;
    } catch (e) { return def; }
}

async function updateStats(type, branch = "الرئيسي") {
    if (!dbConnected) return;
    try {
        const update = { $inc: { [type === 'order' ? 'totalOrders' : type]: 1 } };
        await client.db('whatsapp_bot').collection('branches').updateOne({ branchName: branch }, update, { upsert: true });
        await client.db('whatsapp_bot').collection('analytics').updateOne({ _id: 'daily_stats' }, update, { upsert: true });
    } catch (e) {}
}

// --- 3. محرك الواتساب ---
async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await import('@whiskeysockets/baileys');
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

    sock = makeWASocket({
        version, auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Desktop'),
        printQRInTerminal: false,
        markOnlineOnConnect: false
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => {
        const { connection, qr } = u;
        if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
        if (connection === 'open') { isReady = true; lastQR = null; console.log('✅ WhatsApp Active.'); }
        if (connection === 'close') { isReady = false; setTimeout(connectToWhatsApp, 5000); }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const remoteJid = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        const settings = await getSettings();
        const manager = process.env.MANAGER_PHONE ? process.env.MANAGER_PHONE.replace(/[^0-9]/g, '') + "@s.whatsapp.net" : null;

        if (/^[1١]/.test(text)) {
            await updateStats('positive');
            await sock.sendMessage(remoteJid, { text: `يسعدنا جداً أن التجربة نالت إعجابك! 😍\n\n📍 ${settings.googleLink}` });
            if (manager) await sock.sendMessage(manager, { text: `✅ تقييم ممتاز من: ${msg.pushName || 'عميل'}` });
        } else if (/^[2٢]/.test(text)) {
            await updateStats('negative');
            await sock.sendMessage(remoteJid, { text: `نعتذر منك جداً 😔\n\n🎫 كود الخصم: *${settings.discountCode}*` });
            if (manager) await sock.sendMessage(manager, { text: `⚠️ تنبيه: تقييم سلبي من: ${msg.pushName || 'عميل'}` });
        }
    });
}

// --- 4. الروابط (Endpoints) ---
app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { phone, name, branch } = req.body;
    const br = branch || "الرئيسي";
    await updateStats('order', br);
    const settings = await getSettings();
    
    setTimeout(async () => {
        if (isReady && sock) {
            let p = phone.replace(/[^0-9]/g, '');
            if (p.startsWith('05')) p = '966' + p.substring(1);
            await sock.sendMessage(p + "@s.whatsapp.net", { text: `مرحباً ${name || 'عميلنا'}، نورتنا في (${br})! 🌸\n\nكيف كانت تجربتك؟\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` });
        }
    }, (parseInt(settings.delay) || 0) * 60000 + 3000);
    res.json({ success: true });
});

app.get('/admin', async (req, res) => {
    const stats = dbConnected ? await client.db('whatsapp_bot').collection('analytics').findOne({ _id: 'daily_stats' }) : { positive: 0, negative: 0 };
    res.send(`<body style="font-family:sans-serif; text-align:center; padding:50px;">
        <h1>Mawjat Al Samt Dashboard</h1>
        <p>Status: ${isReady ? '✅ Active' : '❌ Connecting...'}</p>
        <div style="display:flex; justify-content:center; gap:20px;">
            <div style="background:#e3f2fd; padding:20px; border-radius:15px;"><h3>😍 راضين</h3><h2>${stats?.positive || 0}</h2></div>
            <div style="background:#ffebee; padding:20px; border-radius:15px;"><h3>😔 مستائين</h3><h2>${stats?.negative || 0}</h2></div>
        </div>
        ${lastQR ? `<h3>Scan to Login:</h3><img src="${lastQR}">` : ''}
    </body>`);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); await connectToWhatsApp(); });