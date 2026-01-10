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

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

async function connectToWhatsApp() {
    // استخدام مجلد محلي لتخزين البيانات
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    sock = makeWASocket({
        auth: state,
        // تم حذف سطر printQRInTerminal نهائياً لمنع الرسائل الصفراء
        logger: pino({ level: 'silent' }) 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        // هنا يظهر الرابط الذي تحتاجه
        if (qr) {
            console.log('\n\n=========================================');
            console.log('🔗 SCAN THIS LINK TO CONNECT:');
            console.log(`👉 https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}`);
            console.log('=========================================\n\n');
            
            // نسخة احتياطية للترمبنال لو أحببت
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            isReady = false;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('🚀 WhatsApp IS READY (Clean Logs Edition)!');
            isReady = true;
        }
    });
}

app.post('/api/webhooks/foodics', async (req, res) => {
    const { payload } = req.body;
    if (payload?.customer?.phone && isReady) {
        let phone = payload.customer.phone.replace(/\D/g, '');
        if (phone.startsWith('05')) phone = '966' + phone.substring(1);
        else if (phone.startsWith('5')) phone = '966' + phone;

        const customerName = payload.customer.name;
        const jid = `${phone}@s.whatsapp.net`;
        
        const googleMapLink = "https://g.page/r/YOUR_REVIEWS_LINK/review"; 
        const supportLink = "https://wa.me/9665XXXXXXXX"; 

        const smartMessage = `مرحباً ${customerName} 👋\n\nنشكرك على طلبك! كيف كانت تجربتك؟\n\n✅ راضٍ (جوجل): ${googleMapLink}\n\n❌ ملاحظات (المدير): ${supportLink}`;

        try {
            await sock.sendMessage(jid, { text: smartMessage });
            res.status(200).json({ status: 'sent' });
        } catch (err) {
            res.status(500).json({ status: 'error' });
        }
    } else {
        res.status(400).json({ status: 'not_ready' });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'active', connected: isReady });
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    connectToWhatsApp();
});