'use strict';

const {
    USABLE_DIMENSIONS,
    SIGNAL_SENTIMENTS,
    MIN_AGGREGATION_CONFIDENCE
} = require('./taxonomy');

const BASELINE_DAYS = 30;
const POST_DAYS = 30;
const MIN_SIGNALS_PER_WINDOW = 5;
const OUTCOME_DELTA_THRESHOLD = 0.10;
const RATE_SCALE = 1000000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TERMINAL_STATUSES = new Set([
    'INSUFFICIENT_DATA', 'IMPROVED', 'UNCHANGED', 'WORSENED'
]);

function buildOutcomeWindows(completedAt) {
    const completed = new Date(completedAt);
    if (!Number.isFinite(completed.getTime())) throw new Error('Invalid completedAt');
    return {
        completedAt: completed,
        baselineStart: new Date(completed.getTime() - BASELINE_DAYS * DAY_MS),
        baselineEnd: completed,
        postStart: completed,
        postEnd: new Date(completed.getTime() + POST_DAYS * DAY_MS)
    };
}

function calculateRate(negativeCount, totalCount) {
    return totalCount > 0
        ? Math.round((negativeCount / totalCount) * RATE_SCALE) / RATE_SCALE
        : null;
}

function classifyOutcome(baselineTotal, postTotal, delta) {
    if (baselineTotal < MIN_SIGNALS_PER_WINDOW || postTotal < MIN_SIGNALS_PER_WINDOW) {
        return 'INSUFFICIENT_DATA';
    }
    if (delta <= -OUTCOME_DELTA_THRESHOLD) return 'IMPROVED';
    if (delta >= OUTCOME_DELTA_THRESHOLD) return 'WORSENED';
    return 'UNCHANGED';
}

function outcomeView(row) {
    const numericOrNull = value => value == null ? null : Number(value);
    return {
        id: String(row.id),
        actionId: String(row.action_id),
        completedAt: row.completed_at_snapshot,
        baselineWindow: { start: row.baseline_start, end: row.baseline_end },
        postWindow: { start: row.post_start, end: row.post_end },
        status: row.status,
        baseline: {
            negativeCount: numericOrNull(row.baseline_negative_count),
            totalCount: numericOrNull(row.baseline_total_count),
            negativeRate: numericOrNull(row.baseline_negative_rate)
        },
        post: {
            negativeCount: numericOrNull(row.post_negative_count),
            totalCount: numericOrNull(row.post_total_count),
            negativeRate: numericOrNull(row.post_negative_rate)
        },
        deltaNegativeRate: numericOrNull(row.delta_negative_rate),
        measuredAt: row.measured_at
    };
}

async function createOutcomeCycle(db, actionId, clientId) {
    const { rows } = await db.query(`INSERT INTO action_outcomes
        (action_id, completed_at_snapshot, baseline_start, baseline_end, post_start, post_end, status)
        SELECT a.id, a.completed_at,
            a.completed_at - ($3 * INTERVAL '1 day'), a.completed_at,
            a.completed_at, a.completed_at + ($4 * INTERVAL '1 day'), 'PENDING'
        FROM operational_actions a
        WHERE a.id = $1 AND a.client_id = $2 AND a.status = 'DONE' AND a.completed_at IS NOT NULL
        RETURNING id`, [actionId, clientId, BASELINE_DAYS, POST_DAYS]);
    if (!rows[0]) throw new Error('Completed action unavailable for outcome cycle');
    return rows[0];
}

async function evaluateMatureActionOutcomes(db, clientId) {
    const { rows: pending } = await db.query(`SELECT o.id::text AS id
        FROM action_outcomes o
        JOIN operational_actions a ON a.id = o.action_id
        JOIN intelligence_issues i ON i.id = a.issue_id AND i.client_id = a.client_id
        WHERE a.client_id = $1 AND o.status = 'PENDING' AND o.post_end <= NOW()
        ORDER BY o.post_end, o.id
        FOR UPDATE OF o`, [clientId]);

    if (!pending.length) return { evaluated: 0, insufficientData: 0 };
    const ids = pending.map(row => row.id);
    const { rows: aggregates } = await db.query(`SELECT o.id::text AS id,
        COUNT(e.id) FILTER (WHERE e.sent_at >= o.baseline_start AND e.sent_at < o.baseline_end)::int AS baseline_total,
        COUNT(e.id) FILTER (WHERE e.sent_at >= o.baseline_start AND e.sent_at < o.baseline_end AND s.sentiment = 'NEGATIVE')::int AS baseline_negative,
        COUNT(e.id) FILTER (WHERE e.sent_at >= o.post_start AND e.sent_at < o.post_end)::int AS post_total,
        COUNT(e.id) FILTER (WHERE e.sent_at >= o.post_start AND e.sent_at < o.post_end AND s.sentiment = 'NEGATIVE')::int AS post_negative
        FROM action_outcomes o
        JOIN operational_actions a ON a.id = o.action_id
        JOIN intelligence_issues i ON i.id = a.issue_id AND i.client_id = a.client_id
        LEFT JOIN intelligence_signals s
          ON s.client_id = i.client_id
         AND s.dimension = i.dimension
         AND s.confidence >= $3
         AND s.dimension = ANY($1::varchar[])
         AND s.sentiment = ANY($2::varchar[])
         AND (i.scope_type = 'CLIENT' OR (i.scope_type = 'BRANCH'
              AND BTRIM(COALESCE(s.branch_name, '')) = BTRIM(COALESCE(i.branch_name, ''))))
        LEFT JOIN evaluations e
          ON e.id = s.evaluation_id AND e.client_id = s.client_id
         AND ((e.sent_at >= o.baseline_start AND e.sent_at < o.baseline_end)
              OR (e.sent_at >= o.post_start AND e.sent_at < o.post_end))
        WHERE o.id = ANY($4::bigint[]) AND o.status = 'PENDING'
        GROUP BY o.id`, [
        USABLE_DIMENSIONS,
        SIGNAL_SENTIMENTS,
        MIN_AGGREGATION_CONFIDENCE,
        ids
    ]);

    let evaluated = 0;
    let insufficientData = 0;
    for (const row of aggregates) {
        const baselineTotal = Number(row.baseline_total || 0);
        const baselineNegative = Number(row.baseline_negative || 0);
        const postTotal = Number(row.post_total || 0);
        const postNegative = Number(row.post_negative || 0);
        const baselineRate = calculateRate(baselineNegative, baselineTotal);
        const postRate = calculateRate(postNegative, postTotal);
        const delta = baselineRate == null || postRate == null
            ? null
            : Math.round((postRate - baselineRate) * RATE_SCALE) / RATE_SCALE;
        const status = classifyOutcome(baselineTotal, postTotal, delta);
        if (TERMINAL_STATUSES.has(status)) {
            const result = await db.query(`UPDATE action_outcomes SET
                baseline_negative_count = $2, baseline_total_count = $3, baseline_negative_rate = $4,
                post_negative_count = $5, post_total_count = $6, post_negative_rate = $7,
                delta_negative_rate = $8, status = $9, measured_at = NOW(), updated_at = NOW()
                WHERE id = $1 AND status = 'PENDING' AND post_end <= NOW()`, [
                row.id, baselineNegative, baselineTotal, baselineRate,
                postNegative, postTotal, postRate, delta, status
            ]);
            if (result.rowCount > 0) {
                evaluated += 1;
                if (status === 'INSUFFICIENT_DATA') insufficientData += 1;
            }
        }
    }
    return { evaluated, insufficientData };
}

module.exports = {
    BASELINE_DAYS,
    POST_DAYS,
    MIN_SIGNALS_PER_WINDOW,
    OUTCOME_DELTA_THRESHOLD,
    buildOutcomeWindows,
    calculateRate,
    classifyOutcome,
    createOutcomeCycle,
    evaluateMatureActionOutcomes,
    outcomeView
};
