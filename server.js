require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const twilio = require('twilio');
const path = require('path');
const fs = require('fs'); // مكتبة قراءة الملفات

const app = express();
app.use(express.json());

// إعدادات Twilio
const twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const CONFIG = {
    mongoUrl: process.env.MONGO_URL,
    webhookKey: process.env.WEBHOOK_KEY,
    twilioNumber: process.env.TWILIO_PHONE_NUMBER,
    googleLink: process.env.Maps_LINK || "#"
};

let db;
const initMongo = async () => {
    try {
        const client = new MongoClient(CONFIG.mongoUrl);
        await client.connect();
        db = client.db('whatsapp_bot');
        console.log("🔗 MongoDB Connected");
    } catch (e) { setTimeout(initMongo, 5000); }
};

// --- الحل الذكي لعرض اللوحة ---
app.get('/', async (req, res) => {
    try {
        const total = await db.collection('evaluations').countDocuments();
        let html = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
        
        // هنا نقوم باستبدال العلامات بالقيم الحقيقية من Render
        html = html.replace('{{total}}', total)
                   .replace('{{webhookKey}}', CONFIG.webhookKey);
                   
        res.send(html);
    } catch (e) {
        res.sendFile(path.join(__dirname, 'admin.html'));
    }
});

// استقبال طلب الإرسال
app.post('/api/send', async (req, res) => {
    // التأكد من الكلمة السرية
    if (req.query.key !== CONFIG.webhookKey) {
        console.log("Unauthorized attempt with key:", req.query.key);
        return res.sendStatus(401);
    }

    let { phone, name, branch } = req.body;
    let p = String(phone).replace(/\D/g, '');
    if (p.startsWith('05')) p = '966' + p.substring(1);

    try {
        await twilioClient.messages.create({
            from: CONFIG.twilioNumber,
            body: `أهلاً بك ${name}، كيف كانت تجربتك في ${branch}؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين`,
            to: `whatsapp:+${p}`
        });

        await db.collection('evaluations').insertOne({ phone: p, name, branch, status: 'sent', sentAt: new Date() });
        res.json({ success: true });
    } catch (error) {
        console.error("Twilio Error:", error.message);
        res.status(500).send(error.message);
    }
});

// Webhook للردود
app.post('/whatsapp/webhook', express.urlencoded({ extended: false }), async (req, res) => {
    const { Body, From } = req.body;
    // ... بقية كود المعالجة كما هو ...
    res.sendStatus(200);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); });