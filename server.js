/**
 * نظام سُمعة (RepuSystem) - النسخة الاحترافية v2.4
 * التحديث: تعزيز أمان الـ Webhook وضمان استقرار جميع المهام المتوازية
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

// --- حماية الـ CORS: للسماح للمحاكي بالاتصال بالسيرفر دون قيود متصفح ---
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// --- تهيئة محرك MongoDB السحابي ---
let MongoClient;
try {
    MongoClient = require('mongodb').MongoClient;
} catch (e) {
    console.warn("⚠️ تحذير: مكتبة mongodb غير مثبتة، سيتم العمل محلياً.");
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
            console.log("🔗 محرك MongoDB جاهز ومفعل.");
        }
    } catch (e) {
        console.error("❌ فشل تهيئة MongoDB: تأكد من صحة الرابط.");
    }
}

const dbName = 'whatsapp_bot';
const collectionName = 'session_data';

// --- وظيفة المزامنة الذكية (تمنع الضغط على قاعدة البيانات) ---
let syncTimeout = null;
async function syncSessionToMongo() {
    if (!client) return;
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
                console.log('☁️ تم تأمين نسخة الجلسة سحابياً بنجاح.');
            }
        } catch (err) {
            console.error('❌ فشل في تحديث النسخة السحابية.');
        }
    }, 2000); 
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
            console.log('📥 تم استعادة الجلسة من السحابة (لن تحتاج لباركود).');
        }
    } catch (err) {
        console.log('ℹ️ لا توجد جلسة سابقة في السحابة.');
    }
}

// --- المحرك الرئيسي للاتصال بواتساب ---
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
                
                if (statusCode !== 408 && statusCode !== 440) {
                    console.log(`📡 انقطع الاتصال (كود: ${statusCode}). جاري الإعادة...`);
                }
                if (shouldReconnect) connectToWhatsApp();
            } else if (connection === 'open') {
                console.log('✅ نظام سُمعة متصل الآن وجاهز!');
                isReady = true;
                lastQR = null;
                if (client) syncSessionToMongo();
            }
        });

        // --- معالجة ردود العملاء (1 للتقييم، 2 للشكوى) ---
        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const remoteJid = msg.key.remoteJid;
            
            // استخراج النص بذكاء من مختلف أنواع الرسائل (أزرار، قوائم، نص مباشر)
            let text = "";
            if (msg.message.conversation) text = msg.message.conversation;
            else if (msg.message.extendedTextMessage) text = msg.message.extendedTextMessage.text;
            else if (msg.message.buttonsResponseMessage) text = msg.message.buttonsResponseMessage.selectedButtonId;
            else if (msg.message.listResponseMessage) text = msg.message.listResponseMessage.singleSelectReply.selectedRowId;
            
            text = text.trim();

            if (text) {
                console.log(`📩 رد من [${remoteJid.split('@')[0]}]: ${text}`);
            }

            // الاستجابة الذكية
            if (/^[1١]/.test(text)) {
                await sock.sendMessage(remoteJid, { text: "يسعدنا جداً أن التجربة كانت ممتازة! 😍 كرمًا منك شاركنا تقييمك هنا لتصل تجربتك للجميع:\n📍 [رابط جوجل ماب الخاص بك]" });
            } 
            else if (/^[2٢]/.test(text)) {
                await sock.sendMessage(remoteJid, { text: "نعتذر منك جداً 😔، هدفنا رضاك التام. سيتم التواصل معك من قبل الإدارة فوراً لحل الموضوع." });
                
                const managerPhone = process.env.MANAGER_PHONE;
                if (managerPhone && isReady) {
                    const managerJid = `${managerPhone.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
                    await sock.sendMessage(managerJid, { text: `⚠️ *تنبيه تقييم سلبي*:\nالعميل: ${remoteJid.split('@')[0]}\nاختار "يحتاج تحسين". يرجى التواصل معه.` });
                }
            }
        });
    } catch (error) { console.error("Error Core:", error.message); }
}

// --- استقبال بيانات فودكس (Webhook) ---
app.post('/foodics-webhook', async (req, res) => {
    const apiKey = req.query.key;
    if (apiKey !== process.env.WEBHOOK_KEY) return res.status(401).send('Unauthorized');
    
    const { customer, status } = req.body;
    
    // فحص سلامة البيانات قبل البدء لمنع انهيار السيرفر
    if (!customer || !customer.phone) {
        return res.status(400).send('Missing customer phone');
    }

    // إرسال الرسالة عند إغلاق الطلب (Status 4)
    if ((status === 4 || status === 'closed' || status === 'completed') && isReady) {
        const cleanPhone = customer.phone.replace(/[^0-9]/g, '');
        const jid = `${cleanPhone}@s.whatsapp.net`;
        
        console.log(`📤 إرسال طلب تقييم إلى: ${customer.name || cleanPhone}`);
        
        setTimeout(async () => {
            try { 
                if (sock && isReady) {
                    await sock.sendMessage(jid, { text: `مرحباً ${customer.name || 'عميلنا العزيز'}، نورتنا! 🌸\n\nكيف كانت تجربة طلبك اليوم؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` }); 
                }
            } catch (e) { console.error("Webhook Send Error:", e.message); }
        }, 3000);
    }
    res.send('OK');
});

// --- صفحة الحالة الصحية (Health Check) ---
app.get('/health', (req, res) => {
    let html = '<div style="font-family:sans-serif; text-align:center; padding-top:50px; line-height:1.6;">';
    html += isReady ? '<h1 style="color:green;">✅ نظام سمعة نشط ومتصل</h1>' : (lastQR ? `<h1>📲 الربط مطلوب</h1><p>امسح الكود لتفعيل الواتساب:</p><img src="${lastQR}" style="border:10px solid #eee; border-radius:15px;" />` : '<h1>⏳ جاري تجهيز المحرك...</h1>');
    html += `<p style="color:gray; font-size:12px; margin-top:20px;">MongoDB Status: ${client ? 'Connected 🔗' : 'Local Mode 🏠'}</p>`;
    html += '</div>';
    res.send(html);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => connectToWhatsApp());