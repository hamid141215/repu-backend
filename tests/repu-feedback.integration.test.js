'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { Pool } = require('pg');
const { runMigration } = require('../db/run-repu-feedback-migration');
const { saveRepuFeedback } = require('../db/repu-feedback');
const { syncEvaluationSignals } = require('../intelligence/signal-persistence');

const connectionString = process.env.PG_URL_TEST;
const baseUrl = process.env.REPU_TEST_BASE_URL;
if (!connectionString || !baseUrl || !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl)
    || new URL(connectionString).hostname !== '127.0.0.1') {
    throw new Error('Explicit isolated PG_URL_TEST and localhost REPU_TEST_BASE_URL required');
}

const pool = new Pool({ connectionString });
const suffix = crypto.randomUUID().slice(0, 8);
const clients = [];

async function insertClient(name) {
    const { rows } = await pool.query(
        `INSERT INTO clients (name, api_key, nfc_id) VALUES ($1,$2,$3) RETURNING id, api_key, nfc_id`,
        [name, `voc-test-${suffix}-${name}`, `voc-client-${suffix}-${name}`]);
    clients.push(rows[0].id);
    return rows[0];
}

async function insertBranch(client, name, code) {
    const { rows } = await pool.query(
        `INSERT INTO branches (client_id, name, nfc_id) VALUES ($1,$2,$3) RETURNING id, nfc_id`,
        [client.id, name, `voc-branch-${suffix}-${code}`]);
    return rows[0];
}

async function postReview(body) {
    const response = await fetch(`${baseUrl}/api/public/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json() };
}

test('Repu migration and submission on isolated PostgreSQL', async () => {
    try {
        const a = await insertClient('a');
        const b = await insertClient('b');
        const aBranch = await insertBranch(a, `Exact ${suffix}`, 'a');
        const bBranch = await insertBranch(b, `Exact ${suffix}`, 'b');
        const ambiguousName = `Ambiguous ${suffix}`;
        await pool.query('ALTER TABLE branches DROP CONSTRAINT IF EXISTS uniq_branch_name_per_client');
        await insertBranch(a, ambiguousName, 'ambiguous1');
        await insertBranch(a, ambiguousName, 'ambiguous2');

        const old = await Promise.all([
            pool.query(`INSERT INTO evaluations (client_id, phone, branch, source) VALUES ($1,'', $2,'nfc') RETURNING id`, [a.id, `Exact ${suffix}`]),
            pool.query(`INSERT INTO evaluations (client_id, phone, branch, source) VALUES ($1,'', $2,'nfc') RETURNING id`, [a.id, ` Exact ${suffix} `]),
            pool.query(`INSERT INTO evaluations (client_id, phone, branch, source) VALUES ($1,'', $2,'nfc') RETURNING id`, [b.id, `Exact ${suffix}`]),
            pool.query(`INSERT INTO evaluations (client_id, phone, branch, source) VALUES ($1,'', $2,'nfc') RETURNING id`, [a.id, ambiguousName]),
            pool.query(`INSERT INTO evaluations (client_id, phone, branch, source) VALUES ($1,'', $2,'nfc') RETURNING id`, [a.id, `Absent ${suffix}`])
        ]);
        const report = await runMigration(pool);
        assert.ok(report.matched >= 2);
        assert.ok(report.ambiguous >= 1);
        assert.ok(report.unmatched >= 1);
        const { rows: migrated } = await pool.query(
            `SELECT id, client_id, branch_id, source_kind, access_method
             FROM evaluations WHERE id = ANY($1::integer[]) ORDER BY id`,
            [old.map(result => result.rows[0].id)]);
        assert.equal(migrated[0].branch_id, aBranch.id);
        // Migration uses exact equality; unlike issue aggregation's BTRIM,
        // leading/trailing whitespace is not normalized to a branch match.
        assert.equal(migrated[1].branch_id, null);
        assert.equal(migrated[2].branch_id, bBranch.id);
        assert.equal(migrated[3].branch_id, null);
        assert.equal(migrated[4].branch_id, null);
        assert.ok(migrated.every(row => row.source_kind === 'REPU' && row.access_method === 'UNKNOWN'));

        const rowsBeforeRerun = await pool.query(
            `SELECT id, branch_id, source_kind, access_method, submission_key, submission_fingerprint
             FROM evaluations WHERE id = ANY($1::integer[]) ORDER BY id`,
            [old.map(result => result.rows[0].id)]);
        const rerunReport = await runMigration(pool);
        const rowsAfterRerun = await pool.query(
            `SELECT id, branch_id, source_kind, access_method, submission_key, submission_fingerprint
             FROM evaluations WHERE id = ANY($1::integer[]) ORDER BY id`,
            [old.map(result => result.rows[0].id)]);
        assert.deepEqual(rowsAfterRerun.rows, rowsBeforeRerun.rows);
        assert.ok(rerunReport.matched >= 2);
        assert.ok(rerunReport.unmatched >= 2);
        await assert.rejects(
            saveRepuFeedback(pool, { clientId: a.id, branchId: bBranch.id,
                branch: `Exact ${suffix}`, nfcId: aBranch.nfc_id, status: 'complaint',
                answer: '2', rating: 2, feedback: 'bad service', phone: '', name: null,
                submissionKey: crypto.randomUUID() }),
            error => error.code === '23503');

        const key = crypto.randomUUID();
        const body = { nfcId: aBranch.nfc_id, submissionKey: key, answer: '2',
            rating: 2, feedback: 'The service was slow', name: 'Test', phone: '0501234567' };
        const parallel = await Promise.all(Array.from({ length: 8 }, () => postReview(body)));
        assert.ok(parallel.every(result => result.status === 200));
        assert.equal(parallel.filter(result => !result.body.replayed).length, 1);
        assert.equal(new Set(parallel.map(result => result.body.evaluationId)).size, 1);
        const { rows: saved } = await pool.query(
            `SELECT * FROM evaluations WHERE client_id=$1 AND submission_key=$2`, [a.id, key]);
        assert.equal(saved.length, 1);
        assert.equal(saved[0].branch_id, aBranch.id);
        assert.equal(saved[0].source, 'nfc');
        assert.equal(saved[0].source_kind, 'REPU');
        assert.equal(saved[0].access_method, 'UNKNOWN');

        await syncEvaluationSignals(pool, saved[0]);
        const before = await pool.query('SELECT COUNT(*)::int AS n FROM intelligence_signals WHERE evaluation_id=$1', [saved[0].id]);
        assert.ok(before.rows[0].n > 0);
        // Simulate the response being lost after the database commit.
        const lost = await postReview(body);
        assert.equal(lost.status, 200);
        const retry = await postReview(body);
        assert.equal(retry.status, 200);
        assert.equal(retry.body.replayed, true);
        assert.equal(retry.body.evaluationId, parallel[0].body.evaluationId);
        const after = await pool.query('SELECT COUNT(*)::int AS n FROM intelligence_signals WHERE evaluation_id=$1', [saved[0].id]);
        assert.equal(after.rows[0].n, before.rows[0].n);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM evaluations WHERE client_id=$1 AND submission_key=$2', [a.id, key])).rows[0].n, 1);
        assert.equal((await postReview({ ...body, feedback: 'Different' })).status, 409);
        const sameKeyOtherTenant = await postReview({ ...body, nfcId: bBranch.nfc_id });
        assert.equal(sameKeyOtherTenant.status, 200);
        const otherTenantSaved = await pool.query(
            'SELECT branch_id FROM evaluations WHERE client_id=$1 AND submission_key=$2', [b.id, key]);
        assert.equal(otherTenantSaved.rows[0].branch_id, bBranch.id);

        const spoofKey = crypto.randomUUID();
        const spoof = await postReview({ nfcId: a.nfc_id, submissionKey: spoofKey,
            answer: '1', rating: 5, feedback: 'Good', branch: `Exact ${suffix}` });
        assert.equal(spoof.status, 200);
        const unassigned = await pool.query('SELECT branch_id, branch FROM evaluations WHERE client_id=$1 AND submission_key=$2', [a.id, spoofKey]);
        // The body cannot assign a branch for a client-wide link.
        assert.equal(unassigned.rows.length, 1);
        assert.equal(unassigned.rows[0].branch_id, null);
        assert.equal(unassigned.rows[0].branch, null);

        const reviewList = await fetch(`${baseUrl}/api/reviews`, { headers: { 'x-api-key': a.api_key } });
        const reviewBody = await reviewList.json();
        const item = reviewBody.items.find(row => row.id === saved[0].id);
        assert.equal(item.source_kind, 'REPU');
        assert.equal(item.access_method, 'UNKNOWN');
        assert.equal(item.branch_id, aBranch.id);
        assert.ok(!item.phone.includes('0501234567'));
        const complaints = await fetch(`${baseUrl}/api/complaints`, { headers: { 'x-api-key': a.api_key } });
        const complaintItem = (await complaints.json()).items.find(row => row.id === saved[0].id);
        assert.ok(complaintItem && !complaintItem.phone.includes('0501234567'));
        const reports = await fetch(`${baseUrl}/api/my-reports`, { headers: { 'x-api-key': a.api_key } });
        const reportItem = (await reports.json()).find(row => row.id === saved[0].id);
        assert.ok(reportItem && !reportItem.phone.includes('0501234567'));
        assert.ok(!('submission_fingerprint' in reportItem) && !('submission_key' in reportItem));
        const otherList = await fetch(`${baseUrl}/api/reviews`, { headers: { 'x-api-key': b.api_key } });
        assert.ok(!(await otherList.json()).items.some(row => row.id === saved[0].id));
    } finally {
        for (const id of clients) await pool.query('DELETE FROM clients WHERE id=$1', [id]);
        await pool.end();
    }
});
