'use strict';

const {
    syncEvaluationSignals
} = require('./signal-persistence');

const {
    buildIssueCandidates
} = require('./issue-engine');

const {
    persistIssueCandidates
} = require('./issue-persistence');
const { evaluateMatureActionOutcomes } = require('./action-outcome-service');

const RIYADH_OFFSET_MS =
    3 * 60 * 60 * 1000;

const DEFAULT_WINDOW_DAYS = 30;

function getRiyadhWindow(
    now = new Date(),
    days = DEFAULT_WINDOW_DAYS
) {
    const safeDays =
        Number.isInteger(days)
            ? Math.max(
                1,
                Math.min(days, 365)
            )
            : DEFAULT_WINDOW_DAYS;

    const riyadhNow =
        new Date(
            now.getTime() +
            RIYADH_OFFSET_MS
        );

    const windowEndDate =
        new Date(
            Date.UTC(
                riyadhNow.getUTCFullYear(),
                riyadhNow.getUTCMonth(),
                riyadhNow.getUTCDate() + 1
            ) -
            RIYADH_OFFSET_MS
        );

    const windowStartDate =
        new Date(
            windowEndDate.getTime() -
            (
                safeDays *
                24 *
                60 *
                60 *
                1000
            )
        );

    return {
        days: safeDays,
        start:
            windowStartDate.toISOString(),
        end:
            windowEndDate.toISOString()
    };
}

async function fetchEvaluationsForWindow(
    db,
    clientId,
    window
) {
    const { rows } = await db.query(
        `SELECT
            id,
            client_id,
            branch,
            rating,
            feedback,
            sent_at
         FROM evaluations
         WHERE client_id = $1
           AND feedback IS NOT NULL
           AND BTRIM(feedback) <> ''
           AND sent_at >= $2
           AND sent_at < $3
         ORDER BY sent_at ASC, id ASC`,
        [
            clientId,
            window.start,
            window.end
        ]
    );

    return rows;
}

async function fetchPersistedSignalsForWindow(
    db,
    clientId,
    window
) {
    const { rows } = await db.query(
        `SELECT
            s.id,
            s.client_id,
            s.evaluation_id,
            s.branch_name,
            s.dimension,
            s.sentiment,
            s.confidence,
            s.evidence_text,
            s.model_provider,
            s.model_name,
            s.created_at,
            e.sent_at AS occurred_at
         FROM intelligence_signals s
         JOIN evaluations e
           ON e.id = s.evaluation_id
          AND e.client_id = s.client_id
         WHERE s.client_id = $1
           AND e.sent_at >= $2
           AND e.sent_at < $3
         ORDER BY e.sent_at ASC, s.id ASC`,
        [
            clientId,
            window.start,
            window.end
        ]
    );

    return rows;
}

async function runIntelligencePipeline(
    db,
    options = {}
) {
    const clientId =
        Number(options.clientId);

    if (!Number.isInteger(clientId)) {
        throw new Error(
            'clientId is required'
        );
    }

    const now =
        options.now instanceof Date
            ? options.now
            : new Date(
                options.now || Date.now()
            );

    const window =
        getRiyadhWindow(
            now,
            options.days
        );

    const evaluations =
        await fetchEvaluationsForWindow(
            db,
            clientId,
            window
        );

    let signalsWritten = 0;

    const signalErrors = [];

    for (const evaluation of evaluations) {
        try {
            const result =
                await syncEvaluationSignals(
                    db,
                    evaluation,
                    {
                        modelProvider:
                            'deterministic',

                        modelName:
                            'ri-1b-v0.2'
                    }
                );

            signalsWritten +=
                result.written;
        } catch (error) {
            signalErrors.push({
                evaluationId:
                    evaluation.id,

                message:
                    error.message
            });
        }
    }

    if (signalErrors.length > 0) {
        const error =
            new Error(
                'Signal synchronization failed'
            );

        error.details =
            signalErrors;

        throw error;
    }

    const persistedSignals =
        await fetchPersistedSignalsForWindow(
            db,
            clientId,
            window
        );

    const issueCandidates =
        buildIssueCandidates(
            persistedSignals,
            {
                clientId,
                windowStart:
                    window.start,

                windowEnd:
                    window.end,

                now
            }
        );

    const issueResult =
        await persistIssueCandidates(
            db,
            issueCandidates
        );

    if (issueResult.errors.length > 0) {
        const error =
            new Error(
                'Issue persistence failed'
            );

        error.details =
            issueResult.errors;

        throw error;
    }

    const outcomeResult = await evaluateMatureActionOutcomes(db, clientId);

    return {
        client_id: clientId,

        window,

        evaluations:
            evaluations.length,

        signals_written:
            signalsWritten,

        persisted_signals:
            persistedSignals.length,

        issue_candidates:
            issueCandidates.length,

        issues_persisted:
            issueResult.persisted,

        outcomes_evaluated:
            outcomeResult.evaluated,

        outcomes_insufficient_data:
            outcomeResult.insufficientData,

        issues:
            issueResult.rows
    };
}

module.exports = {
    RIYADH_OFFSET_MS,
    DEFAULT_WINDOW_DAYS,
    getRiyadhWindow,
    fetchEvaluationsForWindow,
    fetchPersistedSignalsForWindow,
    runIntelligencePipeline
};
