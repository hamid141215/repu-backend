/**
 * نظام سُمعة (RepuSystem) - النسخة v2.9 (الخصوصية المطلقة)
 * التحديث: إلغاء تسجيل محتوى الرسائل تماماً وتأمين السجلات من تسريب البيانات الخاصة.
 */

require('dotenv').config();
const express = require('express');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// --- إعدادات CORS ---
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// --- منع الانهيارات ---
process.on('unhandledRejection', (reason) => { /* صامت لحماية السجلات */ });
process.on('uncaughtException', (err) => { console.error('❌ خطأ في النظام'); });

// --- MongoDB Setup ---
let MongoClient;
try { MongoClient = require('mongodb').MongoClient; } catch (e) {}

const MONGO_URL = process.env.MONGO_URL;
let client = null;
let dbConnected = false;

if (typeof MONGO_URL === 'string' && MONGO_URL.trim().length > 0) {
    try {
        if (MongoClient) {
            client = new MongoClient(MONGO_URL.trim());
            client.connect().then(() => { dbConnected = true; console.log("🔗 السحابة متصلة."); }).catch(() => {});
        }
    } catch (e) {}
}

const SESSION_PATH = 'auth_new_session';

// --- المزامنة (بدون تخزين رسائل) ---
let syncTimeout = null;
async function syncSessionToMongo() {
    if (!client || !dbConnected) return;
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(async () => {
        try {
            const credsPath = path.join(SESSION_PATH, 'creds.json');
            if (fs.existsSync(credsPath)) {
                const credsData = fs.readFileSync(credsPath, 'utf-8');
                const db = client.db('whatsapp_bot');
                await db.collection('session_data').updateOne(
                    { _id: 'whatsapp_creds' },
                    { $set: { data: credsData, updatedAt: new Date() } },
                    { upsert: true }
                );
            }
        } catch (err) {}
    }, 3000); 
}

async function loadSessionFromMongo() {
    if (!client) return;
    try {
        const db = client.db('whatsapp_bot');
        const result = await db.collection('session_data').findOne({ _id: 'whatsapp_creds' });
        if (result && result.data) {
            if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });
            fs.writeFileSync(path.join(SESSION_PATH, 'creds.json'), result.data);
            console.log('📥 تم استعادة الجلسة.');
        }
    } catch (err) {}
}

// --- المحرك الرئيسي ---
let sock = null;
let isReady = false;
let lastQR = null;
const processedWebhooks = new Map();

async function connectToWhatsApp() {
    try {
        await loadSessionFromMongo();
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }), // صامت تماماً
            browser: ['RepuSystem', 'Chrome', '110.0'],
            printQRInTerminal: false
        });

        sock.ev.on('creds.update', async () => {
            await saveCreds();
            syncSessionToMongo();
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, qr } = update;
            if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
            if (connection === 'close') { isReady = false; connectToWhatsApp(); }
            else if (connection === 'open') { isReady = true; lastQR = null; console.log('✅ البوت نشط وآمن.'); }
        });

        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const remoteJid = msg.key.remoteJid;
            if (remoteJid.endsWith('@g.us')) return; // تجاهل المجموعات فوراً

            // استخراج النص وفلترته
            let text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
            
            // تسجيل نشاط "مجهول" فقط للحفاظ على الخصوصية
            if (text.length > 0) {
                // لا نطبع النص هنا أبداً في السجلات
                console.log(`📩 نشاط جديد من عميل: [${remoteJid.split('@')[0].substring(0, 5)}***]`);
            }

            // الاستجابة المحددة فقط
            if (/^[1١]/.test(text)) {
                await sock.sendMessage(remoteJid, { text: "يسعدنا جداً أن التجربة كانت ممتازة! 😍 كرمًا منك شاركنا تقييمك هنا:\n📍 [رابط جوجل ماب]" });
            } 
            else if (/^[2٢]/.test(text)) {
                await sock.sendMessage(remoteJid, { text: "نعتذر منك جداً 😔، سيتم التواصل معك من قبل الإدارة فوراً." });
                const managerPhone = process.env.MANAGER_PHONE;
                if (managerPhone && isReady) {
                    const customerPhone = remoteJid.split('@')[0];
                    const managerJid = `${managerPhone.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
                    await sock.sendMessage(managerJid, { text: `⚠️ تنبيه: تقييم سلبي من ${customerPhone}\nللتواصل: https://wa.me/${customerPhone}` });
                }
            }
        });
    } catch (error) {}
}

app.post('/foodics-webhook', async (req, res) => {
    const apiKey = req.query.key;
    if (apiKey !== process.env.WEBHOOK_KEY) return res.status(401).send('Unauthorized');
    const { customer, status, id, hid } = req.body;
    if (!customer?.phone) return res.status(400).send('Missing data');

    const orderId = id || hid || customer.phone;
    if (processedWebhooks.has(orderId)) return res.send('OK');
    processedWebhooks.set(orderId, Date.now());
    setTimeout(() => processedWebhooks.delete(orderId), 600000);

    if ((status === 4 || status === 'closed') && isReady) {
        const jid = `${customer.phone.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
        setTimeout(async () => {
            try { await sock.sendMessage(jid, { text: `مرحباً ${customer.name || 'عميلنا العزيز'}، كيف كانت تجربتك؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` }); } catch (e) {}
        }, 3000);
    }
    res.send('OK');
});

app.get('/health', (req, res) => {
    res.send(`<div style="font-family:sans-serif;text-align:center;padding-top:50px;">${isReady ? '<h1 style="color:green;">✅ نظام سمعة آمن ونشط</h1>' : (lastQR ? '<h1>الربط مطلوب</h1><img src="'+lastQR+'"/>' : '<h1>⏳ جاري التحميل...</h1>')}</div>`);
});

app.listen(process.env.PORT || 10000, () => connectToWhatsApp());