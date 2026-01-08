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

// دالة ذكية لإيجاد مسار المتصفح تلقائياً في Render لضمان عدم حدوث خطأ Browser not found
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

// الاتصال بـ MongoDB وإعداد الواتساب
mongoose.connect(MONGO_URI).then(() => {
    console.log('✅ Connected to MongoDB');
    const store = new MongoStore({ mongoose: mongoose });

    client = new Client({
        authStrategy: new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 300000 // مزامنة الجلسة كل 5 دقائق
        }),
        puppeteer: {
            headless: true,
            executablePath: getChromePath(),
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox', 
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        }
    });

    client.on('qr', qr => {
        console.log('🔗 QR CODE RECEIVED (Scan now):');
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
        console.log('🚀 WhatsApp Client is Ready and connected to MongoDB!');
    });

    client.on('remote_session_saved', () => {
        console.log('💾 Session backup saved to MongoDB successfully!');
    });

    client.initialize().catch(err => console.error('❌ Initialization error:', err));
});

// نظام الطابور (لمنع حظر الرقم عبر فواصل زمنية عشوائية)
async function processQueue() {
    if (isProcessing || messageQueue.length === 0) return;
    isProcessing = true;

    const { phone, message } = messageQueue.shift();
    try {
        const contact = await client.getNumberId(phone);
        if (contact) {
            await client.sendMessage(contact._serialized, message);
            console.log(`✅ Message sent to ${phone}. Queue left: ${messageQueue.length}`);
        } else {
            console.log(`⚠️ Number ${phone} is not on WhatsApp.`);
        }
    } catch (err) {
        console.error('❌ Error sending message:', err);
    }

    // تأخير بشري عشوائي (بين 15 و 25 ثانية) لمحاكاة السلوك البشري
    const delay = Math.floor(Math.random() * 10000) + 15000;
    setTimeout(() => {
        isProcessing = false;
        processQueue();
    }, delay);
}

// مسار استقبال الويب هوك (تم إعداده للتجربة بدون حساب فودكس حالياً)
app.post('/api/webhooks/foodics', (req, res) => {
    console.log('📥 Incoming Request:', JSON.stringify(req.body));
    
    const { payload } = req.body;
    
    if (payload?.customer?.phone) {
        let phone = payload.customer.phone.replace(/\D/g, '');
        // تحويل الرقم للصيغة الدولية السعودية
        if (phone.startsWith('05')) phone = '966' + phone.substring(1);
        if (phone.startsWith('5')) phone = '966' + phone;

        const customerName = payload.customer.name || 'عميلنا العزيز';
        const message = `مرحباً ${customerName} 👋\nشكراً لطلبك من مطعمنا! نتشرف بتقييمك لنا هنا: https://google.com/review`;
        
        messageQueue.push({ phone, message });
        processQueue();
        res.status(200).send('Message queued successfully');
    } else {
        res.status(400).send('Invalid data: No phone number found');
    }
});

app.get('/', (req, res) => res.send('WhatsApp Bot is Active! 🚀'));

app.listen(PORT, () => console.log(`🚀 Server listening on port ${PORT}`));