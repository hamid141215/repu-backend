require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// إعداد عميل الواتساب مع دعم البيئة السحابية
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        // هذا السطر يضمن تشغيل المتصفح سواء كنت على جهازك أو على سيرفر Render
        executablePath: process.env.NODE_ENV === 'production' 
            ? '/opt/render/project/src/.cache/puppeteer/chrome/linux-143.0.7499.169/chrome-linux64/chrome' 
            : undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--no-zygote',
            '--single-process'
        ]
    }
});

// التعامل مع الباركود
client.on('qr', (qr) => {
    console.log('🔗 QR Code Received! Scan this from your Phone:');
    qrcode.generate(qr, { small: true });
});

// رسالة نجاح الاتصال
client.on('ready', () => {
    console.log('✅ WhatsApp is READY! Connected to the cloud.');
});

client.initialize();

app.use(bodyParser.json());

// مسار افتراضي للتأكد من عمل السيرفر
app.get('/', (req, res) => {
    res.send('WhatsApp Bot is Online! 🚀');
});

// استقبال بيانات فودكس
app.post('/api/webhooks/foodics', async (req, res) => {
    console.log('📥 Received data from Foodics');
    try {
        const eventData = req.body;
        const payload = eventData.payload || {};
        const customer = payload.customer || {};
        const customerName = customer.name || 'عميلنا العزيز';
        let phone = customer.phone || null;

        if (phone) {
            phone = phone.replace(/\D/g, '');
            if (phone.startsWith('05')) phone = '966' + phone.substring(1);

            const contact = await client.getNumberId(phone);

            if (contact) {
                const message = `مرحباً ${customerName} 👋\nشكراً لطلبك! نتشرف بتقييمك لنا:\nhttps://google.com/review-link`;
                await client.sendMessage(contact._serialized, message);
                console.log(`✅ Sent to ${phone}`);
            }
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).send('Error');
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server listening on port ${PORT}`);
});