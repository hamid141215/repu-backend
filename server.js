require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const app = express();
const PORT = process.env.PORT || 10000; // Render يستخدم غالباً المنفذ 10000

// إعداد الواتساب مع إعدادات تناسب السيرفرات السحابية
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
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

client.on('qr', (qr) => {
    console.log('🔗 QR Code Generated! انسخ الكود من الـ Logs وصوره:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ WhatsApp is READY!');
});

client.initialize();

app.use(bodyParser.json());

// مسار لفحص السيرفر (Health Check)
app.get('/', (req, res) => {
    res.send('Server is running perfectly! 🚀');
});

app.post('/api/webhooks/foodics', async (req, res) => {
    console.log('📥 Webhook received from Foodics');
    try {
        const eventData = req.body;
        const payload = eventData.payload || {};
        const customer = payload.customer || {};
        const customerName = customer.name || 'عميلنا العزيز';
        let phone = customer.phone || null;

        if (phone) {
            phone = phone.replace(/\D/g, '');
            if (phone.startsWith('05')) phone = '966' + phone.substring(1);

            console.log(`🔍 Sending message to: ${phone}`);
            const contact = await client.getNumberId(phone);

            if (contact) {
                const message = `مرحباً ${customerName} 👋\nشكراً لطلبك من مطعمنا! نتشرف بتقييمك لنا عبر الرابط:\nhttps://google.com/review-link`;
                await client.sendMessage(contact._serialized, message);
                console.log(`✅ Message Sent to ${phone}`);
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