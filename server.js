/**
 * نظام سُمعة (RepuSystem) - النسخة الاحترافية v2.6 (النهائية)
 * التحديث: معالجة شاملة للأخطاء، تحسين استهلاك الذاكرة، واستقرار الربط السحابي
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

// --- إعدادات السيرفر الأساسية ---
const app = express();
app.use(express.json());

// دعم CORS للمحاكي وأدوات الاختبار
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// --- منع انهيار السيرفر بسبب أخطاء غير متوقعة (Crucial for Render) ---
process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

// --- إعدادات MongoDB ---
let MongoClient;
try {
    MongoClient = require('mongodb').MongoClient;
} catch (e) {
    console.warn("⚠️ مكتبة mongodb غير مثبتة، سيتم العمل محلياً.");
}

const MONGO_URL = process.env.MONGO_URL;
let client = null;
let dbConnected = false;

if (typeof MONGO_URL === 'string' && MONGO_URL.trim().length > 0) {
    try {
        if (MongoClient) {
            client = new MongoClient(MONGO_URL.trim());
            client.connect()
                .then(() => {
                    dbConnected = true;
                    console.log("🔗 متصل بـ MongoDB بنجاح.");
                })
                .catch(err => console.error("❌ فشل الاتصال الأولي بـ MongoDB:", err.message));
        }
    } catch (e) {
        console.error("❌ خطأ في تهيئة MongoDB.");
    }
}

const dbName = 'whatsapp_bot';
const collectionName = 'session_data';
const SESSION_PATH = 'auth_new_session';

// --- إدارة الجلسة والمزامنة ---
let syncTimeout = null;
async function syncSessionToMongo() {
    if (!client || !dbConnected) return;
    
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(async () => {
        try {
            const credsPath = path.join(SESSION_PATH, 'creds.json');
            if (fs.existsSync(credsPath)) {
                const credsData = fs.readFileSync(credsPath, 'utf-8');
                const db = client.db(dbName);
                const collection = db.collection(collectionName);
                await collection.updateOne(
                    { _id: 'whatsapp_creds' },
                    { $set: { data: credsData, updatedAt: new Date() } },
                    { upsert: true }
                );
                console.log('☁️ تم تأمين نسخة الجلسة سحابياً.');
            }
        } catch (err) {
            console.error('❌ فشل مزامنة الجلسة.');
        }
    }, 3000); 
}

async function loadSessionFromMongo() {
    if (!client) return;
    try {
        if (!dbConnected) await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);
        const result = await collection.findOne({ _id: 'whatsapp_creds' });
        if (result && result.data) {
            if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });
            fs.writeFileSync(path.join(SESSION_PATH, 'creds.json'), result.data);
            console.log('📥 تم استعادة الجلسة من السحابة.');
        }
    } catch (err) {
        console.log('ℹ️ تعذر تحميل الجلسة من السحابة، بانتظار الباركود.');
    }
}

// --- محرك الواتساب ---
let sock = null;
let isReady = false;
let lastQR = null;
const processedWebhooks = new Map(); // تحويل لـ Map لتخزين وقت المعالجة

async function connectToWhatsApp() {
    try {
        await loadSessionFromMongo();
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
        const { version } = await fetchLatestBaileysVersion();

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ['RepuSystem', 'Chrome', '110.0'],
            printQRInTerminal: false,
            generateHighQualityLinkPreview: false
        });

        sock.ev.on('creds.update', async () => {
            await saveCreds();
            syncSessionToMongo();
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                isReady = false;
                if (shouldReconnect) connectToWhatsApp();
            } else if (connection === 'open') {
                console.log('✅ نظام سُمعة جاهز للعمل!');
                isReady = true;
                lastQR = null;
                syncSessionToMongo();
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const remoteJid = msg.key.remoteJid;
            
            // استخراج النص المطور (يدعم الرسائل المباشرة والردود)
            let text = msg.message.conversation || 
                       msg.message.extendedTextMessage?.text || 
                       msg.message.buttonsResponseMessage?.selectedButtonId || 
                       "";
            
            text = text.trim();
            if (!text) return;

            console.log(`📩 رد من ${remoteJid.split('@')[0]}: ${text}`);

            if (/^[1١]/.test(text)) {
                await sock.sendMessage(remoteJid, { text: "يسعدنا جداً أن التجربة كانت ممتازة! 😍 كرمًا منك شاركنا تقييمك هنا:\n📍 [رابط جوجل ماب الخاص بك]" });
            } 
            else if (/^[2٢]/.test(text)) {
                await sock.sendMessage(remoteJid, { text: "نعتذر منك جداً 😔، سيتم التواصل معك من قبل الإدارة فوراً لحل الموضوع." });
                const managerPhone = process.env.MANAGER_PHONE;
                if (managerPhone && isReady) {
                    const managerJid = `${managerPhone.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
                    await sock.sendMessage(managerJid, { text: `⚠️ *تنبيه تقييم سلبي*:\nالعميل: ${remoteJid.split('@')[0]}\nاختار "يحتاج تحسين".` });
                }
            }
        });
    } catch (error) {
        console.error("❌ خطأ في محرك الواتساب:", error.message);
    }
}

// --- استقبال بيانات فودكس (Webhook) ---
app.post('/foodics-webhook', async (req, res) => {
    const apiKey = req.query.key;
    if (apiKey !== process.env.WEBHOOK_KEY) return res.status(401).send('Unauthorized');
    
    const { customer, status, id, hid } = req.body;
    if (!customer?.phone) return res.status(400).send('Missing customer phone');

    // منع التكرار (Deduplication)
    const orderId = id || hid || customer.phone;
    if (processedWebhooks.has(orderId)) return res.send('Duplicate ignored');
    
    processedWebhooks.set(orderId, Date.now());
    // تنظيف تلقائي للذاكرة كل 10 دقائق
    setTimeout(() => processedWebhooks.delete(orderId), 600000);

    if ((status === 4 || status === 'closed' || status === 'completed') && isReady) {
        const cleanPhone = customer.phone.replace(/[^0-9]/g, '');
        const jid = `${cleanPhone}@s.whatsapp.net`;
        
        console.log(`📤 إرسال طلب تقييم: ${customer.name || cleanPhone}`);
        
        setTimeout(async () => {
            try { 
                if (sock && isReady) {
                    await sock.sendMessage(jid, { text: `مرحباً ${customer.name || 'عميلنا العزيز'}، نورتنا! 🌸\n\nكيف كانت تجربة طلبك اليوم؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` }); 
                }
            } catch (e) { console.error("Webhook Send Error."); }
        }, 3000);
    }
    res.send('OK');
});

// --- صفحة الحالة (Health Check) ---
app.get('/health', (req, res) => {
    let html = '<div style="font-family:sans-serif; text-align:center; padding-top:50px;">';
    html += isReady ? '<h1 style="color:green;">✅ نظام سمعة نشط</h1>' : (lastQR ? `<h1>📲 الربط مطلوب</h1><img src="${lastQR}" style="border-radius:15px; border:8px solid #eee;" />` : '<h1>⏳ جاري التحميل...</h1>');
    html += `<p style="color:gray;">MongoDB: ${dbConnected ? 'Connected 🔗' : 'Offline 🏠'}</p>`;
    html += '</div>';
    res.send(html);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => connectToWhatsApp());