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
    twilioNumber: process.env.TWILIO_PHONE_NUMBER, // يجب أن يبدأ بـ whatsapp:
    googleLink: process.env.Maps_LINK || "#",
    branches: ['فرع الرياض', 'فرع جدة', 'فرع الدمام', 'فرع مكة'] // أضف فروعك هنا
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

    console.log(`Message from ${rawPhone}: ${customerAnswer}`);

    let replyMsg = "";
    
    // تصنيف الرد
    if (customerAnswer === "1") {
        replyMsg = `يسعدنا تقييمك! 😍\n📍 يرجى إضافة تقييمك هنا: ${CONFIG.googleLink}`;
    } else if (customerAnswer === "2") {
        replyMsg = `نعتذر منك 😔، تم إرسال ملاحظتك للإدارة وسيتم التواصل معك لحل المشكلة.`;
    }

    if (replyMsg) {
        // تحديث قاعدة البيانات بالرد
        await db.collection('evaluations').findOneAndUpdate(
            { phone: { $regex: rawPhone.slice(-9) + "$" }, status: 'sent' },
            { $set: { status: 'replied', answer: customerAnswer, repliedAt: new Date() } },
            { sort: { sentAt: -1 } }
        );

        // إرسال الرد التلقائي
        try {
            await twilioClient.messages.create({
                from: CONFIG.twilioNumber,
                body: replyMsg,
                to: From
            });
        } catch (err) { console.error("Reply Error:", err.message); }
    }

    res.sendStatus(200); // إغلاق الطلب بنجاح
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { 
    console.log(`Server running on port ${PORT}`);
    await initMongo(); 
});