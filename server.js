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

const normalizePhone = (phone) => {
    let p = String(phone).replace(/\D/g, '');
    if (p.startsWith('05')) p = '966' + p.substring(1);
    if (p.startsWith('5') && !p.startsWith('966')) p = '966' + p;
    return p;
};

let db;
const initMongo = async () => {
    try {
        const client = new MongoClient(process.env.MONGO_URL);
        await client.connect();
        db = client.db('mawjat_platform');
        console.log("🛡️ Database Isolated & Connected");
    } catch (e) { 
        console.error("Mongo Error:", e.message);
        setTimeout(initMongo, 5000); 
    }
};

// Middleware لتأمين الروابط وعزل الهوية
const authenticate = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!apiKey) return res.status(401).json({ error: "Missing API Key" });
    const client = await db.collection('clients').findOne({ apiKey });
    if (!client) return res.status(403).json({ error: "Invalid API Key" });
    req.clientData = client;
    next();
};

const superAdminAuth = (req, res, next) => {
    const pass = req.headers['x-admin-password'];
    if (pass === process.env.ADMIN_PASSWORD) next();
    else res.status(401).json({ error: "Unauthorized" });
};

// --- المسارات (Routes) ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// جلب بيانات العميل والإحصائيات الخاصة به فقط
app.get('/api/client-info', authenticate, async (req, res) => {
    try {
        const total = await db.collection('evaluations').countDocuments({ clientId: req.clientData._id });
        res.json({
            name: req.clientData.name,
            total: total
        });
    } catch (e) { res.status(500).json({ error: "Error fetching info" }); }
});

app.post('/api/send', authenticate, async (req, res) => {
    const { phone, name, branch } = req.body;
    const cleanPhone = normalizePhone(phone);
    const client = req.clientData;
    
    try {
        // تضمين اسم المطعم ديناميكياً في الرسالة
        await twilioClient.messages.create({
            from: process.env.TWILIO_PHONE_NUMBER,
            body: `أهلاً بك ${name}، كيف كانت تجربتك في ${client.name} - ${branch}؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين`,
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
        res.json({ success: true, clientName: client.name });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/reports', (req, res) => {
    res.sendFile(path.join(__dirname, 'reports.html'));
});

// جلب التقييمات المعزولة للمطعم فقط
app.get('/api/my-reports', authenticate, async (req, res) => {
    try {
        const evaluations = await db.collection('evaluations')
            .find({ clientId: req.clientData._id })
            .sort({ sentAt: -1 })
            .toArray();
        res.json(evaluations);
    } catch (e) { res.status(500).json({ error: "Error fetching reports" }); }
});

// Webhook ومعالجة الردود (نفس المنطق السابق مع التأكد من اسم المطعم)
app.post('/whatsapp/webhook', async (req, res) => {
    const { Body, From } = req.body;
    const customerAnswer = Body ? Body.trim() : "";
    const fullPhone = From.replace('whatsapp:+', '');
    try {
        const lastEval = await db.collection('evaluations').findOne({ phone: fullPhone, status: 'sent' }, { sort: { sentAt: -1 } });
        if (lastEval) {
            const client = await db.collection('clients').findOne({ _id: lastEval.clientId });
            let replyMsg = "";
            if (customerAnswer === "1") {
                replyMsg = `شكراً لزيارتك ${client.name}! 😍\n📍 قيمنا هنا: ${client.googleLink}`;
                await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'replied', answer: '1', repliedAt: new Date() } });
            } else if (customerAnswer === "2") {
                replyMsg = `نعتذر منك 😔، تم إرسال ملاحظتك لإدارة ${client.name} وسيتم التواصل معك.`;
                await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'replied', answer: '2', repliedAt: new Date() } });
                try {
                    let adminNum = normalizePhone(process.env.MANAGER_PHONE || client.adminPhone);
                    await twilioClient.messages.create({
                        from: process.env.TWILIO_PHONE_NUMBER,
                        body: `⚠️ تنبيه سلبي - ${client.name}!\nالعميل: ${lastEval.name}\nالفرع: ${lastEval.branch}`,
                        to: `whatsapp:+${adminNum}`
                    });
                } catch (e) { console.error("Admin Alert Fail", e.message); }
            }
            if (replyMsg) await twilioClient.messages.create({ from: process.env.TWILIO_PHONE_NUMBER, body: replyMsg, to: From });
        }
    } catch (err) { console.error("Webhook Error", err.message); }
    res.type('text/xml').send('<Response></Response>');
});

// سوبر أدمن
app.get('/super-admin', (req, res) => res.sendFile(path.join(__dirname, 'super-admin.html')));
app.get('/api/clients', superAdminAuth, async (req, res) => res.json(await db.collection('clients').find().toArray()));
app.post('/api/clients/add', superAdminAuth, async (req, res) => {
    const { name, apiKey, googleLink, adminPhone } = req.body;
    await db.collection('clients').insertOne({ name, apiKey, googleLink, adminPhone, createdAt: new Date() });
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); });