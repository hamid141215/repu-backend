'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

async function runMigration(pool) {
    const sql = fs.readFileSync(path.join(__dirname, 'migrations', '001_repu_feedback_source.sql'), 'utf8');
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        // Bound lock waits and each migration statement. A timeout fails the
        // migration once; it is never retried automatically.
        await db.query("SET LOCAL lock_timeout = '5s'");
        await db.query("SET LOCAL statement_timeout = '10min'");
        const result = await db.query(sql);
        await db.query('COMMIT');
        return (Array.isArray(result) ? result.at(-1) : result).rows[0];
    } catch (error) {
        try {
            await db.query('ROLLBACK');
        } catch (rollbackError) {
            throw new AggregateError([error, rollbackError],
                `Migration failed (${error.message}); ROLLBACK also failed (${rollbackError.message})`);
        }
        throw error;
    } finally {
        db.release();
    }
}

if (require.main === module) {
    if (!process.env.PG_URL) throw new Error('PG_URL is required');
    const pool = new Pool({ connectionString: process.env.PG_URL });
    runMigration(pool)
        .then(report => console.log(JSON.stringify({ migration: '001_repu_feedback_source', ...report })))
        .catch(error => { console.error(error); process.exitCode = 1; })
        .finally(() => pool.end());
}

module.exports = { runMigration };
