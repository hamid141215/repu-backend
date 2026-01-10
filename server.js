require('dotenv').config();
const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

const app = express();
app.use(express.json());

let sock;
let isReady = false;
let lastQR = null; // تخزين آخر كود لتظهره في المتصفح

async function connectToWhatsApp() {
    console.log('🔄 Starting WhatsApp connection...');
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        connectTimeoutMs: 60000, // زيادة وقت الانتظار لـ 60 ثانية
        defaultQueryTimeoutMs: 0
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}`;
            console.log('✅ QR Code generated successfully!');
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`⚠️ Connection closed (Status: ${statusCode}). Reconnecting: ${shouldReconnect}`);
            isReady = false;
            if (shouldReconnect) setTimeout(connectToWhatsApp, 5000); // إعادة محاولة بعد 5 ثوانٍ
        } else if (connection === 'open') {
            console.log('🚀 WhatsApp CONNECTED!');
            isReady = true;
            lastQR = null;
        }
    });
}

// تعديل صفحة الـ Health لتظهر لك الرابط مباشرة
app.get('/health', (req, res) => {
    if (isReady) {
        res.send('<h1>✅ WhatsApp is Connected!</h1>');
    } else if (lastQR) {
        res.send(`<h1>🔗 Scan to Connect:</h1><img src="${lastQR}" /><br><p>${lastQR}</p>`);
    } else {
        res.send('<h1>⏳ Loading WhatsApp... Please refresh in 10 seconds.</h1>');
    }
});

app.listen(process.env.PORT || 10000, () => {
    console.log('🚀 Server is running');
    connectToWhatsApp();
});