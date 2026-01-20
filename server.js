require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const twilio = require('twilio');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // مهم جداً لاستقبال بيانات الويب هوك

const twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// توحيد تنسيق الأرقام لضمان الإرسال الصحيح
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

// Middleware الحماية القصوى وعزل البيانات
const authenticate = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!apiKey) return res.status(401).json({ error: "Authentication Required" });

    const client = await db.collection('clients').findOne({ apiKey });
    if (!client) return res.status(403).json({ error: "Invalid Key" });

    // التحقق من تاريخ انتهاء الاشتراك
    if (client.expiryDate && new Date(client.expiryDate) < new Date()) {
        return res.status(402).json({ error: "Subscription Expired" });
    }

    req.clientData = client;
    next();
};

// المسارات الأساسية لفتح الصفحات
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/reports', (req, res) => res.sendFile(path.join(__dirname, 'reports.html')));
app.get('/super-admin', (req, res) => res.sendFile(path.join(__dirname, 'super-admin.html')));

// --- API إدارة المطاعم والموظفين ---

// جلب معلومات العميل وإحصائياته
app.get('/api/client-info', authenticate, async (req, res) => {
    const total = await db.collection('evaluations').countDocuments({ clientId: req.clientData._id });
    res.json({ name: req.clientData.name, total });
});

// إرسال طلب التقييم للعميل
app.post('/api/send', authenticate, async (req, res) => {
    const { phone, name, branch } = req.body;
    const cleanPhone = normalizePhone(phone);
    try {
        await twilioClient.messages.create({
            from: process.env.TWILIO_PHONE_NUMBER,
            body: `أهلاً بك ${name}، كيف كانت تجربتك في ${req.clientData.name} - ${branch}؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين`,
            to: `whatsapp:+${cleanPhone}`
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
        console.error("Twilio Send Error:", e.message);
        res.status(500).json({ error: "فشل إرسال الرسالة، تأكد من إعدادات تويليو" }); 
    }
});

// جلب التقارير المعزولة لكل مطعم
app.get('/api/my-reports', authenticate, async (req, res) => {
    const evals = await db.collection('evaluations')
        .find({ clientId: req.clientData._id })
        .sort({ sentAt: -1 })
        .toArray();
    res.json(evals);
});

// تصدير التقارير بصيغة Excel (CSV) آمنة
app.get('/api/export-excel', authenticate, async (req, res) => {
    try {
        const evals = await db.collection('evaluations')
            .find({ clientId: req.clientData._id })
            .sort({ sentAt: -1 })
            .toArray();

        // إضافة BOM لضمان قراءة اللغة العربية في Excel
        let csv = "\ufeffالعميل,الجوال,الفرع,الرد,التاريخ\n";
        evals.forEach(e => {
            const ans = e.answer === '1' ? 'ممتاز' : e.answer === '2' ? 'سلبي' : 'لم يرد';
            const date = new Date(e.sentAt).toLocaleDateString('ar-SA');
            const safeName = (e.name || '').replace(/,/g, ' ');
            csv += `${safeName},${e.phone},${e.branch || 'الرئيسي'},${ans},${date}\n`;
        });

        // ضبط الـ Headers بدون أحرف عربية لمنع انهيار السيرفر
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=Mawjat_Report.csv');
        return res.status(200).send(csv);
    } catch (e) {
        res.status(500).json({ error: "فشل تصدير الملف" });
    }
});

// --- الجوهر: الويب هوك لاستقبال ردود العملاء ---
app.post('/whatsapp/webhook', async (req, res) => {
    const { Body, From } = req.body;
    const customerAnswer = Body ? Body.trim() : "";
    const fullPhone = From.replace('whatsapp:+', '');

    try {
        // البحث عن آخر رسالة أرسلت لهذا العميل وحالتها "sent"
        const lastEval = await db.collection('evaluations').findOne(
            { phone: fullPhone, status: 'sent' }, 
            { sort: { sentAt: -1 } }
        );

        if (lastEval) {
            const client = await db.collection('clients').findOne({ _id: lastEval.clientId });
            let replyMsg = "";

            if (customerAnswer === "1") {
                replyMsg = `شكراً لتقييمك لـ ${client.name}! 😍\n📍 قيمنا هنا: ${client.googleLink}`;
                await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'replied', answer: '1', repliedAt: new Date() } });
            } else if (customerAnswer === "2") {
                replyMsg = `نعتذر منك 😔، تم استلام ملاحظتك من قبل إدارة ${client.name}.`;
                await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'replied', answer: '2', repliedAt: new Date() } });
                
                // تنبيه المدير الفوري في حال التقييم السلبي
                let adminNum = normalizePhone(client.adminPhone || process.env.MANAGER_PHONE);
                await twilioClient.messages.create({
                    from: process.env.TWILIO_PHONE_NUMBER,
                    body: `⚠️ تنبيه سلبي جديد - ${client.name}\nالعميل: ${lastEval.name}\nالجوال: ${lastEval.phone}`,
                    to: `whatsapp:+${adminNum}`
                });
            }
            
            if (replyMsg) {
                await twilioClient.messages.create({ from: process.env.TWILIO_PHONE_NUMBER, body: replyMsg, to: From });
            }
        }
    } catch (err) { console.error("Webhook Error"); }
    res.type('text/xml').send('<Response></Response>');
});

// --- مسارات السوبر أدمن لإدارة الاشتراكات ---
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