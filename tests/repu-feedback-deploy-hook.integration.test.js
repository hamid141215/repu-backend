'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Pool } = require('pg');
const { DEFAULT_TOTAL_TIMEOUT_MS, runMigration, ensureMigration, backfillLegacyFeedback } = require('../db/run-repu-feedback-migration');

const connectionString = process.env.PG_URL_TEST;
if (!connectionString || new URL(connectionString).hostname !== '127.0.0.1') {
    throw new Error('Explicit localhost PG_URL_TEST required');
}

test('Beanstalk hook migration deadline, rollback, and data-only legacy catch-up', async () => {
    assert.equal(DEFAULT_TOTAL_TIMEOUT_MS, 30_000);
    const schema = `repu_hook_${crypto.randomBytes(6).toString('hex')}`;
    const admin = new Pool({ connectionString, connectionTimeoutMillis: 3000, max: 2 });
    let pool;
    try {
        await admin.query(`CREATE SCHEMA ${schema}`);
        pool = new Pool({ connectionString, options: `-c search_path=${schema}`, connectionTimeoutMillis: 3000, max: 5 });
        await pool.query(`
            CREATE TABLE clients (
                id SERIAL PRIMARY KEY, name TEXT NOT NULL, api_key TEXT NOT NULL UNIQUE, nfc_id TEXT UNIQUE
            );
            CREATE TABLE branches (
                id SERIAL PRIMARY KEY, client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
                name TEXT NOT NULL, nfc_id TEXT UNIQUE
            );
            CREATE TABLE evaluations (
                id SERIAL PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                phone VARCHAR(20) NOT NULL DEFAULT '', name VARCHAR(255), branch VARCHAR(255),
                status VARCHAR(50) NOT NULL DEFAULT 'pending', answer VARCHAR(5), sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                source TEXT DEFAULT 'dashboard', feedback TEXT, rating INT, complaint_status TEXT DEFAULT 'new',
                complaint_updated_at TIMESTAMP, complaint_resolved_at TIMESTAMP, complaint_note TEXT,
                reply_text TEXT, replied_at TIMESTAMPTZ
            );
            INSERT INTO clients (name, api_key) VALUES ('synthetic', 'local-hook-test');
            INSERT INTO branches (client_id, name) VALUES (1, 'Exact Branch');
            INSERT INTO evaluations (client_id, branch, source, feedback)
            VALUES (1, 'Exact Branch', 'nfc', 'synthetic old feedback');
        `);

        const blocker = await pool.connect();
        await blocker.query('BEGIN');
        await blocker.query('SELECT * FROM evaluations');
        const timeoutStartedAt = Date.now();
        await assert.rejects(runMigration(pool, { totalTimeoutMs: 300 }),
            error => error.code === 'MIGRATION_TOTAL_TIMEOUT');
        assert.ok(Date.now() - timeoutStartedAt < 3_000, 'timeout aborts promptly without an extended wait');
        const afterTimeout = await pool.query(`
            SELECT COUNT(*)::int AS count
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = 'evaluations'
              AND column_name IN ('source_kind', 'access_method', 'branch_id', 'submission_key', 'submission_fingerprint')
        `, [schema]);
        assert.equal(afterTimeout.rows[0].count, 0);
        assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM evaluations')).rows[0].count, 1);
        await blocker.query('ROLLBACK');
        blocker.release();

        const report = await runMigration(pool, { totalTimeoutMs: 30_000 });
        assert.deepEqual(report, { matched: 1, unmatched: 0, ambiguous: 0, no_branch: 0 });
        const completeSchema = await schemaShapeForEnsure(pool, schema);
        assert.deepEqual(await ensureMigration(pool, { totalTimeoutMs: 30_000 }), { skipped: true });
        assert.deepEqual((await schemaShapeForEnsure(pool, schema)).rows, completeSchema.rows);
        await pool.query(`
            INSERT INTO evaluations (client_id, phone, name, branch, status, answer, source, feedback, rating)
            VALUES (1, '', 'Synthetic legacy', 'Exact Branch', 'complaint', '2', 'nfc', 'old-version window', 2)
        `);
        const schemaShape = async () => pool.query(`
            SELECT
                (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'evaluations')::int AS columns,
                (SELECT COUNT(*) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
                 JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1)::int AS constraints,
                (SELECT COUNT(*) FROM pg_indexes WHERE schemaname=$1)::int AS indexes
        `, [schema]);
        const beforeBackfill = await schemaShape();
        const backfill = await backfillLegacyFeedback(pool, { totalTimeoutMs: 30_000 });
        assert.deepEqual(backfill, { sourceKindUpdated: 1, branchIdsAssigned: 1 });
        const migrated = await pool.query(`
            SELECT source, source_kind, access_method, branch_id, submission_key
            FROM evaluations WHERE name = 'Synthetic legacy'
        `);
        assert.deepEqual(migrated.rows[0], {
            source: 'nfc', source_kind: 'REPU', access_method: 'UNKNOWN', branch_id: 1, submission_key: null
        });
        assert.deepEqual((await schemaShape()).rows, beforeBackfill.rows);
        assert.deepEqual(await backfillLegacyFeedback(pool, { totalTimeoutMs: 30_000 }),
            { sourceKindUpdated: 0, branchIdsAssigned: 0 });

        const predeployHook = fs.readFileSync(path.join(__dirname, '..', '.platform/hooks/predeploy/50_repu_source_migration.sh'), 'utf8');
        const postdeployHook = fs.readFileSync(path.join(__dirname, '..', '.platform/hooks/postdeploy/90_repu_source_legacy_backfill.sh'), 'utf8');
        assert.match(predeployHook, /get-config.*environment -k PG_URL/s);
        assert.match(predeployHook, /exec "\$node_bin" "\$migration_script" --ensure/);
        assert.match(postdeployHook, /--backfill-legacy/);
        assert.doesNotMatch(`${predeployHook}\n${postdeployHook}`, /(?:^|\n)\s*set\s+-x\b|echo\s+[^\n]*\$\{?PG_URL\b/im);
    } finally {
        if (pool) await pool.end();
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await admin.end();
    }
});

async function schemaShapeForEnsure(pool, schema) {
    return pool.query(`
        SELECT
            (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=$1 AND table_name='evaluations')::int AS columns,
            (SELECT COUNT(*) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
             JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1)::int AS constraints,
            (SELECT COUNT(*) FROM pg_indexes WHERE schemaname=$1)::int AS indexes
    `, [schema]);
}
