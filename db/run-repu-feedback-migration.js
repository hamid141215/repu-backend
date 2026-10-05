'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const DEFAULT_TOTAL_TIMEOUT_MS = 30_000;

function migrationTimeoutError(totalTimeoutMs) {
    const error = new Error(`Database operation exceeded ${totalTimeoutMs}ms total timeout`);
    error.code = 'MIGRATION_TOTAL_TIMEOUT';
    return error;
}

async function runTransaction(pool, task, { totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS } = {}) {
    if (!Number.isInteger(totalTimeoutMs) || totalTimeoutMs < 1) {
        throw new TypeError('totalTimeoutMs must be a positive integer');
    }

    // Reserve a second connection so the migration backend can be cancelled
    // even while its DDL query is waiting for a lock.
    const cancelClient = await pool.connect();
    let db;
    let timeoutHandle;
    let terminateRequest;
    let backendTerminated = false;
    let queryActive = false;
    let timedOut = false;
    let transactionStarted = false;
    let backendPid;
    const deadline = Date.now() + totalTimeoutMs;

    try {
        db = await pool.connect();
        const pidResult = await db.query('SELECT pg_backend_pid() AS pid');
        backendPid = pidResult.rows[0].pid;
        await db.query('BEGIN');
        transactionStarted = true;
        await db.query("SET LOCAL lock_timeout = '5s'");
        await db.query("SET LOCAL statement_timeout = '10min'");

        timeoutHandle = setTimeout(() => {
            timedOut = true;
            if (queryActive) {
                // Terminate the migration session at the hard deadline. PostgreSQL
                // rolls back its open transaction and releases its locks as the
                // backend exits; discarding the client also guarantees the caller
                // does not keep waiting for the running query or rollback response.
                const abandoned = db;
                db = null;
                transactionStarted = false;
                abandoned?.release(migrationTimeoutError(totalTimeoutMs));
                terminateRequest = cancelClient.query(
                    'SELECT pg_terminate_backend($1) AS terminated', [backendPid]
                ).then(result => {
                    backendTerminated = result.rows[0]?.terminated === true;
                }).catch(() => false);
            }
        }, Math.max(1, deadline - Date.now()));

        const result = await task(async (sql, values) => {
            if (timedOut || Date.now() >= deadline) throw migrationTimeoutError(totalTimeoutMs);
            queryActive = true;
            try {
                return await db.query(sql, values);
            } finally {
                queryActive = false;
            }
        });

        if (timedOut || Date.now() >= deadline) throw migrationTimeoutError(totalTimeoutMs);
        const commitBudgetMs = deadline - Date.now();
        if (commitBudgetMs < 1) throw migrationTimeoutError(totalTimeoutMs);
        queryActive = true;
        try {
            await db.query("SELECT set_config('statement_timeout', $1, true)", [`${commitBudgetMs}ms`]);
            await db.query('COMMIT');
            transactionStarted = false;
        } finally {
            queryActive = false;
        }
        return result;
    } catch (error) {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (terminateRequest) await terminateRequest;
        const failure = timedOut || Date.now() >= deadline
            ? migrationTimeoutError(totalTimeoutMs)
            : error;
        if (transactionStarted && backendTerminated) {
            // A terminated PostgreSQL backend has already rolled back; discard
            // its dead client rather than returning it to the pool.
            db.release(failure);
            db = null;
            transactionStarted = false;
        }
        if (transactionStarted && !backendTerminated) {
            try {
                await db.query('ROLLBACK');
                transactionStarted = false;
            } catch (rollbackError) {
                db.release(rollbackError);
                db = null;
                throw new AggregateError([failure, rollbackError],
                    `Database operation failed (${failure.code || 'DB_ERROR'}); ROLLBACK also failed (${rollbackError.code || 'DB_ERROR'})`);
            }
        }
        throw failure;
    } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (db) db.release();
        cancelClient.release();
    }
}

async function runMigration(pool, options) {
    const sql = fs.readFileSync(path.join(__dirname, 'migrations', '001_repu_feedback_source.sql'), 'utf8');
    return runTransaction(pool, async query => {
        const result = await query(sql);
        return (Array.isArray(result) ? result.at(-1) : result).rows[0];
    }, options);
}

async function hasCompleteSchema(pool) {
    const { rows } = await pool.query(`
        SELECT
            (SELECT COUNT(DISTINCT column_name) = 5
             FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'evaluations'
               AND column_name = ANY(ARRAY['source_kind','access_method','branch_id','submission_key','submission_fingerprint'])) AS columns_complete,
            (SELECT COUNT(*) = 4
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
             WHERE n.nspname = current_schema() AND t.relname = 'evaluations'
               AND c.conname = ANY(ARRAY['evaluations_source_kind_check','evaluations_access_method_check',
                   'evaluations_submission_pair_check','evaluations_branch_same_client_fk'])) AS constraints_complete,
            (SELECT COUNT(*) = 3
             FROM pg_indexes
             WHERE schemaname = current_schema()
               AND indexname = ANY(ARRAY['uq_branches_client_id_id','uq_evaluations_client_submission_key',
                   'idx_evaluations_client_branch_id'])) AS indexes_complete
    `);
    return rows[0].columns_complete && rows[0].constraints_complete && rows[0].indexes_complete;
}

async function ensureMigration(pool, options) {
    if (await hasCompleteSchema(pool)) return { skipped: true };
    return { skipped: false, ...(await runMigration(pool, options)) };
}

async function backfillLegacyFeedback(pool, options) {
    return runTransaction(pool, async query => {
        const sourceKinds = await query(`
            UPDATE evaluations
            SET source_kind = 'REPU'
            WHERE source_kind IS NULL AND source IN ('nfc', 'dashboard')`);
        const branches = await query(`
            WITH matched AS (
                SELECT e.id AS evaluation_id, MIN(b.id) AS branch_id
                FROM evaluations e
                JOIN branches b ON b.client_id = e.client_id AND b.name = e.branch
                WHERE e.branch_id IS NULL AND e.branch IS NOT NULL AND BTRIM(e.branch) <> ''
                GROUP BY e.id
                HAVING COUNT(*) = 1
            )
            UPDATE evaluations e SET branch_id = matched.branch_id
            FROM matched WHERE e.id = matched.evaluation_id`);
        return { sourceKindUpdated: sourceKinds.rowCount, branchIdsAssigned: branches.rowCount };
    }, options);
}

if (require.main === module) {
    if (!process.env.PG_URL) throw new Error('PG_URL is required');
    const pool = new Pool({
        connectionString: process.env.PG_URL,
        connectionTimeoutMillis: 10_000,
        options: '-c statement_timeout=15s -c lock_timeout=5s',
        max: 3
    });
    const backfillOnly = process.argv.includes('--backfill-legacy');
    const ensureOnly = process.argv.includes('--ensure');
    const operation = backfillOnly
        ? backfillLegacyFeedback(pool)
        : ensureOnly ? ensureMigration(pool) : runMigration(pool);
    operation
        .then(report => console.log(JSON.stringify({
            event: backfillOnly ? 'repu_feedback_legacy_backfill_complete'
                : 'repu_feedback_migration_complete',
            ...report
        })))
        .catch(error => {
            const code = typeof error.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code)
                ? error.code : 'DATABASE_OPERATION_FAILED';
            console.error(JSON.stringify({ event: 'repu_feedback_database_operation_failed', code }));
            process.exitCode = 1;
        })
        .finally(() => pool.end());
}

module.exports = {
    DEFAULT_TOTAL_TIMEOUT_MS, runMigration, ensureMigration, backfillLegacyFeedback
};
