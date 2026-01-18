require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const twilio = require('twilio');
const path = require('path');
const fs = require('fs');

const app = express();

// إعدادات قراءة البيانات بصيغ مختلفة (مهم جداً للردود)
app.use(express.json());
app.use(express.urlencoded({ extended: true })); 

// إعدادات Twilio الرسمية
const twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const CONFIG = {
    mongoUrl: process.env.MONGO_URL,
    webhookKey: process.env.WEBHOOK_KEY,
    twilioNumber: process.env.TWILIO_PHONE_NUMBER,
    googleLink: process.env.Maps_LINK || "#",
    adminPhone: process.env.MANAGER_PHONE, // هنا ربطناه بالاسم الذي اخترته في Render
    branches: ['فرع الرياض', 'فرع جدة', 'فرع الدمام', 'فرع مكة']
};

let db;
// الاتصال بقاعدة البيانات
const initMongo = async () => {
    try {
        const client = new MongoClient(CONFIG.mongoUrl);
        await client.connect();
        db = client.db('whatsapp_bot');
        console.log("🔗 MongoDB Connected (Mawjat Analytics Mode)");
    } catch (e) { 
        console.error("MongoDB Connection Failed:", e.message);
        setTimeout(initMongo, 5000); 
    }
};

// --- عرض لوحة التحكم بشكل ديناميكي ---
app.get('/', async (req, res) => {
    try {
        const total = await db.collection('evaluations').countDocuments();
        let html = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
        
        // توليد قائمة الفروع برمجياً
        const branchesHtml = CONFIG.branches.map(b => `<option value="${b}">${b}</option>`).join('');

        // استبدال العلامات بالقيم الحقيقية قبل العرض
        html = html.replace(/{{total}}/g, total)
                   .replace(/{{webhookKey}}/g, CONFIG.webhookKey)
                   .replace(/{{branches}}/g, branchesHtml);
                   
        res.send(html);
    } catch (e) {
        res.sendFile(path.join(__dirname, 'admin.html'));
    }
});

// --- إرسال الطلب الأول (Template) ---
app.post('/api/send', async (req, res) => {
    if (req.query.key !== CONFIG.webhookKey) return res.sendStatus(401);

    let { phone, name, branch } = req.body;
    let p = String(phone).replace(/\D/g, '');
    if (p.startsWith('05')) p = '966' + p.substring(1);

    try {
        // إرسال الرسالة مع التأكد من صيغة whatsapp:
        await twilioClient.messages.create({
            from: CONFIG.twilioNumber,
            body: `أهلاً بك ${name}، كيف كانت تجربتك في ${branch}؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين`,
            to: `whatsapp:+${p}`
        });

        await db.collection('evaluations').insertOne({ 
            phone: p, name, branch, status: 'sent', sentAt: new Date() 
        });
        res.json({ success: true });
    } catch (error) {
        console.error("Twilio Send Error:", error.message);
        res.status(500).send(error.message);
    }
});

// --- معالجة ردود العملاء (1 أو 2) ---
app.post('/whatsapp/webhook', async (req, res) => {
    const { Body, From } = req.body;
    const customerAnswer = Body ? Body.trim() : "";
    const rawPhone = From ? From.replace('whatsapp:+', '') : "";

    // 1. البحث عن آخر طلب إرسال "معلق" فقط (Status: sent)
    // هذا يضمن أن العميل لو رد مرة ثانية لن يجد طلباً نشطاً
    const lastEval = await db.collection('evaluations').findOne(
        { phone: { $regex: rawPhone.slice(-9) + "$" }, status: 'sent' },
        { sort: { sentAt: -1 } }
    );

    // إذا لم يجد طلب بانتظار الرد، يرسل رد فارغ ويخرج (يمنع الرد على الرسائل المتكررة)
    if (!lastEval) {
        res.type('text/xml');
        return res.send('<Response></Response>');
    }

    let replyMsg = "";
    let isNegative = false; // علامة لمعرفة إذا كان التقييم سلبي

    if (customerAnswer === "1") {
        replyMsg = `يسعدنا تقييمك! 😍\n📍 يرجى إضافة تقييمك هنا: ${CONFIG.googleLink}`;
        
        // تحديث الحالة فوراً لمنع الرد مرة أخرى
        await db.collection('evaluations').updateOne(
            { _id: lastEval._id },
            { $set: { status: 'replied', answer: '1', repliedAt: new Date() } }
        );

    } else if (customerAnswer === "2") {
        replyMsg = `نعتذر منك 😔، تم إرسال ملاحظتك للإدارة وسيتم التواصل معك قريباً لحل المشكلة.`;
        isNegative = true;

        // تحديث الحالة فوراً لمنع الرد مرة أخرى
        await db.collection('evaluations').updateOne(
            { _id: lastEval._id },
            { $set: { status: 'replied', answer: '2', repliedAt: new Date() } }
        );
    }

    // إرسال الرد للعميل (إذا كان 1 أو 2)
    if (replyMsg) {
        try {
            await twilioClient.messages.create({
                from: CONFIG.twilioNumber,
                body: replyMsg,
                to: From
            });

            // --- إرسال تنبيه للمدير إذا كان التقييم سلبي (رقم 2) ---
            if (isNegative && CONFIG.adminPhone) {
                await twilioClient.messages.create({
                    from: CONFIG.twilioNumber,
                    body: `⚠️ *تنبيه تقييم سلبي!*\n\n*العميل:* ${lastEval.name}\n*الجوال:* ${rawPhone}\n*الفرع:* ${lastEval.branch}\n*التقييم:* يحتاج تحسين (2)`,
                    to: CONFIG.adminPhone
                });
                console.log("تم تنبيه المدير بنجاح");
            }
        } catch (err) {
            console.error("خطأ في إرسال الرسائل:", err.message);
        }
    }

    // إرسال XML فارغ لإنهاء المحادثة ومنع ظهور كلمة OK
    res.type('text/xml');
    res.send('<Response></Response>');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { 
    console.log(`Server running on port ${PORT}`);
    await initMongo(); 
});