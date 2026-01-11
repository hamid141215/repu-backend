/**
 * نظام سُمعة (RepuSystem) - النسخة الاحترافية v2.2
 * تحديث: تحسين أداء المزامنة وتقليل ضجيج السجلات (Logs)
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

// دعم CORS للمحاكي
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

let MongoClient;
try {
    MongoClient = require('mongodb').MongoClient;
} catch (e) {
    console.warn("⚠️ مكتبة mongodb غير مثبتة.");
}

let sock = null;
let isReady = false;
let lastQR = null;
const SESSION_PATH = 'auth_new_session';

const MONGO_URL = process.env.MONGO_URL;
let client = null;

if (typeof MONGO_URL === 'string' && MONGO_URL.trim().length > 0) {
    try {
        if (MongoClient) {
            client = new MongoClient(MONGO_URL.trim());
            console.log("🔗 محرك MongoDB جاهز للمزامنة.");
        }
    } catch (e) {
        console.error("❌ خطأ في رابط MongoDB.");
    }
}

const dbName = 'whatsapp_bot';
const collectionName = 'session_data';

// --- تحسين الخبير: وظيفة المزامنة الذكية لمنع التكرار المزعج ---
let syncTimeout = null;
async function syncSessionToMongo() {
    if (!client) return;
    
    // تأخير الحفظ لثانية واحدة لجمع كل التحديثات الصغيرة في عملية واحدة
    if (syncTimeout) clearTimeout(syncTimeout);
    
    syncTimeout = setTimeout(async () => {
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
                // تقليل تكرار الرسالة في السجلات
                console.log('☁️ تم تأمين نسخة الجلسة سحابياً.');
            }
        } catch (err) {
            console.error('❌ خطأ في المزامنة السحابية.');
        }
    }, 2000); // انتظر ثانيتين قبل الحفظ
}

async function loadSessionFromMongo() {
    if (!client) return;
    try {
        await client.connect();
        const db = client.db(dbName);
        const collection = db.collection(collectionName);
        const result = await collection.findOne({ _id: 'whatsapp_creds' });
        if (result && result.data) {
            if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });
            fs.writeFileSync(path.join(SESSION_PATH, 'creds.json'), result.data);
            console.log('📥 تم استعادة الجلسة من السحابة بنجاح.');
        }
    } catch (err) {
        console.log('ℹ️ لا توجد بيانات سحابية سابقة.');
    }
}

async function connectToWhatsApp() {
    try {
        if (client) await loadSessionFromMongo();
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
            if (client) syncSessionToMongo();
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                isReady = false;
                
                // تجاهل الأخطاء البسيطة في السجلات
                if (statusCode !== 408 && statusCode !== 440) {
                    console.log(`📡 انقطع الاتصال (كود: ${statusCode}). إعادة المحاولة...`);
                }
                
                if (shouldReconnect) connectToWhatsApp();
            } else if (connection === 'open') {
                console.log('✅ نظام سُمعة متصل الآن وجاهز!');
                isReady = true;
                lastQR = null;
                if (client) syncSessionToMongo();
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;
            const remoteJid = msg.key.remoteJid;
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
            
            if (/^[1١]/.test(text)) {
                await sock.sendMessage(remoteJid, { text: "يسعدنا جداً أن التجربة كانت ممتازة! 😍 كرمًا شاركنا تقييمك هنا:\n📍 [رابط جوجل ماب]" });
            } else if (/^[2٢]/.test(text)) {
                await sock.sendMessage(remoteJid, { text: "نعتذر منك جداً 😔، سيتم التواصل معك من قبل الإدارة فوراً." });
                const managerPhone = process.env.MANAGER_PHONE;
                if (managerPhone && isReady) {
                    const managerJid = `${managerPhone.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
                    await sock.sendMessage(managerJid, { text: `⚠️ تنبيه: تقييم سلبي من الرقم ${remoteJid.split('@')[0]}` });
                }
            }
        });
    } catch (error) { console.error("Error:", error.message); }
}

app.post('/foodics-webhook', async (req, res) => {
    const apiKey = req.query.key;
    if (apiKey !== process.env.WEBHOOK_KEY) return res.status(401).send('Unauthorized');
    const { customer, status } = req.body;
    if ((status === 4 || status === 'closed' || status === 'completed') && isReady) {
        const cleanPhone = customer.phone.replace(/[^0-9]/g, '');
        const jid = `${cleanPhone}@s.whatsapp.net`;
        setTimeout(async () => {
            try { await sock.sendMessage(jid, { text: `مرحباً ${customer.name || 'عميلنا العزيز'}، كيف كانت تجربة طلبك اليوم؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` }); } 
            catch (e) { console.error("Webhook Send Error."); }
        }, 3000);
    }
    res.send('OK');
});

app.get('/health', (req, res) => {
    let html = '<div style="font-family:sans-serif; text-align:center; padding-top:50px;">';
    html += isReady ? '<h1 style="color:green;">✅ نظام سمعة نشط</h1>' : (lastQR ? `<h1>الربط مطلوب</h1><img src="${lastQR}" />` : '<h1>⏳ جاري التحميل...</h1>');
    html += '</div>';
    res.send(html);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => connectToWhatsApp());