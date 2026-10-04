'use strict';

// Display-only redaction: stored signals and detection rules are unchanged.
function readableEvidence(value) {
    return String(value || '').normalize('NFKC')
        .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, char => String(char.charCodeAt(0) - (char <= '\u0669' ? 0x0660 : 0x06f0)))
        .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
        .replace(/(?:https?:\/\/|www\.)\S+/gi, '[رابط محجوب]')
        .replace(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/g, '[بريد محجوب]')
        .replace(/@[^\s،,;]+/g, '[حساب محجوب]')
        .replace(/(?:\+|00)?\d(?:[\s().-]*\d){6,}/g, '[رقم محجوب]')
        .trim();
}

// Product reads only. No engine, pipeline or provider calls belong here.
const STATUSES = ['OPEN', 'WATCHING', 'RESOLVED', 'DISMISSED'];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const SCOPES = ['CLIENT', 'BRANCH'];
const DIMENSIONS = ['SERVICE', 'PRODUCT_QUALITY', 'STAFF', 'SPEED', 'COMMUNICATION',
    'AVAILABILITY', 'FACILITY', 'AMBIENCE', 'PRICE', 'DIGITAL_EXPERIENCE', 'OTHER'];

function badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
}

function scalar(value, key) {
    if (value === undefined) return '';
    if (typeof value !== 'string') badRequest(`Invalid ${key}`);
    return value.trim();
}

function positiveInteger(value, fallback, max, key) {
    if (value === undefined) return fallback;
    const text = scalar(value, key);
    if (!/^\d+$/.test(text)) badRequest(`Invalid ${key}`);
    const number = Number(text);
    if (!Number.isSafeInteger(number) || number < 1 || number > max) badRequest(`Invalid ${key}`);
    return number;
}

function listFilters(clientId, query) {
    const page = positiveInteger(query.page, 1, 1000000, 'page');
    const pageSize = positiveInteger(query.pageSize, 20, 100, 'pageSize');
    const statuses = query.status === undefined ? ['OPEN', 'WATCHING']
        : scalar(query.status, 'status').split(',').map(s => s.trim());
    if (!statuses.length || statuses.some(s => !STATUSES.includes(s))) badRequest('Invalid status');
    const params = [clientId, statuses];
    const conditions = ['i.client_id = $1', 'i.status = ANY($2::varchar[])'];
    for (const [key, allowed] of [['severity', SEVERITIES], ['dimension', DIMENSIONS], ['scope_type', SCOPES]]) {
        const value = scalar(query[key], key);
        if (!value) continue;
        if (!allowed.includes(value)) badRequest(`Invalid ${key}`);
        params.push(value);
        conditions.push(`i.${key} = $${params.length}`);
    }
    const branch = scalar(query.branch, 'branch');
    if (branch.length > 200) badRequest('Invalid branch');
    if (branch) {
        params.push(branch);
        conditions.push(`i.scope_type = 'BRANCH' AND i.branch_name = $${params.length}`);
    }
    const q = scalar(query.q, 'q');
    if (q.length > 200) badRequest('Invalid q');
    if (q) {
        // Literal substring search, including literal % and _; never evidence text.
        params.push(q);
        conditions.push(`(STRPOS(LOWER(i.dimension), LOWER($${params.length})) > 0
            OR STRPOS(LOWER(COALESCE(i.branch_name, '')), LOWER($${params.length})) > 0)`);
    }
    return { page, pageSize, params, where: conditions.join(' AND ') };
}

// Use evaluation occurrence time, as fetchIssueSignals does. No fuzzy linkage.
const RELATION = `s.client_id = i.client_id AND s.dimension = i.dimension
    AND e.sent_at >= i.window_start AND e.sent_at < i.window_end
    AND (i.scope_type = 'CLIENT' OR (i.scope_type = 'BRANCH'
        AND BTRIM(COALESCE(s.branch_name, '')) = BTRIM(COALESCE(i.branch_name, ''))))`;
const ELIGIBLE = `s.sentiment = 'NEGATIVE' AND s.confidence >= 0.70
    AND NULLIF(BTRIM(s.evidence_text), '') IS NOT NULL`;
const COLUMNS = `i.id, i.dimension, i.scope_type, i.branch_name, i.window_start, i.window_end,
    i.positive_signals, i.negative_signals, i.total_signals, i.negative_rate,
    i.severity, i.priority, i.status, i.detected_at, i.updated_at,
    en.classification, en.confidence AS enrichment_confidence, en.likely_cause,
    en.recommended_action, en.success_metric, en.created_at AS enriched_at,
    en.updated_at AS enrichment_updated_at, stats.evidence_count`;
const JOINS = `LEFT JOIN issue_enrichments en ON en.issue_id = i.id
    LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE ${ELIGIBLE})::int AS evidence_count
        FROM intelligence_signals s
        JOIN evaluations e ON e.id = s.evaluation_id AND e.client_id = s.client_id
        WHERE ${RELATION}
    ) stats ON true`;

function issueView(row, detail = false) {
    const summary = value => {
        if (typeof value !== 'string') return null;
        return detail ? value : value.slice(0, 240);
    };
    const result = {
        id: String(row.id), dimension: row.dimension, scopeType: row.scope_type,
        branchName: row.branch_name, windowStart: row.window_start, windowEnd: row.window_end,
        positiveCount: Number(row.positive_signals), negativeCount: Number(row.negative_signals),
        totalCount: Number(row.total_signals), negativeRate: Number(row.negative_rate),
        severity: row.severity, priority: Number(row.priority), status: row.status,
        detectedAt: row.detected_at, updatedAt: row.updated_at, evidenceCount: Number(row.evidence_count || 0),
        enrichment: row.classification ? {
            classification: row.classification,
            confidence: row.enrichment_confidence == null ? null : Number(row.enrichment_confidence),
            likelyCause: summary(row.likely_cause), recommendedAction: summary(row.recommended_action),
            successMetric: summary(row.success_metric), enrichedAt: row.enriched_at,
            updatedAt: row.enrichment_updated_at,
            ...(detail ? { whyText: summary(row.why_text) } : {})
        } : null
    };
    return result;
}

function createIssueReadHandlers(db) {
    const handleError = (res, error) => res.status(error.statusCode === 400 ? 400 : 500)
        .json({ error: error.statusCode === 400 ? error.message : 'Database Error' });
    return {
        list: async (req, res) => {
            try {
                const { page, pageSize, params, where } = listFilters(req.clientData.id, req.query);
                const limitIndex = params.length + 1;
                const { rows } = await db.query(`WITH filtered AS MATERIALIZED (
                    SELECT i.* FROM intelligence_issues i WHERE ${where}
                ), page_rows AS (
                    SELECT * FROM filtered ORDER BY priority DESC, updated_at DESC, detected_at DESC, id DESC
                    LIMIT $${limitIndex} OFFSET $${limitIndex + 1}
                ), totals AS (SELECT COUNT(*)::int AS total FROM filtered)
                SELECT ${COLUMNS}, totals.total
                FROM totals LEFT JOIN page_rows i ON true ${JOINS}
                ORDER BY i.priority DESC, i.updated_at DESC, i.detected_at DESC, i.id DESC`,
                [...params, pageSize, (page - 1) * pageSize]);
                const total = Number(rows[0]?.total || 0);
                res.json({ success: true, items: rows.filter(r => r.id != null).map(r => issueView(r)),
                    pagination: { page, pageSize, total, hasMore: page * pageSize < total } });
            } catch (error) { handleError(res, error); }
        },
        detail: async (req, res) => {
            try {
                const issueId = scalar(req.params.issueId, 'issueId');
                if (!/^[1-9]\d{0,18}$/.test(issueId) || BigInt(issueId) > 9223372036854775807n) badRequest('Invalid issueId');
                const clientId = req.clientData.id;
                const { rows } = await db.query(`SELECT ${COLUMNS}, en.why_text
                    FROM intelligence_issues i ${JOINS}
                    WHERE i.client_id = $1 AND i.id = $2`, [clientId, issueId]);
                if (!rows[0]) return res.status(404).json({ error: 'Issue not found' });
                const issue = rows[0];
                // Capture the metadata read above so a rolling-window update between
                // queries cannot attach evidence from a different issue window.
                const { rows: evidence } = await db.query(`SELECT s.evaluation_id, s.branch_name,
                    s.dimension, s.sentiment, s.confidence, s.created_at,
                    s.evidence_text, e.sent_at AS occurred_at
                    FROM (SELECT $1::integer AS client_id, $2::varchar AS dimension,
                        $3::timestamptz AS window_start, $4::timestamptz AS window_end,
                        $5::varchar AS scope_type, $6::text AS branch_name) i
                    JOIN intelligence_signals s ON s.client_id = i.client_id
                    JOIN evaluations e ON e.id = s.evaluation_id AND e.client_id = s.client_id
                    WHERE s.client_id = $1 AND ${RELATION} AND ${ELIGIBLE}
                    ORDER BY s.confidence DESC, s.created_at DESC, s.id DESC LIMIT 10`,
                [clientId, issue.dimension, issue.window_start, issue.window_end, issue.scope_type, issue.branch_name]);
                res.json({ success: true, issue: issueView(issue, true), evidence: evidence.map(s => ({
                    evaluationId: String(s.evaluation_id), branchName: readableEvidence(s.branch_name) || null, dimension: s.dimension,
                    sentiment: s.sentiment, confidence: Number(s.confidence),
                    createdAt: s.created_at, occurredAt: s.occurred_at,
                    text: readableEvidence(s.evidence_text)
                })) });
            } catch (error) { handleError(res, error); }
        }
    };
}

module.exports = { createIssueReadHandlers, listFilters, issueView };
