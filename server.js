require('dotenv').config();
const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());

let sock = null;
let isReady = false;
let lastQR = null;
const SESSION_PATH = 'auth_new_session';

// إعداد قاعدة البيانات
const MONGO_URL = process.env.MONGO_URL;
const client = new MongoClient(MONGO_URL);
const dbName = 'whatsapp_bot';
const collectionName = 'session_data';

// --- دالة لحفظ الجلسة في MongoDB ---
async function syncSessionToMongo() {
    try {
        const credsPath = path.join(SESSION_PATH, 'creds.json');
        if (fs.existsSync(credsPath)) {
            const credsData = fs.readFileSync(credsPath, 'utf-8');
            await client.connect();
            const db = client.db(dbName);
            const collection = db.collection(collectionName);
            await collection.updateOne(
                { _id: 'whatsapp_creds' },
                { $set: { data: credsData, updatedAt: new Date() } },
                { upsert: true }
            );
            console.log('📤 تم مزامنة الجلسة مع MongoDB بنجاح.');
        }
    } catch (err) {
        console.error('❌ فشل مزامنة الجلسة مع الماركت:', err);
    }
}

// --- دالة لاستعادة الجلسة من MongoDB ---
async function loadSessionFromMongo() {
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);
        const result = await collection.findOne({ _id: 'whatsapp_creds' });
        
        if (result && result.data) {
            if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH);
            fs.writeFileSync(path.join(SESSION_PATH, 'creds.json'), result.data);
            console.log('📥 تم استعادة الجلسة من MongoDB بنجاح.');
        }
    } catch (err) {
        console.log('ℹ️ لا توجد جلسة سابقة في MongoDB.');
    }
}

async function connectToWhatsApp() {
    await loadSessionFromMongo();

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['RepuSystem', 'Chrome', '110.0'],
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', async () => {
        await saveCreds();
        await syncSessionToMongo();
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            isReady = false;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('✅ البوت متصل وشغال!');
            isReady = true;
            lastQR = null;
            await syncSessionToMongo();
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const remoteJid = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        
        if (/^[1١]/.test(text)) {
            await sock.sendMessage(remoteJid, { text: "يسعدنا أن التجربة كانت ممتازة! 😍 كرمًا شاركنا تقييمك هنا:\n📍 [رابط جوجل ماب]" });
        } else if (/^[2٢]/.test(text)) {
            await sock.sendMessage(remoteJid, { text: "نعتذر منك جداً 😔، سيتم التواصل معك من قبل الإدارة فوراً لحل الموضوع." });
            
            const managerPhone = process.env.MANAGER_PHONE;
            if (managerPhone) {
                const managerJid = `${managerPhone.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
                await sock.sendMessage(managerJid, { 
                    text: `⚠️ *تنبيه تقييم سلبي*:\n\nالعميل صاحب الرقم: ${remoteJid.split('@')[0]}\nقام باختيار "يحتاج تحسين". يرجى التواصل معه.` 
                });
            }
        }
    });
}

// الـ Webhook الخاص بفودكس مع حماية بـ Key
app.post('/foodics-webhook', async (req, res) => {
    // التحقق من مفتاح الأمان القادم في الرابط
    const apiKey = req.query.key;
    if (apiKey !== process.env.WEBHOOK_KEY) {
        console.log("🚫 محاولة وصول غير مصرح بها للـ Webhook");
        return res.status(401).send('Unauthorized');
    }

    const { customer, status } = req.body;
    if (status === 4 || status === 'closed') {
        if (customer?.phone && isReady) {
            const cleanPhone = customer.phone.replace(/[^0-9]/g, '');
            const jid = `${cleanPhone}@s.whatsapp.net`;
            setTimeout(async () => {
                await sock.sendMessage(jid, { 
                    text: `مرحباً ${customer.name || 'عميلنا العزيز'}، نورتنا! 🌸\n\nكيف كانت تجربة طلبك اليوم؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` 
                });
            }, 3000);
        }
    }
    res.send('OK');
});

app.get('/health', (req, res) => {
    if (isReady) return res.send('<h1 style="color:green;text-align:center;">✅ نظام سمعة متصل</h1>');
    if (lastQR) return res.send(`<div style="text-align:center;"><h1>الربط مطلوب</h1><img src="${lastQR}" /></div>`);
    res.send('<h1 style="text-align:center;">⏳ جاري التحميل...</h1>');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => connectToWhatsApp());