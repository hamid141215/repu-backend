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
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Ubuntu', 'Chrome', '20.0.04'] // تعريف المتصفح لتسهيل الربط
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}`;
            console.log('🔗 QR CODE UPDATED: ', lastQR);
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            isReady = false;
            if (shouldReconnect) connectToWhatsApp();
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