require('dotenv').config();
const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.use(express.json());

let sock = null;
let isReady = false;
let lastQR = null;
let isConnecting = false; // لمنع تكرار محاولات الاتصال

async function connectToWhatsApp() {
    if (isConnecting) return; // إذا كان هناك محاولة اتصال جارية، لا تبدأ واحدة جديدة
    isConnecting = true;

    console.log('🔄 Attempting new clean connection...');
    
    // استخدام مجلد auth_info لتخزين الجلسة
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    try {
        sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            // تغيير المتصفح لتجنب خطأ 405
            browser: ['Mac OS', 'Chrome', '110.0.5481.177'],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 30000
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}`;
                console.log('✅ NEW QR READY - Refresh /health page');
                isConnecting = false; // السماح بالتحديثات القادمة
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log(`⚠️ Connection closed: ${statusCode}`);
                isReady = false;
                isConnecting = false;
                
                // إذا لم يكن تسجيل خروج متعمد، حاول إعادة الاتصال بعد 10 ثوانٍ
                if (statusCode !== DisconnectReason.loggedOut) {
                    console.log('🔄 Retrying in 10 seconds...');
                    setTimeout(connectToWhatsApp, 10000);
                }
            } else if (connection === 'open') {
                console.log('🚀 SUCCESS: WhatsApp Connected!');
                isReady = true;
                isConnecting = false;
                lastQR = null;
            }
        });
    } catch (err) {
        console.error('❌ Connection Error:', err);
        isConnecting = false;
        setTimeout(connectToWhatsApp, 10000);
    }
}

// صفحة الـ Health لإظهار الباركود أو حالة الاتصال
app.get('/health', (req, res) => {
    if (isReady) {
        res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                <h1 style="color:green;">✅ WhatsApp is Connected!</h1>
                <p>The bot is active and ready to send messages.</p>
            </div>
        `);
    } else if (lastQR) {
        res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                <h1>🔗 Scan to Connect:</h1>
                <img src="${lastQR}" style="border:10px solid #f0f0f0; border-radius:10px;" />
                <br><br>
                <p style="color:#666;">Refresh this page if the code expires</p>
            </div>
        `);
    } else {
        res.send(`
            <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
                <h1>⏳ Initializing WhatsApp...</h1>
                <p>Please wait 15 seconds and refresh the page.</p>
                <script>setTimeout(() => { location.reload(); }, 10000);</script>
            </div>
        `);
    }
});

app.listen(process.env.PORT || 10000, () => {
    console.log('🚀 Server is running on port ' + (process.env.PORT || 10000));
    connectToWhatsApp();
});