require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const twilio = require('twilio');
const path = require('path'); // أضفنا هذا السطر للتعامل مع مسارات الملفات

const app = express();
app.use(express.json());

// --- إضافة هذا الجزء لعرض لوحة التحكم ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});
// ---------------------------------------

// إعدادات Twilio الرسمية
const twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const CONFIG = {
    mongoUrl: process.env.MONGO_URL,
    webhookKey: process.env.WEBHOOK_KEY,
    googleLink: process.env.Maps_LINK || "#",
    twilioNumber: process.env.TWILIO_PHONE_NUMBER
};

let db;
// الاتصال بقاعدة البيانات
const initMongo = async () => {
    try {
        const client = new MongoClient(CONFIG.mongoUrl);
        await client.connect();
        db = client.db('whatsapp_bot');
        console.log("🔗 MongoDB Connected (Official Mode)");
    } catch (e) { 
        console.error("MongoDB Error:", e);
        setTimeout(initMongo, 5000); 
    }
};

// استقبال طلب الإرسال من الـ API
app.post('/api/send', async (req, res) => {
    if (req.query.key !== CONFIG.webhookKey) return res.sendStatus(401);
    let { phone, name, branch } = req.body;
    
    let p = String(phone).replace(/\D/g, '');
    if (p.startsWith('05')) p = '966' + p.substring(1);
    const toJid = `whatsapp:+${p}`;

    try {
        await twilioClient.messages.create({
            from: CONFIG.twilioNumber,
            body: `أهلاً بك ${name}، كيف كانت تجربتك في ${branch}؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين`,
            to: toJid
        });

        await db.collection('evaluations').insertOne({ phone: p, name, branch, status: 'sent', sentAt: new Date() });
        res.json({ success: true });
    } catch (error) {
        console.error("Twilio Error:", error);
        res.status(500).send(error.message);
    }
});

// استقبال ردود العملاء (Webhook من Twilio)
app.post('/whatsapp/webhook', express.urlencoded({ extended: false }), async (req, res) => {
    const { Body, From } = req.body;
    const text = Body ? Body.trim() : "";
    const rawPhone = From ? From.replace('whatsapp:+', '') : "";

    console.log(`Received message from ${rawPhone}: ${text}`);

    if (["1", "2"].includes(text)) {
        const evaluation = await db.collection('evaluations').findOneAndUpdate(
            { phone: { $regex: rawPhone.slice(-9) + "$" }, status: 'sent' },
            { $set: { status: 'replied', answer: text, repliedAt: new Date() } },
            { sort: { sentAt: -1 }, returnDocument: 'after' }
        );

        if (evaluation) {
            let replyMsg = text === "1" ? `يسعدنا تقييمك! 😍\n📍 ${CONFIG.googleLink}` : `نعتذر منك 😔، سيتم التواصل معك لحل المشكلة.`;
            await twilioClient.messages.create({
                from: CONFIG.twilioNumber,
                body: replyMsg,
                to: From
            });
        }
    }
    res.sendStatus(200);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { 
    console.log(`Server is running on port ${PORT}`);
    await initMongo(); 
});