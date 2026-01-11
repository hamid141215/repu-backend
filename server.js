/**
 * نظام سُمعة (RepuSystem) - النسخة v3.5 (نسخة التعويض التلقائي)
 * التحديث: إضافة ميزة إرسال كود خصم آلي للعملاء عند التقييم السلبي لامتصاص الغضب.
 * الخصوصية: نظام التشفير ومنع المجموعات لا يزال مفعلاً بأعلى المعايير.
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

// --- إعدادات CORS الشاملة ---
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// --- نظام مراقبة الأخطاء الاستباقي ---
process.on('unhandledRejection', (reason) => {
    // تجاهل أخطاء الشبكة البسيطة لمنع امتلاء السجلات
});
process.on('uncaughtException', (err) => {
    console.error('❌ خطأ غير متوقع:', err.message);
});

// --- إعدادات MongoDB الحديثة ---
let MongoClient;
try { 
    MongoClient = require('mongodb').MongoClient; 
} catch (e) {
    console.warn("⚠️ مكتبة mongodb غير مثبتة.");
}

const MONGO_URL = process.env.MONGO_URL;
let client = null;
let dbConnected = false;

const initMongo = async () => {
    if (typeof MONGO_URL === 'string' && MONGO_URL.trim().startsWith('mongodb')) {
        try {
            client = new MongoClient(MONGO_URL.trim(), { 
                connectTimeoutMS: 15000,
                serverSelectionTimeoutMS: 15000 
            });
            await client.connect();
            dbConnected = true;
            console.log("🔗 [MongoDB] تم الربط السحابي بنجاح.");
        } catch (e) {
            console.error(`⚠️ [MongoDB] فشل الاتصال: ${e.message}`);
            dbConnected = false;
        }
    } else {
        console.log("🏠 [System] يعمل بالوضع المحلي (MONGO_URL غير موجود).");
    }
};

const SESSION_PATH = 'auth_new_session';

// --- إدارة المزامنة السحابية الذكية ---
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
                console.log("☁️ [MongoDB] تم تحديث نسخة الجلسة سحابياً.");
            }
        } catch (err) {}
    }, 5000); 
}

async function loadSessionFromMongo() {
    if (!client || !dbConnected) return;
    try {
        const db = client.db('whatsapp_bot');
        const result = await db.collection('session_data').findOne({ _id: 'whatsapp_creds' });
        if (result && result.data) {
            if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });
            fs.writeFileSync(path.join(SESSION_PATH, 'creds.json'), result.data);
            console.log('📥 [System] تم تحميل الجلسة بنجاح من السحابة.');
            return true;
        }
    } catch (err) {
        console.error("❌ فشل استعادة الجلسة من السحابة.");
    }
    return false;
}

async function clearInvalidSession() {
    console.log("🧹 [System] جاري مسح البيانات التالفة لإعادة الربط...");
    try {
        if (fs.existsSync(SESSION_PATH)) {
            fs.rmSync(SESSION_PATH, { recursive: true, force: true });
        }
        if (client && dbConnected) {
            const db = client.db('whatsapp_bot');
            await db.collection('session_data').deleteOne({ _id: 'whatsapp_creds' });
            console.log("☁️ [MongoDB] تم حذف السجل التالف من السحابة.");
        }
    } catch (err) {
        console.error("❌ خطأ أثناء مسح البيانات:", err.message);
    }
}

// --- المحرك الرئيسي لاتصال واتساب ---
let sock = null;
let isReady = false;
let lastQR = null;
const processedWebhooks = new Map();

async function connectToWhatsApp() {
    try {
        if (dbConnected) {
            await loadSessionFromMongo();
        }

        const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
        const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

        sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ['RepuSystem', 'Chrome', '110.0'],
            printQRInTerminal: false,
            connectTimeoutMS: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 20000
        });

        sock.ev.on('creds.update', async () => {
            await saveCreds();
            if (dbConnected) syncSessionToMongo();
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
                console.log("📲 [WhatsApp] بانتظار مسح الباركود الجديد...");
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                isReady = false;
                
                if (statusCode === 401) {
                    console.log("❌ [WhatsApp] الجلسة تالفة. جاري الإصلاح التلقائي...");
                    await clearInvalidSession();
                    setTimeout(connectToWhatsApp, 3000);
                } else if (shouldReconnect) {
                    console.log(`📡 [WhatsApp] إعادة الاتصال (كود: ${statusCode})...`);
                    setTimeout(connectToWhatsApp, 5000);
                }
            } else if (connection === 'open') {
                isReady = true;
                lastQR = null;
                console.log('✅ [WhatsApp] نظام سُمعة متصل ونشط الآن!');
                if (dbConnected) syncSessionToMongo();
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const remoteJid = msg.key.remoteJid;
            if (remoteJid.endsWith('@g.us')) return; 

            let text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
            if (!text) return;

            console.log(`📩 نشاط من عميل: [${remoteJid.split('@')[0].slice(-4)}***]`);

            if (/^[1١]/.test(text)) {
                await sock.sendMessage(remoteJid, { text: "يسعدنا جداً أن التجربة كانت ممتازة! 😍 كرمًا منك شاركنا تقييمك هنا لتصل تجربتك للجميع:\n📍 [رابط جوجل ماب الخاص بك]" });
            } 
            else if (/^[2٢]/.test(text)) {
                // جلب كود الخصم من متغيرات البيئة أو استخدام كود افتراضي
                const discountCode = process.env.DISCOUNT_CODE || "WELCOME10";
                
                // إرسال رسالة الاعتذار والتعويض التلقائي للعميل
                await sock.sendMessage(remoteJid, { 
                    text: `نعتذر منك جداً 😔، هدفنا رضاك التام. وتقديراً منا لصدقك، نهديك كود خصم خاص بطلبك القادم:\n\n🎫 كود الخصم: *${discountCode}*\n\nسيتم التواصل معك من قبل الإدارة فوراً لحل أي ملاحظة واجهتها.` 
                });

                const managerPhone = process.env.MANAGER_PHONE;
                if (managerPhone && isReady) {
                    const customerPhone = remoteJid.split('@')[0];
                    const cleanManager = managerPhone.replace(/[^0-9]/g, '');
                    const managerJid = `${cleanManager}@s.whatsapp.net`;
                    await sock.sendMessage(managerJid, { 
                        text: `⚠️ *تنبيه تقييم سلبي (تم إرسال كود خصم)*:\nالعميل: ${customerPhone}\nاختار "يحتاج تحسين".\nللتواصل معه: https://wa.me/${customerPhone}` 
                    });
                }
            }
        });
    } catch (error) {
        console.error("❌ خطأ في المحرك:", error.message);
        setTimeout(connectToWhatsApp, 10000);
    }
}

// --- استقبال بيانات فودكس (Webhook) ---
app.post('/foodics-webhook', async (req, res) => {
    const apiKey = req.query.key;
    if (apiKey !== process.env.WEBHOOK_KEY) return res.status(401).send('Unauthorized');
    
    const { customer, status, id, hid } = req.body;
    if (!customer?.phone) return res.status(400).send('Missing data');

    const orderId = id || hid || customer.phone;
    if (processedWebhooks.has(orderId)) return res.send('Duplicate ignored');
    
    processedWebhooks.set(orderId, Date.now());
    setTimeout(() => processedWebhooks.delete(orderId), 600000);

    if ((status === 4 || status === 'closed' || status === 'completed') && isReady) {
        const cleanPhone = customer.phone.replace(/[^0-9]/g, '');
        const jid = `${cleanPhone}@s.whatsapp.net`;
        
        console.log(`📤 إرسال طلب تقييم: ${customer.name || cleanPhone}`);
        
        setTimeout(async () => {
            try { 
                if (sock && isReady) {
                    await sock.sendMessage(jid, { 
                        text: `مرحباً ${customer.name || 'عميلنا العزيز'}، نورتنا! 🌸\n\nكيف كانت تجربة طلبك اليوم؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` 
                    }); 
                }
            } catch (e) {}
        }, 3000);
    }
    res.send('OK');
});

// --- صفحة الحالة الصحية ---
app.get('/health', (req, res) => {
    res.send(`
        <div style="font-family:sans-serif; text-align:center; padding-top:50px; direction:rtl;">
            ${isReady ? 
                '<h1 style="color:green;">✅ نظام سمعة متصل ونشط</h1><p>السيرفر جاهز لاستقبال الطلبات.</p>' : 
                (lastQR ? 
                    '<h1>📲 الربط مطلوب</h1><p>يرجى مسح الباركود لتفعيل الواتساب:</p><img src="'+lastQR+'" style="border:10px solid #eee; border-radius:15px;"/>' : 
                    '<h1>⏳ جاري تجهيز المحرك...</h1>')
            }
            <p style="color:gray; font-size:12px; margin-top:30px;">
                MongoDB: ${dbConnected ? 'متصل 🔗' : 'الوضع المحلي 🏠'}
            </p>
        </div>
    `);
});

// --- تشغيل السيرفر ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
    console.log(`🚀 [Server] يعمل الآن على المنفذ ${PORT}`);
    await initMongo();
    connectToWhatsApp();
});