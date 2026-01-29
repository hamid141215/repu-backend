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

const authenticate = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!apiKey) return res.status(401).json({ error: "Missing API Key" });
    const client = await db.collection('clients').findOne({ apiKey });
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

// --- المسارات ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/reports', (req, res) => res.sendFile(path.join(__dirname, 'reports.html')));
app.get('/super-admin', (req, res) => res.sendFile(path.join(__dirname, 'super-admin.html')));

app.post('/api/send', authenticate, async (req, res) => {
    const { phone, name, branch, delayMinutes } = req.body;
    const cleanPhone = normalizePhone(phone);
    const delay = parseInt(delayMinutes) || 0;

    try {
        const randomWait = Math.floor(Math.random() * (4000 - 1000 + 1)) + 1000;
        await sleep(randomWait);

        const messageOptions = {
            messagingServiceSid: MESSAGING_SERVICE_SID,
            to: `whatsapp:+${cleanPhone}`,
            // تأكد من تحديث هذا الـ SID في تويليو ليقبل الأزرار
            contentSid: 'HXfac5e63d161f07e3ebc652a9931ce1c2', 
            contentVariables: JSON.stringify({ 
                "1": String(name).trim(),                  
                "2": String(req.clientData.name).trim()    
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
        res.status(500).json({ error: e.message }); 
    }
});

// --- الويب هوك المحدث (NFC + Buttons) ---
app.post('/whatsapp/webhook', async (req, res) => {
    const { Body, From, ButtonText, ButtonPayload } = req.body;
    const customerAnswer = (ButtonText || Body || "").trim();
    const fullPhone = From.replace('whatsapp:+', '');

    try {
        // البحث عن آخر عملية إرسال لهذا الرقم
        const lastEval = await db.collection('evaluations').findOne({ phone: fullPhone }, { sort: { sentAt: -1 } });
        
        // إذا مسح العميل NFC وأرسل كلمة "تقييم"
        if (customerAnswer === "تقييم") {
            // ملاحظة: هنا نحتاج لتحديد المقهى، سنفترض آخر مقهى تم التعامل معه أو إضافة منطق لجلب العميل بناءً على الرقم
            const client = lastEval ? await db.collection('clients').findOne({ _id: lastEval.clientId }) : null;
            if (client) {
                await twilioClient.messages.create({
                    messagingServiceSid: MESSAGING_SERVICE_SID,
                    to: From,
                    contentSid: 'HXfac5e63d161f07e3ebc652a9931ce1c2',
                    contentVariables: JSON.stringify({ "1": "عزيزنا", "2": client.name })
                });
            }
            return res.type('text/xml').send('<Response></Response>');
        }

        if (lastEval) {
            const client = await db.collection('clients').findOne({ _id: lastEval.clientId });
            if (client) {
                let replyMsg = "";
                
                // معالجة ضغطة زر "ممتاز جداً" أو إرسال رقم 1
                if (customerAnswer === "ممتاز جداً 😍" || customerAnswer === "1" || customerAnswer === "Excellent_Feedback") {
                    replyMsg = `شكراً لتقييمك لـ ${client.name}! 😍 قيمنا على جوجل عبر الرابط التالي: ${client.googleLink}`;
                    await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'replied', answer: '1' } });
                } 
                // معالجة ضغطة زر "لدي ملاحظة" أو إرسال رقم 2
                else if (customerAnswer === "لدى ملاحظة 📝" || customerAnswer === "2" || customerAnswer === "Complaint_Feedback") {
                    replyMsg = `نعتذر منك 😔، تم إرسال ملاحظتك لإدارة ${client.name} فوراً لتحسين تجربتك القادمة.`;
                    await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'complaint', answer: '2' } });

                    if (client.adminPhone) {
                        try {
                            await twilioClient.messages.create({
                                from: MESSAGING_SERVICE_SID,
                                to: `whatsapp:+${normalizePhone(client.adminPhone)}`,
                                contentSid: 'HX0820f9b7ac928e159b018b2c0e905566',
                                contentVariables: JSON.stringify({
                                    "1": lastEval.name || "عميل NFC",
                                    "2": lastEval.branch || 'الرئيسي',
                                    "3": fullPhone
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

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); });