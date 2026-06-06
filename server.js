require('dotenv').config();
const express = require('express');
const { Pool }  = require('pg');
const axios     = require('axios');
const path      = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Phone normalization ───────────────────────────────────────────────────
const normalizePhone = (phone) => {
    let p = String(phone).replace(/\D/g, '');
    if (p.startsWith('05')) p = '966' + p.substring(1);
    if (p.startsWith('5') && p.length === 9) p = '966' + p;
    return p;
};

// ─── Meta WhatsApp Cloud API ───────────────────────────────────────────────
const isMockMode = () =>
    process.env.META_WHATSAPP_TOKEN === 'dummy' ||
    process.env.META_PHONE_NUMBER_ID === 'dummy';

const sendTextMessage = async (to, text) => {
    if (isMockMode()) {
        console.log(`MOCK Meta send to ${normalizePhone(to)}`);
        return;
    }
    const url = `https://graph.facebook.com/v20.0/${process.env.META_PHONE_NUMBER_ID}/messages`;
    await axios.post(url, {
        messaging_product: 'whatsapp',
        to: normalizePhone(to),
        type: 'text',
        text: { body: text }
    }, {
        headers: {
            Authorization: `Bearer ${process.env.META_WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json'
        }
    });
};

// ─── PostgreSQL pool ───────────────────────────────────────────────────────
const pool = new Pool({
    connectionString: process.env.PG_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const initDB = async (retries = 10) => {
    try {
        await pool.query('SELECT 1'); // connectivity check

        await pool.query(`
            CREATE TABLE IF NOT EXISTS clients (
                id          SERIAL PRIMARY KEY,
                name        VARCHAR(255) NOT NULL,
                api_key     VARCHAR(255) NOT NULL UNIQUE,
                nfc_id      VARCHAR(100) UNIQUE,
                google_link TEXT,
                admin_phone VARCHAR(20),
                plan        VARCHAR(50),
                expiry_date TIMESTAMPTZ,
                created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS evaluations (
                id          SERIAL PRIMARY KEY,
                client_id   INTEGER      NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                phone       VARCHAR(20)  NOT NULL,
                name        VARCHAR(255),
                branch      VARCHAR(255),
                status      VARCHAR(50)  NOT NULL DEFAULT 'pending',
                answer      VARCHAR(5),
                sent_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
            )
        `);

        await pool.query("ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'dashboard'");
        await pool.query('ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS feedback TEXT');

        await pool.query('CREATE INDEX IF NOT EXISTS idx_clients_api_key       ON clients (api_key)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_clients_nfc_id        ON clients (nfc_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_evaluations_phone     ON evaluations (phone)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_evaluations_client_id ON evaluations (client_id)');
        await pool.query('CREATE INDEX IF NOT EXISTS idx_evaluations_sent_at   ON evaluations (sent_at DESC)');

        console.log('✅ PostgreSQL ready');
    } catch (e) {
        console.error('DB Error:', e.message);
        if (retries > 0) {
            await new Promise(r => setTimeout(r, 5000));
            return initDB(retries - 1);
        }
        throw new Error('PostgreSQL connection failed after retries');
    }
};

// ─── Auth middleware ───────────────────────────────────────────────────────
const authenticate = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'Missing API Key' });
    const { rows } = await pool.query(
        'SELECT * FROM clients WHERE api_key = $1',
        [apiKey.trim()]
    );
    if (rows.length === 0) return res.status(403).json({ error: 'Invalid API Key' });
    req.clientData = rows[0];
    next();
};

const superAdminAuth = (req, res, next) => {
    const adminPass = req.headers['x-admin-password'];
    if (adminPass !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
    next();
};

// ─── Health check ──────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', db: 'connected' });
    } catch (e) {
        res.json({ status: 'ok', db: 'disconnected' });
    }
});

// ─── Meta webhook verification (GET) ──────────────────────────────────────
app.get('/webhook', (req, res) => {
    const mode      = req.query['hub.mode'];
    const token     = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }
    res.status(403).send('Forbidden');
});

// ─── Meta webhook receiver (POST) ─────────────────────────────────────────
app.post('/webhook', async (req, res) => {
    // Respond immediately — Meta requires a fast 200
    res.status(200).send('EVENT_RECEIVED');

    try {
        const body = req.body;
        if (body.object !== 'whatsapp_business_account') return;

        const value = body.entry?.[0]?.changes?.[0]?.value;
        if (!value || !value.messages || value.messages.length === 0) return;

        const message = value.messages[0];

        // Ignore group messages
        if (String(message.from).includes('@g.us')) return;

        // Only handle text messages — ignore media, audio, etc.
        if (message.type !== 'text') return;

        const customerPhone = message.from; // E.164 without '+', e.g. 966501234567
        const incomingText  = message.text?.body?.trim() || '';
        if (!incomingText) return;

        // ── 1. NFC detection ──────────────────────────────────────────────
        // Current NFC link format: "... (Ref: 101)"
        let nfcId = null;
        const refMatch = incomingText.match(/\(Ref:\s*(\d+)\)/i);
        if (refMatch) nfcId = refMatch[1];

        // Legacy NFC format: "تقييم_101"
        if (!nfcId && incomingText.startsWith('تقييم_')) {
            const parts = incomingText.split('_');
            nfcId = parts[parts.length - 1].trim();
        }

        if (nfcId) {
            const { rows } = await pool.query(
                'SELECT * FROM clients WHERE nfc_id = $1',
                [nfcId]
            );
            const client = rows[0];
            if (client) {
                await sendTextMessage(customerPhone,
                    `مرحباً بك في ${client.name} 👋\n\n` +
                    `نشكرك على زيارتك! كيف كانت تجربتك معنا اليوم؟\n\n` +
                    `1️⃣ ردّ بـ *1* إذا كانت تجربتك ممتازة ⭐\n` +
                    `2️⃣ ردّ بـ *2* إذا لديك ملاحظة أو اقتراح 📝`
                );
                await pool.query(
                    'INSERT INTO evaluations (client_id, phone, name, status) VALUES ($1, $2, $3, $4)',
                    [client.id, customerPhone, value.contacts?.[0]?.profile?.name || 'عميل', 'pending']
                );
            }
            return;
        }

        // ── 2. Reply processing ───────────────────────────────────────────
        const { rows: evalRows } = await pool.query(
            'SELECT * FROM evaluations WHERE phone = $1 ORDER BY sent_at DESC LIMIT 1',
            [customerPhone]
        );
        const lastEval = evalRows[0];
        if (!lastEval) return;

        const { rows: clientRows } = await pool.query(
            'SELECT * FROM clients WHERE id = $1',
            [lastEval.client_id]
        );
        const client = clientRows[0];
        if (!client) return;

        const t = incomingText;
        const isThanks    = ['شكراً', 'شكرا', 'تمام', 'يعطيك العافية'].some(w => t.includes(w));
        const isPositive  = t === '1' || t.includes('ممتاز');
        const isComplaint = t === '2' || t.includes('ملاحظة') || t.includes('ملاحظات');

        if (isThanks) {
            await sendTextMessage(customerPhone, `شكراً لك، يسعدنا دائماً خدمتك 😊`);
            await pool.query(
                'UPDATE evaluations SET status = $1 WHERE id = $2',
                ['closed', lastEval.id]
            );
        } else if (isPositive) {
            await sendTextMessage(customerPhone,
                `شكراً على تقييمك الرائع! 😍\n` +
                `يسعدنا كثيراً لو شاركت تجربتك على جوجل:\n${client.google_link}`
            );
            await pool.query(
                'UPDATE evaluations SET status = $1, answer = $2 WHERE id = $3',
                ['replied', '1', lastEval.id]
            );
        } else if (isComplaint) {
            const discountLine = process.env.DISCOUNT_CODE
                ? `\n\nكود خصم مقدَّم منا: *${process.env.DISCOUNT_CODE}*`
                : '';
            await sendTextMessage(customerPhone,
                `نعتذر منك على أي تقصير 😔\n` +
                `تم إرسال ملاحظتك لإدارة ${client.name} فوراً وسيتم التواصل معك قريباً.` +
                discountLine
            );
            await pool.query(
                'UPDATE evaluations SET status = $1, answer = $2 WHERE id = $3',
                ['complaint', '2', lastEval.id]
            );
            // Manager alert — send as plain text, no customer message content
            if (client.admin_phone) {
                const directLink = `https://wa.me/${customerPhone.replace(/\D/g, '')}`;
                await sendTextMessage(client.admin_phone,
                    `⚠️ شكوى جديدة — ${client.name}\nتواصل مع العميل مباشرة: ${directLink}`
                );
            }
        }
        // All other messages are silently ignored
    } catch (err) {
        console.error('Webhook error:', err.message);
    }
});

// ─── Static pages ──────────────────────────────────────────────────────────
app.get('/',                (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/app',             (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/admin.html',      (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/reports',         (req, res) => res.sendFile(path.join(__dirname, 'reports.html')));
app.get('/reports.html',    (req, res) => res.sendFile(path.join(__dirname, 'reports.html')));
app.get('/super-admin',     (req, res) => res.sendFile(path.join(__dirname, 'super-admin.html')));
app.get('/super-admin.html',(req, res) => res.sendFile(path.join(__dirname, 'super-admin.html')));

// ─── Super admin APIs ──────────────────────────────────────────────────────
app.get('/api/super-admin/clients', superAdminAuth, async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
    res.json(rows);
});

app.post('/api/clients/add', superAdminAuth, async (req, res) => {
    const { name, apiKey, nfcId, googleLink, adminPhone, plan, durationType } = req.body;
    let expiryDate = new Date();
    if (durationType === 'yearly') expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    else expiryDate.setMonth(expiryDate.getMonth() + 1);

    try {
        const { rows: existing } = await pool.query(
            'SELECT id FROM clients WHERE api_key = $1 OR nfc_id = $2',
            [apiKey, nfcId]
        );
        if (existing.length > 0) return res.status(400).json({ error: 'البيانات مسجلة مسبقاً' });

        await pool.query(
            `INSERT INTO clients (name, api_key, nfc_id, google_link, admin_phone, plan, expiry_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [name, apiKey, nfcId, googleLink, normalizePhone(adminPhone), plan, expiryDate]
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Database Error' });
    }
});

app.delete('/api/clients/:id', superAdminAuth, async (req, res) => {
    await pool.query('DELETE FROM clients WHERE id = $1', [parseInt(req.params.id, 10)]);
    res.json({ success: true });
});

// Public NFC/QR review APIs
app.get('/api/public/client/:nfcId', async (req, res) => {
    const nfcId = String(req.params.nfcId || '').trim();
    if (!nfcId) return res.status(400).json({ error: 'Missing NFC ID' });

    try {
        const { rows } = await pool.query(
            'SELECT name, google_link FROM clients WHERE nfc_id = $1',
            [nfcId]
        );
        const client = rows[0];
        if (!client) return res.status(404).json({ error: 'Client not found' });

        res.json({
            name: client.name,
            googleLink: client.google_link
        });
    } catch (e) {
        res.status(500).json({ error: 'Database Error' });
    }
});

app.post('/api/public/review', async (req, res) => {
    const nfcId = String(req.body.nfcId || '').trim();
    const answer = String(req.body.answer || '').trim();
    const name = String(req.body.name || '').trim() || null;
    const phoneInput = String(req.body.phone || '').trim();
    const phone = phoneInput ? normalizePhone(phoneInput) : '';
    const feedback = String(req.body.feedback || '').trim() || null;

    if (!nfcId) return res.status(400).json({ error: 'Missing NFC ID' });
    if (!['1', '2'].includes(answer)) return res.status(400).json({ error: 'Invalid answer' });
    if (answer === '2' && !feedback) return res.status(400).json({ error: 'Feedback is required' });

    try {
        const { rows } = await pool.query(
            'SELECT id, google_link FROM clients WHERE nfc_id = $1',
            [nfcId]
        );
        const client = rows[0];
        if (!client) return res.status(404).json({ error: 'Client not found' });

        const status = answer === '1' ? 'replied' : 'complaint';
        await pool.query(
            `INSERT INTO evaluations (client_id, phone, name, status, answer, source, feedback)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [client.id, phone, name, status, answer, 'nfc', feedback]
        );

        res.json({
            success: true,
            status,
            googleLink: answer === '1' ? client.google_link : undefined
        });
    } catch (e) {
        res.status(500).json({ error: 'Database Error' });
    }
});

// ─── Client APIs ───────────────────────────────────────────────────────────
app.get('/api/client-info', authenticate, async (req, res) => {
    const { rows } = await pool.query(
        'SELECT COUNT(*)::int AS count FROM evaluations WHERE client_id = $1',
        [req.clientData.id]
    );
    res.json({ name: req.clientData.name, total: rows[0].count });
});

app.post('/api/send', authenticate, async (req, res) => {
    const { phone, name, branch } = req.body;
    const cleanPhone = normalizePhone(phone);
    try {
        await sendTextMessage(cleanPhone,
            `مرحباً ${name} 👋\n` +
            `نشكرك على تعاملك مع ${req.clientData.name}!\n\n` +
            `كيف كانت تجربتك معنا؟\n\n` +
            `1️⃣ ردّ بـ *1* إذا كانت تجربتك ممتازة ⭐\n` +
            `2️⃣ ردّ بـ *2* إذا لديك ملاحظة أو اقتراح 📝`
        );
        await pool.query(
            'INSERT INTO evaluations (client_id, phone, name, branch, status) VALUES ($1, $2, $3, $4, $5)',
            [req.clientData.id, cleanPhone, name, branch, 'sent']
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/my-reports', authenticate, async (req, res) => {
    const { rows } = await pool.query(
        'SELECT * FROM evaluations WHERE client_id = $1 ORDER BY sent_at DESC',
        [req.clientData.id]
    );
    res.json(rows);
});

app.get('/api/export-excel', async (req, res) => {
    const apiKey = req.query.apiKey;
    if (!apiKey) return res.status(401).json({ error: 'Missing API Key' });

    const { rows: clientRows } = await pool.query(
        'SELECT id FROM clients WHERE api_key = $1',
        [String(apiKey).trim()]
    );
    const client = clientRows[0];
    if (!client) return res.status(401).json({ error: 'Invalid API Key' });

    const { rows } = await pool.query(
        `SELECT name, phone, branch, status, answer, sent_at
         FROM evaluations
         WHERE client_id = $1
         ORDER BY sent_at DESC`,
        [client.id]
    );

    const escapeTsv = (value) => String(value ?? '').replace(/[\t\r\n]+/g, ' ');
    const tsvRows = [
        ['العميل', 'رقم الجوال', 'الفرع', 'الحالة', 'الرد', 'التوقيت'],
        ...rows.map(row => [
            row.name,
            row.phone == null ? '' : `="${String(row.phone).replace(/"/g, '""')}"`,
            row.branch,
            row.status,
            row.answer,
            row.sent_at ? new Date(row.sent_at).toLocaleString('ar-SA') : ''
        ])
    ];

    const content = tsvRows.map(row => row.map(escapeTsv).join('\t')).join('\r\n');
    const bom = Buffer.from([0xff, 0xfe]);
    const bodyBuffer = Buffer.from(content, 'utf16le');
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-16le');
    res.setHeader('Content-Disposition', 'attachment; filename="repusystem-reports.xls"');
    res.send(Buffer.concat([bom, bodyBuffer]));
});

// ─── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

(async () => {
    await initDB();
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
})();
