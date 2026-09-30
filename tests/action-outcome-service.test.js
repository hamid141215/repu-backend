'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
    BASELINE_DAYS,
    POST_DAYS,
    MIN_SIGNALS_PER_WINDOW,
    OUTCOME_DELTA_THRESHOLD,
    buildOutcomeWindows,
    classifyOutcome,
    evaluateMatureActionOutcomes
} = require('../intelligence/action-outcome-service');

const completedAt = new Date('2026-09-29T12:00:00.000Z');

function measurementDb({ pending = [{ id: '5' }], aggregates = [{
    id: '5', baseline_total: 10, baseline_negative: 3, post_total: 10, post_negative: 1
}] } = {}) {
    const calls = [];
    return {
        calls,
        async query(sql, params = []) {
            calls.push({ sql, params });
            if (sql.includes('SELECT o.id::text AS id') && sql.includes('FOR UPDATE OF o')) return { rows: pending };
            if (sql.includes('COUNT(e.id) FILTER')) return { rows: aggregates };
            if (sql.includes('UPDATE action_outcomes SET')) return { rowCount: 1, rows: [] };
            return { rows: [] };
        }
    };
}

test('uses fixed 30-day half-open windows anchored on completion time', () => {
    assert.equal(BASELINE_DAYS, 30);
    assert.equal(POST_DAYS, 30);
    const windows = buildOutcomeWindows(completedAt);
    assert.equal(windows.baselineEnd.toISOString(), completedAt.toISOString());
    assert.equal(windows.postStart.toISOString(), completedAt.toISOString());
    assert.equal(windows.baselineStart.getTime(), completedAt.getTime() - 30 * 86400000);
    assert.equal(windows.postEnd.getTime(), completedAt.getTime() + 30 * 86400000);
});

test('minimum data and exact +/-10 percentage-point thresholds classify as specified', () => {
    assert.equal(MIN_SIGNALS_PER_WINDOW, 5);
    assert.equal(OUTCOME_DELTA_THRESHOLD, 0.10);
    assert.equal(classifyOutcome(4, 10, -0.5), 'INSUFFICIENT_DATA');
    assert.equal(classifyOutcome(10, 4, 0.5), 'INSUFFICIENT_DATA');
    assert.equal(classifyOutcome(10, 10, -0.10), 'IMPROVED');
    assert.equal(classifyOutcome(10, 10, 0.10), 'WORSENED');
    assert.equal(classifyOutcome(10, 10, -0.099), 'UNCHANGED');
    assert.equal(classifyOutcome(10, 10, 0.099), 'UNCHANGED');
});

test('mature pending cycle counts same-dimension eligible signals by evaluations.sent_at and stores terminal metrics', async () => {
    const db = measurementDb();
    const result = await evaluateMatureActionOutcomes(db, 7);
    assert.deepEqual(result, { evaluated: 1, insufficientData: 0 });
    const pendingQuery = db.calls[0];
    assert.deepEqual(pendingQuery.params, [7]);
    assert.match(pendingQuery.sql, /a\.client_id = \$1/);
    assert.match(pendingQuery.sql, /o\.status = 'PENDING' AND o\.post_end <= NOW\(\)/);
    assert.match(pendingQuery.sql, /FOR UPDATE OF o/);
    const query = db.calls[1];
    assert.match(query.sql, /e\.sent_at >= o\.baseline_start AND e\.sent_at < o\.baseline_end/);
    assert.match(query.sql, /e\.sent_at >= o\.post_start AND e\.sent_at < o\.post_end/);
    assert.match(query.sql, /s\.dimension = i\.dimension/);
    assert.match(query.sql, /s\.confidence >= \$3/);
    assert.match(query.sql, /s\.sentiment = ANY\(\$2::varchar\[\]\)/);
    assert.match(query.sql, /s\.sentiment = 'NEGATIVE'/);
    assert.match(query.sql, /BTRIM\(COALESCE\(s\.branch_name, ''\)\) = BTRIM\(COALESCE\(i\.branch_name, ''\)\)/);
    assert.match(query.sql, /i\.scope_type = 'CLIENT' OR/);
    assert.match(query.sql, /e\.id = s\.evaluation_id AND e\.client_id = s\.client_id/);
    assert.doesNotMatch(query.sql, /evidence_text|created_at/);
    assert.ok(!query.params[0].includes('UNCLEAR') && !query.params[0].includes('NOISE'));
    assert.equal(query.params[2], 0.70);
    assert.ok(query.params[1].includes('MIXED') && query.params[1].includes('NEUTRAL'));
    const update = db.calls[2];
    assert.deepEqual(update.params, ['5', 3, 10, 0.3, 1, 10, 0.1, -0.2, 'IMPROVED']);
    assert.match(update.sql, /WHERE id = \$1 AND status = 'PENDING' AND post_end <= NOW\(\)/);
});

test('low baseline or post count persists INSUFFICIENT_DATA and observed counts', async () => {
    const db = measurementDb({ aggregates: [{ id: '5', baseline_total: 5, baseline_negative: 2, post_total: 4, post_negative: 1 }] });
    const result = await evaluateMatureActionOutcomes(db, 7);
    assert.deepEqual(result, { evaluated: 1, insufficientData: 1 });
    assert.equal(db.calls[2].params[8], 'INSUFFICIENT_DATA');
    assert.equal(db.calls[2].params[7], -0.15);
});

test('future pending outcome is untouched and no aggregate/update query runs', async () => {
    const db = measurementDb({ pending: [] });
    const result = await evaluateMatureActionOutcomes(db, 7);
    assert.deepEqual(result, { evaluated: 0, insufficientData: 0 });
    assert.equal(db.calls.length, 1);
});

test('terminal outcomes are never selected for recomputation', async () => {
    const db = measurementDb({ pending: [] });
    await evaluateMatureActionOutcomes(db, 7);
    assert.match(db.calls[0].sql, /o\.status = 'PENDING'/);
    assert.equal(db.calls.some(call => call.sql.includes('UPDATE action_outcomes')), false);
});

test('pipeline evaluates outcomes after issue persistence; both routes use shared transaction runner', () => {
    const pipeline = fs.readFileSync(path.join(__dirname, '../intelligence/pipeline.js'), 'utf8');
    const issuesAt = pipeline.indexOf('await persistIssueCandidates');
    const outcomesAt = pipeline.indexOf('await evaluateMatureActionOutcomes(db, clientId)');
    assert.ok(issuesAt >= 0 && outcomesAt > issuesAt);
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const routeAt = server.indexOf("app.post('/api/internal/intelligence/run-pipeline'");
    const manualAt = server.indexOf('await runTenantIntelligenceWithLock(pool,', routeAt);
    const scheduledAt = server.indexOf("app.post('/api/internal/intelligence/run-scheduled-pipeline'", routeAt);
    assert.ok(routeAt >= 0 && manualAt > routeAt && scheduledAt > manualAt);
    const runner = fs.readFileSync(path.join(__dirname, '../intelligence/scheduled-pipeline-runner.js'), 'utf8');
    assert.ok(runner.indexOf("await connection.query('BEGIN')") < runner.indexOf('await pipeline(connection,'));
    assert.ok(runner.indexOf('await pipeline(connection,') < runner.indexOf("await connection.query('COMMIT')"));
});
