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

function getChromePath() {
    if (process.env.NODE_ENV !== 'production') return undefined;
    const baseDir = '/opt/render/project/src/.cache/puppeteer/chrome';
    if (fs.existsSync(baseDir)) {
        const folders = fs.readdirSync(baseDir);
        if (folders.length > 0) {
            const chromePath = path.join(baseDir, folders[0], 'chrome-linux64/chrome');
            if (fs.existsSync(chromePath)) return chromePath;
        }
    }
    return undefined;
}

mongoose.connect(MONGO_URI).then(() => {
    console.log('✅ Connected to MongoDB');
    const store = new MongoStore({ mongoose: mongoose });

    client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 300000, // مزامنة كل 5 دقائق لتقليل الضغط
            clientId: 'main-session' 
        }),
        // إعدادات لتقليل استهلاك الرام ومنع تكرار الأكواد
        authTimeoutMs: 180000, 
        qrMaxRetries: 5,
        puppeteer: {
            headless: true,
            executablePath: getChromePath(),
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process', 
                '--no-zygote',
                '--disable-gpu',
                '--no-first-run',
                '--js-flags="--max-old-space-size=300"' // تقييد المحرك بـ 300MB رام فقط
            ]
        }
    });

    client.on('qr', qr => {
        console.log('🔗 QR CODE RECEIVED:');
        console.log('👉 SCAN HERE: https://api.qrserver.com/v1/create-qr-code/?data=' + encodeURIComponent(qr));
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
        console.log('🚀 WhatsApp Client is Ready!');
        processQueue();
    });

    client.on('remote_session_saved', () => console.log('💾 Session saved!'));

    // الانتظار 15 ثانية كاملة قبل التشغيل لضمان استقرار البيئة
    setTimeout(() => {
        console.log('🚀 Initializing WhatsApp...');
        client.initialize().catch(err => console.error('❌ Init Error:', err));
    }, 15000);

}).catch(err => console.error('❌ MongoDB Error:', err));

async function processQueue() {
    if (isProcessing || messageQueue.length === 0) return;
    if (!client || !client.pupPage || client.pupPage.isClosed()) {
        setTimeout(processQueue, 5000);
        return;
    }

    isProcessing = true;
    const { phone, message } = messageQueue.shift();

    try {
        const cleanNumber = phone.replace(/\D/g, '');
        const chatId = `${cleanNumber}@c.us`;
        const state = await client.getState().catch(() => 'DISCONNECTED');
        
        if (state === 'CONNECTED') {
            await client.sendMessage(chatId, message);
            console.log(`✅ Sent to ${cleanNumber}`);
        } else {
            console.log('⚠️ Client not connected, re-queuing...');
            messageQueue.unshift({ phone, message });
        }
    } catch (err) {
        console.error('❌ Send Error:', err.message);
        messageQueue.unshift({ phone, message });
    }

    // تأخير آمن بين الرسائل (20 ثانية)
    setTimeout(() => {
        isProcessing = false;
        processQueue();
    }, 20000);
}

app.post('/api/webhooks/foodics', (req, res) => {
    const { payload } = req.body;
    if (payload?.customer?.phone) {
        let phone = payload.customer.phone.replace(/\D/g, '');
        if (phone.startsWith('05')) phone = '966' + phone.substring(1);
        else if (phone.startsWith('5')) phone = '966' + phone;
        
        messageQueue.push({ 
            phone, 
            message: `مرحباً ${payload.customer.name} 👋\nشكراً لطلبك من مطعمنا! نتشرف بتقييمك لنا: https://google.com/review` 
        });
        processQueue();
        res.status(200).json({ status: 'queued' });
    } else {
        res.status(400).json({ status: 'invalid_phone' });
    }
});

app.get('/health', async (req, res) => {
    const state = client ? await client.getState().catch(() => 'OFFLINE') : 'NOT_INIT';
    res.json({ status: 'active', whatsapp_state: state, queue_length: messageQueue.length });
});

app.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));