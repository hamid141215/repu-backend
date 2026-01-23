require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const twilio = require('twilio');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

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
        console.log("🛡️ Database Connected & Ready");
    } catch (e) { 
        console.error("DB Error:", e);
        setTimeout(initMongo, 5000); 
    }
};

const authenticate = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!apiKey) return res.status(401).json({ error: "Missing API Key" });
    const client = await db.collection('clients').findOne({ apiKey });
    if (!client) return res.status(403).json({ error: "Invalid API Key" });
    req.clientData = client;
    next();
};

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/reports', (req, res) => res.sendFile(path.join(__dirname, 'reports.html')));
app.get('/super-admin', (req, res) => res.sendFile(path.join(__dirname, 'super-admin.html')));

app.get('/api/client-info', authenticate, async (req, res) => {
    try {
        const total = await db.collection('evaluations').countDocuments({ clientId: req.clientData._id });
        res.json({ name: req.clientData.name, total });
    } catch (e) { res.status(500).json({ error: "Internal Error" }); }
});

app.post('/api/send', authenticate, async (req, res) => {
    const { phone, name, branch, delayMinutes } = req.body;
    const cleanPhone = normalizePhone(phone);
    const delay = parseInt(delayMinutes) || 0;

    try {
        const messageOptions = {
            messagingServiceSid: MESSAGING_SERVICE_SID,
            to: `whatsapp:+${cleanPhone}`,
            contentSid: 'HXfac5e63d161f07e3ebc652a9931ce1c2',
            contentVariables: JSON.stringify({ "1": name, "2": req.clientData.name })
        };

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
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- الويب هوك المحدث لاستقبال الأزرار بذكاء ---
app.post('/whatsapp/webhook', async (req, res) => {
    const { Body, From } = req.body;
    const customerAnswer = Body ? Body.trim() : "";
    const fullPhone = From.replace('whatsapp:+', '');

    console.log(`📩 رد جديد من ${fullPhone}: "${customerAnswer}"`);

    try {
        const lastEval = await db.collection('evaluations').findOne({ phone: fullPhone }, { sort: { sentAt: -1 } });
        if (lastEval) {
            const client = await db.collection('clients').findOne({ _id: lastEval.clientId });
            if (client) {
                let replyMsg = "";
                
                // البحث عن كلمة "ممتاز" أو رقم "1" في الرد
                if (customerAnswer === "1" || customerAnswer.includes("ممتاز")) {
                    replyMsg = `شكراً لتقييمك لـ ${client.name}! 😍 يسعدنا جداً رضاك. قيمنا على جوجل لنستمر في خدمتك: ${client.googleLink}`;
                    await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'replied', answer: '1' } });
                } 
                // البحث عن كلمة "ملاحظة" أو رقم "2" في الرد
                else if (customerAnswer === "2" || customerAnswer.includes("ملاحظات") || customerAnswer.includes("ملاحظة")) {
                    replyMsg = `نعتذر منك 😔، تم إرسال ملاحظتك لإدارة ${client.name} فوراً لتحسين تجربتك القادمة.`;
                    await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'complaint', answer: '2' } });

                    // تنبيه المدير فوراً عبر الواتساب
                    if (client.adminPhone) {
                        await twilioClient.messages.create({
                            messagingServiceSid: MESSAGING_SERVICE_SID,
                            body: `⚠️ تنبيه شكوى: العميل ${lastEval.name} (${lastEval.phone}) قدم ملاحظة سلبية لفرع ${lastEval.branch || 'الرئيسي'}.`,
                            to: `whatsapp:+${normalizePhone(client.adminPhone)}`
                        });
                    }
                }

                if (replyMsg) {
                    await twilioClient.messages.create({
                        messagingServiceSid: MESSAGING_SERVICE_SID,
                        body: replyMsg,
                        to: From
                    });
                    console.log(`✅ تم إرسال الرد الآلي بنجاح إلى ${fullPhone}`);
                }
            }
        }
    } catch (err) { console.error("Webhook Logic Error:", err); }
    res.type('text/xml').send('<Response></Response>');
});

app.get('/api/my-reports', authenticate, async (req, res) => {
    const evals = await db.collection('evaluations').find({ clientId: req.clientData._id }).sort({ sentAt: -1 }).toArray();
    res.json(evals);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); });