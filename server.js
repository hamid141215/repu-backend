require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');
const twilio = require('twilio');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const twilioClient = new twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const CONFIG = {
    mongoUrl: process.env.MONGO_URL,
    webhookKey: process.env.WEBHOOK_KEY,
    twilioNumber: process.env.TWILIO_PHONE_NUMBER,
    googleLink: process.env.Maps_LINK || "#",
    adminPhone: process.env.MANAGER_PHONE,
    branches: ['فرع الرياض', 'فرع جدة', 'فرع الدمام', 'فرع مكة']
};

let db;
const initMongo = async () => {
    try {
        const client = new MongoClient(CONFIG.mongoUrl);
        await client.connect();
        db = client.db('whatsapp_bot');
        console.log("🔗 MongoDB Connected");
    } catch (e) { 
        console.error("Mongo Error:", e.message);
        setTimeout(initMongo, 5000); 
    }
};

// عرض لوحة التحكم
app.get('/', async (req, res) => {
    try {
        const total = await db.collection('evaluations').countDocuments();
        let html = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
        const branchesHtml = CONFIG.branches.map(b => `<option value="${b}">${b}</option>`).join('');
        html = html.replace(/{{total}}/g, total)
                   .replace(/{{webhookKey}}/g, CONFIG.webhookKey)
                   .replace(/{{branches}}/g, branchesHtml);
        res.send(html);
    } catch (e) {
        res.sendFile(path.join(__dirname, 'admin.html'));
    }
});

// مسار التقارير الشاملة
app.get('/reports/all', async (req, res) => {
    try {
        const allEvals = await db.collection('evaluations').find({ status: "replied" }).sort({ repliedAt: -1 }).toArray();
        let tableRows = allEvals.map(e => {
            const isPos = e.answer === "1";
            const rowBg = isPos ? "#e6fffa" : "#fff5f5";
            return `<tr style="background:${rowBg}; border-bottom:1px solid #ddd;">
                <td style="padding:12px;">${e.name}</td>
                <td style="padding:12px;">${e.phone}</td>
                <td style="padding:12px;">${e.branch}</td>
                <td style="padding:12px; text-align:center;">
                    <span style="background:${isPos ? '#38a169' : '#e53e3e'}; color:white; padding:4px 8px; border-radius:8px; font-size:12px;">
                        ${isPos ? 'ممتاز (1)' : 'يحتاج تحسين (2)'}
                    </span>
                </td>
                <td style="padding:12px;">${new Date(e.repliedAt).toLocaleString('ar-SA')}</td>
            </tr>`;
        }).join('');

        res.send(`
            <div dir="rtl" style="font-family:sans-serif; padding:20px; max-width:1000px; margin:auto;">
                <h2 style="border-bottom:2px solid #333; padding-bottom:10px;">📊 تقرير تقييمات Mawjat Analytics</h2>
                <table style="width:100%; border-collapse:collapse; margin-top:20px;">
                    <thead style="background:#333; color:white;">
                        <tr><th>الاسم</th><th>الجوال</th><th>الفرع</th><th>التقييم</th><th>التاريخ</th></tr>
                    </thead>
                    <tbody>${tableRows}</tbody>
                </table>
                <div style="margin-top:20px; text-align:center;">
                    <button onclick="window.print()" style="padding:10px 20px; cursor:pointer;">طباعة PDF</button>
                    <a href="/" style="margin-right:10px; text-decoration:none; color:blue;">العودة للوحة التحكم</a>
                </div>
            </div>
        `);
    } catch (e) { res.status(500).send("خطأ في جلب البيانات"); }
});

app.post('/api/send', async (req, res) => {
    if (req.query.key !== CONFIG.webhookKey) return res.sendStatus(401);
    let { phone, name, branch } = req.body;
    let p = String(phone).replace(/\D/g, '');
    if (p.startsWith('05')) p = '966' + p.substring(1);
    try {
        await twilioClient.messages.create({
            from: CONFIG.twilioNumber,
            body: `أهلاً بك ${name}، كيف كانت تجربتك في ${branch}؟\n\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين`,
            to: `whatsapp:+${p}`
        });
        await db.collection('evaluations').insertOne({ phone: p, name, branch, status: 'sent', sentAt: new Date() });
        res.json({ success: true });
    } catch (error) { res.status(500).send(error.message); }
});

app.post('/whatsapp/webhook', async (req, res) => {
    const { Body, From } = req.body;
    const customerAnswer = Body ? Body.trim() : "";
    const rawPhone = From ? From.replace('whatsapp:+', '') : "";

    try {
        const lastEval = await db.collection('evaluations').findOne(
            { phone: { $regex: rawPhone.slice(-9) + "$" }, status: 'sent' },
            { sort: { sentAt: -1 } }
        );

        if (!lastEval) {
            res.type('text/xml');
            return res.send('<Response></Response>');
        }

        let replyMsg = "";
        let isNegative = false;

        if (customerAnswer === "1") {
            replyMsg = `يسعدنا تقييمك! 😍\n📍 يرجى إضافة تقييمك هنا: ${CONFIG.googleLink}`;
            await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'replied', answer: '1', repliedAt: new Date() } });
        } else if (customerAnswer === "2") {
            replyMsg = `نعتذر منك 😔، تم إرسال ملاحظتك للإدارة وسيتم التواصل معك قريباً.`;
            isNegative = true;
            await db.collection('evaluations').updateOne({ _id: lastEval._id }, { $set: { status: 'replied', answer: '2', repliedAt: new Date() } });
        }

        if (replyMsg) {
            await twilioClient.messages.create({ from: CONFIG.twilioNumber, body: replyMsg, to: From });
            if (isNegative && CONFIG.adminPhone) {
                const waLink = `https://wa.me/${rawPhone}`;
                let adminNum = CONFIG.adminPhone.startsWith('whatsapp:') ? CONFIG.adminPhone : `whatsapp:${CONFIG.adminPhone}`;
                await twilioClient.messages.create({
                    from: CONFIG.twilioNumber,
                    body: `⚠️ *تنبيه تقييم سلبي!*\n\n*العميل:* ${lastEval.name}\n*الفرع:* ${lastEval.branch}\n🔗 *للتواصل المباشر:*\n${waLink}`,
                    to: adminNum
                });
            }
        }
    } catch (err) { console.error("Webhook Error:", err.message); }
    res.type('text/xml').send('<Response></Response>');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); });