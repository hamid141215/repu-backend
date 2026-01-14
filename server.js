if (!globalThis.crypto) { globalThis.crypto = require('crypto').webcrypto; }
require('dotenv').config();
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());

const SESSION_PATH = 'auth_stable_v103'; 
let sock = null, isReady = false, lastQR = null;

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
    try {
        const credsPath = path.join(SESSION_PATH, 'creds.json');
        if (fs.existsSync(credsPath)) {
            const data = fs.readFileSync(credsPath, 'utf-8');
            await client.db('whatsapp_bot').collection('final_v103').updateOne({ _id: 'creds' }, { $set: { data } }, { upsert: true });
        }
    } catch (e) {}
}

async function restoreSession() {
    if (!dbConnected) return;
    try {
        const res = await client.db('whatsapp_bot').collection('final_v103').findOne({ _id: 'creds' });
        if (res) {
            if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });
            fs.writeFileSync(path.join(SESSION_PATH, 'creds.json'), res.data);
        }
    } catch (e) {}
}

async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await import('@whiskeysockets/baileys');
    await restoreSession();
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

    sock = makeWASocket({
        auth: state, version,
        logger: pino({ level: 'error' }),
        browser: Browsers.ubuntu('Chrome'), 
        printQRInTerminal: false,
        shouldSyncHistoryMessage: () => false
    });

    sock.ev.on('creds.update', async () => { await saveCreds(); await syncSession(); });

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
        if (connection === 'open') { isReady = true; lastQR = null; console.log("✅ LIVE"); }
        if (connection === 'close') {
            isReady = false;
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code === 401 || code === DisconnectReason.loggedOut) {
                fs.rmSync(SESSION_PATH, { recursive: true, force: true });
                if(dbConnected) client.db('whatsapp_bot').collection('final_v103').deleteOne({ _id: 'creds' });
            }
            setTimeout(connectToWhatsApp, 5000);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.fromMe) return;
            
            // تنظيف الرقم القادم من واتساب للبحث عنه بدقة
            const rawPhone = msg.key.remoteJid.split('@')[0];
            const cleanPhone = rawPhone.replace(/\D/g, ''); 
            
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

            if (text === "1" || text === "2") {
                const s = dbConnected ? await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' }) : null;
                const config = s || { googleLink: "#", discountCode: "OFFER10" };
                
                if (dbConnected) {
                    // تحديث السجل باستخدام الرقم المنظف
                    await client.db('whatsapp_bot').collection('evaluations').updateOne(
                        { phone: { $regex: cleanPhone }, status: 'sent' },
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

app.get('/api/status', (req, res) => res.json({ isReady, lastQR }));
app.get('/', (req, res) => res.redirect('/admin'));

app.get('/admin', async (req, res) => {
    const s = dbConnected ? await client.db('whatsapp_bot').collection('config').findOne({ _id: 'global_settings' }) : { googleLink: "#", discountCode: "OFFER10", delay: 0 };
    const evals = dbConnected ? await client.db('whatsapp_bot').collection('evaluations').find().sort({ sentAt: -1 }).limit(10).toArray() : [];
    
    // إنشاء أسطر الجدول بشكل منفصل لمنع تداخل الكود في المتصفح
    const tableRows = evals.map(e => `
        <tr class="border-b hover:bg-gray-50">
            <td class="py-4 font-bold text-gray-700">${e.phone}</td>
            <td class="py-4 text-center">
                <span class="px-2 py-1 rounded-lg text-[10px] font-bold ${e.status === 'replied' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}">
                    ${e.status === 'replied' ? 'تم الرد' : 'بانتظار'}
                </span>
            </td>
            <td class="py-4 font-black text-left ${e.answer === '1' ? 'text-green-500' : 'text-red-500'}">
                ${e.answer ? (e.answer === '1' ? 'ممتاز 😍' : 'تحسين 😔') : '-'}
            </td>
        </tr>
    `).join('');

    res.send(`
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
        <meta charset="UTF-8"><title>لوحة التحكم</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');body{font-family:'Cairo',sans-serif;background-color:#f8fafc;}</style>
    </head>
    <body class="p-4 md:p-8 text-right">
        <div class="max-w-5xl mx-auto space-y-8">
            <header class="flex justify-between items-center">
                <h1 class="text-2xl font-black italic uppercase">MAWJAT <span class="text-blue-600 font-normal">ALSAMT</span></h1>
                <div class="bg-white px-5 py-2 rounded-2xl border text-[10px] font-bold flex items-center gap-2">
                    <div id="dot" class="w-2 h-2 rounded-full bg-red-500"></div>
                    <span id="stat">Checking...</span>
                </div>
            </header>

            <div class="grid md:grid-cols-2 gap-8">
                <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border text-center space-y-4">
                    <h3 class="font-bold text-blue-600">📥 إرسال تقييم</h3>
                    <input id="p" placeholder="05xxxxxxxx" class="w-full p-4 bg-gray-50 rounded-2xl border font-bold text-center outline-none">
                    <button onclick="send()" id="sb" class="w-full bg-blue-600 text-white p-4 rounded-2xl font-bold shadow-lg">إرسال الآن</button>
                </div>
                <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border text-center space-y-4 text-right">
                    <h3 class="font-bold text-green-600 italic">⚙️ الإعدادات</h3>
                    <input id="gl" value="${s.googleLink}" class="w-full p-2 bg-gray-100 rounded-lg text-[10px] text-center outline-none border">
                    <button onclick="save()" class="w-full bg-black text-white p-3 rounded-xl font-bold">حفظ</button>
                </div>
            </div>

            <div id="qrc" class="bg-white p-8 rounded-[2.5rem] border-2 border-dashed flex items-center justify-center min-h-[250px]">
                <p class="animate-pulse">Loading QR...</p>
            </div>

            <div class="bg-white p-8 rounded-[2.5rem] shadow-sm border overflow-hidden">
                <h3 class="font-bold mb-6 text-gray-800">📊 التقرير المباشر</h3>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead><tr class="border-b text-gray-400"><th class="pb-4">العميل</th><th class="pb-4 text-center">الحالة</th><th class="pb-4 text-left">الرد</th></tr></thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </div>
            </div>
        </div>
        <script>
            async function chk(){
                const r=await fetch('/api/status'); const d=await r.json();
                const o=document.getElementById('dot'); const t=document.getElementById('stat'); const q=document.getElementById('qrc');
                if(d.isReady){
                    o.className='w-2 h-2 rounded-full bg-green-500 animate-pulse'; t.innerText='متصل';
                    q.innerHTML='<p class="text-green-600 font-bold text-lg">System Active ✅</p>';
                } else if(d.lastQR){
                    o.className='w-2 h-2 rounded-full bg-amber-500'; t.innerText='بانتظار المسح';
                    q.innerHTML='<div><img src="'+d.lastQR+'" class="mx-auto w-44 rounded-xl shadow-2xl border-4 border-white"></div>';
                }
            }
            setInterval(chk, 3000);
            async function send(){
                const p=document.getElementById('p').value; if(!p)return alert('أدخل الرقم');
                const res=await fetch('/send-evaluation?key=${process.env.WEBHOOK_KEY}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:p})});
                if(res.ok){alert('✅ تم الإرسال');location.reload();}
            }
            async function save(){
                const d={googleLink:document.getElementById('gl').value};
                const res=await fetch('/update-settings?key=${process.env.WEBHOOK_KEY}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
                if(res.ok)alert('✅ تم الحفظ');
            }
        </script>
    </body>
    </html>
    `);
});

app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { phone } = req.body;
    let p = phone.replace(/\D/g, ''); 
    if (p.startsWith('05')) p = '966' + p.substring(1);
    if (dbConnected) await client.db('whatsapp_bot').collection('evaluations').insertOne({ phone: p, status: 'sent', sentAt: new Date() });
    
    setTimeout(async () => {
        if (isReady && sock) {
            await sock.sendMessage(p + "@s.whatsapp.net", { text: "مرحباً بك! ✨ كيف كانت تجربتك معنا؟\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين" });
        }
    }, 2000);
    res.json({ success: true });
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== process.env.WEBHOOK_KEY) return res.sendStatus(401);
    const { googleLink } = req.body;
    if (dbConnected) await client.db('whatsapp_bot').collection('config').updateOne({ _id: 'global_settings' }, { $set: { googleLink } }, { upsert: true });
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); await connectToWhatsApp(); });