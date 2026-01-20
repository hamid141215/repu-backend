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

// توحيد تنسيق الأرقام
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
        console.log("🛡️ المنصة جاهزة: عزل البيانات والاشتراكات مفعل");
    } catch (e) { 
        console.error("Mongo Error:", e.message);
        setTimeout(initMongo, 5000); 
    }
};

// Middleware: التحقق من الهوية + تاريخ انتهاء الاشتراك
const authenticate = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!apiKey) return res.status(401).json({ error: "Missing API Key" });

    const client = await db.collection('clients').findOne({ apiKey });
    if (!client) return res.status(403).json({ error: "Invalid API Key" });

    if (client.expiryDate && new Date(client.expiryDate) < new Date()) {
        return res.status(402).json({ error: "Subscription Expired" });
    }

    req.clientData = client;
    next();
};

const superAdminAuth = (req, res, next) => {
    if (req.headers['x-admin-password'] === process.env.ADMIN_PASSWORD) next();
    else res.status(401).json({ error: "Unauthorized" });
};

// --- المسارات (Routes) ---

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html'))); // صفحة الهبوط
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'admin.html'))); // لوحة الإرسال
app.get('/reports', (req, res) => res.sendFile(path.join(__dirname, 'reports.html'))); // التقارير
app.get('/super-admin', (req, res) => res.sendFile(path.join(__dirname, 'super-admin.html'))); // الإدارة

// معلومات العميل وإحصائياته
app.get('/api/client-info', authenticate, async (req, res) => {
    const total = await db.collection('evaluations').countDocuments({ clientId: req.clientData._id });
    res.json({ name: req.clientData.name, total, expiry: req.clientData.expiryDate });
});

// إرسال التقييم
app.post('/api/send', authenticate, async (req, res) => {
    const { phone, name, branch } = req.body;
    const cleanPhone = normalizePhone(phone);
    try {
        await twilioClient.messages.create({
            from: process.env.TWILIO_PHONE_NUMBER,
            body: `أهلاً بك ${name}، كيف كانت تجربتك في ${req.clientData.name} - ${branch}؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين`,
            to: `whatsapp:+${cleanPhone}`
        });
        await db.collection('evaluations').insertOne({ clientId: req.clientData._id, phone: cleanPhone, name, branch, status: 'sent', sentAt: new Date() });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// جلب التقارير الخاصة (معزولة)
app.get('/api/my-reports', authenticate, async (req, res) => {
    const evals = await db.collection('evaluations').find({ clientId: req.clientData._id }).sort({ sentAt: -1 }).toArray();
    res.json(evals);
});

// تصدير ملف إكسل يدوي بدون مكتبات
app.get('/api/export-excel', authenticate, async (req, res) => {
    try {
        const evals = await db.collection('evaluations').find({ clientId: req.clientData._id }).sort({ sentAt: -1 }).toArray();
        let csv = "\ufeffالعميل,الجوال,الفرع,التقييم,التاريخ\n";
        evals.forEach(e => {
            const ans = e.answer === '1' ? 'ممتاز' : e.answer === '2' ? 'سلبي' : 'لم يرد';
            csv += `${e.name},${e.phone},${e.branch},${ans},${new Date(e.sentAt).toLocaleDateString('ar-SA')}\n`;
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=Reports_${req.clientData.name}.csv`);
        res.send(csv);
    } catch (e) { res.status(500).send("Export Error"); }
});

// Webhook
app.post('/whatsapp/webhook', async (req, res) => {
    const { Body, From } = req.body;
    const customerAnswer = Body ? Body.trim() : "";
    const fullPhone = From.replace('whatsapp:+', '');
    try {
        const lastEval = await db.collection('evaluations').findOne({ phone: fullPhone, status: 'sent' }, { sort: { sentAt: -1 } });
        if (lastEval) {
            const client = await db.collection('clients').findOne({ _id: lastEval.clientId });
            let msg = "";
            if (customerAnswer === "1") {
                msg = `شكراً لتقييمك لـ ${client.name}! 😍\n📍 قيمنا هنا: ${client.googleLink}`;
                await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'replied', answer: '1', repliedAt: new Date() } });
            } else if (customerAnswer === "2") {
                msg = `نعتذر منك 😔، تم إرسال ملاحظتك لإدارة ${client.name}.`;
                await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'replied', answer: '2', repliedAt: new Date() } });
                let adminNum = normalizePhone(process.env.MANAGER_PHONE || client.adminPhone);
                await twilioClient.messages.create({ from: process.env.TWILIO_PHONE_NUMBER, body: `⚠️ تنبيه سلبي - ${client.name}\nالعميل: ${lastEval.name}`, to: `whatsapp:+${adminNum}` });
            }
            if (msg) await twilioClient.messages.create({ from: process.env.TWILIO_PHONE_NUMBER, body: msg, to: From });
        }
    } catch (err) { console.error("Webhook Error"); }
    res.type('text/xml').send('<Response></Response>');
});

// السوبر أدمن
app.get('/api/clients', superAdminAuth, async (req, res) => res.json(await db.collection('clients').find().toArray()));
app.post('/api/clients/add', superAdminAuth, async (req, res) => {
    const { name, apiKey, googleLink, adminPhone, plan, durationType } = req.body;
    const expiryDate = new Date();
    if (durationType === 'monthly') expiryDate.setMonth(expiryDate.getMonth() + 1);
    else expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    await db.collection('clients').insertOne({ name, apiKey, googleLink, adminPhone, plan, durationType, expiryDate, createdAt: new Date() });
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); });