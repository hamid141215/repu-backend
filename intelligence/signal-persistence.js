'use strict';

const {
    classifyFeedback,
    validateSignal
} = require('./signal-engine');

async function fetchPendingEvaluations(pool, options = {}) {
    const limit = Number.isInteger(options.limit)
        ? Math.max(1, Math.min(options.limit, 500))
        : 200;

    const clientId = options.clientId
        ? Number(options.clientId)
        : null;

    const params = [];
    const filters = [
        `e.feedback IS NOT NULL`,
        `BTRIM(e.feedback) <> ''`
    ];

    if (clientId) {
        params.push(clientId);
        filters.push(`e.client_id = $${params.length}`);
    }

    params.push(limit);

    const sql = `
        SELECT
            e.id,
            e.client_id,
            e.branch,
            e.rating,
            e.feedback,
            e.sent_at
        FROM evaluations e
        WHERE ${filters.join('\n          AND ')}
        ORDER BY e.sent_at ASC, e.id ASC
        LIMIT $${params.length}
    `;

    const { rows } = await pool.query(sql, params);

    return rows;
}

async function upsertSignal(pool, evaluation, signal, metadata = {}) {
    if (!validateSignal(signal)) {
        throw new Error(
            `Invalid signal for evaluation ${evaluation.id}`
        );
    }

    const modelProvider =
        metadata.modelProvider || 'deterministic';

    const modelName =
        metadata.modelName || 'ri-1b-v0.2';

    const sql = `
        INSERT INTO intelligence_signals (
            client_id,
            evaluation_id,
            branch_name,
            dimension,
            sentiment,
            confidence,
            evidence_text,
            model_provider,
            model_name
        )
        VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9
        )
        ON CONFLICT (evaluation_id, dimension)
        DO UPDATE SET
            client_id = EXCLUDED.client_id,
            branch_name = EXCLUDED.branch_name,
            sentiment = EXCLUDED.sentiment,
            confidence = EXCLUDED.confidence,
            evidence_text = EXCLUDED.evidence_text,
            model_provider = EXCLUDED.model_provider,
            model_name = EXCLUDED.model_name
        RETURNING id
    `;

    const params = [
        evaluation.client_id,
        evaluation.id,
        evaluation.branch || null,
        signal.dimension,
        signal.sentiment,
        Number(signal.confidence),
        signal.evidence_text || evaluation.feedback || null,
        modelProvider,
        modelName
    ];

    const { rows } = await pool.query(sql, params);

    return rows[0];
}

async function persistEvaluationSignals(
    pool,
    evaluation,
    metadata = {}
) {
    const classification =
        classifyFeedback(
            evaluation.feedback,
            {
                rating: evaluation.rating
            }
        );

    let written = 0;

    for (const signal of classification.signals) {
        await upsertSignal(
            pool,
            evaluation,
            signal,
            metadata
        );

        written += 1;
    }

    return {
        evaluationId: evaluation.id,
        classification: classification.classification,
        usable: classification.usable,
        written
    };
}

async function syncEvaluationSignals(
    pool,
    evaluation,
    metadata = {}
) {
    const classification =
        classifyFeedback(
            evaluation.feedback,
            {
                rating: evaluation.rating
            }
        );

    const dimensions =
        classification.signals.map(
            (signal) => signal.dimension
        );

    // Remove derived signals that are no longer produced
    // by the current classifier version.
    await pool.query(
        `DELETE FROM intelligence_signals
         WHERE client_id = $1
           AND evaluation_id = $2
           AND NOT (
               dimension = ANY($3::text[])
           )`,
        [
            evaluation.client_id,
            evaluation.id,
            dimensions
        ]
    );

    let written = 0;

    for (const signal of classification.signals) {
        await upsertSignal(
            pool,
            evaluation,
            signal,
            metadata
        );

        written += 1;
    }

    return {
        evaluationId: evaluation.id,
        classification:
            classification.classification,
        usable:
            classification.usable,
        written
    };
}
async function processSignalBatch(pool, options = {}) {
    const evaluations =
        await fetchPendingEvaluations(pool, options);

    const result = {
        evaluations: evaluations.length,
        signalsWritten: 0,
        usableEvaluations: 0,
        unclearEvaluations: 0,
        noiseEvaluations: 0,
        errors: []
    };

    for (const evaluation of evaluations) {
        try {
            const persisted =
                await persistEvaluationSignals(
                    pool,
                    evaluation,
                    options.metadata || {}
                );

            result.signalsWritten +=
                persisted.written;

            if (persisted.usable) {
                result.usableEvaluations += 1;
            }

            if (
                persisted.classification ===
                'UNCLEAR'
            ) {
                result.unclearEvaluations += 1;
            }

            if (
                persisted.classification ===
                'NOISE'
            ) {
                result.noiseEvaluations += 1;
            }
        } catch (error) {
            result.errors.push({
                evaluationId: evaluation.id,
                message: error.message
            });
        }
    }

    return result;
}

module.exports = {
    fetchPendingEvaluations,
    upsertSignal,
    persistEvaluationSignals,
    syncEvaluationSignals,
    processSignalBatch
};