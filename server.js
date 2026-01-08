require('dotenv').config();
const express = require('express');
const { Client, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 10000;

let client;
let messageQueue = [];
let isProcessing = false;

// دالة ذكية لإيجاد مسار المتصفح تلقائياً في Render
function getChromePath() {
    if (process.env.NODE_ENV !== 'production') return undefined;
    const baseDir = '/opt/render/project/src/.cache/puppeteer/chrome';
    if (fs.existsSync(baseDir)) {
        const versions = fs.readdirSync(baseDir);
        if (versions.length > 0) {
            // يبحث عن ملف chrome داخل أول مجلد إصدار يجده
            return path.join(baseDir, versions[0], 'chrome-linux64/chrome');
        }
    }
    return undefined;
}

// الاتصال بقاعدة البيانات وإعداد الواتساب
mongoose.connect(MONGO_URI).then(() => {
    console.log('✅ Connected to MongoDB');
    const store = new MongoStore({ mongoose: mongoose });

    client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 300000
        }),
        puppeteer: {
            headless: true,
            executablePath: getChromePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        }
    });

    client.on('qr', qr => {
        console.log('🔗 QR CODE RECEIVED:');
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => console.log('🚀 WhatsApp Client is Ready!'));
    client.on('remote_session_saved', () => console.log('💾 Session saved to MongoDB!'));
    
    client.initialize().catch(err => console.error('❌ Initialization error:', err));
});

// نظام الطابور (لمنع الحظر)
async function processQueue() {
    if (isProcessing || messageQueue.length === 0) return;
    isProcessing = true;

    const { phone, message } = messageQueue.shift();
    try {
        const contact = await client.getNumberId(phone);
        if (contact) {
            await client.sendMessage(contact._serialized, message);
            console.log(`✅ Message sent to ${phone}`);
        }
    } catch (err) {
        console.error('❌ Error sending message:', err);
    }

    const delay = Math.floor(Math.random() * 10000) + 15000; // تأخير 15-25 ثانية
    setTimeout(() => {
        isProcessing = false;
        processQueue();
    }, delay);
}

app.post('/api/webhooks/foodics', (req, res) => {
    const { payload } = req.body;
    if (payload?.customer?.phone) {
        let phone = payload.customer.phone.replace(/\D/g, '');
        if (phone.startsWith('05')) phone = '966' + phone.substring(1);

        const message = `مرحباً ${payload.customer.name} 👋\nشكراً لطلبك! نتشرف بتقييمك لنا هنا: https://google.com/review`;
        
        messageQueue.push({ phone, message });
        processQueue();
    }
    res.sendStatus(200);
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));