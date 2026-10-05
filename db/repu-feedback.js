'use strict';

const crypto = require('node:crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function submissionFingerprint(item) {
    const canonical = [item.nfcId, item.branchId, item.answer, item.rating,
        item.name, item.phone, item.feedback];
    return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

async function saveRepuFeedback(pool, item) {
    if (item.submissionKey != null && !UUID.test(item.submissionKey)) {
        const error = new Error('Invalid submission key');
        error.statusCode = 400;
        throw error;
    }
    const fingerprint = item.submissionKey ? submissionFingerprint(item) : null;
    const { rows } = await pool.query(`
        INSERT INTO evaluations
            (client_id, phone, name, branch, branch_id, status, answer, source,
             source_kind, access_method, feedback, rating,
             complaint_updated_at, submission_key, submission_fingerprint)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'nfc','REPU','UNKNOWN',$8,$9,
                CASE WHEN $7::varchar = '2' THEN NOW() ELSE NULL END,$10,$11)
        ON CONFLICT (client_id, submission_key) WHERE submission_key IS NOT NULL
        DO NOTHING
        RETURNING id`, [item.clientId, item.phone, item.name, item.branch,
        item.branchId, item.status, item.answer, item.feedback, item.rating,
        item.submissionKey, fingerprint]);
    if (rows[0]) return { id: rows[0].id, replayed: false };

    // The unique index waits for a simultaneous writer before this SELECT.
    const { rows: existing } = await pool.query(
        `SELECT id, submission_fingerprint FROM evaluations
         WHERE client_id = $1 AND submission_key = $2`,
        [item.clientId, item.submissionKey]);
    if (!existing[0]) throw new Error('Submission conflict without saved evaluation');
    if (existing[0].submission_fingerprint !== fingerprint) {
        const error = new Error('Submission key already used for different feedback');
        error.statusCode = 409;
        throw error;
    }
    return { id: existing[0].id, replayed: true };
}

module.exports = { saveRepuFeedback, submissionFingerprint };
