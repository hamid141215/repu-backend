require('dotenv').config();
const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs'); // لإدارة الملفات

const app = express();
app.use(express.json());

let sock = null;
let isReady = false;
let lastQR = null;
let isConnecting = false;

async function connectToWhatsApp() {
    if (isConnecting) return;
    isConnecting = true;

    console.log('🔄 STARTING CLEAN SESSION...');
    
    // استخدام اسم مجلد جديد تماماً لتخطي خطأ 405
    const { state, saveCreds } = await useMultiFileAuthState('auth_new_session');

    try {
        sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            // هوية متصفح مختلفة تماماً
            browser: ['Windows', 'Edge', '115.0.1901.183'],
            connectTimeoutMs: 60000,
            printQRInTerminal: false
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}`;
                console.log('✅ NEW QR CREATED');
                isConnecting = false;
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(`⚠️ Closed with status: ${statusCode}`);
                isReady = false;
                isConnecting = false;
                
                // إذا تكرر الخطأ 405، نزيد وقت الانتظار لـ 30 ثانية
                const delay = statusCode === 405 ? 30000 : 10000;
                setTimeout(connectToWhatsApp, delay);
            } else if (connection === 'open') {
                console.log('🚀 CONNECTED SUCCESSFULLY!');
                isReady = true;
                isConnecting = false;
                lastQR = null;
            }
        });
    } catch (err) {
        isConnecting = false;
        setTimeout(connectToWhatsApp, 20000);
    }
}

app.get('/health', (req, res) => {
    if (isReady) return res.send('<h1>✅ Connected!</h1>');
    if (lastQR) return res.send(`<h1>🔗 Scan Now:</h1><img src="${lastQR}" />`);
    res.send('<h1>⏳ Initializing clean session... Refresh in 30s.</h1>');
});

app.listen(process.env.PORT || 10000, () => {
    connectToWhatsApp();
});