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

// تحسين العثور على مسار الكروم في بيئة Render
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

// تشغيل النظام بعد التأكد من قاعدة البيانات
mongoose.connect(MONGO_URI).then(() => {
    console.log('✅ Connected to MongoDB');
    const store = new MongoStore({ mongoose: mongoose });

    client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 60000, // مزامنة كل دقيقة لضمان عدم ضياع الجلسة
            clientId: 'main-session' // تثبيت معرف الجلسة
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
                '--disable-gpu'
            ]
        }
    });

    client.on('qr', qr => {
        console.log('🔗 QR CODE RECEIVED - Scan with your phone:');
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
        console.log('🚀 WhatsApp Client is Ready!');
        // البدء في معالجة الطابور بمجرد الجاهزية
        processQueue();
    });

    client.on('remote_session_saved', () => {
        console.log('💾 Session backup saved to MongoDB successfully!');
    });

    client.on('auth_failure', msg => console.error('❌ Auth Failure:', msg));
    
    client.on('disconnected', (reason) => {
        console.log('⚠️ Client was disconnected:', reason);
        // محاولة إعادة التهيئة إذا انقطع الاتصال
        client.initialize();
    });

    client.initialize();
}).catch(err => console.error('❌ MongoDB Connection Error:', err));

// نظام الطابور الذكي
async function processQueue() {
    if (isProcessing || messageQueue.length === 0) return;

    // حماية: التأكد من أن المتصفح جاهز تماماً قبل سحب أي رسالة
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
        
        // التحقق من حالة الاتصال قبل الإرسال
        const state = await client.getState().catch(() => 'DISCONNECTED');
        if (state !== 'CONNECTED') throw new Error('Client not connected');

        await client.sendMessage(chatId, message);
        console.log(`✅ Success: Message sent to ${cleanNumber}`);
        
    } catch (err) {
        console.error('❌ Send Error:', err.message);
        // إعادة الرسالة للطابور في حال فشل الإرسال لسبب مؤقت
        if (err.message.includes('evaluate') || err.message.includes('closed')) {
            messageQueue.unshift({ phone, message });
        }
    }

    // تأخير عشوائي آمن (بين 15 و 25 ثانية)
    const delay = Math.floor(Math.random() * 10000) + 15000;
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
        // تحويل أرقام الجوال السعودية للصيغة الدولية
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

// مسار لفحص حالة البوت (Health Check)
app.get('/health', async (req, res) => {
    const state = client ? await client.getState().catch(() => 'OFFLINE') : 'NOT_INIT';
    res.json({ status: 'active', whatsapp_state: state, queue_length: messageQueue.length });
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));