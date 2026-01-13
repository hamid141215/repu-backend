if (!globalThis.crypto) { globalThis.crypto = require('crypto').webcrypto; }
require('dotenv').config();
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());

const SESSION_PATH = 'auth_new_session';
let sock = null, isReady = false, lastQR = null;

// --- MongoDB Setup ---
const { MongoClient } = require('mongodb');
const MONGO_URL = process.env.MONGO_URL;
let client = null, dbConnected = false;

const initMongo = async () => {
    try {
        client = new MongoClient(MONGO_URL);
        await client.connect();
        dbConnected = true;
        console.log("🔗 MongoDB Connected.");
    } catch (e) { console.error("❌ MongoDB Fail"); }
};

async function syncSession() {
    if (!dbConnected) return;
    const credsPath = path.join(SESSION_PATH, 'creds.json');
    if (fs.existsSync(credsPath)) {
        const data = fs.readFileSync(credsPath, 'utf-8');
        await client.db('whatsapp_bot').collection('session').updateOne({ _id: 'creds' }, { $set: { data } }, { upsert: true });
    }
}
async function restoreSession() {
    if (!dbConnected) return;
    const res = await client.db('whatsapp_bot').collection('session').findOne({ _id: 'creds' });
    if (res) {
        if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });
        fs.writeFileSync(path.join(SESSION_PATH, 'creds.json'), res.data);
    }
}

// --- WhatsApp Logic ---
async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = await import('@whiskeysockets/baileys');
    await restoreSession();
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);

    sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'error' }),
        browser: Browsers.macOS('Desktop'),
        printQRInTerminal: false,
        shouldSyncHistoryMessage: () => false
    });

    sock.ev.on('creds.update', async () => { await saveCreds(); await syncSession(); });

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        
        // تحديث الباركود فوراً في حال صدوره
        if (qr) {
            lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
            console.log("🚀 New QR Generated");
        }
        
        if (connection === 'open') {
            isReady = true;
            lastQR = null;
            console.log("✅ Ready.");
        }

        if (connection === 'close') {
            isReady = false;
            const code = lastDisconnect?.error?.output?.statusCode;
            // إذا كان الخطأ تعارض أو انتهاء جلسة، نصفر المجلد المحلي ونحاول من جديد
            if (code === DisconnectReason.loggedOut || code === 401 || code === 409) {
                console.log("⚠️ Refreshing session to force new QR...");
                fs.rmSync(SESSION_PATH, { recursive: true, force: true });
                if(dbConnected) client.db('whatsapp_bot').collection('session').deleteOne({ _id: 'creds' });
            }
            setTimeout(connectToWhatsApp, 5000);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.fromMe) return;
            const phone = msg.key.remoteJid.split('@')[0];
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

            if (text === "1" || text === "2") {
                const s = dbConnected ? await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' }) : null;
                const config = s || { googleLink: "#", discountCode: "OFFER10" };
                
                if (dbConnected) {
                    await client.db('whatsapp_bot').collection('evaluations').updateOne(
                        { phone: phone, status: 'sent' },
                        { $set: { status: 'replied', answer: text, repliedAt: new Date() } },
                        { sort: { sentAt: -1 } }
                    );
                }
                const reply = text === "1" ? `يسعدنا تقييمك! 😍\n📍 ${config.googleLink}` : `نعتذر منك 😔\n🎫 كود الخصم: ${config.discountCode}`;
                await sock.sendMessage(msg.key.remoteJid, { text: reply });
            }
        } catch (e) { console.log("🛡️ Decryption Skip"); }
    });
}

// --- UI: Landing Page ---
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>موجة الصمت</title><script src="https://cdn.tailwindcss.com"></script><style>body{font-family:'Cairo',sans-serif;}</style></head><body><nav class="p-6 flex justify-between items-center max-w-6xl mx-auto"><h1 class="text-2xl font-black italic">MAWJAT <span class="text-blue-600 font-normal">ALSAMT</span></h1><a href="/admin" class="bg-gray-100 px-5 py-2 rounded-full font-bold text-sm">دخول العملاء</a></nav><header class="py-20 text-center px-4"><h2 class="text-5xl md:text-7xl font-black mb-6 leading-tight">سيطر على سمعة مطعمك <br><span class="text-blue-600">بصمت واحترافية</span></h2><p class="text-xl text-gray-500 max-w-2xl mx-auto mb-10">حوّل تجارب عملائك إلى تقييمات 5 نجوم على جوجل ماب، واستقبل الشكاوى داخلياً قبل أن يراها الجميع.</p><a href="/admin" class="bg-blue-600 text-white px-8 py-4 rounded-2xl font-bold text-lg shadow-xl shadow-blue-100">ابدأ الآن</a></header></body></html>`);
});

// --- UI: Admin Dashboard ---
app.get('/admin', async (req, res) => {
    const s = dbConnected ? await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' }) : { googleLink: "#", discountCode: "OFFER10", delay: 0 };
    const evals = dbConnected ? await client.db('whatsapp_bot').collection('evaluations').find().sort({ sentAt: -1 }).limit(10).toArray() : [];

    res.send(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>لوحة التحكم</title><script src="https://cdn.tailwindcss.com"></script><style>body{font-family:'Cairo',sans-serif;background-color:#f8fafc;}</style></head><body class="p-4 md:p-8"><div class="max-w-5xl mx-auto space-y-8 text-right">
        <header class="flex justify-between items-center">
            <h1 class="text-2xl font-black italic uppercase">MAWJAT <span class="text-blue-600">ALSAMT</span></h1>
            <div class="bg-white px-5 py-2 rounded-2xl border text-[10px] font-bold flex items-center gap-2">
                <div class="w-2 h-2 rounded-full ${isReady ? 'bg-green-500 animate-pulse' : 'bg-red-500'}"></div>
                ${isReady ? 'CONNECTED' : 'WAITING FOR QR'}
            </div>
        </header>

        <div class="grid md:grid-cols-2 gap-8">
            <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border text-center space-y-4">
                <h3 class="font-bold text-blue-600 italic">📥 إرسال تقييم جديد</h3>
                <input id="p" placeholder="رقم الجوال 05xxxxxxxx" class="w-full p-4 bg-gray-50 rounded-2xl border font-bold text-center outline-none">
                <input id="n" placeholder="اسم العميل" class="w-full p-4 bg-gray-50 rounded-2xl border font-bold text-center outline-none">
                <button onclick="send()" id="sb" class="w-full bg-blue-600 text-white p-4 rounded-2xl font-bold shadow-lg">إرسال الآن</button>
            </div>
            <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border text-center space-y-4 text-right">
                <h3 class="font-bold text-green-600 italic">⚙️ الإعدادات</h3>
                <input id="gl" value="${s.googleLink}" class="w-full p-3 bg-gray-50 rounded-xl text-[10px] border text-center">
                <div class="flex gap-2">
                    <input id="dc" value="${s.discountCode}" class="w-1/2 p-3 bg-gray-50 rounded-xl text-center font-bold text-blue-600 border">
                    <input id="dl" value="${s.delay}" class="w-1/2 p-3 bg-gray-50 rounded-xl text-center font-bold border">
                </div>
                <button onclick="save()" class="w-full bg-black text-white p-4 rounded-2xl font-bold">حفظ</button>
            </div>
        </div>

        <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border overflow-hidden">
            <h3 class="font-bold mb-6 text-gray-800">📊 تقارير رضا العملاء</h3>
            <div class="overflow-x-auto"><table class="w-full text-right text-sm"><thead><tr class="border-b text-gray-400"><th class="pb-4">العميل</th><th class="pb-4 text-center">الحالة</th><th class="pb-4 text-left">الرد</th></tr></thead><tbody>
            ${evals.map(e => `<tr class="border-b hover:bg-gray-50"><td class="py-4 font-bold text-gray-700">${e.phone}</td><td class="py-4 text-center"><span class="px-2 py-1 rounded-lg text-[10px] font-bold ${e.status === 'replied' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}">${e.status === 'replied' ? 'تم الرد' : 'بانتظار الرد'}</span></td><td class="py-4 font-black text-left ${e.answer === '1' ? 'text-green-500' : 'text-red-500'}">${e.answer ? (e.answer === '1' ? 'ممتاز 😍' : 'تحسين 😔') : '-'}</td></tr>`).join('')}
            </tbody></table></div>
        </div>

        <div class="bg-white p-8 rounded-[2.5rem] border-2 border-dashed border-gray-100 flex flex-col items-center justify-center min-h-[200px]">
            ${lastQR ? `<div><img src="${lastQR}" class="mx-auto w-40 rounded-xl shadow-lg border-4 border-white"><p class="text-amber-600 font-bold mt-4 animate-pulse">امسح الكود الآن</p></div>` : isReady ? '<p class="text-green-600 font-black tracking-widest text-lg">System Active ✅</p>' : '<p class="text-gray-400 animate-pulse font-bold text-xs uppercase">Connecting to WhatsApp Cloud...</p>'}
        </div>
    </div>
    <script>
    async function send(){const p=document.getElementById('p').value;const n=document.getElementById('n').value;if(!p)return alert('أدخل الرقم');const res=await fetch('/send-evaluation?key=${process.env.WEBHOOK_KEY}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:p,name:n})});if(res.ok){alert('✅ تم الإرسال');location.reload();}}
    async function save(){const d={googleLink:document.getElementById('gl').value,discountCode:document.getElementById('dc').value,delay:document.getElementById('dl').value};const res=await fetch('/update-settings?key=${process.env.WEBHOOK_KEY}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});if(res.ok)alert('✅ تم الحفظ');}
    </script></body></html>`);
});

// --- API Endpoints ---
app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { phone, name } = req.body;
    if (dbConnected) await client.db('whatsapp_bot').collection('evaluations').insertOne({ phone, status: 'sent', sentAt: new Date() });
    const greetings = [`مرحباً ${name || 'عزيزنا'}، نورتنا اليوم! ✨`,`أهلاً بك ${name || 'يا غالي'}، سعدنا بزيارتك لنا. 😊`,`حيّاك الله ${name || 'عميلنا العزيز'}، نشكرك على اختيارك لنا. 🌸`];
    const randomMsg = greetings[Math.floor(Math.random() * greetings.length)];
    const s = dbConnected ? await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' }) : { delay: 0 };
    setTimeout(async () => {
        if (isReady && sock) {
            let p = phone.replace(/[^0-9]/g, '');
            if (p.startsWith('05')) p = '966' + p.substring(1);
            await sock.sendMessage(p + "@s.whatsapp.net", { text: `${randomMsg}\n\nكيف كانت تجربتك معنا؟\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` });
        }
    }, (parseInt(s.delay) || 0) * 60000 + 2000);
    res.json({ success: true });
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { googleLink, discountCode, delay } = req.body;
    if (dbConnected) await client.db('whatsapp_bot').collection('config').updateOne({ _id: 'global_settings' }, { $set: { googleLink, discountCode, delay: parseInt(delay) || 0 } }, { upsert: true });
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); await connectToWhatsApp(); });