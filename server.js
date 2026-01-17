if (!globalThis.crypto) { globalThis.crypto = require('crypto').webcrypto; }
require('dotenv').config();
const express = require('express');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const app = express();
app.use(express.json());

// --- الإعدادات الداخلية الثابتة (يتم تعديلها برمجياً فقط) ---
const INTERNAL_CONFIG = {
    googleLink: "https://maps.google.com/?q=YourBusiness", // رابط جوجل ماب الخاص بالعميل
    discountCode: "MAWJA2026",                            // كود الخصم الافتراضي
    delayMinutes: 0                                       // وقت التأخير بالدقائق (0 للإرسال الفوري)
};

// --- الإعدادات الفنية للسيرفر ---
const SESSION_PATH = 'auth_stable_v111'; 
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
    } catch (e) { 
        console.error("❌ MongoDB Connection Error:", e.message); 
        // محاولة إعادة الاتصال بعد 5 ثوانٍ في حال الفشل
        setTimeout(initMongo, 5000);
    }
};

async function syncSession() {
    if (!dbConnected) return;
    try {
        const credsPath = path.join(SESSION_PATH, 'creds.json');
        if (fs.existsSync(credsPath)) {
            const data = fs.readFileSync(credsPath, 'utf-8');
            await db.collection('final_v111').updateOne(
                { _id: 'creds' }, 
                { $set: { data, lastUpdate: new Date() } }, 
                { upsert: true }
            );
        }
    } catch (e) {
        console.error("❌ Session Sync Error:", e.message);
    }
}

async function restoreSession() {
    if (!dbConnected) return;
    try {
        const res = await db.collection('final_v111').findOne({ _id: 'creds' });
        if (res) {
            if (!fs.existsSync(SESSION_PATH)) fs.mkdirSync(SESSION_PATH, { recursive: true });
            fs.writeFileSync(path.join(SESSION_PATH, 'creds.json'), res.data);
            console.log("📂 Session Restored from MongoDB.");
        }
    } catch (e) {
        console.error("❌ Session Restore Error:", e.message);
    }
}

// --- منطق واتساب ---
async function connectToWhatsApp() {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await import('@whiskeysockets/baileys');
    
    // تأكد من استعادة الجلسة قبل بدء الاتصال
    if (dbConnected) await restoreSession();
    
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1017531287] }));

    sock = makeWASocket({
        auth: state, 
        version,
        logger: pino({ level: 'error' }),
        browser: Browsers.macOS('Desktop'), 
        printQRInTerminal: false,
        keepAliveIntervalMs: 30000,
        shouldSyncHistoryMessage: () => false,
        markOnlineOnConnect: true
    });

    sock.ev.on('creds.update', async () => { 
        await saveCreds(); 
        await syncSession(); 
    });

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
        
        if (connection === 'open') { 
            isReady = true; 
            lastQR = null; 
            console.log("✅ Mawjat AlSamt v12.2 is LIVE"); 
        }
        
        if (connection === 'close') {
            isReady = false;
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("⚠️ Connection closed. Reconnecting:", shouldReconnect);
            
            if (!shouldReconnect) {
                console.log("❌ Logged out. Clearing local session...");
                fs.rmSync(SESSION_PATH, { recursive: true, force: true });
            }
            setTimeout(connectToWhatsApp, 5000);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.fromMe) return;
            
            const rawPhone = msg.key.remoteJid.split('@')[0];
            const cleanPhone = rawPhone.replace(/\D/g, '');
            const phoneSuffix = cleanPhone.slice(-9); 
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

            if (text === "1" || text === "2") {
                if (dbConnected) {
                    await db.collection('evaluations').findOneAndUpdate(
                        { phone: { $regex: phoneSuffix + "$" }, status: 'sent' },
                        { $set: { status: 'replied', answer: text, repliedAt: new Date() } },
                        { sort: { sentAt: -1 } }
                    );
                }
                const reply = text === "1" ? `يسعدنا تقييمك! 😍\n📍 ${INTERNAL_CONFIG.googleLink}` : `نعتذر منك 😔\n🎫 كود الخصم لزيارتك القادمة: ${INTERNAL_CONFIG.discountCode}`;
                await sock.sendMessage(msg.key.remoteJid, { text: reply });
            }
        } catch (e) {
            console.error("❌ Message Processing Error:", e.message);
        }
    });
}

// --- مسارات النظام ---
app.get('/api/status', (req, res) => res.json({ isReady, lastQR }));

app.get('/', (req, res) => res.redirect('/admin'));

app.get('/admin', async (req, res) => {
    if (!dbConnected) return res.send("جاري الاتصال بقاعدة البيانات... يرجى تحديث الصفحة بعد قليل.");

    const s = await db.collection('config').findOne({ _id: 'global_settings' });
    const branchesString = (s && s.branches) ? s.branches : "فرع جدة, فرع الرياض, فرع الخبر";
    const branchList = branchesString.split(',').map(b => b.trim()).filter(b => b.length > 0);

    const evals = await db.collection('evaluations').find().sort({ sentAt: -1 }).toArray();

    // إحصائيات الرضا المتقدمة
    const totalSent = evals.length;
    const totalReplied = evals.filter(e => e.status === 'replied').length;
    const responseRate = totalSent > 0 ? ((totalReplied / totalSent) * 100).toFixed(1) : 0;
    const positiveCount = evals.filter(e => e.answer === '1').length;
    const negativeCount = evals.filter(e => e.answer === '2').length;
    
    // تحليل الفروع
    const branchStats = branchList.map(name => {
        const bEvals = evals.filter(e => e.branch === name);
        const bPositive = bEvals.filter(e => e.answer === '1').length;
        const bNegative = bEvals.filter(e => e.answer === '2').length;
        return { name, total: bEvals.length, pos: bPositive, neg: bNegative };
    });

    res.send(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>Mawjat Analytics v12.2</title><script src="https://cdn.tailwindcss.com"></script><style>@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');body{font-family:'Cairo',sans-serif;background-color:#f8fafc;}</style></head>
    <body class="p-4 md:p-8 text-right text-slate-800">
        <div class="max-w-7xl mx-auto space-y-6">
            
            <header class="flex justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100">
                <div class="flex items-center gap-4">
                    <div class="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-200 text-white">
                        <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    </div>
                    <div><h1 class="text-2xl font-black italic tracking-tighter">MAWJAT <span class="text-blue-600">ANALYTICS</span></h1><p class="text-[9px] text-gray-400 font-bold uppercase tracking-widest">Reputation Management Center</p></div>
                </div>
                <div class="flex items-center gap-4">
                    <input type="password" id="accessKey" placeholder="Access Key" class="text-xs p-3 border rounded-2xl outline-none focus:border-blue-500 bg-gray-50 border-slate-200 shadow-inner">
                    <div class="bg-slate-900 text-white px-5 py-2.5 rounded-2xl text-[10px] font-bold flex items-center gap-3 shadow-xl"><div id="dot" class="w-2.5 h-2.5 rounded-full bg-red-500"></div><span id="stat">Disconnected</span></div>
                </div>
            </header>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div class="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
                    <p class="text-[10px] text-gray-400 font-black mb-1 uppercase">إجمالي الطلبات</p>
                    <h3 class="text-3xl font-black">${totalSent}</h3>
                </div>
                <div class="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm">
                    <p class="text-[10px] text-gray-400 font-black mb-1 uppercase">معدل الاستجابة</p>
                    <h3 class="text-3xl font-black text-blue-600">${responseRate}%</h3>
                </div>
                <div class="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm border-r-4 border-r-green-500">
                    <p class="text-[10px] text-gray-400 font-black mb-1 uppercase text-green-600">تقييمات ممتازة</p>
                    <h3 class="text-3xl font-black text-green-600">${positiveCount}</h3>
                </div>
                <div class="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm border-r-4 border-r-red-500">
                    <p class="text-[10px] text-gray-400 font-black mb-1 uppercase text-red-600">ملاحظات سلبية</p>
                    <h3 class="text-3xl font-black text-red-600">${negativeCount}</h3>
                </div>
            </div>

            <div class="grid lg:grid-cols-3 gap-8">
                <div class="lg:col-span-2 space-y-8">
                    <div class="bg-white p-10 rounded-[3rem] shadow-sm border border-slate-100 relative overflow-hidden">
                        <div class="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-full -mr-16 -mt-16 opacity-50"></div>
                        <h3 class="font-black text-blue-900 text-xl mb-8 flex items-center gap-3"><span>🚀</span> إرسال طلب تقييم فوري</h3>
                        <div class="grid md:grid-cols-2 gap-6 mb-8">
                            <div class="space-y-2 text-right">
                                <label class="text-[10px] font-black text-gray-400 mr-2 uppercase italic tracking-widest">Phone Number</label>
                                <input id="p" placeholder="05xxxxxxxx" class="w-full p-4 bg-gray-50 rounded-2xl border border-slate-100 font-bold text-center text-lg focus:ring-4 ring-blue-50 transition-all outline-none">
                            </div>
                            <div class="space-y-2 text-right">
                                <label class="text-[10px] font-black text-gray-400 mr-2 uppercase italic tracking-widest">Branch</label>
                                <select id="br" class="w-full p-4 bg-blue-50 text-blue-900 rounded-2xl border border-blue-100 font-black text-center appearance-none cursor-pointer outline-none">
                                    ${branchList.map(b => `<option value="${b}">${b}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <button onclick="sendQuick()" class="w-full bg-blue-600 text-white p-5 rounded-3xl font-black text-xl shadow-2xl shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all">إرسال لـ ${branchList[0] || 'الفرع'}</button>
                    </div>

                    <div class="bg-white p-10 rounded-[3rem] shadow-sm border border-slate-100">
                        <h3 class="font-black text-slate-800 mb-8 uppercase tracking-tighter text-sm flex justify-between items-center">
                            تحليل أداء الفروع 
                            <span class="text-[9px] bg-slate-100 px-4 py-1 rounded-full text-slate-500 font-black">Live Tracker</span>
                        </h3>
                        <div class="overflow-x-auto">
                            <table class="w-full text-right border-separate border-spacing-y-3">
                                <tr class="text-[10px] text-gray-400 font-black uppercase"><th class="pb-4 pr-4">الفرع</th><th class="pb-4 text-center">العمليات</th><th class="pb-4 text-center text-green-600">رضا</th><th class="pb-4 text-center text-red-600">شكاوى</th></tr>
                                ${branchStats.map(b => `
                                    <tr class="bg-slate-50/50 hover:bg-slate-50 transition-all rounded-2xl">
                                        <td class="py-5 pr-4 font-black text-slate-700">${b.name}</td>
                                        <td class="py-5 text-center font-bold text-slate-500">${b.total}</td>
                                        <td class="py-5 text-center text-green-600 font-black text-lg">${b.pos}</td>
                                        <td class="py-5 text-center text-red-600 font-black text-lg">${b.neg}</td>
                                    </tr>
                                `).join('')}
                            </table>
                        </div>
                    </div>
                </div>

                <div class="space-y-8">
                    <div class="bg-white p-8 rounded-[3rem] shadow-sm border border-slate-100 space-y-6 text-right">
                        <h3 class="font-black text-indigo-600 flex items-center gap-2"><span>📍</span> إدارة الفروع</h3>
                        <p class="text-[10px] text-gray-400 font-bold leading-relaxed italic">افصل بين أسماء الفروع بفاصلة لظهورها في القوائم والتقارير.</p>
                        <textarea id="bl" class="w-full p-5 bg-slate-50 rounded-3xl text-xs border border-slate-100 font-bold text-blue-900 h-28 focus:ring-4 ring-indigo-50 outline-none transition-all">${branchesString}</textarea>
                        <button onclick="saveBranches()" class="w-full bg-slate-900 text-white p-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg">حفظ قائمة الفروع</button>
                    </div>

                    <div id="qrc" class="bg-white p-6 rounded-[3rem] border-2 border-dashed border-slate-100 flex items-center justify-center min-h-[220px]">
                        <p class="animate-pulse text-gray-300 font-bold text-xs uppercase italic">Checking Status...</p>
                    </div>

                    <div class="bg-slate-900 p-8 rounded-[3rem] text-white shadow-xl text-right">
                        <h4 class="text-[10px] font-black uppercase tracking-widest text-blue-400 mb-6 flex justify-between items-center">العمليات الأخيرة <span>Live Logs</span></h4>
                        <div class="space-y-4">
                            ${evals.slice(0, 4).map(e => `
                                <div class="border-b border-white/5 pb-3 last:border-0">
                                    <p class="text-[10px] font-bold">${e.phone}</p>
                                    <div class="flex justify-between items-center mt-1">
                                        <span class="text-[8px] opacity-40">${new Date(e.sentAt).toLocaleTimeString('ar-SA')}</span>
                                        <span class="text-[8px] font-black ${e.status === 'replied' ? 'text-green-400' : 'text-blue-400'} uppercase">${e.status}</span>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <script>
            localStorage.setItem('bot_key', document.getElementById('accessKey').value || localStorage.getItem('bot_key') || '');
            document.getElementById('accessKey').value = localStorage.getItem('bot_key');

            async function sendQuick() {
                const key = document.getElementById('accessKey').value;
                const p = document.getElementById('p').value;
                const b = document.getElementById('br').value;
                if(!p || !key) return alert('يرجى التأكد من الرقم ومفتاح الوصول');
                
                localStorage.setItem('bot_key', key);
                const res = await fetch('/send-evaluation?key=' + key, { 
                    method: 'POST', 
                    headers: {'Content-Type': 'application/json'}, 
                    body: JSON.stringify({phone: p, branch: b}) 
                });
                if(res.ok) { alert('✅ تم الإرسال للفرع بنجاح'); location.reload(); }
                else alert('❌ خطأ في الصلاحيات');
            }

            async function saveBranches(){
                const key = document.getElementById('accessKey').value;
                const b = document.getElementById('bl').value;
                if(!key) return alert('أدخل مفتاح الوصول أولاً');
                await fetch('/update-settings?key=' + key, { 
                    method: 'POST', 
                    headers: {'Content-Type': 'application/json'}, 
                    body: JSON.stringify({branches: b}) 
                });
                alert('✅ تم تحديث الفروع بنجاح');
                location.reload();
            }

            async function chk(){
                try {
                    const r = await fetch('/api/status');
                    const d = await r.json();
                    const o = document.getElementById('dot');
                    const t = document.getElementById('stat');
                    const q = document.getElementById('qrc');
                    if(d.isReady){
                        o.className='w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse'; t.innerText='Active';
                        q.innerHTML='<div class="text-center font-black text-blue-600 text-[10px] uppercase italic tracking-widest">WhatsApp Cloud Connected</div>';
                    } else if(d.lastQR){
                        o.className='w-2.5 h-2.5 rounded-full bg-amber-500'; t.innerText='QR Ready';
                        q.innerHTML='<div class="text-center"><p class="text-[8px] font-black text-gray-400 mb-3 uppercase italic">Scan for Link</p><img src="'+d.lastQR+'" class="w-36 rounded-[2rem] shadow-2xl border-4 border-white"></div>';
                    }
                } catch(e){}
            }
            setInterval(chk, 4000); chk();
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
            branch: branch || "فرع افتراضي", 
            status: 'sent', 
            sentAt: new Date() 
        });
    }

    setTimeout(async () => {
        if (isReady && sock) {
            try {
                const branchName = branch || "فرعنا";
                const message = `أهلاً بك، سعدنا بزيارتك لنا في ${branchName}! ✨\n\nكيف كانت تجربتك معنا؟\n1️⃣ ممتاز\n2️⃣ يحتاج تحسين`;
                await sock.sendMessage(p + "@s.whatsapp.net", { text: message });
            } catch (err) {
                console.error("❌ Send Error:", err.message);
            }
        }
    }, (INTERNAL_CONFIG.delayMinutes * 60000) + 1000);
    res.json({ success: true });
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== WEBHOOK_KEY) return res.sendStatus(401);
    const { branches } = req.body;
    if (dbConnected) {
        await db.collection('config').updateOne(
            { _id: 'global_settings' }, 
            { $set: { branches } }, 
            { upsert: true }
        );
    }
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { 
    await initMongo(); 
    await connectToWhatsApp(); 
});