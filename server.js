require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        // هذا المسار خاص ببيئة Render التي أعددناها سابقاً
        executablePath: process.env.NODE_ENV === 'production' 
            ? '/opt/render/project/src/.cache/puppeteer/chrome/linux-143.0.7499.169/chrome-linux64/chrome' 
            : undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-zygote'
        ],
        // حل مشكلة الخطأ: يمنع المتصفح من إغلاق الاتصال بسرعة
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false
    }
});

// عرض الباركود بحجم أكبر لضمان الرؤية في Render
client.on('qr', (qr) => {
    console.log('--- QR CODE START ---');
    qrcode.generate(qr, { small: false });
    console.log('--- QR CODE END ---');
});

client.on('ready', () => {
    console.log('✅ WhatsApp is READY!');
});

// التعامل مع الأخطاء المفاجئة لمنع السيرفر من الانهيار
client.on('auth_failure', msg => console.error('❌ Auth failure', msg));
client.on('disconnected', (reason) => console.log('⚠️ Client was logged out', reason));

client.initialize().catch(err => console.error('❌ Initialization error:', err));

app.use(bodyParser.json());

app.get('/', (req, res) => res.send('Bot Status: Active 🚀'));

app.post('/api/webhooks/foodics', async (req, res) => {
    try {
        const { payload, event } = req.body;
        if (event === 'order.paid' && payload?.customer?.phone) {
            let phone = payload.customer.phone.replace(/\D/g, '');
            if (phone.startsWith('05')) phone = '966' + phone.substring(1);

            const contact = await client.getNumberId(phone);
            if (contact) {
                await client.sendMessage(contact._serialized, `مرحباً ${payload.customer.name || 'عميلنا العزيز'} 👋\nشكراً لزيارتك! نتشرف بتقييمك:\nhttps://google.com/review-link`);
                console.log(`✅ Sent to ${phone}`);
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Webhook Error:', error);
        res.sendStatus(500);
    }
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));