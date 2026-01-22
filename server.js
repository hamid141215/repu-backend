require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const twilio = require('twilio');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// تأكد من وضع الـ SID الصحيح الذي حصلت عليه هنا
const MESSAGING_SERVICE_SID = 'MG3c5f83c10c1a23b224ec8068c8ddcee7'; 

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
        console.log("🛡️ Database Connected");
    } catch (e) { 
        console.error("DB Error:", e);
        setTimeout(initMongo, 5000); 
    }
};

// الدالة المسؤولة عن فحص المفتاح (Authentication)
const authenticate = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!apiKey) return res.status(401).json({ error: "Missing API Key" });
    
    const client = await db.collection('clients').findOne({ apiKey });
    if (!client) return res.status(403).json({ error: "Invalid API Key" });
    
    req.clientData = client;
    next();
};

// --- تعريف المسارات (Routes) ---

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/reports', (req, res) => res.sendFile(path.join(__dirname, 'reports.html')));
app.get('/super-admin', (req, res) => res.sendFile(path.join(__dirname, 'super-admin.html')));

// المسار الذي تسبب في خطأ 404 - تأكد من وجوده هنا
app.get('/api/client-info', authenticate, async (req, res) => {
    try {
        const total = await db.collection('evaluations').countDocuments({ clientId: req.clientData._id });
        res.json({ name: req.clientData.name, total });
    } catch (e) {
        res.status(500).json({ error: "Internal Error" });
    }
});

app.post('/api/send', authenticate, async (req, res) => {
    const { phone, name, branch, delayMinutes } = req.body;
    const cleanPhone = normalizePhone(phone);
    const delay = parseInt(delayMinutes) || 0;

    try {
        const messageOptions = {
            messagingServiceSid: MESSAGING_SERVICE_SID,
            to: `whatsapp:+${cleanPhone}`,
            contentSid: 'HXe54a3f32a20960047a45d78181743d5d',
            contentVariables: JSON.stringify({ "1": name, "2": req.clientData.name })
        };

        // الجدولة إذا كان التأخير 15 دقيقة أو أكثر
        if (delay >= 15) {
            messageOptions.sendAt = new Date(Date.now() + delay * 60000).toISOString();
            messageOptions.scheduleType = 'fixed';
        }

        await twilioClient.messages.create(messageOptions);

        await db.collection('evaluations').insertOne({ 
            clientId: req.clientData._id, 
            phone: cleanPhone, 
            name, branch, 
            status: delay >= 15 ? 'scheduled' : 'sent', 
            sentAt: new Date() 
        });

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/my-reports', authenticate, async (req, res) => {
    const evals = await db.collection('evaluations').find({ clientId: req.clientData._id }).sort({ sentAt: -1 }).toArray();
    res.json(evals);
});

// ويب هوك الاستقبال
app.post('/whatsapp/webhook', async (req, res) => {
    const { Body, From } = req.body;
    const customerAnswer = Body ? Body.trim() : "";
    const fullPhone = From.replace('whatsapp:+', '');

    try {
        const lastEval = await db.collection('evaluations').findOne({ phone: fullPhone }, { sort: { sentAt: -1 } });
        if (lastEval) {
            const client = await db.collection('clients').findOne({ _id: lastEval.clientId });
            if (client) {
                let replyMsg = "";
                if (customerAnswer === "1") {
                    replyMsg = `شكراً لتقييمك لـ ${client.name}! 😍 قيمنا هنا: ${client.googleLink}`;
                    await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'replied', answer: '1' } });
                } else if (customerAnswer === "2") {
                    replyMsg = `نعتذر منك 😔، تم إرسال ملاحظتك لإدارة ${client.name}.`;
                    await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'complaint', answer: '2' } });
                }
                if (replyMsg) await twilioClient.messages.create({ messagingServiceSid: MESSAGING_SERVICE_SID, body: replyMsg, to: From });
            }
        }
    } catch (err) {}
    res.type('text/xml').send('<Response></Response>');
});

// إدارة السوبر أدمن
app.get('/api/clients', async (req, res) => {
    if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD) return res.status(401).send();
    const clients = await db.collection('clients').find().toArray();
    res.json(clients);
});

app.post('/api/clients/add', async (req, res) => {
    if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD) return res.status(401).send();
    const { name, apiKey, googleLink, adminPhone, plan, durationType } = req.body;
    const expiryDate = new Date();
    durationType === 'monthly' ? expiryDate.setMonth(expiryDate.getMonth() + 1) : expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    await db.collection('clients').insertOne({ name, apiKey, googleLink, adminPhone, plan, durationType, expiryDate, createdAt: new Date() });
    res.json({ success: true });
});

app.delete('/api/clients/:id', async (req, res) => {
    if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD) return res.status(401).send();
    await db.collection('clients').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); });