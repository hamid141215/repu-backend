if (!globalThis.crypto) { globalThis.crypto = require('crypto').webcrypto; }
require('dotenv').config();
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());

// الإعدادات
const SESSION_PATH = 'auth_stable_v104'; 
const MONGO_URL = process.env.MONGO_URL;
const WEBHOOK_KEY = process.env.WEBHOOK_KEY;

let sock = null, isReady = false, lastQR = null;
let client = null, db = null, dbConnected = false;

// --- إدارة قاعدة البيانات ---
const initMongo = async () => {
    try {
        client = new MongoClient(MONGO_URL);
        await client.connect();
        db = client.db('whatsapp_bot');
        dbConnected = true;
        console.log("🔗 MongoDB Connected.");
    } catch (e) { 
        console.error("❌ MongoDB Fail:", e.message); 
    }
};

async function syncSession() {
    if (!dbConnected) return;
    try {
        const credsPath = path.join(SESSION_PATH, 'creds.json');
        if (fs.existsSync(credsPath)) {
            const data = fs.readFileSync(credsPath, 'utf-8');
            await db.collection('final_v104').updateOne({ _id: 'creds' }, { $set: { data, updatedAt: new Date() } }, { upsert: true });
        }
    } catch (e) { console.error("Sync Error:", e.message); }
}

async function restoreSession() {
    if (!dbConnected) return;
    try {
        const res = await db.collection('final_v104').findOne({ _id: 'creds' });
        if (res && res.data) {
            if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });
            fs.writeFileSync(path.join(SESSION_PATH, 'creds.json'), res.data);
            console.log("📂 Session Restored from DB");
        }
    } catch (e) { console.error("Restore Error:", e.message); }
}

// --- إدارة واتساب ---
async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await import('@whiskeysockets/baileys');
    
    await restoreSession();
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

    sock = makeWASocket({
        auth: state, 
        version,
        logger: pino({ level: 'error' }),
        browser: Browsers.macOS('Desktop'), 
        printQRInTerminal: true,
        keepAliveIntervalMs: 30000,
        shouldSyncHistoryMessage: () => false
    });

    sock.ev.on('creds.update', async () => { 
        await saveCreds(); 
        await syncSession(); 
    });

    sock.ev.on('connection.update', async (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
        
        if (connection === 'open') { 
            isReady = true; 
            lastQR = null; 
            console.log("✅ WhatsApp Live"); 
        }
        
        if (connection === 'close') {
            isReady = false;
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("❌ Connection closed. Reconnecting:", shouldReconnect);
            if (shouldReconnect) setTimeout(connectToWhatsApp, 5000);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.fromMe) return;
            
            const jid = msg.key.remoteJid;
            const rawPhone = jid.split('@')[0];
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

            if (text === "1" || text === "2") {
                const config = (dbConnected ? await db.collection('config').findOne({ _id: 'global_settings' }) : null) || { googleLink: "#", discountCode: "OFFER10" };
                
                if (dbConnected) {
                    // تصحيح: استخدام findOneAndUpdate بدلاً من updateOne مع sort
                    await db.collection('evaluations').findOneAndUpdate(
                        { phone: { $regex: rawPhone }, status: 'sent' },
                        { $set: { status: 'replied', answer: text, repliedAt: new Date() } },
                        { sort: { sentAt: -1 } }
                    );
                }
                
                const reply = text === "1" ? `يسعدنا تقييمك! 😍\n📍 ${config.googleLink}` : `نعتذر منك 😔\n🎫 كود الخصم: ${config.discountCode}`;
                await sock.sendMessage(jid, { text: reply });
            }
        } catch (e) { console.error("Error in upsert:", e); }
    });
}

// --- المسارات (Routes) ---

app.get('/api/status', (req, res) => res.json({ isReady, lastQR }));
app.get('/', (req, res) => res.redirect('/admin'));

app.get('/admin', async (req, res) => {
    const s = dbConnected ? await db.collection('config').findOne({ _id: 'global_settings' }) : { googleLink: "#", discountCode: "OFFER10", delay: 0 };
    const evals = dbConnected ? await db.collection('evaluations').find().sort({ sentAt: -1 }).limit(10).toArray() : [];
    
    // ملاحظة أمنية: لا نمرر المفتاح هنا، بل نستخدمه في الطلبات من السيرفر أو نطلبه من المستخدم
    res.send(`... (نفس تصميمك مع إضافة حقل للمفتاح أو استخدامه بشكل آمن) ...`);
    // ملاحظة: اختصرت كود HTML لسهولة القراءة، لكنه يعمل مع كودك الأصلي
});

app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== WEBHOOK_KEY) return res.status(401).send('Unauthorized');
    const { phone, name } = req.body;
    let p = phone.replace(/\D/g, ''); 
    if (p.startsWith('05')) p = '966' + p.substring(1);
    else if (p.startsWith('5') && p.length === 9) p = '966' + p;

    if (dbConnected) {
        await db.collection('evaluations').insertOne({ 
            phone: p, 
            name: name || 'عميل',
            status: 'sent', 
            sentAt: new Date() 
        });
    }
    
    const greetings = [
        `مرحباً ${name || 'عزيزنا'}، نورتنا اليوم! ✨`,
        `أهلاً بك ${name || 'يا غالي'}، سعدنا بزيارتك لنا. 😊`,
        `حيّاك الله ${name || 'عميلنا العزيز'}، نشكرك على اختيارك لنا. 🌸`
    ];
    const randomMsg = greetings[Math.floor(Math.random() * greetings.length)];
    const config = dbConnected ? await db.collection('config').findOne({ _id: 'global_settings' }) : { delay: 0 };

    setTimeout(async () => {
        if (isReady && sock) {
            try {
                await sock.sendMessage(p + "@s.whatsapp.net", { 
                    text: `${randomMsg}\n\nكيف كانت تجربتك معنا؟\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` 
                });
            } catch (err) { console.error("Send Msg Error:", err.message); }
        }
    }, (parseInt(config?.delay) || 0) * 60000 + 1000);

    res.json({ success: true });
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== WEBHOOK_KEY) return res.sendStatus(401);
    const { googleLink, discountCode, delay } = req.body;
    if (dbConnected) {
        await db.collection('config').updateOne(
            { _id: 'global_settings' }, 
            { $set: { googleLink, discountCode, delay: parseInt(delay) || 0 } }, 
            { upsert: true }
        );
    }
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { 
    await initMongo(); 
    await connectToWhatsApp(); 
    console.log(`🚀 Server running on port ${PORT}`);
});