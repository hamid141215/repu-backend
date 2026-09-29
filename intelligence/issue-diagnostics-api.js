'use strict';

const {
    USABLE_DIMENSIONS,
    SIGNAL_SENTIMENTS,
    MIN_AGGREGATION_CONFIDENCE
} = require('./taxonomy');

const DIAGNOSTIC_QUERY = `WITH evaluation_stats AS (
    SELECT COUNT(*)::int AS evaluations, MAX(sent_at) AS latest_evaluation_at
    FROM evaluations
    WHERE client_id = $1
), signal_stats AS (
    SELECT COUNT(*)::int AS signals,
        COUNT(*) FILTER (WHERE dimension = ANY($2::varchar[])
            AND sentiment = ANY($3::varchar[]) AND confidence >= $4)::int AS eligible_signals,
        COUNT(*) FILTER (WHERE dimension = ANY($2::varchar[])
            AND sentiment = 'NEGATIVE' AND confidence >= $4)::int AS eligible_negative_signals,
        MAX(created_at) AS latest_signal_at
    FROM intelligence_signals
    WHERE client_id = $1
), issue_stats AS (
    SELECT COUNT(*)::int AS issues, MAX(updated_at) AS latest_issue_at
    FROM intelligence_issues
    WHERE client_id = $1
), negative_dimensions AS (
    SELECT dimension, COUNT(*)::int AS count
    FROM intelligence_signals
    WHERE client_id = $1
        AND dimension = ANY($2::varchar[])
        AND sentiment = 'NEGATIVE'
        AND confidence >= $4
    GROUP BY dimension
), distribution AS (
    SELECT COALESCE(json_agg(json_build_object('dimension', dimension, 'count', count)
        ORDER BY dimension), '[]'::json) AS negative_by_dimension
    FROM negative_dimensions
)
SELECT evaluation_stats.evaluations, evaluation_stats.latest_evaluation_at,
    signal_stats.signals, signal_stats.eligible_signals,
    signal_stats.eligible_negative_signals, signal_stats.latest_signal_at,
    issue_stats.issues, issue_stats.latest_issue_at,
    distribution.negative_by_dimension
FROM evaluation_stats CROSS JOIN signal_stats CROSS JOIN issue_stats CROSS JOIN distribution`;

function diagnosisFor({ evaluations, signals, eligibleSignals, eligibleNegativeSignals, issues }) {
    if (issues > 0) return 'ISSUES_EXIST';
    if (evaluations === 0) return 'NO_EVALUATIONS';
    if (signals === 0) return 'NO_SIGNALS';
    if (eligibleSignals === 0) return 'NO_ELIGIBLE_SIGNALS';
    if (eligibleNegativeSignals < 2) return 'INSUFFICIENT_NEGATIVES';
    return 'NO_ISSUES_GENERATED';
}

function createIssueDiagnosticsHandler(db) {
    return async (req, res) => {
        try {
            const clientId = req.clientData.id;
            const { rows } = await db.query(DIAGNOSTIC_QUERY, [
                clientId,
                USABLE_DIMENSIONS,
                SIGNAL_SENTIMENTS,
                MIN_AGGREGATION_CONFIDENCE
            ]);
            const row = rows[0] || {};
            const counts = {
                evaluations: Number(row.evaluations || 0),
                signals: Number(row.signals || 0),
                eligibleSignals: Number(row.eligible_signals || 0),
                eligibleNegativeSignals: Number(row.eligible_negative_signals || 0),
                issues: Number(row.issues || 0)
            };
            const negativeByDimension = Array.isArray(row.negative_by_dimension)
                ? row.negative_by_dimension.map(item => ({
                    dimension: item.dimension,
                    count: Number(item.count)
                }))
                : [];
            res.json({
                ...counts,
                latestEvaluationAt: row.latest_evaluation_at || null,
                latestSignalAt: row.latest_signal_at || null,
                latestIssueAt: row.latest_issue_at || null,
                negativeByDimension,
                diagnosis: diagnosisFor(counts)
            });
        } catch {
            res.status(500).json({ error: 'Database Error' });
        }
    };
}

module.exports = { createIssueDiagnosticsHandler, diagnosisFor, DIAGNOSTIC_QUERY };
