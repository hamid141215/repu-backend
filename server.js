require('dotenv').config();
const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { MongoClient } = require('mongodb');
const pino = require('pino');
const fs = require('fs');

const app = express();
app.use(express.json());

let sock = null;
let isReady = false;
let lastQR = null;

async function connectToWhatsApp() {
    // 1. إعداد مسار ملفات الجلسة
    const { state, saveCreds } = await useMultiFileAuthState('auth_new_session');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'error' }),
        browser: ['Ubuntu', 'Chrome', '110.0.5481.177'],
        connectTimeoutMs: 60000,
    });

    // حفظ الجلسة محلياً (وفي الخطوة القادمة سنرفعها للسحاب)
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            isReady = false;
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('🚀 تم الاتصال بنجاح!');
            isReady = true;
            lastQR = null;
        }
    });

    // منطق الرد الذكي
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const remoteJid = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

        if (text === '1') {
            await sock.sendMessage(remoteJid, { text: "يسعدنا إعجابك! 😍 كرمًا قيمنا هنا:\n📍 [رابط جوجل ماب]" });
        } else if (text === '2') {
            await sock.sendMessage(remoteJid, { text: "نعتذر منك 😔، سيتم التواصل معك فوراً." });
        }
    });
}

// واجهة الـ Health
app.get('/health', (req, res) => {
    if (isReady) return res.send('<h1>✅ نظام سمعة متصل</h1>');
    if (lastQR) return res.send(`<div style="text-align:center;"><h1>امسح للربط</h1><img src="${lastQR}" /></div>`);
    res.send('<h1>⏳ جاري التجهيز...</h1>');
});

// استقبال فودكس
app.post('/foodics-webhook', async (req, res) => {
    try {
        const { customer, status } = req.body;
        if ((status === 4 || status === 'completed') && customer?.phone) {
            const cleanPhone = customer.phone.replace('+', '').replace(/\s/g, '');
            await sock.sendMessage(`${cleanPhone}@s.whatsapp.net`, { 
                text: `مرحباً ${customer.name || ''}، كيف كانت تجربتك؟\n\n1️⃣ ممتاز\n2️⃣ سيء` 
            });
        }
        res.status(200).send('OK');
    } catch (e) { res.status(500).send(e.message); }
});

app.listen(process.env.PORT || 10000, () => {
    connectToWhatsApp();
});