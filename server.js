/**
 * نظام سُمعة (RepuSystem) - النسخة الاحترافية المستقرة
 * تم إصلاح خطأ startsWith ودعم المزامنة السحابية الكاملة
 * تحديث: تحسين نظام اكتشاف الأخطاء في الربط السحابي
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

// محاولة استدعاء مكتبة MongoDB بأمان لضمان عدم توقف السيرفر إذا لم تكن مثبتة
let MongoClient;
try {
    const mongodb = require('mongodb');
    MongoClient = mongodb.MongoClient;
} catch (e) {
    console.error("❌ خطأ حرج: مكتبة mongodb غير موجودة في ملفات المشروع.");
    console.warn("⚠️ سيتم العمل بالوضع المحلي فقط.");
}

const app = express();
app.use(express.json());

let sock = null;
let isReady = false;
let lastQR = null;
const SESSION_PATH = 'auth_new_session';

// --- إدارة الاتصال بقاعدة البيانات (نظام تشخيص الأخطاء المطور) ---
const MONGO_URL = process.env.MONGO_URL;
let client = null;
let dbError = null;

console.log("🔍 جاري فحص إعدادات MongoDB...");

if (!MONGO_URL) {
    console.log("ℹ️ الحالة: MONGO_URL غير معرف في إعدادات البيئة.");
    dbError = "الرابط غير معرف (Environment Variable Missing)";
} else if (typeof MONGO_URL !== 'string' || MONGO_URL.trim().length === 0) {
    console.log("ℹ️ الحالة: MONGO_URL موجود ولكنه فارغ.");
    dbError = "الرابط فارغ";
} else if (!MongoClient) {
    console.log("ℹ️ الحالة: المكتبة (mongodb) غير محملة برمجياً.");
    dbError = "مكتبة البرمجة مفقودة (Run: npm install mongodb)";
} else {
    // التحقق من تنسيق الرابط
    const isValidFormat = MONGO_URL.startsWith('mongodb://') || MONGO_URL.startsWith('mongodb+srv://');
    
    if (!isValidFormat) {
        console.error("❌ خطأ: تنسيق MONGO_URL غير صحيح. يجب أن يبدأ بـ mongodb:// أو mongodb+srv://");
        dbError = "تنسيق الرابط خاطئ";
    } else {
        try {
            client = new MongoClient(MONGO_URL);
            console.log("🔗 تم تهيئة محرك MongoDB بنجاح.");
        } catch (e) {
            console.error("❌ خطأ في معالجة الرابط:", e.message);
            dbError = e.message;
        }
    }
}

const dbName = 'whatsapp_bot';
const collectionName = 'session_data';

/**
 * وظائف المزامنة السحابية (Cloud Sync)
 * تضمن استعادة الجلسة تلقائياً عند إعادة تشغيل Render ومسح الملفات المحلية
 */
async function syncSessionToMongo() {
    if (!client) return;
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
            console.log('📤 تم تحديث نسخة الجلسة في MongoDB السحابي.');
        }
    } catch (err) {
        console.error('❌ فشل المزامنة السحابية:', err.message);
    }
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
            console.log('📥 تم استعادة الجلسة بنجاح من MongoDB.. لن تحتاج لمسح الباركود.');
        }
    } catch (err) {
        console.log('ℹ️ لم يتم العثور على جلسة سابقة في السحابة للتحميل.');
    }
}

/**
 * دالة الاتصال الرئيسية بواتساب
 */
async function connectToWhatsApp() {
    try {
        // محاولة استعادة الجلسة سحابياً قبل بدء تشغيل الواتساب
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

        // مزامنة فورية عند أي تغيير في مفاتيح الدخول
        sock.ev.on('creds.update', async () => {
            await saveCreds();
            if (client) await syncSessionToMongo();
        });

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                isReady = false;
                console.log(`📡 انقطع الاتصال (كود: ${statusCode}). إعادة المحاولة: ${shouldReconnect}`);
                if (shouldReconnect) connectToWhatsApp();
            } else if (connection === 'open') {
                console.log('✅ تم الاتصال بنجاح! البوت جاهز لاستقبال الطلبات.');
                isReady = true;
                lastQR = null;
                if (client) syncSessionToMongo(); // تأكيد الحفظ السحابي عند النجاح
            }
        });

        // معالجة الردود التلقائية وتنبيهات الإدارة
        sock.ev.on('messages.upsert', async (m) => {
            const msg = m.messages[0];
            if (!msg.message || msg.key.fromMe) return;
            const remoteJid = msg.key.remoteJid;
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
            
            // 1. التعامل مع التقييم الممتاز (1)
            if (/^[1١]/.test(text)) {
                await sock.sendMessage(remoteJid, { 
                    text: "يسعدنا جداً أن التجربة كانت ممتازة! 😍 كرمًا منك شاركنا تقييمك هنا:\n📍 [رابط جوجل ماب الخاص بك]" 
                });
            } 
            // 2. التعامل مع التقييم السلبي (2) وتنبيه المدير
            else if (/^[2٢]/.test(text)) {
                await sock.sendMessage(remoteJid, { 
                    text: "نعتذر منك جداً 😔، هدفنا رضاك التام. سيتم التواصل معك من قبل الإدارة فوراً لحل الموضوع." 
                });
                
                const managerPhone = process.env.MANAGER_PHONE;
                if (managerPhone && isReady) {
                    const managerJid = `${managerPhone.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
                    await sock.sendMessage(managerJid, { 
                        text: `⚠️ *تنبيه تقييم سلبي*:\n\nالعميل: ${remoteJid.split('@')[0]}\nاختار "يحتاج تحسين". يرجى التواصل معه.` 
                    });
                }
            }
        });

    } catch (error) {
        console.error("❌ خطأ حرج في تشغيل النظام:", error.message);
    }
}

/**
 * الويب هوك الخاص باستقبال بيانات فودكس (Foodics Webhook)
 */
app.post('/foodics-webhook', async (req, res) => {
    // حماية الرابط بمفتاح أمان (WEBHOOK_KEY)
    const apiKey = req.query.key;
    if (apiKey !== process.env.WEBHOOK_KEY) {
        console.log("🚫 محاولة وصول غير مصرح بها للـ Webhook");
        return res.status(401).send('Unauthorized');
    }

    const { customer, status } = req.body;
    
    // إرسال الرسالة عند إغلاق الطلب (Status 4 في فودكس)
    if ((status === 4 || status === 'closed' || status === 'completed') && isReady) {
        if (customer?.phone) {
            const cleanPhone = customer.phone.replace(/[^0-9]/g, '');
            const jid = `${cleanPhone}@s.whatsapp.net`;
            
            console.log(`📤 جاري إرسال طلب التقييم إلى: ${customer.name || cleanPhone}`);
            
            // تأخير عشوائي لحماية الرقم من الحظر (3-5 ثواني)
            setTimeout(async () => {
                try {
                    await sock.sendMessage(jid, { 
                        text: `مرحباً ${customer.name || 'عميلنا العزيز'}، نورتنا! 🌸\n\nكيف كانت تجربة طلبك اليوم؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` 
                    });
                } catch (e) { console.error("Webhook Send Error:", e.message); }
            }, Math.random() * 2000 + 3000);
        }
    }
    res.send('OK');
});

/**
 * صفحة مراقبة حالة السيرفر (Health Check)
 */
app.get('/health', (req, res) => {
    let html = '<div style="font-family:sans-serif; text-align:center; padding-top:50px; line-height:1.6;">';
    
    if (!client) {
        html += `<p style="color:orange; font-weight:bold;">⚠️ النظام يعمل بالوضع المحلي (Local Mode).</p>`;
        html += `<p style="color:red; font-size:12px;">السبب: ${dbError || 'غير معروف'}</p>`;
    } else {
        html += '<p style="color:blue; font-weight:bold;">🔗 الربط السحابي (MongoDB) مفعل ونشط.</p>';
    }

    if (isReady) {
        html += '<h1 style="color:green; font-size:40px;">✅ نظام سمعة متصل ونشط</h1>';
    } else if (lastQR) {
        html += '<h1 style="color:red;">📲 الربط مطلوب</h1>';
        html += `<img src="${lastQR}" style="border: 10px solid #eee; border-radius: 20px;" />`;
    } else {
        html += '<h1>⏳ جاري تجهيز المحرك...</h1>';
    }
    
    html += '</div>';
    res.send(html);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 السيرفر انطلق بنجاح على المنفذ ${PORT}`);
    connectToWhatsApp();
});