require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const twilio = require('twilio');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// SID الخدمة الموحد (تأكد أنه مرتبط برقمك ومفعل عليه القوالب)
const MESSAGING_SERVICE_SID = 'MG3c5f83c10c1a23b224ec8068c8ddcee7'; 
const BOT_PHONE = '9665XXXXXXXX'; // استبدل X برقم البوت الفعلي بدون +

// --- الدوال المساعدة ---
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
        console.log("🛡️ Mawjat Platform: Database Connected");
    } catch (e) { console.error("DB Connection Error:", e); }
};

// --- الحماية (Middleware) ---
const authenticate = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!apiKey) return res.status(401).json({ error: "Missing API Key" });
    const client = await db.collection('clients').findOne({ apiKey });
    if (!client) return res.status(403).json({ error: "Invalid API Key" });
    req.clientData = client;
    next();
};

const superAdminAuth = (req, res, next) => {
    if (req.headers['x-admin-password'] !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
};

// --- مسارات الصفحات ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/reports', (req, res) => res.sendFile(path.join(__dirname, 'reports.html')));
app.get('/super-admin', (req, res) => res.sendFile(path.join(__dirname, 'super-admin.html')));

// --- السوبر أدمن: جلب المنشآت وروابط NFC ---
app.get('/api/super-admin/clients', superAdminAuth, async (req, res) => {
    const clients = await db.collection('clients').find().toArray();
    const formatted = clients.map(c => ({
        ...c,
        nfcLink: `https://wa.me/${BOT_PHONE}?text=تقييم_${c.apiKey}`
    }));
    res.json(formatted);
});

// --- العميل: إرسال يدوي من لوحة التحكم ---
app.post('/api/send', authenticate, async (req, res) => {
    const { phone, name, branch } = req.body;
    const cleanPhone = normalizePhone(phone);
    try {
        await twilioClient.messages.create({
            messagingServiceSid: MESSAGING_SERVICE_SID,
            to: `whatsapp:+${cleanPhone}`,
            contentSid: 'HXfac5e63d161f07e3ebc652a9931ce1c2', // قالب الأزرار
            contentVariables: JSON.stringify({ "1": name, "2": req.clientData.name })
        });
        await db.collection('evaluations').insertOne({ 
            clientId: req.clientData._id, phone: cleanPhone, name, branch, status: 'sent', sentAt: new Date() 
        });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- الويب هوك الشامل (NFC + أزرار + تنبيهات) ---

app.post('/whatsapp/webhook', async (req, res) => {
    const { Body, From, ButtonPayload } = req.body;
    const incomingText = Body ? Body.trim() : "";
    const phone = From.replace('whatsapp:+', '');

    try {
        // 1. معالجة مسح NFC (التنسيق المتوقع: تقييم_اسم_المنشأة_ID)
        if (incomingText.startsWith("تقييم_")) {
            // استخراج الـ nfcId من آخر النص (مثلاً من: تقييم_مطعم_البيت_101 يأخذ 101)
            const parts = incomingText.split('_');
            const nfcId = parts[parts.length - 1]; 

            // البحث عن المنشأة باستخدام الـ nfcId بدلاً من الـ apiKey
            const client = await db.collection('clients').findOne({ nfcId: nfcId });
            
            if (client) {
                await twilioClient.messages.create({
                    messagingServiceSid: MESSAGING_SERVICE_SID,
                    to: From,
                    contentSid: 'HXfac5e63d161f07e3ebc652a9931ce1c2',
                    contentVariables: JSON.stringify({ 
                        "1": "عزيزنا", 
                        "2": client.name 
                    })
                });
                
                // تسجيل العملية وربطها بالمنشأة (status: pending)
                await db.collection('evaluations').insertOne({ 
                    clientId: client._id, 
                    phone, 
                    name: "عميل NFC", 
                    status: 'pending', 
                    sentAt: new Date() 
                });
            } else {
                console.error("❌ NFC ID not found in database:", nfcId);
            }
            return res.status(200).end();
        }

        // 2. معالجة الردود (أزرار أو نص)
        // نبحث عن آخر تقييم مرسل لهذا الرقم لربط الرد بالمنشأة الصحيحة
        const lastEval = await db.collection('evaluations').findOne({ phone }, { sort: { sentAt: -1 } });
        
        if (lastEval) {
            const client = await db.collection('clients').findOne({ _id: lastEval.clientId });
            if (!client) return res.status(200).end();

            // حالة العميل ضغط "ممتاز جداً"
            if (incomingText.includes("ممتاز") || ButtonPayload === "Excellent_Feedback" || incomingText === "1") {
                await twilioClient.messages.create({
                    messagingServiceSid: MESSAGING_SERVICE_SID,
                    to: From,
                    body: `شكراً لك! 😍 يسعدنا تقييمك لـ ${client.name} على جوجل ماب عبر الرابط التالي: ${client.googleLink}`
                });
                await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'replied', answer: '5' } });
            } 
            // حالة العميل ضغط "لدى ملاحظة"
            else if (incomingText.includes("ملاحظة") || ButtonPayload === "Complaint_Feedback" || incomingText === "2") {
                await twilioClient.messages.create({
                    messagingServiceSid: MESSAGING_SERVICE_SID,
                    to: From,
                    body: `نعتذر منك 😔، تم إرسال ملاحظتك لإدارة ${client.name} فوراً لتحسين خدمتنا.`
                });
                // تحديث الحالة لـ complaint ليظهر التنبيه الأحمر في لوحة التحكم
                await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'complaint', answer: '1' } });

                // تنبيه المدير فوراً عبر الواتساب
                if (client.adminPhone) {
                    try {
                        await twilioClient.messages.create({
                            messagingServiceSid: MESSAGING_SERVICE_SID,
                            to: `whatsapp:+${normalizePhone(client.adminPhone)}`,
                            body: `⚠️ تنبيه Mawjat: شكوى جديدة من عميل رقم (${phone}) تتبع منشأة (${client.name}). يرجى مراجعة التقارير.`
                        });
                    } catch (twilioErr) {
                        console.error("❌ Failed to notify admin:", twilioErr.message);
                    }
                }
            }
        }
    } catch (err) { 
        console.error("Webhook Error:", err); 
    }
    res.status(200).end();
});

// جلب التقارير للمنشأة
app.get('/api/my-reports', authenticate, async (req, res) => {
    const evals = await db.collection('evaluations').find({ clientId: req.clientData._id }).sort({ sentAt: -1 }).toArray();
    res.json(evals);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); });