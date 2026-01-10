require('dotenv').config();
const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
let sock;
let isReady = false;

// 1. الاتصال بـ MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// 2. دالة الاتصال بالواتساب (Baileys - Low Memory)
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('🔗 QR CODE RECEIVED:');
            console.log('👉 SCAN THIS LINK: https://api.qrserver.com/v1/create-qr-code/?data=' + encodeURIComponent(qr));
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            isReady = false;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('🚀 WhatsApp IS READY (Smart Filter Active)!');
            isReady = true;
        }
    });
}

// 3. استقبال طلبات فودكس ومعالجة "الفلترة الذكية"
app.post('/api/webhooks/foodics', async (req, res) => {
    const { payload } = req.body;
    
    if (payload?.customer?.phone && isReady) {
        let phone = payload.customer.phone.replace(/\D/g, '');
        if (phone.startsWith('05')) phone = '966' + phone.substring(1);
        else if (phone.startsWith('5')) phone = '966' + phone;

        const customerName = payload.customer.name;
        const jid = `${phone}@s.whatsapp.net`;

        // --- إعدادات الروابط (استبدلها بروابطك الحقيقية) ---
        const googleMapLink = "https://g.page/r/YOUR_REVIEWS_LINK/review"; 
        const supportLink = "https://wa.me/9665XXXXXXXX"; // رقم خدمة العملاء/المدير
        // ----------------------------------------------

        const smartMessage = `مرحباً ${customerName} 👋\n\nنشكرك على طلبك من مطعمنا! نود أن نسألك: كيف كانت تجربتك معنا اليوم؟\n\n✅ إذا كنت راضياً، يسعدنا تقييمك لنا على جوجل: \n${googleMapLink}\n\n❌ إذا كان لديك أي ملاحظات أو لم تكن راضياً، نرجو إبلاغنا مباشرة لنتمكن من خدمتك: \n${supportLink}`;

        try {
            await sock.sendMessage(jid, { text: smartMessage });
            console.log(`✅ Smart Message sent to ${phone}`);
            res.status(200).json({ status: 'sent' });
        } catch (err) {
            console.error('❌ Send Error:', err);
            res.status(500).json({ status: 'error' });
        }
    } else {
        res.status(400).json({ status: 'failed', reason: 'Client not ready or invalid data' });
    }
});

// 4. فحص الحالة (Health Check)
app.get('/health', (req, res) => {
    res.json({ 
        status: 'active', 
        whatsapp_connected: isReady,
        memory_usage: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    connectToWhatsApp();
});