require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
// Render يخصص المنفذ تلقائياً، وإذا لم يجد يستخدم 10000
const PORT = process.env.PORT || 10000; 

// إعداد عميل الواتساب
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        // هذه الأوامر ضرورية لتشغيل المتصفح داخل سيرفرات Linux (مثل Render)
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

// عرض الباركود في الـ Logs
client.on('qr', (qr) => {
    console.log('🔗 QR Code Received! Scan it now:');
    qrcode.generate(qr, { small: true });
});

// تأكيد الاتصال
client.on('ready', () => {
    console.log('✅ WhatsApp is READY! السيرفر متصل الآن');
});

client.initialize();

app.use(bodyParser.json());

// مسار فحص حالة السيرفر
app.get('/', (req, res) => {
    res.send('WhatsApp Webhook Server is Live! 🚀');
});

// مسار استقبال طلبات فودكس
app.post('/api/webhooks/foodics', async (req, res) => {
    console.log('📥 Webhook received from Foodics...');
    try {
        const eventData = req.body;
        const payload = eventData.payload || {};
        const customer = payload.customer || {};
        const customerName = customer.name || 'عميلنا العزيز';
        let phone = customer.phone || null;

        if (phone) {
            // تنظيف الرقم من أي رموز
            phone = phone.replace(/\D/g, '');
            
            // تحويل الرقم للصيغة الدولية (للسعودية)
            if (phone.startsWith('05')) {
                phone = '966' + phone.substring(1);
            }

            console.log(`🔍 Checking WhatsApp for: ${phone}`);
            const contact = await client.getNumberId(phone);

            if (contact) {
                const message = `مرحباً ${customerName} 👋\nشكراً لزيارتك! نتشرف بسماع رأيك لخدمتك بشكل أفضل في المرة القادمة:\nhttps://google.com/review-link`;
                
                await client.sendMessage(contact._serialized, message);
                console.log(`✅ Message Sent to: ${phone}`);
            } else {
                console.log(`❌ Number not on WhatsApp: ${phone}`);
            }
        } else {
            console.log('⚠️ No phone number in payload.');
        }

        res.status(200).send('Webhook Processed');
    } catch (error) {
        console.error('❌ Error in processing webhook:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server is listening on port ${PORT}`);
});