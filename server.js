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
        console.log("🛡️ Database Secured & Connected");
    } catch (e) { 
        console.error("Mongo Error:", e.message);
        setTimeout(initMongo, 5000); 
    }
};

// Middleware للأمان (عملاء المطاعم)
const authenticate = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ error: "Missing API Key" });
    const client = await db.collection('clients').findOne({ apiKey });
    if (!client) return res.status(403).json({ error: "Invalid API Key" });
    req.clientData = client;
    next();
};

// Middleware لحماية لوحة السوبر أدمن (أنت فقط)
const superAdminAuth = (req, res, next) => {
    const pass = req.headers['x-admin-password'];
    if (pass === process.env.ADMIN_PASSWORD) {
        next();
    } else {
        res.status(401).json({ error: "Unauthorized" });
    }
};

// --- المسارات (Routes) ---

app.get('/', async (req, res) => {
    try {
        const total = await db.collection('evaluations').countDocuments();
        let html = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
        res.send(html.replace(/{{total}}/g, total));
    } catch (e) { res.status(500).send("Error"); }
});

app.get('/reports', async (req, res) => {
    try {
        const evaluations = await db.collection('evaluations').find().sort({ sentAt: -1 }).toArray();
        let html = fs.readFileSync(path.join(__dirname, 'reports.html'), 'utf8');
        const rows = evaluations.map(ev => `
            <tr class="border-b">
                <td class="p-4 text-right">${ev.name}</td>
                <td class="p-4 text-center">${ev.phone}</td>
                <td class="p-4 text-center">${ev.answer === '1' ? '✅ ممتاز' : ev.answer === '2' ? '❌ سلبي' : '-'}</td>
                <td class="p-4 text-center text-xs text-gray-400">${ev.sentAt ? new Date(ev.sentAt).toLocaleString('ar-SA') : '-'}</td>
            </tr>
        `).join('');
        res.send(html.replace('{{rows}}', rows));
    } catch (e) { res.status(500).send("Error"); }
});

// صفحة السوبر أدمن
app.get('/super-admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'super-admin.html'));
});

// API لإدارة العملاء (محمية)
app.get('/api/clients', superAdminAuth, async (req, res) => {
    const clients = await db.collection('clients').find().toArray();
    res.json(clients);
});

app.post('/api/clients/add', superAdminAuth, async (req, res) => {
    const { name, apiKey, googleLink, adminPhone } = req.body;
    await db.collection('clients').insertOne({ name, apiKey, googleLink, adminPhone, createdAt: new Date() });
    res.json({ success: true });
});

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
        await db.collection('evaluations').insertOne({ clientId: client._id, phone: cleanPhone, name, branch, status: 'sent', sentAt: new Date() });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

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
                replyMsg = `يسعدنا تقييمك! 😍\n📍 ${client.googleLink}`;
                await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'replied', answer: '1', repliedAt: new Date() } });
            } else if (customerAnswer === "2") {
                replyMsg = `نعتذر منك 😔، تم إرسال ملاحظتك للإدارة.`;
                await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'replied', answer: '2', repliedAt: new Date() } });
                try {
                    let adminNum = normalizePhone(process.env.MANAGER_PHONE || client.adminPhone);
                    await twilioClient.messages.create({
                        from: process.env.TWILIO_PHONE_NUMBER,
                        body: `⚠️ تنبيه سلبي!\nالعميل: ${lastEval.name}\nالفرع: ${lastEval.branch}`,
                        to: `whatsapp:+${adminNum}`
                    });
                } catch (e) { console.error("Admin Alert Fail", e.message); }
            }
            if (replyMsg) await twilioClient.messages.create({ from: process.env.TWILIO_PHONE_NUMBER, body: replyMsg, to: From });
        }
    } catch (err) { console.error("Webhook Error", err.message); }
    res.type('text/xml').send('<Response></Response>');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); });