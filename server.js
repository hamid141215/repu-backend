require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const twilio = require('twilio');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// الإعدادات الأساسية - تأكد من رقم البوت في تويليو
const MESSAGING_SERVICE_SID = 'MG3c5f83c10c1a23b224ec8068c8ddcee7'; 

// دالة تنسيق الأرقام
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
        console.log("🛡️ Mawjat Platform: Database Connected & Secured");
    } catch (e) { 
        console.error("DB Error:", e);
        setTimeout(initMongo, 5000);
    }
};

// --- الحماية (Middleware) ---
const authenticate = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!apiKey) return res.status(401).json({ error: "Missing API Key" });
    const client = await db.collection('clients').findOne({ apiKey: apiKey.trim() });
    if (!client) return res.status(403).json({ error: "Invalid API Key" });
    req.clientData = client;
    next();
};

const superAdminAuth = (req, res, next) => {
    const adminPass = req.headers['x-admin-password'];
    if (adminPass !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
};

// --- مسارات الصفحات ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/reports', (req, res) => res.sendFile(path.join(__dirname, 'reports.html')));
app.get('/super-admin', (req, res) => res.sendFile(path.join(__dirname, 'super-admin.html')));

// --- مسارات السوبر أدمن ---
app.get('/api/super-admin/clients', superAdminAuth, async (req, res) => {
    try {
        const clients = await db.collection('clients').find().toArray();
        res.json(clients);
    } catch (e) { res.status(500).json({ error: "Internal Error" }); }
});

// المسار الذي كان يسبب مشكلة (تم إصلاحه لاستقبال nfcId)
app.post('/api/clients/add', superAdminAuth, async (req, res) => {
    const { name, apiKey, nfcId, googleLink, adminPhone, plan, durationType } = req.body;
    
    let expiryDate = new Date();
    if (durationType === 'yearly') expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    else expiryDate.setMonth(expiryDate.getMonth() + 1);

    try {
        const existing = await db.collection('clients').findOne({ 
            $or: [{ apiKey: apiKey }, { nfcId: nfcId }] 
        });
        
        if (existing) return res.status(400).json({ error: "ID أو Key مستخدم مسبقاً" });

        await db.collection('clients').insertOne({
            name, apiKey: apiKey.trim(), nfcId: nfcId.trim(),
            googleLink, adminPhone: normalizePhone(adminPhone),
            plan, expiryDate, createdAt: new Date()
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Database Error" }); }
});

app.delete('/api/clients/:id', superAdminAuth, async (req, res) => {
    try {
        await db.collection('clients').deleteOne({ _id: new ObjectId(req.params.id) });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Delete Error" }); }
});

// --- الويب هوك الشامل (NFC + أزرار + تنبيهات) ---
app.post('/whatsapp/webhook', async (req, res) => {
    const { Body, From, ButtonPayload } = req.body;
    const incomingText = Body ? Body.trim() : "";
    const phone = From.replace('whatsapp:+', '');

    try {
        // 1. معالجة NFC (تقييم_اسم_ID)
        if (incomingText.startsWith("تقييم_")) {
            const parts = incomingText.split('_');
            const nfcId = parts[parts.length - 1]; 
            const client = await db.collection('clients').findOne({ nfcId: nfcId });
            
            if (client) {
                await twilioClient.messages.create({
                    messagingService_sid: MESSAGING_SERVICE_SID,
                    to: From,
                    contentSid: 'HXfac5e63d161f07e3ebc652a9931ce1c2',
                    contentVariables: JSON.stringify({ "1": "عزيزنا", "2": client.name })
                });
                await db.collection('evaluations').insertOne({ 
                    clientId: client._id, phone, name: "عميل NFC", status: 'pending', sentAt: new Date() 
                });
            }
            return res.status(200).end();
        }

        // 2. معالجة الردود والشكاوى
        const lastEval = await db.collection('evaluations').findOne({ phone }, { sort: { sentAt: -1 } });
        if (lastEval) {
            const client = await db.collection('clients').findOne({ _id: lastEval.clientId });
            if (!client) return res.status(200).end();

            if (incomingText.includes("ممتاز") || ButtonPayload === "Excellent_Feedback") {
                await twilioClient.messages.create({
                    messagingServiceSid: MESSAGING_SERVICE_SID, to: From,
                    body: `شكراً لك! 😍 قيمنا هنا: ${client.googleLink}`
                });
                await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'replied' } });
            } 
            else if (incomingText.includes("ملاحظة") || ButtonPayload === "Complaint_Feedback") {
                await twilioClient.messages.create({
                    messagingServiceSid: MESSAGING_SERVICE_SID, to: From,
                    body: `نعتذر منك 😔، تم إرسال ملاحظتك للإدارة فوراً.`
                });
                await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'complaint' } });

                if (client.adminPhone) {
                    await twilioClient.messages.create({
                        messagingServiceSid: MESSAGING_SERVICE_SID,
                        to: `whatsapp:+${normalizePhone(client.adminPhone)}`,
                        body: `⚠️ تنبيه شكوى: عميل رقم (${phone}) في (${client.name}) لديه ملاحظة.`
                    });
                }
            }
        }
    } catch (err) { console.error("Webhook Error:", err); }
    res.status(200).end();
});

// --- مسارات العميل ---
app.get('/api/client-info', authenticate, async (req, res) => {
    const total = await db.collection('evaluations').countDocuments({ clientId: req.clientData._id });
    res.json({ name: req.clientData.name, total });
});

app.post('/api/send', authenticate, async (req, res) => {
    const { phone, name, branch } = req.body;
    const cleanPhone = normalizePhone(phone);
    try {
        await twilioClient.messages.create({
            messagingServiceSid: MESSAGING_SERVICE_SID,
            to: `whatsapp:+${cleanPhone}`,
            contentSid: 'HXfac5e63d161f07e3ebc652a9931ce1c2',
            contentVariables: JSON.stringify({ "1": name, "2": req.clientData.name })
        });
        await db.collection('evaluations').insertOne({ 
            clientId: req.clientData._id, phone: cleanPhone, name, branch, status: 'sent', sentAt: new Date() 
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/my-reports', authenticate, async (req, res) => {
    const evals = await db.collection('evaluations').find({ clientId: req.clientData._id }).sort({ sentAt: -1 }).toArray();
    res.json(evals);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); });