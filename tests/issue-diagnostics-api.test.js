'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createIssueDiagnosticsHandler, diagnosisFor, DIAGNOSTIC_QUERY } = require('../intelligence/issue-diagnostics-api');
const { USABLE_DIMENSIONS, SIGNAL_SENTIMENTS, MIN_AGGREGATION_CONFIDENCE } = require('../intelligence/taxonomy');

function response() {
    return { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

async function invoke(row, request = { clientData: { id: 41 }, query: { client_id: 999 } }) {
    const calls = [];
    const res = response();
    await createIssueDiagnosticsHandler({ async query(sql, params) { calls.push({ sql, params }); return { rows: row ? [row] : [] }; } })(request, res);
    return { calls, res };
}

test('diagnostics uses authenticated tenant id and taxonomy constants, ignoring request client_id', async () => {
    const { calls } = await invoke({});
    assert.equal(calls.length, 1);
    assert.equal(calls[0].params[0], 41);
    assert.deepEqual(calls[0].params[1], USABLE_DIMENSIONS);
    assert.deepEqual(calls[0].params[2], SIGNAL_SENTIMENTS);
    assert.equal(calls[0].params[3], MIN_AGGREGATION_CONFIDENCE);
    assert.match(calls[0].sql, /WHERE client_id = \$1/);
    assert.match(calls[0].sql, /FROM evaluations[\s\S]*?WHERE client_id = \$1/);
    assert.match(calls[0].sql, /FROM intelligence_signals[\s\S]*?WHERE client_id = \$1/);
    assert.match(calls[0].sql, /FROM intelligence_issues[\s\S]*?WHERE client_id = \$1/);
});

test('diagnostics query is read-only SQL and response contains only counts, timestamps, distribution, diagnosis', async () => {
    const { calls, res } = await invoke({
        evaluations: 5, latest_evaluation_at: '2026-09-28T10:00:00Z',
        signals: 4, eligible_signals: 3, eligible_negative_signals: 2,
        latest_signal_at: '2026-09-28T10:01:00Z', issues: 0, latest_issue_at: null,
        negative_by_dimension: [{ dimension: 'SERVICE', count: 2 }]
    });
    assert.match(calls[0].sql.trim(), /^WITH/);
    assert.doesNotMatch(calls[0].sql, /\b(?:INSERT|UPDATE|DELETE|UPSERT|CREATE|ALTER|DROP|CALL)\b/i);
    assert.deepEqual(res.body, {
        evaluations: 5, signals: 4, eligibleSignals: 3, eligibleNegativeSignals: 2, issues: 0,
        latestEvaluationAt: '2026-09-28T10:00:00Z', latestSignalAt: '2026-09-28T10:01:00Z',
        latestIssueAt: null, negativeByDimension: [{ dimension: 'SERVICE', count: 2 }],
        diagnosis: 'NO_ISSUES_GENERATED'
    });
    const serialized = JSON.stringify(res.body).toLowerCase();
    for (const field of ['evidence', 'text', 'phone', 'email', 'name', 'branch', 'client_id']) assert.ok(!serialized.includes(field));
});

test('zero counts and missing timestamps return a conservative empty diagnosis', async () => {
    const { res } = await invoke(null);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, {
        evaluations: 0, signals: 0, eligibleSignals: 0, eligibleNegativeSignals: 0, issues: 0,
        latestEvaluationAt: null, latestSignalAt: null, latestIssueAt: null,
        negativeByDimension: [], diagnosis: 'NO_EVALUATIONS'
    });
});

test('diagnosis mapping distinguishes each pipeline stage and existing issues', () => {
    assert.equal(diagnosisFor({ evaluations: 4, signals: 0, eligibleSignals: 0, eligibleNegativeSignals: 0, issues: 0 }), 'NO_SIGNALS');
    assert.equal(diagnosisFor({ evaluations: 4, signals: 3, eligibleSignals: 0, eligibleNegativeSignals: 0, issues: 0 }), 'NO_ELIGIBLE_SIGNALS');
    assert.equal(diagnosisFor({ evaluations: 4, signals: 3, eligibleSignals: 2, eligibleNegativeSignals: 1, issues: 0 }), 'INSUFFICIENT_NEGATIVES');
    assert.equal(diagnosisFor({ evaluations: 4, signals: 3, eligibleSignals: 2, eligibleNegativeSignals: 2, issues: 0 }), 'NO_ISSUES_GENERATED');
    assert.equal(diagnosisFor({ evaluations: 0, signals: 0, eligibleSignals: 0, eligibleNegativeSignals: 0, issues: 1 }), 'ISSUES_EXIST');
});

test('server mounts diagnostics behind authenticate without write-role requirement', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(server.includes("app.get('/api/intelligence/diagnostics/issues', authenticate, issueDiagnosticsHandler)"));
});

test('diagnostic query has no write or schema initialization operation', () => {
    assert.doesNotMatch(DIAGNOSTIC_QUERY, /\b(?:INSERT|UPDATE|DELETE|UPSERT|CREATE|ALTER|DROP|CALL)\b/i);
});
