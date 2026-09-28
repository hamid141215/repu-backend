'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createIssueReadHandlers, listFilters, issueView } = require('../intelligence/issue-read-api');

const issue = {
    id: '1', client_id: 7, dimension: 'SPEED', scope_type: 'BRANCH', branch_name: 'الرياض',
    window_start: '2026-09-01T00:00:00Z', window_end: '2026-09-28T00:00:00Z',
    positive_signals: 2, negative_signals: 3, total_signals: 5, negative_rate: '0.6',
    severity: 'HIGH', priority: '65.25', status: 'OPEN', detected_at: '2026-09-27', updated_at: '2026-09-28',
    evidence_count: 3, classification: null,
    name: 'اسم اختباري', phone: '0501234567', email: 'test@example.com', model_provider: 'internal',
    model_name: 'internal', raw_response: 'secret', prompt: 'secret'
};

function response() {
    return { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

async function list(query = {}, rows = [{ ...issue, total: 1 }]) {
    const calls = [];
    const db = { async query(sql, params) { calls.push({ sql, params }); return { rows }; } };
    const res = response();
    await createIssueReadHandlers(db).list({ clientData: { id: 7 }, query }, res);
    return { res, calls };
}

test('list tenant comes from identity; query client_id is ignored', async () => {
    const { calls, res } = await list({ client_id: '999' });
    assert.equal(calls[0].params[0], 7);
    assert.match(calls[0].sql, /i.client_id = \$1/);
    assert.equal(calls.length, 1);
    assert.equal(res.body.items.length, 1);
});

test('foreign issue returns 404 and never queries evidence', async () => {
    const calls = [];
    const db = { async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; } };
    const res = response();
    await createIssueReadHandlers(db).detail({ clientData: { id: 7 }, params: { issueId: '99' } }, res);
    assert.equal(res.code, 404);
    assert.deepEqual(calls[0].params, [7, '99']);
    assert.match(calls[0].sql, /WHERE i.client_id = \$1 AND i.id = \$2/);
    assert.equal(calls.length, 1);
});

test('default status excludes resolved/dismissed', () => {
    assert.deepEqual(listFilters(7, {}).params, [7, ['OPEN', 'WATCHING']]);
});

test('pagination and count share one filtered SQL source before limit', async () => {
    const { calls, res } = await list({ page: '2', pageSize: '2' }, [{ ...issue, total: 5 }]);
    const { sql, params } = calls[0];
    assert.match(sql, /COUNT\(\*\)::int AS total FROM filtered/);
    assert.match(sql, /SELECT \* FROM filtered ORDER BY priority DESC/);
    assert.match(sql, /LIMIT \$3 OFFSET \$4/);
    assert.deepEqual(params.slice(-2), [2, 2]);
    assert.deepEqual(res.body.pagination, { page: 2, pageSize: 2, total: 5, hasMore: true });
});

test('page outside results preserves total with no sentinel item', async () => {
    const { res } = await list({ page: '3' }, [{ id: null, total: 21 }]);
    assert.deepEqual(res.body.items, []);
    assert.equal(res.body.pagination.total, 21);
    assert.equal(res.body.pagination.hasMore, false);
});

for (const [key, value, condition] of [
    ['severity', 'HIGH', 'i.severity = $3'], ['status', 'RESOLVED', 'i.status = ANY($2::varchar[])'],
    ['dimension', 'SPEED', 'i.dimension = $3'], ['scope_type', 'CLIENT', 'i.scope_type = $3'],
    ['branch', 'الرياض', "i.scope_type = 'BRANCH' AND i.branch_name = $3"]
]) {
    test(`${key} filter is parameterized before pagination`, () => {
        const result = listFilters(7, { [key]: value });
        assert.ok(result.where.includes(condition));
        assert.ok(key === 'status' ? result.params[1].includes(value) : result.params.includes(value));
    });
}

test('q uses literal substring on dimension/branch only, never evidence', () => {
    const result = listFilters(7, { q: "%_' OR 1=1 --" });
    assert.match(result.where, /STRPOS\(LOWER\(i.dimension\)/);
    assert.match(result.where, /i.branch_name/);
    assert.ok(!result.where.includes('evidence'));
    assert.ok(!result.where.includes('OR 1=1'));
    assert.equal(result.params[2], "%_' OR 1=1 --");
});

test('invalid bounds/enums/objects return 400 without database work', async () => {
    for (const query of [{ page: '0' }, { page: '1.2' }, { pageSize: '101' }, { status: 'anything' },
        { severity: 'URGENT' }, { scope_type: 'OTHER' }, { q: ['a'] }, { branch: {} }, { dimension: 'NOISE' }]) {
        const { res, calls } = await list(query);
        assert.equal(res.code, 400);
        assert.equal(calls.length, 0);
    }
});

test('detail returns metadata only and SQL enforces tenant, normalized scope, window and eligibility', async () => {
    const calls = [];
    const db = { async query(sql, params) {
        calls.push({ sql, params });
        return { rows: calls.length === 1 ? [issue] : [{ evaluation_id: 12, branch_name: ' الرياض ',
            dimension: 'SPEED', sentiment: 'NEGATIVE', confidence: '0.9',
            created_at: '2026-09-27',
            evidence_text: 'فاطمة أحمد، جوال ٠٥٥١٢٣٤٥٦٧، fatima@example.test، هوية ١٠٢٣٤٥٦٧٨٩، طلب ٩٩١٢٣٤، شارع الملك فهد، الرياض',
            comment_body: 'نص حر إضافي', raw_text: 'raw free text',
            customer_name: 'فاطمة أحمد', phone: '٠٥٥١٢٣٤٥٦٧', email: 'fatima@example.test',
            identity_number: '١٠٢٣٤٥٦٧٨٩', order_number: '٩٩١٢٣٤', address: 'شارع الملك فهد' }] };
    } };
    const res = response();
    await createIssueReadHandlers(db).detail({ clientData: { id: 7 }, params: { issueId: '1' } }, res);
    assert.equal(res.code, 200);
    assert.equal(calls.length, 2);
    const { sql, params } = calls[1];
    assert.deepEqual(params, [7, issue.dimension, issue.window_start, issue.window_end, issue.scope_type, issue.branch_name]);
    for (const clause of ['s.client_id = $1', 's.client_id = i.client_id',
        'e.client_id = s.client_id', 's.dimension = i.dimension', 'e.sent_at >= i.window_start',
        'e.sent_at < i.window_end', "i.scope_type = 'CLIENT'",
        "BTRIM(COALESCE(s.branch_name, '')) = BTRIM(COALESCE(i.branch_name, ''))", 's.confidence >= 0.70',
        "s.sentiment = 'NEGATIVE'", 's.confidence DESC, s.created_at DESC', 'LIMIT 10']) assert.ok(sql.includes(clause), clause);
    const text = JSON.stringify(res.body);
    for (const secret of ['فاطمة أحمد', '٠٥٥١٢٣٤٥٦٧', 'fatima@example.test', '١٠٢٣٤٥٦٧٨٩',
        '٩٩١٢٣٤', 'شارع الملك فهد', 'evidenceText', 'evidence_text', 'comment_body', 'raw_text',
        'customer_name', 'phone', 'email', 'identity_number', 'order_number', 'address', 'model_name']) {
        assert.ok(!text.includes(secret), `response leaked ${secret}`);
    }
    assert.deepEqual(Object.keys(res.body.evidence[0]).sort(),
        ['branchName', 'confidence', 'createdAt', 'dimension', 'evaluationId', 'sentiment']);
    assert.ok(!sql.slice(0, sql.indexOf('FROM')).includes('evidence_text'), 'detail SELECT projection must not select free text');
    assert.equal(res.body.issue.negativeCount, 3);
    assert.equal(res.body.issue.evidenceCount, 3);
});

test('only explicit public fields are serialized; enrichment is optional', () => {
    const view = issueView(issue);
    assert.equal(view.enrichment, null);
    assert.equal(view.priority, 65.25);
    for (const key of ['client_id', 'name', 'phone', 'email', 'privacy_values', 'model_provider', 'model_name', 'raw_response', 'prompt']) assert.ok(!(key in view));
});

test('enrichment present includes hypothesis, detail whyText, timestamps', () => {
    const enriched = { ...issue, classification: 'HYPOTHESIS_NOT_CONFIRMED', enrichment_confidence: '0.8',
        likely_cause: 'اسم اختباري: نقص الموظفين', why_text: 'تكرار التأخير', recommended_action: 'مراجعة الخدمة',
        success_metric: 'انخفاض التأخير', enriched_at: '2026-09-28', enrichment_updated_at: '2026-09-28' };
    const view = issueView(enriched, true);
    assert.equal(view.enrichment.classification, 'HYPOTHESIS_NOT_CONFIRMED');
    assert.equal(view.enrichment.confidence, 0.8);
    assert.equal(view.enrichment.whyText, 'تكرار التأخير');
    assert.equal(view.enrichment.likelyCause, 'اسم اختباري: نقص الموظفين');
    assert.ok(!('whyText' in issueView(enriched).enrichment));
    assert.equal(issueView({ ...enriched, likely_cause: 'أ'.repeat(400) }).enrichment.likelyCause.length, 240);
});

test('BRANCH matching trims both stored branch values like issue aggregation', async () => {
    const branchIssue = { ...issue, branch_name: 'الرياض', scope_type: 'BRANCH' };
    const calls = [];
    const db = { async query(sql, params) {
        calls.push({ sql, params });
        return { rows: calls.length === 1 ? [branchIssue] : [{
            evaluation_id: 13, branch_name: ' الرياض ', dimension: 'SPEED',
            sentiment: 'NEGATIVE', confidence: '0.9', created_at: '2026-09-27'
        }] };
    } };
    const res = response();
    await createIssueReadHandlers(db).detail({ clientData: { id: 7 }, params: { issueId: '1' } }, res);
    assert.equal(res.code, 200);
    assert.match(calls[1].sql, /BTRIM\(COALESCE\(s\.branch_name, ''\)\) = BTRIM\(COALESCE\(i\.branch_name, ''\)\)/);
    assert.equal(calls[1].params[4], 'BRANCH');
    assert.equal(calls[1].params[5], 'الرياض');
    assert.equal(res.body.evidence[0].branchName, ' الرياض ');
});

test('CLIENT scope includes matching-dimension signals from multiple branches', async () => {
    const clientIssue = { ...issue, scope_type: 'CLIENT', branch_name: null };
    const calls = [];
    const db = { async query(sql, params) {
        calls.push({ sql, params });
        return { rows: calls.length === 1 ? [clientIssue] : [
            { evaluation_id: 21, branch_name: 'الرياض', dimension: 'SPEED', sentiment: 'NEGATIVE', confidence: '0.8', created_at: '2026-09-20' },
            { evaluation_id: 22, branch_name: 'جدة', dimension: 'SPEED', sentiment: 'NEGATIVE', confidence: '0.9', created_at: '2026-09-21' }
        ] };
    } };
    const res = response();
    await createIssueReadHandlers(db).detail({ clientData: { id: 7 }, params: { issueId: '1' } }, res);
    assert.equal(calls[1].params[4], 'CLIENT');
    assert.match(calls[1].sql, /i\.scope_type = 'CLIENT' OR \(i\.scope_type = 'BRANCH'/);
    assert.deepEqual(res.body.evidence.map(e => e.branchName), ['الرياض', 'جدة']);
});

test('BRANCH scope constrains evidence to its normalized branch', async () => {
    const calls = [];
    const db = { async query(sql, params) {
        calls.push({ sql, params });
        if (calls.length === 1) return { rows: [issue] };
        const candidateRows = [
            { evaluation_id: 31, branch_name: ' الرياض ', dimension: 'SPEED', sentiment: 'NEGATIVE', confidence: '0.8', created_at: '2026-09-20' },
            { evaluation_id: 32, branch_name: 'جدة', dimension: 'SPEED', sentiment: 'NEGATIVE', confidence: '0.9', created_at: '2026-09-21' }
        ];
        return { rows: candidateRows.filter(row => row.branch_name.trim() === params[5].trim()) };
    } };
    const res = response();
    await createIssueReadHandlers(db).detail({ clientData: { id: 7 }, params: { issueId: '1' } }, res);
    assert.equal(calls[1].params[4], 'BRANCH');
    assert.match(calls[1].sql, /BTRIM\(COALESCE\(s\.branch_name, ''\)\) = BTRIM\(COALESCE\(i\.branch_name, ''\)\)/);
    assert.deepEqual(calls[1].params.slice(4), ['BRANCH', 'الرياض']);
    assert.deepEqual(res.body.evidence.map(e => e.evaluationId), ['31']);
    // The SQL branch predicate rejects another branch before it can enter the result.
    assert.ok(!res.body.evidence.some(e => e.branchName === 'جدة'));
});

test('evidence window includes start and excludes end', async () => {
    const calls = [];
    const db = { async query(sql, params) {
        calls.push({ sql, params });
        const evidenceRows = [
            { evaluation_id: 41, branch_name: 'الرياض', dimension: 'SPEED', sentiment: 'NEGATIVE', confidence: '0.8', sent_at: issue.window_start, created_at: issue.window_start },
            { evaluation_id: 42, branch_name: 'الرياض', dimension: 'SPEED', sentiment: 'NEGATIVE', confidence: '0.9', sent_at: issue.window_end, created_at: issue.window_end }
        ];
        if (calls.length === 1) return { rows: [issue] };
        const [start, end] = [new Date(params[2]).getTime(), new Date(params[3]).getTime()];
        return { rows: evidenceRows.filter(row => {
            const sentAt = new Date(row.sent_at).getTime();
            return sentAt >= start && sentAt < end;
        }) };
    } };
    const res = response();
    await createIssueReadHandlers(db).detail({ clientData: { id: 7 }, params: { issueId: '1' } }, res);
    assert.match(calls[1].sql, /e\.sent_at >= i\.window_start/);
    assert.match(calls[1].sql, /e\.sent_at < i\.window_end/);
    assert.deepEqual(calls[1].params.slice(2, 4), [issue.window_start, issue.window_end]);
    // The mock returns only rows accepted by the query; start is included, end is excluded.
    assert.deepEqual(res.body.evidence.map(e => e.evaluationId), ['41']);
});

test('empty evidence text can leave evidenceCount below the aggregated negativeCount', () => {
    const row = { ...issue, negative_signals: 4, total_signals: 6, evidence_count: 3 };
    const view = issueView(row);
    assert.equal(view.negativeCount, 4);
    assert.equal(view.evidenceCount, 3);
    const source = fs.readFileSync(path.join(__dirname, '../intelligence/issue-read-api.js'), 'utf8');
    assert.match(source, /COUNT\(\*\) FILTER \(WHERE \$\{ELIGIBLE\}\)/);
    assert.match(source, /NULLIF\(BTRIM\(s\.evidence_text\), ''\) IS NOT NULL/);
    assert.match(source, /i\.negative_signals/);
});

test('unsafe/overflowing IDs are rejected without database access', async () => {
    for (const id of ['0', '-1', '1 OR 1=1', '1.5', '9223372036854775808']) {
        let called = false;
        const res = response();
        await createIssueReadHandlers({ query() { called = true; } }).detail({ clientData: { id: 7 }, params: { issueId: id } }, res);
        assert.equal(res.code, 400);
        assert.equal(called, false);
    }
});

test('database errors do not leak SQL/secrets', async () => {
    const res = response();
    await createIssueReadHandlers({ query() { throw new Error('secret SQL'); } }).list({ clientData: { id: 7 }, query: {} }, res);
    assert.equal(res.code, 500);
    assert.deepEqual(res.body, { error: 'Database Error' });
});

test('product routes use authenticate, have no owner restriction and no mutation routes', () => {
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    assert.ok(server.includes("app.get('/api/intelligence/issues', authenticate, issueReadHandlers.list)"));
    assert.ok(server.includes("app.get('/api/intelligence/issues/:issueId', authenticate, issueReadHandlers.detail)"));
    assert.ok(!/app\.(post|patch|put|delete)\('\/api\/intelligence\/issues/.test(server));
    const source = fs.readFileSync(path.join(__dirname, '../intelligence/issue-read-api.js'), 'utf8');
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/.test(source));
    assert.ok(!source.includes('humain'));
});
