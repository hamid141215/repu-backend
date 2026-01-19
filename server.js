require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const twilio = require('twilio');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// دالة توحيد الأرقام الدولية (E.164) لمنع تداخل البيانات
const normalizePhone = (phone) => {
    let p = String(phone).replace(/\D/g, '');
    if (p.startsWith('05')) p = '966' + p.substring(1);
    return p;
};

let db;
const initMongo = async () => {
    try {
        const client = new MongoClient(process.env.MONGO_URL);
        await client.connect();
        db = client.db('mawjat_platform');
        console.log("🛡️ Database Secured & Connected");
    } catch (e) { 
        console.error("Mongo Error:", e.message);
        setTimeout(initMongo, 5000); 
    }
};

// Middleware لتأمين الروابط عبر Headers (سد ثغرة تسريب المفتاح في URL)
const authenticate = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: "Missing API Key" });
    
    // البحث عن العميل صاحب هذا المفتاح في قاعدة البيانات
    const client = await db.collection('clients').findOne({ apiKey: apiKey });
    if (!client) return res.status(403).json({ error: "Invalid API Key" });
    
    req.clientData = client; // تمرير بيانات العميل لباقي المسارات
    next();
};

// لوحة التحكم - حقن البيانات ديناميكياً
app.get('/', async (req, res) => {
    try {
        const total = await db.collection('evaluations').countDocuments();
        let html = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
        // هنا يمكنك إضافة منطق لجلب الفروع الخاصة بالعميل المسجل دخولاً
        res.send(html.replace(/{{total}}/g, total));
    } catch (e) { res.status(500).send("Error loading dashboard"); }
});

// إرسال التقييم - يدعم فودكس واللوحة اليدوية
app.post('/api/send', authenticate, async (req, res) => {
    const { phone, name, branch } = req.body;
    const cleanPhone = normalizePhone(phone);
    const client = req.clientData;

    try {
        await twilioClient.messages.create({
            from: process.env.TWILIO_PHONE_NUMBER,
            body: `أهلاً بك ${name}، كيف كانت تجربتك في ${branch}؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين`,
            to: `whatsapp:+${cleanPhone}`
        });

        await db.collection('evaluations').insertOne({ 
            clientId: client._id,
            phone: cleanPhone, 
            name, 
            branch, 
            status: 'sent', 
            sentAt: new Date() 
        });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Webhook تويليو المطور - معالجة دقيقة للردود
app.post('/whatsapp/webhook', async (req, res) => {
    const { Body, From } = req.body;
    const customerAnswer = Body ? Body.trim() : "";
    const fullPhone = From.replace('whatsapp:+', '');

    try {
        // البحث المطابق تماماً للرقم الدولي الكامل
        const lastEval = await db.collection('evaluations').findOne(
            { phone: fullPhone, status: 'sent' },
            { sort: { sentAt: -1 } }
        );

        if (lastEval) {
            const client = await db.collection('clients').findOne({ _id: lastEval.clientId });
            let replyMsg = "";

            if (customerAnswer === "1") {
                replyMsg = `يسعدنا تقييمك! 😍\n📍 يرجى إضافة تقييمك هنا: ${client.googleLink}`;
                await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'replied', answer: '1', repliedAt: new Date() } });
            } else if (customerAnswer === "2") {
                replyMsg = `نعتذر منك 😔، تم إرسال ملاحظتك للإدارة وسيتم التواصل معك قريباً.`;
                await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'replied', answer: '2', repliedAt: new Date() } });
                
                // تنبيه المدير الخاص بهذا المطعم تحديداً
                await twilioClient.messages.create({
                    from: process.env.TWILIO_PHONE_NUMBER,
                    body: `⚠️ تنبيه تقييم سلبي!\nالعميل: ${lastEval.name}\nالفرع: ${lastEval.branch}`,
                    to: `whatsapp:+${client.adminPhone}`
                });
            }

            if (replyMsg) await twilioClient.messages.create({ from: process.env.TWILIO_PHONE_NUMBER, body: replyMsg, to: From });
        }
    } catch (err) { console.error("Webhook Error:", err.message); }
    res.type('text/xml').send('<Response></Response>');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); });