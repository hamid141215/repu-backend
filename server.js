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
        console.log("🔗 MongoDB Connected.");
        
        // بدء نظام الأتمتة (فحص كل ساعة)
        setInterval(checkAutomation, 3600000);
    } catch (e) { console.error("❌ MongoDB Fail:", e.message); }
};

// --- نظام الأتمتة (Follow-up Automation) ---
async function checkAutomation() {
    if (!dbConnected || !isReady || !sock) return;
    try {
        const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
        
        // البحث عن العملاء المهتمين الذين لم يتم التواصل معهم منذ 48 ساعة
        const pendingLeads = await db.collection('leads').find({
            status: 'مهتم',
            lastFollowUp: { $exists: false },
            createdAt: { $lt: fortyEightHoursAgo }
        }).toArray();

        for (const lead of pendingLeads) {
            const message = `مرحباً ${lead.name || 'عزيزنا'}،\nلقد مر يومان منذ تواصلنا الأخير بخصوص نظام موجة الصمت. هل لديك أي استفسارات إضافية تود منا الإجابة عليها؟ نحن هنا لخدمتك! ✨`;
            await sock.sendMessage(lead.phone + "@s.whatsapp.net", { text: message });
            
            // تحديث حالة المتابعة
            await db.collection('leads').updateOne(
                { _id: lead._id },
                { $set: { lastFollowUp: new Date() } }
            );
            console.log(`🤖 Follow-up sent to: ${lead.phone}`);
        }
    } catch (e) { console.error("Automation Error:", e.message); }
}

async function syncSession() {
    if (!dbConnected) return;
    try {
        const credsPath = path.join(SESSION_PATH, 'creds.json');
        if (fs.existsSync(credsPath)) {
            const data = fs.readFileSync(credsPath, 'utf-8');
            await db.collection('final_v111').updateOne({ _id: 'creds' }, { $set: { data, lastUpdate: new Date() } }, { upsert: true });
        }
    } catch (e) {}
}

async function restoreSession() {
    if (!dbConnected) return;
    try {
        const res = await db.collection('final_v111').findOne({ _id: 'creds' });
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
        auth: state, 
        version,
        logger: pino({ level: 'error' }),
        browser: Browsers.macOS('Desktop'), 
        printQRInTerminal: false,
        keepAliveIntervalMs: 30000,
        shouldSyncHistoryMessage: () => false,
        markOnlineOnConnect: true
    });

    sock.ev.on('creds.update', async () => { await saveCreds(); await syncSession(); });

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) lastQR = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300`;
        
        if (connection === 'open') { 
            isReady = true; 
            lastQR = null; 
            console.log("✅ WhatsApp Connected v12.0 CRM"); 
        }
        
        if (connection === 'close') {
            isReady = false;
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code === DisconnectReason.loggedOut) {
                fs.rmSync(SESSION_PATH, { recursive: true, force: true });
                setTimeout(connectToWhatsApp, 5000);
            } else {
                setTimeout(connectToWhatsApp, 5000);
            }
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
                const s = dbConnected ? await db.collection('config').findOne({ _id: 'global_settings' }) : null;
                const config = s || { googleLink: "#", discountCode: "OFFER10" };
                
                if (dbConnected) {
                    await db.collection('evaluations').findOneAndUpdate(
                        { phone: { $regex: phoneSuffix + "$" }, status: 'sent' },
                        { $set: { status: 'replied', answer: text, repliedAt: new Date() } },
                        { sort: { sentAt: -1 } }
                    );
                }
                
                const reply = text === "1" ? `يسعدنا تقييمك! 😍\n📍 ${config.googleLink}` : `نعتذر منك 😔\n🎫 كود الخصم: ${config.discountCode}`;
                await sock.sendMessage(msg.key.remoteJid, { text: reply });
            }
        } catch (e) { console.log("Upsert Error:", e.message); }
    });
}

// --- مسارات الـ API ---
app.get('/api/status', (req, res) => res.json({ isReady, lastQR }));

// إضافة عميل محتمل جديد
app.post('/api/leads/add', async (req, res) => {
    if (req.query.key !== WEBHOOK_KEY) return res.sendStatus(401);
    const { name, phone, branch, amount } = req.body;
    if (dbConnected) {
        await db.collection('leads').insertOne({
            name,
            phone: phone.replace(/\D/g, ''),
            branch,
            amount: parseFloat(amount) || 0,
            status: 'محتمل',
            createdAt: new Date()
        });
    }
    res.json({ success: true });
});

// تحديث حالة العميل
app.post('/api/leads/update-status', async (req, res) => {
    if (req.query.key !== WEBHOOK_KEY) return res.sendStatus(401);
    const { phone, status } = req.body;
    if (dbConnected) {
        await db.collection('leads').updateOne(
            { phone: phone.replace(/\D/g, '') },
            { $set: { status, updatedAt: new Date() } }
        );
    }
    res.json({ success: true });
});

app.get('/', (req, res) => res.redirect('/admin'));

app.get('/admin', async (req, res) => {
    const defaultBranches = "فرع جدة, فرع الرياض, فرع الخبر";
    const s = dbConnected ? await db.collection('config').findOne({ _id: 'global_settings' }) : null;
    const branchesString = (s && s.branches) ? s.branches : defaultBranches;
    const branchList = branchesString.split(',').map(b => b.trim()).filter(b => b.length > 0);

    // بيانات المبيعات (CRM)
    const leads = dbConnected ? await db.collection('leads').find().sort({ createdAt: -1 }).toArray() : [];
    const evals = dbConnected ? await db.collection('evaluations').find().sort({ sentAt: -1 }).limit(10).toArray() : [];

    // تقارير مالية
    const realizedSales = leads.filter(l => l.status === 'تم الإغلاق').reduce((sum, l) => sum + (l.amount || 0), 0);
    const expectedRevenue = leads.filter(l => l.status !== 'تم الإغلاق').reduce((sum, l) => sum + (l.amount || 0), 0);
    const conversionRate = leads.length > 0 ? ((leads.filter(l => l.status === 'تم الإغلاق').length / leads.length) * 100).toFixed(1) : 0;

    res.send(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>CRM موجة الصمت v12</title><script src="https://cdn.tailwindcss.com"></script><style>@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');body{font-family:'Cairo',sans-serif;background-color:#f8fafc;}</style></head>
    <body class="p-4 md:p-8 text-right">
        <div class="max-w-7xl mx-auto space-y-8">
            <header class="flex justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-sm border">
                <div><h1 class="text-2xl font-black italic text-slate-800 tracking-tighter">MAWJAT <span class="text-blue-600">CRM</span></h1><p class="text-[9px] text-gray-400 font-bold uppercase">Automated Sales & Reputation System</p></div>
                <div class="flex items-center gap-4">
                    <input type="password" id="accessKey" placeholder="مفتاح الوصول" class="text-xs p-3 border rounded-2xl outline-none focus:border-blue-500 bg-gray-50">
                    <div class="bg-gray-50 px-4 py-2 rounded-2xl border text-[10px] font-bold flex items-center gap-2"><div id="dot" class="w-3 h-3 rounded-full bg-red-500"></div><span id="stat">Checking...</span></div>
                </div>
            </header>

            <!-- لوحة التقارير المالية -->
            <div class="grid md:grid-cols-3 gap-6">
                <div class="bg-blue-600 text-white p-6 rounded-[2rem] shadow-xl">
                    <p class="text-xs opacity-80 mb-1">إجمالي المبيعات المحققة</p>
                    <h2 class="text-3xl font-black">${realizedSales.toLocaleString()} <span class="text-sm font-normal">ر.س</span></h2>
                </div>
                <div class="bg-white p-6 rounded-[2rem] border shadow-sm">
                    <p class="text-xs text-gray-400 mb-1">إيرادات متوقعة (In Pipeline)</p>
                    <h2 class="text-3xl font-black text-slate-800">${expectedRevenue.toLocaleString()} <span class="text-sm font-normal">ر.س</span></h2>
                </div>
                <div class="bg-green-500 text-white p-6 rounded-[2rem] shadow-xl">
                    <p class="text-xs opacity-80 mb-1">نسبة التحويل (Conversion)</p>
                    <h2 class="text-3xl font-black">${conversionRate}%</h2>
                </div>
            </div>

            <div class="grid lg:grid-cols-3 gap-8">
                <!-- إدارة العملاء المحتملين -->
                <div class="lg:col-span-2 bg-white p-8 rounded-[3rem] shadow-sm border space-y-6">
                    <h3 class="font-black text-blue-600 flex items-center gap-2"><span>👥</span> إضافة عميل محتمل (Lead)</h3>
                    <div class="grid md:grid-cols-2 gap-4">
                        <input id="ln" placeholder="اسم العميل" class="p-4 bg-gray-50 rounded-2xl border font-bold text-center">
                        <input id="lp" placeholder="رقم الجوال" class="p-4 bg-gray-50 rounded-2xl border font-bold text-center">
                        <input id="la" type="number" placeholder="قيمة الصفقة" class="p-4 bg-gray-50 rounded-2xl border font-bold text-center">
                        <select id="lbr" class="p-4 bg-blue-50 text-blue-900 rounded-2xl border border-blue-100 font-bold">
                            ${branchList.map(b => `<option value="${b}">${b}</option>`).join('')}
                        </select>
                    </div>
                    <button onclick="addLead()" class="w-full bg-blue-600 text-white p-4 rounded-2xl font-black text-lg shadow-xl active:scale-95 transition">إضافة العميل لبدء المتابعة</button>

                    <div class="pt-8">
                        <h4 class="font-black mb-4 text-slate-800">قائمة المبيعات الجارية</h4>
                        <div class="overflow-x-auto">
                            <table class="w-full text-right text-xs">
                                <tr class="border-b text-gray-400 font-bold"><th class="pb-3">العميل</th><th class="pb-3">الفرع</th><th class="pb-3">القيمة</th><th class="pb-3">الحالة</th><th class="pb-3">إجراء</th></tr>
                                ${leads.map(l => `
                                <tr class="border-b hover:bg-gray-50 transition">
                                    <td class="py-3 font-bold">${l.name}<br><span class="text-[9px] text-gray-400 font-normal">${l.phone}</span></td>
                                    <td class="py-3 font-bold text-blue-500">${l.branch}</td>
                                    <td class="py-3 font-black">${l.amount} ر.س</td>
                                    <td class="py-3">
                                        <select onchange="updateLeadStatus('${l.phone}', this.value)" class="bg-gray-100 p-2 rounded-lg font-bold">
                                            <option ${l.status === 'محتمل' ? 'selected' : ''}>محتمل</option>
                                            <option ${l.status === 'مهتم' ? 'selected' : ''}>مهتم</option>
                                            <option ${l.status === 'تم التواصل' ? 'selected' : ''}>تم التواصل</option>
                                            <option ${l.status === 'تم الإغلاق' ? 'selected' : ''}>تم الإغلاق</option>
                                        </select>
                                    </td>
                                    <td class="py-3">
                                        ${l.status === 'تم الإغلاق' ? `<button onclick="genInvoice('${l.name}', ${l.amount})" class="bg-green-100 text-green-600 px-3 py-1 rounded-full font-bold">🧾 فاتورة</button>` : ''}
                                    </td>
                                </tr>`).join('')}
                            </table>
                        </div>
                    </div>
                </div>

                <!-- الإعدادات والواتساب -->
                <div class="space-y-6">
                    <div class="bg-white p-8 rounded-[3rem] shadow-sm border space-y-4">
                        <h3 class="font-black text-green-600 italic">⚙️ إعدادات البوت</h3>
                        <input id="bl" value="${branchesString}" class="w-full p-3 bg-gray-50 rounded-xl text-xs border font-bold text-blue-900" placeholder="الفروع">
                        <input id="gl" value="${(s && s.googleLink) || '#'}" class="w-full p-3 bg-gray-50 rounded-xl text-xs border" placeholder="رابط قوقل">
                        <button onclick="save()" class="w-full bg-slate-900 text-white p-4 rounded-2xl font-black">حفظ الإعدادات</button>
                    </div>
                    <div id="qrc" class="bg-white p-6 rounded-[3rem] border-2 border-dashed border-blue-100 flex items-center justify-center min-h-[200px]"></div>
                </div>
            </div>
        </div>

        <script>
            localStorage.setItem('bot_key', document.getElementById('accessKey').value || localStorage.getItem('bot_key') || '');
            document.getElementById('accessKey').value = localStorage.getItem('bot_key');

            async function addLead() {
                const key = document.getElementById('accessKey').value;
                const body = {
                    name: document.getElementById('ln').value,
                    phone: document.getElementById('lp').value,
                    amount: document.getElementById('la').value,
                    branch: document.getElementById('lbr').value
                };
                const res = await fetch('/api/leads/add?key=' + key, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
                if(res.ok) location.reload();
            }

            async function updateLeadStatus(phone, status) {
                const key = document.getElementById('accessKey').value;
                await fetch('/api/leads/update-status?key=' + key, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({phone, status}) });
                if(status === 'تم الإغلاق') location.reload();
            }

            function genInvoice(name, amount) {
                // توجيه لصفحة مولد الفواتير مع تعبئة البيانات في الرابط
                window.location.href = '/gen?clientName=' + encodeURIComponent(name) + '&baseAmount=' + amount;
            }

            async function chk(){
                try {
                    const r = await fetch('/api/status');
                    const d = await r.json();
                    const o = document.getElementById('dot');
                    const t = document.getElementById('stat');
                    const q = document.getElementById('qrc');
                    if(d.isReady){
                        o.className='w-3 h-3 rounded-full bg-green-500 animate-pulse'; t.innerText='متصل';
                        q.innerHTML='<p class="text-green-600 font-black text-xl italic uppercase">System Online ✅</p>';
                    } else if(d.lastQR){
                        o.className='w-3 h-3 rounded-full bg-amber-500'; t.innerText='بانتظار المسح';
                        q.innerHTML='<img src="'+d.lastQR+'" class="w-40 rounded-2xl shadow-xl">';
                    }
                } catch(e){}
            }
            setInterval(chk, 4000); chk();

            async function save(){
                const key = document.getElementById('accessKey').value;
                const d = { branches: document.getElementById('bl').value, googleLink: document.getElementById('gl').value };
                await fetch('/update-settings?key=' + key, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(d) });
                location.reload();
            }
        </script>
    </body></html>`);
});

app.post('/update-settings', async (req, res) => {
    if (req.query.key !== WEBHOOK_KEY) return res.sendStatus(401);
    const { googleLink, branches } = req.body;
    if (dbConnected) {
        await db.collection('config').updateOne({ _id: 'global_settings' }, { $set: { googleLink, branches } }, { upsert: true });
    }
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => { await initMongo(); await connectToWhatsApp(); });