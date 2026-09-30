'use strict';

const crypto = require('node:crypto');
const { DEFAULT_SCHEDULED_DAYS } = require('./scheduled-pipeline-runner');

function validSchedulerSecret(provided, configured) {
    if (typeof provided !== 'string' || !provided ||
        typeof configured !== 'string' || !configured) return false;
    const actual = Buffer.from(provided, 'utf8');
    const expected = Buffer.from(configured, 'utf8');
    // timingSafeEqual requires equal lengths. Compare a fixed-size digest while
    // retaining an explicit length check to reject unequal byte strings.
    const actualDigest = crypto.createHash('sha256').update(actual).digest();
    const expectedDigest = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(actualDigest, expectedDigest) && actual.length === expected.length;
}

function createScheduledPipelineHandler({ pool, runBatch, getSecret = () => process.env.INTELLIGENCE_SCHEDULER_SECRET }) {
    return async (req, res) => {
        if (!validSchedulerSecret(req.get('x-repu-scheduler-secret'), getSecret())) {
            return res.status(401).json({ error: 'UNAUTHORIZED' });
        }
        const body = req.body || {};
        if (typeof body !== 'object' || Array.isArray(body) ||
            Object.keys(body).some(key => key !== 'days')) {
            return res.status(400).json({ error: 'INVALID_REQUEST' });
        }
        const days = body.days === undefined ? DEFAULT_SCHEDULED_DAYS : body.days;
        if (!Number.isInteger(days) || days < 1 || days > 365) {
            return res.status(400).json({ error: 'INVALID_DAYS' });
        }
        try {
            const summary = await runBatch(pool, { days });
            return res.json({ success: true, summary });
        } catch (_) {
            return res.status(500).json({ error: 'SCHEDULED_PIPELINE_ERROR' });
        }
    };
}

module.exports = { validSchedulerSecret, createScheduledPipelineHandler };
