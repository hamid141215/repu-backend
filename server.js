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

// دالة العثور على المسار الصحيح للكروم في Render
function getChromePath() {
    if (process.env.NODE_ENV !== 'production') return undefined;
    const baseDir = '/opt/render/project/src/.cache/puppeteer/chrome';
    if (fs.existsSync(baseDir)) {
        const folders = fs.readdirSync(baseDir);
        if (folders.length > 0) {
            return path.join(baseDir, folders[0], 'chrome-linux64/chrome');
        }
    }
    return undefined;
}

// الاتصال بـ MongoDB وتشغيل الواتساب
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
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', qr => {
        console.log('🔗 QR CODE RECEIVED (Scan now):');
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => console.log('🚀 WhatsApp Client is Ready!'));
    
    client.on('remote_session_saved', () => console.log('💾 Session saved to MongoDB!'));

    client.initialize().catch(err => console.error('❌ Init Error:', err));
}).catch(err => console.error('❌ MongoDB Connection Error:', err));

// نظام الطابور لمعالجة الرسائل
async function processQueue() {
    if (isProcessing || messageQueue.length === 0) return;
    isProcessing = true;

    const { phone, message } = messageQueue.shift();
    try {
        const cleanNumber = phone.replace(/\D/g, '');
        const chatId = `${cleanNumber}@c.us`;
        console.log(`📤 Sending to: ${chatId}`);
        await client.sendMessage(chatId, message);
        console.log(`✅ Sent successfully to ${cleanNumber}`);
    } catch (err) {
        console.error('❌ Send Error:', err.message);
    }

    const delay = Math.floor(Math.random() * 5000) + 10000; 
    setTimeout(() => {
        isProcessing = false;
        processQueue();
    }, delay);
}

// استقبال طلبات فودكس
app.post('/api/webhooks/foodics', (req, res) => {
    const { payload } = req.body;
    if (payload?.customer?.phone) {
        let phone = payload.customer.phone.replace(/\D/g, '');
        if (phone.startsWith('05')) phone = '966' + phone.substring(1);
        
        messageQueue.push({ 
            phone, 
            message: `مرحباً ${payload.customer.name} 👋\nشكراً لطلبك! نتشرف بتقييمك لنا هنا: https://google.com/review` 
        });
        processQueue();
        res.status(200).send('Queued');
    } else {
        res.status(400).send('Invalid Phone');
    }
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));