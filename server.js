if (!globalThis.crypto) { globalThis.crypto = require('crypto').webcrypto; }
require('dotenv').config();
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());

// --- الإعدادات الفنية ---
const SESSION_PATH = 'auth_stable_v110'; 
const MONGO_URL = process.env.MONGO_URL;
const WEBHOOK_KEY = process.env.WEBHOOK_KEY;

let sock = null, isReady = false, lastQR = null;
let client = null, db = null, dbConnected = false;

// --- منطق قاعدة البيانات ---
const initMongo = async () => {
    try {
        client = new MongoClient(MONGO_URL);
        await client.connect();
        db = client.db('whatsapp_bot');
        dbConnected = true;
        console.log("🔗 MongoDB Connected Successfully.");
    } catch (e) { console.error("❌ MongoDB Fail:", e.message); }
};

async function syncSession() {
    if (!dbConnected) return;
    try {
        const credsPath = path.join(SESSION_PATH, 'creds.json');
        if (fs.existsSync(credsPath)) {
            const data = fs.readFileSync(credsPath, 'utf-8');
            await db.collection('final_v110').updateOne({ _id: 'creds' }, { $set: { data, lastUpdate: new Date() } }, { upsert: true });
        }
    } catch (e) {}
}

async function restoreSession() {
    if (!dbConnected) return;
    try {
        const res = await db.collection('final_v110').findOne({ _id: 'creds' });
        if (res) {
            if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });
            fs.writeFileSync(path.join(SESSION_PATH, 'creds.json'), res.data);
        }
    } catch (e) {}
}

// --- منطق واتساب ---
async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await import('@whiskeysockets/baileys');
    await restoreSession();
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

    sock = makeWASocket({
        auth: state, version,
        logger: pino({ level: 'error' }),
        browser: Browsers.macOS('Desktop'), 
        printQRInTerminal: false,
        keepAliveIntervalMs: 30000,
        shouldSyncHistoryMessage: () => false
    });

    sock.ev.on('creds.update', async () => { await saveCreds(); await syncSession(); });

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) {
            lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
        }
        if (connection === 'open') { isReady = true; lastQR = null; console.log("✅ WhatsApp Live v11"); }
        if (connection === 'close') {
            isReady = false;
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code !== DisconnectReason.loggedOut) setTimeout(connectToWhatsApp, 5000);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.fromMe) return;
            
            const rawPhone = msg.key.remoteJid.split('@')[0];
            const cleanPhone = rawPhone.replace(/\D/g, '');
            const phoneSuffix = cleanPhone.slice(-9); // آخر 9 أرقام للمطابقة المرنة
            
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

            if (text === "1" || text === "2") {
                const s = dbConnected ? await db.collection('config').findOne({ _id: 'global_settings' }) : null;
                const config = s || { googleLink: "#", discountCode: "OFFER10" };
                
                if (dbConnected) {
                    // تحديث الحالة بناءً على آخر طلب أرسل لنفس الرقم (مرونة عالية)
                    await db.collection('evaluations').findOneAndUpdate(
                        { phone: { $regex: phoneSuffix + "$" }, status: 'sent' },
                        { $set: { status: 'replied', answer: text, repliedAt: new Date() } },
                        { sort: { sentAt: -1 } }
                    );
                }
                
                const reply = text === "1" ? `يسعدنا تقييمك! 😍\n📍 ${config.googleLink}` : `نعتذر منك 😔\n🎫 كود الخصم: ${config.discountCode}`;
                await sock.sendMessage(msg.key.remoteJid, { text: reply });
            }
        } catch (e) { console.log("Response Error:", e.message); }
    });
}

// --- مسارات الـ API والواجهة ---
app.get('/api/status', (req, res) => res.json({ isReady, lastQR }));

app.get('/admin', async (req, res) => {
    const s = dbConnected ? await db.collection('config').findOne({ _id: 'global_settings' }) : { googleLink: "#", discountCode: "OFFER10", delay: 0, branches: "الفرع الرئيسي" };
    const evals = dbConnected ? await db.collection('evaluations').find().sort({ sentAt: -1 }).limit(20).toArray() : [];
    const branchList = (s.branches || "الفرع الرئيسي").split(',').map(b => b.trim());

    res.send(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>SaaS موجة الصمت v11</title><script src="https://cdn.tailwindcss.com"></script><style>@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');body{font-family:'Cairo',sans-serif;background-color:#f8fafc;}</style></head>
    <body class="p-4 md:p-8 text-right text-gray-800">
        <div class="max-w-6xl mx-auto space-y-8">
            <header class="flex justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100">
                <div>
                    <h1 class="text-2xl font-black italic tracking-tighter">MAWJAT <span class="text-blue-600 font-normal">ALSAMT</span></h1>
                    <p class="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Multi-Branch Management System</p>
                </div>
                <div class="flex items-center gap-4">
                    <input type="password" id="accessKey" placeholder="مفتاح الوصول" class="text-[10px] p-3 border rounded-2xl outline-none focus:border-blue-500 bg-gray-50">
                    <div class="bg-gray-50 px-4 py-2 rounded-2xl border text-[10px] font-bold flex items-center gap-2">
                        <div id="dot" class="w-3 h-3 rounded-full bg-red-500"></div><span id="stat">Checking...</span>
                    </div>
                </div>
            </header>

            <div class="grid lg:grid-cols-3 gap-8">
                <!-- قسم الإرسال -->
                <div class="lg:col-span-2 bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100 space-y-6">
                    <h3 class="font-black text-blue-600 flex items-center gap-2 italic"><span>📤</span> إرسال طلب تقييم</h3>
                    <div class="grid md:grid-cols-2 gap-4">
                        <div class="space-y-1"><label class="text-[10px] text-gray-400 mr-2 font-bold uppercase">الجوال</label><input id="p" placeholder="05xxxxxxxx" class="w-full p-4 bg-gray-50 rounded-2xl border font-bold text-center outline-none focus:ring-4 ring-blue-50"></div>
                        <div class="space-y-1"><label class="text-[10px] text-gray-400 mr-2 font-bold uppercase">الاسم</label><input id="n" placeholder="اسم العميل" class="w-full p-4 bg-gray-50 rounded-2xl border font-bold text-center outline-none focus:ring-4 ring-blue-50"></div>
                    </div>
                    <div class="space-y-1">
                        <label class="text-[10px] text-gray-400 mr-2 font-bold uppercase">الفرع المستهدف</label>
                        <select id="br" class="w-full p-4 bg-blue-50 text-blue-900 rounded-2xl border border-blue-100 font-bold outline-none cursor-pointer">
                            ${branchList.map(b => `<option value="${b}">${b}</option>`).join('')}
                        </select>
                    </div>
                    <button onclick="send()" id="sb" class="w-full bg-blue-600 text-white p-5 rounded-2xl font-black text-lg hover:bg-blue-700 transition shadow-2xl active:scale-95">إرسال الطلب الآن</button>
                </div>

                <!-- قسم الإعدادات -->
                <div class="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100 space-y-4">
                    <h3 class="font-black text-green-600 flex items-center gap-2 italic"><span>⚙️</span> إعدادات SaaS</h3>
                    <div class="space-y-3">
                        <div><label class="block text-[10px] text-gray-400 mr-2 font-bold">رابط قوقل ماب</label><input id="gl" value="${s.googleLink}" class="w-full p-3 bg-gray-50 rounded-xl text-[12px] border outline-none"></div>
                        <div><label class="block text-[10px] text-gray-400 mr-2 font-bold text-blue-600">إدارة الفروع (افصل بـ ,)</label><input id="bl" value="${s.branches || 'الفرع الرئيسي'}" class="w-full p-3 bg-gray-50 rounded-xl text-[12px] border font-bold text-blue-900 outline-none"></div>
                        <div class="flex gap-2">
                            <div class="w-1/2"><label class="block text-[10px] text-gray-400 mr-2 font-bold">كود الخصم</label><input id="dc" value="${s.discountCode}" class="w-full p-3 bg-gray-50 rounded-xl text-center font-bold text-blue-600 border"></div>
                            <div class="w-1/2"><label class="block text-[10px] text-gray-400 mr-2 font-bold">تأخير (د)</label><input id="dl" value="${s.delay}" class="w-full p-3 bg-gray-50 rounded-xl text-center font-bold border"></div>
                        </div>
                    </div>
                    <button onclick="save()" class="w-full bg-slate-900 text-white p-4 rounded-2xl font-black hover:bg-black transition">تحديث الإعدادات</button>
                </div>
            </div>

            <div id="qrc" class="bg-white p-8 rounded-[3rem] border-2 border-dashed border-blue-100 flex items-center justify-center min-h-[200px]">
                <p class="animate-pulse text-gray-300">جاري استدعاء كود الربط من السيرفر...</p>
            </div>

            <div class="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100 overflow-hidden">
                <h3 class="font-black mb-8 text-slate-800 flex justify-between items-center">📊 سجل المتابعة الذكي <span class="bg-blue-50 text-blue-600 text-[10px] px-4 py-1 rounded-full uppercase">Live Reports</span></h3>
                <div class="overflow-x-auto">
                    <table class="w-full text-right text-sm">
                        <thead><tr class="border-b text-gray-400 uppercase text-[10px] font-black"><th class="pb-4">العميل</th><th class="pb-4">الفرع</th><th class="pb-4 text-center">الحالة</th><th class="pb-4 text-left">النتيجة</th></tr></thead>
                        <tbody>${evals.map(e => `<tr class="border-b hover:bg-gray-50 transition"><td class="py-4 font-bold text-slate-700">${e.phone}<br><span class="text-[8px] font-normal text-gray-400">${new Date(e.sentAt).toLocaleString('ar-SA')}</span></td><td class="py-4 font-bold text-blue-600 text-[11px]">${e.branch || '-'}</td><td class="py-4 text-center"><span class="px-3 py-1 rounded-full text-[9px] font-black ${e.status === 'replied' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}">${e.status === 'replied' ? 'تم الرد' : 'بانتظار'}</span></td><td class="py-4 font-black text-left ${e.answer === '1' ? 'text-green-500' : (e.answer === '2' ? 'text-red-500' : 'text-gray-200')}">${e.answer ? (e.answer === '1' ? 'ممتاز 😍' : 'تحسين 😔') : '-'}</td></tr>`).join('')}</tbody>
                    </table>
                </div>
            </div>
        </div>

        <script>
            document.getElementById('accessKey').value = localStorage.getItem('bot_key') || '';

            async function chk(){
                try {
                    const r = await fetch('/api/status');
                    const d = await r.json();
                    const o = document.getElementById('dot');
                    const t = document.getElementById('stat');
                    const q = document.getElementById('qrc');
                    if(d.isReady){
                        o.className='w-3 h-3 rounded-full bg-green-500 animate-pulse';
                        t.innerText='متصل';
                        q.innerHTML='<div class="text-center"><p class="text-green-600 font-black text-xl italic uppercase">System Online ✅</p><p class="text-gray-400 text-[10px] mt-2 font-bold uppercase">Ready to filter reputation</p></div>';
                    } else if(d.lastQR){
                        o.className='w-3 h-3 rounded-full bg-amber-500';
                        t.innerText='بانتظار المسح';
                        q.innerHTML='<div class="text-center"><p class="text-[9px] font-black mb-4 text-gray-400 uppercase">Scan to sync WhatsApp</p><img src="'+d.lastQR+'" class="mx-auto w-48 rounded-[2rem] shadow-2xl border-4 border-white"></div>';
                    }
                } catch(e){}
            }
            setInterval(chk, 4000); chk();

            async function send(){
                const p = document.getElementById('p').value;
                const n = document.getElementById('n').value;
                const b = document.getElementById('br').value;
                const key = document.getElementById('accessKey').value;
                if(!p || !key) return alert('أدخل الرقم ومفتاح الوصول');
                
                localStorage.setItem('bot_key', key);
                const res = await fetch('/send-evaluation?key=' + key, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({phone: p, name: n, branch: b})
                });
                if(res.ok) { alert('✅ تم الإرسال بنجاح للفرع: ' + b); location.reload(); }
                else alert('❌ خطأ في الصلاحيات');
            }

            async function save(){
                const key = document.getElementById('accessKey').value;
                const d = {
                    googleLink: document.getElementById('gl').value,
                    discountCode: document.getElementById('dc').value,
                    delay: document.getElementById('dl').value,
                    branches: document.getElementById('bl').value
                };
                const res = await fetch('/update-settings?key=' + key, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(d)
                });
                if(res.ok) alert('✅ تم الحفظ وتحديث الفروع');
                else alert('❌ فشل الحفظ');
            }
        </script>
    </body></html>`);
});

app.post('/send-evaluation', async (req, res) => {
    if (req.query.key !== WEBHOOK_KEY) return res.status(401).json({error: 'Unauthorized'});
    const { phone, name, branch } = req.body;
    let p = phone.replace(/\D/g, ''); 
    if (p.startsWith('05')) p = '966' + p.substring(1);
    else if (p.startsWith('5') && p.length === 9) p = '966' + p;

    if (dbConnected) {
        await db.collection('evaluations').insertOne({ 
            phone: p, 
            name, 
            branch: branch || "الفرع الرئيسي",
            status: 'sent', 
            sentAt: new Date() 
        });
    }
    
    const greetings = [`مرحباً ${name || 'عزيزنا'}، نورتنا اليوم! ✨`,`أهلاً بك ${name || 'يا غالي'}، سعدنا بزيارتك لنا. 😊`,`حيّاك الله ${name || 'عميلنا العزيز'}، نشكرك على اختيارك لنا. 🌸`];
    const randomMsg = greetings[Math.floor(Math.random() * greetings.length)];
    const config = dbConnected ? await db.collection('config').findOne({ _id: 'global_settings' }) : { delay: 0 };

    setTimeout(async () => {
        if (isReady && sock) {
            try {
                await sock.sendMessage(p + "@s.whatsapp.net", { text: `${randomMsg}\n\nكيف كانت تجربتك معنا؟\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين` });
            } catch (err) { console.error("Send Error:", err.message); }
        }
    }, (parseInt(config?.delay) || 0) * 60000 + 1000);
    res.json({ success: true });
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== WEBHOOK_KEY) return res.sendStatus(401);
    const { googleLink, discountCode, delay, branches } = req.body;
    if (dbConnected) {
        await db.collection('config').updateOne({ _id: 'global_settings' }, { $set: { googleLink, discountCode, delay: parseInt(delay) || 0, branches: branches } }, { upsert: true });
    }
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { 
    await initMongo(); 
    await connectToWhatsApp(); 
});