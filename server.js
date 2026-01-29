require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const twilio = require('twilio');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// SID الخدمة الجديد المرتبط بالرقم
const MESSAGING_SERVICE_SID = 'MG3c5f83c10c1a23b224ec8068c8ddcee7'; 

// دالة تنسيق الأرقام
const normalizePhone = (phone) => {
    let p = String(phone).replace(/\D/g, '');
    if (p.startsWith('05')) p = '966' + p.substring(1);
    if (p.startsWith('5') && !p.startsWith('966')) p = '966' + p;
    return p;
};

// دالة التأخير لمحاكاة السلوك البشري
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let db;
const initMongo = async () => {
    try {
        const client = new MongoClient(process.env.MONGO_URL);
        await client.connect();
        db = client.db('mawjat_platform');
        console.log("🛡️ Database Connected & Ready");
    } catch (e) { 
        console.error("DB Error:", e);
        setTimeout(initMongo, 5000); 
    }
};

// حماية مسارات العملاء
const authenticate = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!apiKey) return res.status(401).json({ error: "Missing API Key" });
    const client = await db.collection('clients').findOne({ apiKey });
    if (!client) return res.status(403).json({ error: "Invalid API Key" });
    req.clientData = client;
    next();
};

// حماية السوبر أدمن
const superAdminAuth = (req, res, next) => {
    const adminPass = req.headers['x-admin-password'];
    if (adminPass !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
};

// --- الصفحات ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/reports', (req, res) => res.sendFile(path.join(__dirname, 'reports.html')));
app.get('/super-admin', (req, res) => res.sendFile(path.join(__dirname, 'super-admin.html')));

// --- مسارات السوبر أدمن ---
app.get('/api/clients', superAdminAuth, async (req, res) => {
    try {
        const clients = await db.collection('clients').find().toArray();
        res.json(clients);
    } catch (e) { res.status(500).json({ error: "Internal Error" }); }
});

app.post('/api/clients/add', superAdminAuth, async (req, res) => {
    const { name, apiKey, googleLink, adminPhone, plan, durationType } = req.body;
    let expiryDate = new Date();
    if (durationType === 'yearly') expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    else expiryDate.setMonth(expiryDate.getMonth() + 1);

    try {
        await db.collection('clients').insertOne({
            name, apiKey, googleLink,
            adminPhone: normalizePhone(adminPhone),
            plan, expiryDate, createdAt: new Date()
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "DB Error" }); }
});

app.delete('/api/clients/:id', superAdminAuth, async (req, res) => {
    try {
        await db.collection('clients').deleteOne({ _id: new ObjectId(req.params.id) });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Delete Error" }); }
});

// --- مسارات العميل ---
app.get('/api/client-info', authenticate, async (req, res) => {
    try {
        const total = await db.collection('evaluations').countDocuments({ clientId: req.clientData._id });
        res.json({ name: req.clientData.name, total });
    } catch (e) { res.status(500).json({ error: "Internal Error" }); }
});

// إرسال التقييم مع التأخير العشوائي لتجنب السبام
app.post('/api/send', authenticate, async (req, res) => {
    const { phone, name, branch, delayMinutes } = req.body;
    const cleanPhone = normalizePhone(phone);
    const delay = parseInt(delayMinutes) || 0;

    try {
        // تأخير عشوائي لمحاكاة الإرسال البشري
        const randomWait = Math.floor(Math.random() * (4000 - 1000 + 1)) + 1000;
        await sleep(randomWait);

        // في دالة إرسال التقييم
const messageOptions = {
    messagingServiceSid: MESSAGING_SERVICE_SID,
    to: `whatsapp:+${cleanPhone}`,
    contentSid: 'HXfac5e63d161f07e3ebc652a9931ce1c2', 
    contentVariables: JSON.stringify({ 
        "2": String(req.clientData.name).trim(), 
        "1": String(req.clientData.googleLink).trim() 
    })
};

        if (delay >= 15) {
            messageOptions.sendAt = new Date(Date.now() + delay * 60000).toISOString();
            messageOptions.scheduleType = 'fixed';
        }

        const message = await twilioClient.messages.create(messageOptions);

        await db.collection('evaluations').insertOne({ 
            clientId: req.clientData._id, 
            phone: cleanPhone, 
            name, branch, 
            status: delay >= 15 ? 'scheduled' : 'sent', 
            sentAt: new Date(),
            twilioSid: message.sid
        });

        res.json({ success: true });
    } catch (e) { 
        console.error("❌ Send Error:", e.message);
        res.status(500).json({ error: e.message }); 
    }
});

// --- الويب هوك (Webhook) ---
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
                
                if (customerAnswer === "1" || customerAnswer.includes("ممتاز")) {
                    replyMsg = `شكراً لتقييمك لـ ${client.name}! 😍 قيمنا على جوجل: ${client.googleLink}`;
                    await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'replied', answer: '1' } });
                } 
                else if (customerAnswer === "2" || customerAnswer.includes("ملاحظات") || customerAnswer.includes("ملاحظة")) {
                    replyMsg = `نعتذر منك 😔، تم إرسال ملاحظتك لإدارة ${client.name} فوراً لتحسين تجربتك القادمة.`;
                    await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'complaint', answer: '2' } });

                    if (client.adminPhone) {
                        const customerNumber = lastEval.phone.replace(/\D/g, ''); 
                        try {
                            await twilioClient.messages.create({
                                from: MESSAGING_SERVICE_SID,
                                to: `whatsapp:+${normalizePhone(client.adminPhone)}`,
                                contentSid: 'HX0820f9b7ac928e159b018b2c0e905566',
                                contentVariables: JSON.stringify({
                                    "1": lastEval.name,
                                    "2": lastEval.branch || 'الرئيسي',
                                    "3": customerNumber
                                })
                            });
                        } catch (err) { console.error("Admin Alert Failed:", err.message); }
                    }
                }

                if (replyMsg) {
                    await twilioClient.messages.create({
                        messagingServiceSid: MESSAGING_SERVICE_SID,
                        body: replyMsg,
                        to: From
                    });
                }
            }
        }
    } catch (err) { console.error("Webhook Error:", err); }
    res.type('text/xml').send('<Response></Response>');
});

app.get('/api/my-reports', authenticate, async (req, res) => {
    const evals = await db.collection('evaluations').find({ clientId: req.clientData._id }).sort({ sentAt: -1 }).toArray();
    res.json(evals);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); });