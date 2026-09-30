'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    APP_LOCK_NAMESPACE, createPipelineRunner
} = require('../intelligence/scheduled-pipeline-runner');
const {
    validSchedulerSecret, createScheduledPipelineHandler
} = require('../intelligence/scheduled-pipeline-api');

function fakePool(ids = [1], { locked = [], fail = [] } = {}) {
    const calls = [];
    let active = 0;
    let maxActive = 0;
    return {
        calls,
        get maxActive() { return maxActive; },
        async query(sql) {
            calls.push({ sql });
            assert.equal(sql, 'SELECT id FROM clients ORDER BY id');
            return { rows: ids.map(id => ({ id })) };
        },
        async connect() {
            active++;
            maxActive = Math.max(maxActive, active);
            let clientId;
            return {
                async query(sql, params) {
                    calls.push({ sql, params });
                    if (sql.includes('pg_try_advisory_xact_lock')) {
                        clientId = params[1];
                        assert.deepEqual(params, [APP_LOCK_NAMESPACE, clientId]);
                        return { rows: [{ acquired: !locked.includes(clientId) }] };
                    }
                    return { rows: [] };
                },
                release() { active--; }
            };
        },
        fail
    };
}

const result = {
    evaluations: 4, signals_written: 3, issues_persisted: 2,
    outcomes_evaluated: 1, issues: [{ evidence_text: 'PRIVATE' }]
};

test('tenant lock is acquired before pipeline and commits on success', async () => {
    const pool = fakePool();
    const runner = createPipelineRunner({ pipeline: async () => {
        assert.match(pool.calls.at(-1).sql, /pg_try_advisory_xact_lock/);
        return result;
    } });
    const outcome = await runner.runTenantIntelligenceWithLock(pool, { clientId: 1, days: 30 });
    assert.equal(outcome.status, 'SUCCEEDED');
    assert.equal(outcome.result, result);
    assert.deepEqual(pool.calls.map(x => x.sql).slice(-3), [
        'BEGIN',
        'SELECT pg_try_advisory_xact_lock($1::integer, $2::integer) AS acquired',
        'COMMIT'
    ]);
});

test('unavailable lock skips pipeline and rolls back', async () => {
    const pool = fakePool([1], { locked: [1] });
    const runner = createPipelineRunner({ pipeline: async () => assert.fail('pipeline ran') });
    const outcome = await runner.runTenantIntelligenceWithLock(pool, { clientId: 1, days: 30 });
    assert.deepEqual(outcome, { status: 'SKIPPED_LOCKED' });
    assert.equal(pool.calls.at(-1).sql, 'ROLLBACK');
});

test('pipeline failure rolls back and releases connection', async () => {
    const pool = fakePool();
    const runner = createPipelineRunner({ pipeline: async () => { throw Error('PRIVATE'); } });
    await assert.rejects(runner.runTenantIntelligenceWithLock(pool, { clientId: 1, days: 30 }));
    assert.equal(pool.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(pool.maxActive, 1);
});

test('concurrent attempts for one tenant use the same namespace and only one runs', async () => {
    const held = new Set();
    const keys = [];
    let unblock;
    const gate = new Promise(resolve => { unblock = resolve; });
    let notifyStarted;
    const started = new Promise(resolve => { notifyStarted = resolve; });
    let pipelineCalls = 0;
    const pool = {
        async connect() {
            let key;
            return {
                async query(sql, params) {
                    if (sql.includes('pg_try_advisory_xact_lock')) {
                        key = params.join(':');
                        keys.push(key);
                        if (held.has(key)) return { rows: [{ acquired: false }] };
                        held.add(key);
                        return { rows: [{ acquired: true }] };
                    }
                    if (sql === 'COMMIT' || sql === 'ROLLBACK') held.delete(key);
                    return { rows: [] };
                },
                release() {}
            };
        }
    };
    const runner = createPipelineRunner({ pipeline: async () => {
        pipelineCalls++;
        notifyStarted();
        await gate;
        return result;
    } });
    const first = runner.runTenantIntelligenceWithLock(pool, { clientId: 9, days: 30 });
    await started;
    const second = await runner.runTenantIntelligenceWithLock(pool, { clientId: 9, days: 30 });
    assert.equal(second.status, 'SKIPPED_LOCKED');
    unblock();
    assert.equal((await first).status, 'SUCCEEDED');
    assert.equal(pipelineCalls, 1);
    assert.deepEqual(keys, [`${APP_LOCK_NAMESPACE}:9`, `${APP_LOCK_NAMESPACE}:9`]);
});

test('batch uses ordered ids sequentially, isolates failure and lock, and logs no PII', async () => {
    const pool = fakePool([1, 2, 3], { locked: [3] });
    const started = [];
    const logs = [];
    const runner = createPipelineRunner({ log: entry => logs.push(entry), pipeline: async (_db, options) => {
        started.push(options.clientId);
        if (options.clientId === 1) throw Error('PRIVATE');
        return result;
    } });
    const summary = await runner.runScheduledIntelligenceBatch(pool);
    assert.deepEqual(started, [1, 2]);
    assert.equal(pool.maxActive, 1);
    assert.deepEqual([summary.discovered, summary.processed, summary.succeeded,
        summary.failed, summary.skippedLocked, summary.days], [3, 3, 1, 1, 1, 30]);
    assert.deepEqual(summary.tenants.map(t => t.status), ['FAILED', 'SUCCEEDED', 'SKIPPED_LOCKED']);
    assert.deepEqual(summary.tenants[1].outcomesEvaluated, 1);
    assert.ok(summary.runId);
    assert.doesNotMatch(JSON.stringify({ summary, logs }), /PRIVATE|evidence_text/);
    assert.deepEqual(logs.map(x => x.event), [
        'intelligence_scheduled_run_started',
        'intelligence_tenant_started', 'intelligence_tenant_failed',
        'intelligence_tenant_started', 'intelligence_tenant_succeeded',
        'intelligence_tenant_started', 'intelligence_tenant_skipped_locked',
        'intelligence_scheduled_run_completed'
    ]);
});

test('runner rejects invalid days before querying', async () => {
    const pool = fakePool();
    const runner = createPipelineRunner();
    await assert.rejects(runner.runScheduledIntelligenceBatch(pool, { days: 366 }), TypeError);
    assert.equal(pool.calls.length, 0);
});

function fakeResponse() {
    return {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

test('secret comparison rejects missing, wrong and unequal-length values', () => {
    assert.equal(validSchedulerSecret('correct', undefined), false);
    assert.equal(validSchedulerSecret(undefined, 'correct'), false);
    assert.equal(validSchedulerSecret('wrong', 'correct'), false);
    assert.equal(validSchedulerSecret('correct-extra', 'correct'), false);
    assert.equal(validSchedulerSecret('correct', 'correct'), true);
});

test('scheduler endpoint is fail-closed, rejects clientId, and accepts only secret', async () => {
    let calls = 0;
    let secret;
    const handler = createScheduledPipelineHandler({ pool: {}, getSecret: () => secret,
        runBatch: async (_pool, options) => { calls++; return options; } });
    const request = (header, body = {}, otherHeaders = {}) => ({ body,
        get: name => name === 'x-repu-scheduler-secret' ? header : otherHeaders[name] });
    for (const [header, configured] of [['right', undefined], [undefined, 'right'], ['wrong', 'right']]) {
        secret = configured;
        const response = fakeResponse();
        await handler(request(header), response);
        assert.equal(response.statusCode, 401);
    }
    secret = 'right';
    for (const otherHeaders of [{ authorization: 'Bearer tenant-session' }, { 'x-api-key': 'client-key' }]) {
        const response = fakeResponse();
        await handler(request(undefined, {}, otherHeaders), response);
        assert.equal(response.statusCode, 401);
    }
    const scoped = fakeResponse();
    await handler(request('right', { clientId: 1 }), scoped);
    assert.equal(scoped.statusCode, 400);
    const invalidDays = fakeResponse();
    await handler(request('right', { days: 366 }), invalidDays);
    assert.equal(invalidDays.statusCode, 400);
    const valid = fakeResponse();
    await handler(request('right', { days: 30 }), valid);
    assert.equal(valid.statusCode, 200);
    assert.equal(calls, 1);
});
