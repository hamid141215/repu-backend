'use strict';

const crypto = require('node:crypto');
const { runIntelligencePipeline } = require('./pipeline');

// Two-int advisory-lock key: application namespace + tenant id.
const APP_LOCK_NAMESPACE = 1380996437;
const DEFAULT_SCHEDULED_DAYS = 30;

function createPipelineRunner({ pipeline = runIntelligencePipeline, log = console.log } = {}) {
    async function runTenantIntelligenceWithLock(pool, { clientId, days }) {
        if (!Number.isInteger(clientId) || clientId < 1) throw new TypeError('Invalid clientId');
        if (!Number.isInteger(days) || days < 1 || days > 365) throw new TypeError('Invalid days');

        const connection = await pool.connect();
        let transactionStarted = false;
        try {
            await connection.query('BEGIN');
            transactionStarted = true;
            const { rows } = await connection.query(
                'SELECT pg_try_advisory_xact_lock($1::integer, $2::integer) AS acquired',
                [APP_LOCK_NAMESPACE, clientId]
            );
            if (rows[0]?.acquired !== true) {
                await connection.query('ROLLBACK');
                transactionStarted = false;
                return { status: 'SKIPPED_LOCKED' };
            }

            const result = await pipeline(connection, { clientId, days });
            await connection.query('COMMIT');
            transactionStarted = false;
            return { status: 'SUCCEEDED', result };
        } catch (error) {
            if (transactionStarted) {
                try { await connection.query('ROLLBACK'); } catch (_) {}
            }
            throw error;
        } finally {
            connection.release();
        }
    }

    async function runScheduledIntelligenceBatch(pool, { days = DEFAULT_SCHEDULED_DAYS } = {}) {
        if (!Number.isInteger(days) || days < 1 || days > 365) throw new TypeError('Invalid days');
        const runId = crypto.randomUUID();
        const startedAt = Date.now();
        const summary = {
            runId, days, discovered: 0, processed: 0, succeeded: 0,
            failed: 0, skippedLocked: 0, durationMs: 0, tenants: []
        };
        let batchStatus = 'SUCCEEDED';
        log({ event: 'intelligence_scheduled_run_started', runId, days });

        try {
            const { rows } = await pool.query('SELECT id FROM clients ORDER BY id');
            summary.discovered = rows.length;
            for (const row of rows) {
                const clientId = row.id;
                const tenantStartedAt = Date.now();
                summary.processed += 1;
                log({ event: 'intelligence_tenant_started', runId, clientId, days });
                try {
                    const outcome = await runTenantIntelligenceWithLock(pool, { clientId, days });
                    const durationMs = Date.now() - tenantStartedAt;
                    if (outcome.status === 'SKIPPED_LOCKED') {
                        summary.skippedLocked += 1;
                        summary.tenants.push({ clientId, status: 'SKIPPED_LOCKED', durationMs });
                        log({ event: 'intelligence_tenant_skipped_locked', runId, clientId, durationMs });
                        continue;
                    }
                    const result = outcome.result;
                    const counts = {
                        evaluations: result.evaluations,
                        signalsWritten: result.signals_written,
                        issuesPersisted: result.issues_persisted,
                        outcomesEvaluated: result.outcomes_evaluated
                    };
                    summary.succeeded += 1;
                    summary.tenants.push({ clientId, status: 'SUCCEEDED', durationMs, ...counts });
                    log({ event: 'intelligence_tenant_succeeded', runId, clientId, durationMs, ...counts });
                } catch (error) {
                    const durationMs = Date.now() - tenantStartedAt;
                    summary.failed += 1;
                    summary.tenants.push({ clientId, status: 'FAILED', durationMs });
                    log({ event: 'intelligence_tenant_failed', runId, clientId, durationMs,
                        errorCode: typeof error.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code)
                            ? error.code : 'PIPELINE_ERROR' });
                }
            }
            return summary;
        } catch (error) {
            batchStatus = 'FAILED';
            throw error;
        } finally {
            summary.durationMs = Date.now() - startedAt;
            log({ event: 'intelligence_scheduled_run_completed', runId, days, status: batchStatus,
                discovered: summary.discovered, processed: summary.processed,
                succeeded: summary.succeeded, failed: summary.failed,
                skippedLocked: summary.skippedLocked, durationMs: summary.durationMs });
        }
    }

    return { runTenantIntelligenceWithLock, runScheduledIntelligenceBatch };
}

module.exports = { APP_LOCK_NAMESPACE, DEFAULT_SCHEDULED_DAYS, createPipelineRunner };
