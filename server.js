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

// دالة العثور على مسار الكروم في بيئة Render
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

// الاتصال بـ MongoDB وتشغيل الواتساب
mongoose.connect(MONGO_URI).then(() => {
    console.log('✅ Connected to MongoDB');
    const store = new MongoStore({ mongoose: mongoose });

    client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 60000, 
            clientId: 'main-session' 
        }),
        puppeteer: {
            headless: true,
            executablePath: getChromePath(),
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ],
            handleSIGINT: false,
            handleSIGTERM: false,
            handleSIGHUP: false
        }
    });

    // إعداد مستمعي الأحداث
    client.on('qr', qr => {
        console.log('🔗 QR CODE RECEIVED:');
        // رابط خارجي لمسح الباركود بسهولة
        console.log('👉 Open this link to scan QR: https://api.qrserver.com/v1/create-qr-code/?data=' + encodeURIComponent(qr));
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
        console.log('🚀 WhatsApp Client is Ready!');
        processQueue();
    });

    client.on('remote_session_saved', () => {
        console.log('💾 Session backup saved to MongoDB successfully!');
    });

    client.on('auth_failure', msg => console.error('❌ Auth Failure:', msg));
    
    client.on('disconnected', (reason) => {
        console.log('⚠️ Client was disconnected:', reason);
    });

    // انتظار 5 ثوانٍ لاستقرار النظام قبل التشغيل
    console.log('⏳ Waiting 5 seconds for system stability...');
    setTimeout(() => {
        console.log('🚀 Starting WhatsApp initialization...');
        client.initialize().catch(err => {
            console.error('❌ Initialization Error:', err);
        });
    }, 5000);

}).catch(err => console.error('❌ MongoDB Connection Error:', err));

// نظام الطابور لمعالجة الرسائل وحماية الرقم من الحظر
async function processQueue() {
    if (isProcessing || messageQueue.length === 0) return;

    if (!client || !client.pupPage || client.pupPage.isClosed()) {
        console.log('⏳ Waiting for browser page to be available...');
        setTimeout(processQueue, 5000);
        return;
    }

    isProcessing = true;
    const { phone, message } = messageQueue.shift();

    try {
        const cleanNumber = phone.replace(/\D/g, '');
        const chatId = `${cleanNumber}@c.us`;
        
        console.log(`📤 Attempting to send message to: ${chatId}`);
        
        const state = await client.getState().catch(() => 'DISCONNECTED');
        if (state !== 'CONNECTED') throw new Error('Client not connected');

        await client.sendMessage(chatId, message);
        console.log(`✅ Success: Message sent to ${cleanNumber}`);
        
    } catch (err) {
        console.error('❌ Send Error:', err.message);
        if (err.message.includes('evaluate') || err.message.includes('closed')) {
            messageQueue.unshift({ phone, message });
        }
    }

    const delay = Math.floor(Math.random() * 10000) + 15000;
    setTimeout(() => {
        isProcessing = false;
        processQueue();
    }, delay);
}

// استقبال طلبات فودكس (Webhook)
app.post('/api/webhooks/foodics', (req, res) => {
    const { payload } = req.body;
    
    if (payload?.customer?.phone) {
        let phone = payload.customer.phone.replace(/\D/g, '');
        if (phone.startsWith('05')) phone = '966' + phone.substring(1);
        if (phone.startsWith('5')) phone = '966' + phone;
        
        messageQueue.push({ 
            phone, 
            message: `مرحباً ${payload.customer.name} 👋\nشكراً لطلبك من مطعمنا! نتشرف بتقييمك لنا عبر الرابط: https://google.com/review` 
        });
        
        console.log(`📥 New order added to queue for: ${phone}`);
        processQueue();
        res.status(200).json({ status: 'success', message: 'Message added to queue' });
    } else {
        res.status(400).json({ status: 'error', message: 'Invalid phone number' });
    }
});

// مسار فحص الحالة
app.get('/health', async (req, res) => {
    const state = client ? await client.getState().catch(() => 'OFFLINE') : 'NOT_INIT';
    res.json({ status: 'active', whatsapp_state: state, queue_length: messageQueue.length });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));