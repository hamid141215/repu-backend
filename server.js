require('dotenv').config();
const express = require('express');
const { Pool }  = require('pg');
const axios     = require('axios');
const path      = require('path');
const QRCode    = require('qrcode');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Phone normalization ───────────────────────────────────────────────────
const normalizePhone = (phone) => {
    let p = String(phone).replace(/\D/g, '');
    if (p.startsWith('05')) p = '966' + p.substring(1);
    if (p.startsWith('5') && p.length === 9) p = '966' + p;
    return p;
};

const normalizeComplaintAction = (action) => {
    const value = String(action || '').trim();
    return ['contact', 'discount', 'contact_discount'].includes(value) ? value : 'contact';
};

const normalizeWhatsappContact = (contact) => String(contact || '').trim().replace(/\D/g, '');

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

        await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS complaint_action TEXT DEFAULT 'contact'");
        await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS discount_code TEXT');
        await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS complaint_message TEXT DEFAULT 'تم استلام ملاحظتك وسيتم التواصل معك قريباً.'");
        await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS whatsapp_contact TEXT');
        await pool.query("ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'dashboard'");
        await pool.query('ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS feedback TEXT');
        await pool.query('ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS rating INT');

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
    const adminPass = req.headers['x-admin-password'] || req.body?.adminPassword || req.body?.password;
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
app.get('/r/:nfcId',        (req, res) => res.sendFile(path.join(__dirname, 'review.html')));

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

app.patch('/api/clients/:id/complaint-settings', superAdminAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const complaintAction = String(req.body.complaint_action || '').trim();
    const discountCode = String(req.body.discount_code || '').trim();
    const complaintMessage = String(req.body.complaint_message || '').trim() || 'تم استلام ملاحظتك وسيتم التواصل معك قريباً.';
    const whatsappContact = normalizeWhatsappContact(req.body.whatsapp_contact);

    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid client ID' });
    if (!['contact', 'discount', 'contact_discount'].includes(complaintAction)) {
        return res.status(400).json({ error: 'Invalid complaint action' });
    }

    try {
        const { rowCount } = await pool.query(
            `UPDATE clients
             SET complaint_action = $1, discount_code = $2, complaint_message = $3, whatsapp_contact = $4
             WHERE id = $5`,
            [complaintAction, discountCode || null, complaintMessage, whatsappContact || null, id]
        );
        if (rowCount === 0) return res.status(404).json({ error: 'Client not found' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Database Error' });
    }
});

// Public NFC/QR review APIs
app.get('/api/public/client/:nfcId', async (req, res) => {
    const nfcId = String(req.params.nfcId || '').trim();
    if (!nfcId) return res.status(400).json({ error: 'Missing NFC ID' });

    try {
        const { rows } = await pool.query(
            `SELECT name, google_link, complaint_action, discount_code, complaint_message, whatsapp_contact
             FROM clients
             WHERE nfc_id = $1`,
            [nfcId]
        );
        const client = rows[0];
        if (!client) return res.status(404).json({ error: 'Client not found' });

        res.json({
            name: client.name,
            googleLink: client.google_link,
            complaint_action: normalizeComplaintAction(client.complaint_action),
            discount_code: client.discount_code,
            complaint_message: client.complaint_message,
            whatsapp_contact: client.whatsapp_contact
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
    const rawRating = req.body.rating;
    const rating = rawRating === undefined || rawRating === null || rawRating === ''
        ? null
        : Number(rawRating);

    if (!nfcId) return res.status(400).json({ error: 'Missing NFC ID' });
    if (!['1', '2'].includes(answer)) return res.status(400).json({ error: 'Invalid answer' });
    if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
        return res.status(400).json({ error: 'Invalid rating' });
    }
    if (answer === '2' && !feedback) return res.status(400).json({ error: 'Feedback is required' });

    try {
        const { rows } = await pool.query(
            `SELECT id, google_link, complaint_action, discount_code, complaint_message
             FROM clients
             WHERE nfc_id = $1`,
            [nfcId]
        );
        const client = rows[0];
        if (!client) return res.status(404).json({ error: 'Client not found' });

        const status = answer === '1' ? 'replied' : 'complaint';
        await pool.query(
            `INSERT INTO evaluations (client_id, phone, name, status, answer, source, feedback, rating)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [client.id, phone, name, status, answer, 'nfc', feedback, rating]
        );

        const response = {
            success: true,
            status,
            googleLink: answer === '1' ? client.google_link : undefined
        };

        if (answer === '2') {
            response.complaintAction = normalizeComplaintAction(client.complaint_action);
            response.discountCode = client.discount_code || null;
            response.complaintMessage = client.complaint_message || 'تم استلام ملاحظتك وسيتم التواصل معك قريباً.';
        }

        res.json(response);
    } catch (e) {
        res.status(500).json({ error: 'Database Error' });
    }
});

app.get('/api/qr/:nfcId', async (req, res) => {
    const nfcId = String(req.params.nfcId || '').trim();
    if (!nfcId || nfcId.length > 100 || !/^[A-Za-z0-9_-]+$/.test(nfcId)) {
        return res.status(400).json({ error: 'Invalid NFC ID' });
    }

    try {
        const { rows } = await pool.query(
            'SELECT id FROM clients WHERE nfc_id = $1',
            [nfcId]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Client not found' });

        const baseUrl = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
        const reviewUrl = `${baseUrl}/r/${encodeURIComponent(nfcId)}`;
        const safeNfcId = nfcId.replace(/[^A-Za-z0-9_-]/g, '') || 'review';
        const png = await QRCode.toBuffer(reviewUrl, { type: 'png', width: 1024, margin: 2 });

        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="repusystem-review-${safeNfcId}.png"`);
        res.send(png);
    } catch (e) {
        res.status(500).json({ error: 'QR generation failed' });
    }
});

// ─── Client APIs ───────────────────────────────────────────────────────────
app.get('/api/client-info', authenticate, async (req, res) => {
    const { rows } = await pool.query(
        `SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'replied' AND answer = '1')::int AS positive_count,
            COUNT(*) FILTER (WHERE status = 'complaint' OR answer = '2')::int AS complaint_count
         FROM evaluations
         WHERE client_id = $1`,
        [req.clientData.id]
    );
    const stats = rows[0];
    const satisfactionBase = stats.positive_count + stats.complaint_count;
    const satisfactionRate = satisfactionBase === 0
        ? 0
        : Math.round((stats.positive_count / satisfactionBase) * 100);

    res.json({
        name: req.clientData.name,
        total: stats.total,
        total_evaluations: stats.total,
        positive_count: stats.positive_count,
        complaint_count: stats.complaint_count,
        satisfaction_rate: satisfactionRate,
        nfc_id: req.clientData.nfc_id,
        nfcId: req.clientData.nfc_id,
        google_link: req.clientData.google_link,
        complaint_action: normalizeComplaintAction(req.clientData.complaint_action),
        discount_code: req.clientData.discount_code,
        complaint_message: req.clientData.complaint_message,
        whatsapp_number: req.clientData.whatsapp_contact || req.clientData.admin_phone || null,
        whatsapp_contact: req.clientData.whatsapp_contact
    });
});

app.get('/api/dashboard-summary', authenticate, async (req, res) => {
    const clientId = req.clientData.id;

    try {
        const { rows: statsRows } = await pool.query(
            `SELECT
                COUNT(*)::int AS total_evaluations,
                COUNT(*) FILTER (WHERE status = 'replied' AND answer = '1')::int AS positive_count,
                COUNT(*) FILTER (WHERE status = 'complaint' OR answer = '2')::int AS complaint_count
             FROM evaluations
             WHERE client_id = $1`,
            [clientId]
        );
        const stats = statsRows[0];
        const satisfactionBase = stats.positive_count + stats.complaint_count;
        const satisfactionRate = satisfactionBase === 0
            ? 0
            : Math.round((stats.positive_count / satisfactionBase) * 100);

        const { rows: monthlyRows } = await pool.query(
            `WITH months AS (
                SELECT generate_series(
                    date_trunc('month', NOW()) - INTERVAL '5 months',
                    date_trunc('month', NOW()),
                    INTERVAL '1 month'
                ) AS month_start
             )
             SELECT
                to_char(months.month_start, 'YYYY-MM') AS month,
                COUNT(e.id)::int AS total
             FROM months
             LEFT JOIN evaluations e
                ON e.client_id = $1
               AND e.sent_at >= months.month_start
               AND e.sent_at < months.month_start + INTERVAL '1 month'
             GROUP BY months.month_start
             ORDER BY months.month_start`,
            [clientId]
        );

        const { rows: dailyRows } = await pool.query(
            `WITH days AS (
                SELECT generate_series(
                    (CURRENT_DATE - INTERVAL '29 days')::date,
                    CURRENT_DATE,
                    INTERVAL '1 day'
                )::date AS day
             )
             SELECT
                days.day::text AS date,
                COUNT(e.id)::int AS total,
                COUNT(e.id) FILTER (WHERE e.status = 'replied' AND e.answer = '1')::int AS positive_count,
                COUNT(e.id) FILTER (WHERE e.status = 'complaint' OR e.answer = '2')::int AS complaint_count
             FROM days
             LEFT JOIN evaluations e
                ON e.client_id = $1
               AND e.sent_at >= days.day
               AND e.sent_at < days.day + INTERVAL '1 day'
             GROUP BY days.day
             ORDER BY days.day`,
            [clientId]
        );

        const { rows: sourceRows } = await pool.query(
            `SELECT COALESCE(source, 'unknown') AS source, COUNT(*)::int AS total
             FROM evaluations
             WHERE client_id = $1
             GROUP BY COALESCE(source, 'unknown')
             ORDER BY total DESC`,
            [clientId]
        );

        const { rows: recentRows } = await pool.query(
            `SELECT id, name, phone, branch, status, answer, source, feedback, sent_at
             FROM evaluations
             WHERE client_id = $1
             ORDER BY sent_at DESC
             LIMIT 8`,
            [clientId]
        );

        const { rows: complaintRows } = await pool.query(
            `SELECT id, name, phone, branch, status, answer, source, feedback, sent_at
             FROM evaluations
             WHERE client_id = $1
               AND (status = 'complaint' OR answer = '2')
             ORDER BY sent_at DESC
             LIMIT 5`,
            [clientId]
        );

        res.json({
            total_evaluations: stats.total_evaluations,
            positive_count: stats.positive_count,
            complaint_count: stats.complaint_count,
            satisfaction_rate: satisfactionRate,
            monthly_counts: monthlyRows,
            daily_counts_last_30_days: dailyRows,
            source_breakdown: sourceRows,
            recent_activity: recentRows,
            urgent_complaints: complaintRows
        });
    } catch (e) {
        console.error('Dashboard summary error:', e.message);
        res.status(500).json({ error: 'Database Error' });
    }
});

app.get('/api/client-recent', async (req, res) => {
    const apiKey = String(req.query.apiKey || '').trim();
    if (!apiKey) return res.status(401).json({ error: 'Missing API Key' });

    try {
        const { rows: clientRows } = await pool.query(
            'SELECT id FROM clients WHERE api_key = $1',
            [apiKey]
        );
        const client = clientRows[0];
        if (!client) return res.status(401).json({ error: 'Invalid API Key' });

        const { rows } = await pool.query(
            `SELECT id, name, phone, branch, status, answer, source, feedback, sent_at
             FROM evaluations
             WHERE client_id = $1
             ORDER BY sent_at DESC
             LIMIT 5`,
            [client.id]
        );

        res.json({ success: true, items: rows });
    } catch (e) {
        res.status(500).json({ error: 'Database Error' });
    }
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
