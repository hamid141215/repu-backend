require('dotenv').config();
const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
app.use(express.json());

let sock = null;
let isReady = false;
let lastQR = null;

async function connectToWhatsApp() {
    console.log("🔄 جاري تنظيف الجلسة وبدء اتصال جديد...");
    
    // جلب أحدث إصدار متوافق مع واتساب لضمان استقرار الربط
    const { version } = await fetchLatestBaileysVersion();
    console.log(`📡 استخدام نسخة واتساب رقم: ${version.join('.')}`);

    const { state, saveCreds } = await useMultiFileAuthState('auth_new_session');

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'error' }),
        // تغيير هوية المتصفح لهوية متوافقة مع الخوادم (Linux)
        browser: ['Ubuntu', 'Chrome', '110.0.5481.177'], 
        printQRInTerminal: false,
        connectTimeoutMs: 120000, // زيادة وقت الانتظار لـ 120 ثانية
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
        generateHighQualityLinkPreview: true,
        // إضافة هذا السطر لحل مشكلة الـ Loop
        getMessage: async (key) => { return { conversation: 'Welcome' } }
    });

    // تحديث ملفات الجلسة عند كل تغيير
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
            console.log('✅ باركود جديد جاهز للمسح في صفحة /health');
        }

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(`⚠️ تم إغلاق الاتصال. إعادة المحاولة: ${shouldReconnect}`);
            isReady = false;
            if (shouldReconnect) setTimeout(connectToWhatsApp, 5000);
        } else if (connection === 'open') {
            console.log('🚀 تم الاتصال بنجاح! نظام سمعة جاهز.');
            isReady = true;
            lastQR = null;
        }
    });

    // استقبال الرسائل (منطق الفلترة الذكية)
    // استقبال الرسائل ومعالجتها (الفلترة الذكية)
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const remoteJid = msg.key.remoteJid;
        
        // استخراج النص وتنظيفه
        let textMessage = msg.message.conversation || 
                          msg.message.extendedTextMessage?.text || "";
        
        textMessage = textMessage.trim();

        console.log(`📩 رسالة مستلمة من [${remoteJid}]: ${textMessage}`);

        // المسار الإيجابي (العميل أرسل رقم 1)
        if (textMessage === '1') {
            await sock.sendMessage(remoteJid, { 
                text: "يسعدنا جداً أن التجربة نالت إعجابك! 😍\n\nممكن تكرماً تدعمنا بتقييمك على جوجل ماب؟ هذا يساعدنا نطور خدماتنا أكثر ونستمر في تقديم الأفضل:\n\n📍 [ضع هنا رابط جوجل ماب الخاص بالمطعم]" 
            });
            console.log(`✅ تم توجيه العميل لتقييم جوجل ماب: ${remoteJid}`);
        } 
        
        // المسار السلبي (العميل أرسل رقم 2)
        else if (textMessage === '2') {
            await sock.sendMessage(remoteJid, { 
                text: "نعتذر منك جداً على هذه التجربة.. 😔\n\nحقك علينا، شكراً لمشاركتنا ملاحظاتك، وسيتم التواصل معك الآن من قبل إدارة المطعم لحل المشكلة فوراً وإرضائك." 
            });
            
            // تنبيه في الـ Logs (يمكنك لاحقاً برمجته ليرسل إشعاراً لجوال المدير)
            console.log(`🚨 تنبيه: عميل غير راضي يحتاج تواصل فوري! الرقم: ${remoteJid}`);
        }
    });
}

// --- قسم مسارات السيرفر (Routes) ---

// 1. واجهة الفحص والربط
app.get('/health', (req, res) => {
    if (isReady) return res.send('<h1 style="color:green; text-align:center; font-family:sans-serif; margin-top:50px;">✅ نظام سمعة متصل الآن!</h1>');
    if (lastQR) return res.send(`<div style="text-align:center; font-family:sans-serif; margin-top:50px;"><h1>🔗 امسح الرمز للربط</h1><img src="${lastQR}" /><p>بعد المسح، انتظر ثواني ثم قم بتحديث الصفحة.</p></div>`);
    res.send('<h1 style="text-align:center; margin-top:50px;">⏳ جاري تجهيز النظام... انتظر 10 ثوانٍ وحدث الصفحة.</h1>');
});

// 2. استقبال بيانات فودكس (Webhook)
app.post('/foodics-webhook', async (req, res) => {
    try {
        const order = req.body;
        // ملاحظة: فودكس ترسل حالة الطلب، الرقم 4 عادةً يعني مكتمل
        if (order.status === 4 || order.status === 'completed') {
            const customerPhone = order.customer?.phone;
            const customerName = order.customer?.name || 'عميلنا العزيز';
            
            if (customerPhone && isReady) {
                // تنظيف الرقم من أي علامات وإضافة صيغة الواتساب
                const cleanPhone = customerPhone.replace('+', '').replace(/\s/g, '');
                const jid = `${cleanPhone}@s.whatsapp.net`;

                console.log(`📦 إرسال طلب تقييم لـ: ${customerName} على الرقم: ${cleanPhone}`);
                
                await sock.sendMessage(jid, { 
                    text: `مرحباً يا ${customerName}! 🌸\n\nشكراً لطلبك من مطعمنا. يهمنا جداً نعرف رأيك في التجربة:\n\n1. تجربة ممتازة 👍\n2. تجربة سيئة 👎` 
                });
            }
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Webhook Error:', error);
        res.status(500).send('Error');
    }
});

// تشغيل السيرفر
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`📡 السيرفر يعمل على منفذ: ${PORT}`);
    connectToWhatsApp();
});