require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const twilio = require('twilio');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// دالة لتنظيف رقم المرسل لضمان صيغة whatsapp:+1XXXXXXXXXX الصحيحة
// التنسيق الصارم لمنع خطأ الـ Channel
const getTwilioSender = () => {
    // نستخدم الرقم الخام مباشرة مع البادئة الإجبارية لتويليو
    return "whatsapp:+19713064248"; 
};

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
        console.log("🛡️ Mawjat Repu: System Secure & DB Connected");
    } catch (e) { 
        console.error("MongoDB Connection Error:", e);
        setTimeout(initMongo, 5000); 
    }
};

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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/reports', (req, res) => res.sendFile(path.join(__dirname, 'reports.html')));
app.get('/super-admin', (req, res) => res.sendFile(path.join(__dirname, 'super-admin.html')));

app.get('/api/client-info', authenticate, async (req, res) => {
    const total = await db.collection('evaluations').countDocuments({ clientId: req.clientData._id });
    res.json({ name: req.clientData.name, total });
});

// --- إرسال طلب التقييم بالقالب المعتمد ---
app.post('/api/send', authenticate, async (req, res) => {
    const { phone, name, branch } = req.body;
    const cleanPhone = normalizePhone(phone);

    try {
        await twilioClient.messages.create({
            from: getTwilioSender(),
            to: `whatsapp:+${cleanPhone}`,
            contentSid: 'HXe54a3f32a20960047a45d78181743d5d',
            contentVariables: JSON.stringify({
                1: name,
                2: req.clientData.name
            })
        });

        await db.collection('evaluations').insertOne({ 
            clientId: req.clientData._id, 
            phone: cleanPhone, 
            name, 
            branch, 
            status: 'sent', 
            sentAt: new Date() 
        });

        res.json({ success: true });
    } catch (e) {
        console.error("Twilio Error:", e.message);
        res.status(500).json({ error: "فشل الإرسال: " + e.message });
    }
});

app.get('/api/my-reports', authenticate, async (req, res) => {
    const evals = await db.collection('evaluations').find({ clientId: req.clientData._id }).sort({ sentAt: -1 }).toArray();
    res.json(evals);
});

// --- الويب هوك لاستقبال ردود الأزرار وتوجيه الشكاوى ---
app.post('/whatsapp/webhook', async (req, res) => {
    const { Body, From } = req.body;
    const customerAnswer = Body ? Body.trim() : "";
    const fullPhone = From.replace('whatsapp:+', '');

    try {
        const lastEval = await db.collection('evaluations').findOne(
            { phone: fullPhone, status: 'sent' }, 
            { sort: { sentAt: -1 } }
        );

        if (lastEval) {
            const client = await db.collection('clients').findOne({ _id: lastEval.clientId });
            if (client) {
                let replyMsg = "";

                // معالجة الرد الإيجابي (دعم النص والرقم)
                if (customerAnswer === "1" || customerAnswer.includes("ممتاز")) {
                    replyMsg = `شكراً لتقييمك لـ ${client.name}! 😍\n📍 يسعدنا جداً أن تشارك تجربتك الرائعة على خرائط جوجل:\n${client.googleLink}`;
                    await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'replied', answer: '1', repliedAt: new Date() } });
                } 
                // معالجة الرد السلبي وتوجيه التنبيه للمدير
                else if (customerAnswer === "2" || customerAnswer.includes("ملاحظات")) {
                    replyMsg = `نعتذر جداً عن تجربتك في ${client.name} 😔. تم إرسال ملاحظتك للإدارة فوراً وسيتم التواصل معك قريباً.`;
                    await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'complaint', answer: '2', repliedAt: new Date() } });

                    if (client.adminPhone) {
                        const adminNum = normalizePhone(client.adminPhone);
                        const alertMsg = `⚠️ *تنبيه شكوى جديد*\n\nالمطعم: ${client.name}\nالعميل: ${lastEval.name}\nالجوال: ${lastEval.phone}\nالفرع: ${lastEval.branch || 'الرئيسي'}`;
                        
                        await twilioClient.messages.create({
                            from: getTwilioSender(),
                            body: alertMsg,
                            to: `whatsapp:+${adminNum}`
                        });
                    }
                }

                if (replyMsg) {
                    await twilioClient.messages.create({
                        from: getTwilioSender(),
                        body: replyMsg,
                        to: From
                    });
                }
            }
        }
    } catch (err) { console.error("Webhook Error:", err); }
    res.type('text/xml').send('<Response></Response>');
});

app.get('/api/clients', async (req, res) => {
    if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: "Unauthorized" });
    const clients = await db.collection('clients').find().toArray();
    res.json(clients);
});

app.post('/api/clients/add', async (req, res) => {
    if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: "Unauthorized" });
    const { name, apiKey, googleLink, adminPhone, plan, durationType } = req.body;
    const expiryDate = new Date();
    if (durationType === 'monthly') expiryDate.setMonth(expiryDate.getMonth() + 1);
    else expiryDate.setFullYear(expiryDate.getFullYear() + 1);

    await db.collection('clients').insertOne({ 
        name, apiKey, googleLink, adminPhone, 
        plan, durationType, expiryDate, 
        createdAt: new Date() 
    });
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); });