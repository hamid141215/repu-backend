require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const twilio = require('twilio');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

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
        console.log("🛡️ Security Layer Active & DB Connected");
    } catch (e) { setTimeout(initMongo, 5000); }
};

// Middleware الحماية القصوى
const authenticate = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!apiKey) return res.status(401).json({ error: "Authentication Required" });

    const client = await db.collection('clients').findOne({ apiKey });
    if (!client) return res.status(403).json({ error: "Invalid Key" });

    if (client.expiryDate && new Date(client.expiryDate) < new Date()) {
        return res.status(402).json({ error: "Subscription Expired" });
    }

    req.clientData = client;
    next();
};

// المسارات الأساسية
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/reports', (req, res) => res.sendFile(path.join(__dirname, 'reports.html')));

// API مؤمنة بالكامل
app.get('/api/client-info', authenticate, async (req, res) => {
    const total = await db.collection('evaluations').countDocuments({ clientId: req.clientData._id });
    res.json({ name: req.clientData.name, total });
});

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

app.get('/api/my-reports', authenticate, async (req, res) => {
    const evals = await db.collection('evaluations').find({ clientId: req.clientData._id }).sort({ sentAt: -1 }).toArray();
    res.json(evals);
});

app.get('/api/export-excel', authenticate, async (req, res) => {
    const evals = await db.collection('evaluations').find({ clientId: req.clientData._id }).sort({ sentAt: -1 }).toArray();
    let csv = "\ufeffالعميل,الجوال,الفرع,التقييم,التاريخ\n";
    evals.forEach(e => {
        const ans = e.answer === '1' ? 'ممتاز' : e.answer === '2' ? 'سلبي' : 'لم يرد';
        csv += `${e.name},${e.phone},${e.branch},${ans},${new Date(e.sentAt).toLocaleDateString('ar-SA')}\n`;
    });
    res.setHeader('Content-Disposition', `attachment; filename=Reports.csv`);
    res.status(200).send(csv);
});

// --- مسارات السوبر أدمن (إدارة المنصة) ---

// 1. مسار جلب قائمة العملاء (هذا ما تحتاجه الصفحة عند الفتح)
app.get('/api/clients', async (req, res) => {
    // التحقق من كلمة المرور من الهيدرز
    if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: "كلمة المرور غير صحيحة" });
    }
    
    try {
        const clients = await db.collection('clients').find().toArray();
        res.json(clients);
    } catch (e) {
        res.status(500).json({ error: "خطأ في جلب البيانات" });
    }
});

// 2. مسار إضافة عميل جديد (الموجود عندك مع تحسين بسيط)
app.post('/api/clients/add', async (req, res) => {
    if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: "غير مصرح لك" });
    }

    try {
        const { name, apiKey, googleLink, adminPhone, plan, durationType } = req.body;
        const expiryDate = new Date();
        
        if (durationType === 'monthly') {
            expiryDate.setMonth(expiryDate.getMonth() + 1);
        } else {
            expiryDate.setFullYear(expiryDate.getFullYear() + 1);
        }

        await db.collection('clients').insertOne({ 
            name, apiKey, googleLink, adminPhone, 
            plan, durationType, expiryDate, 
            createdAt: new Date() 
        });
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "فشل في إضافة العميل" });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); });