'use strict';

const {
    buildIssueEvidence
} = require('./evidence-builder');

const {
    buildEnrichmentMessages,
    validateEnrichmentResponse
} = require('./enrichment-contract');

const {
    callHumainJson
} = require('./humain-adapter');


function normalizeAiConfidence(
    value
) {
    let numberValue;

    if (
        typeof value ===
        'number'
    ) {
        numberValue =
            value;
    }
    else if (
        typeof value ===
        'string'
    ) {
        const trimmed =
            value.trim();

        if (!trimmed) {
            return value;
        }

        if (
            trimmed.endsWith(
                '%'
            )
        ) {
            const percent =
                Number(
                    trimmed.slice(
                        0,
                        -1
                    )
                );

            if (
                !Number.isFinite(
                    percent
                )
            ) {
                return value;
            }

            numberValue =
                percent / 100;
        }
        else {
            numberValue =
                Number(
                    trimmed
                );
        }
    }
    else {
        return value;
    }

    if (
        !Number.isFinite(
            numberValue
        )
    ) {
        return value;
    }

    if (
        numberValue >= 0 &&
        numberValue <= 1
    ) {
        return numberValue;
    }

    if (
        numberValue > 1 &&
        numberValue <= 100
    ) {
        return (
            numberValue / 100
        );
    }

    return numberValue;
}
async function fetchIssueForEnrichment(
    db,
    clientId,
    issueId
) {
    const { rows } =
        await db.query(
            `SELECT
                id,
                client_id,
                dimension,
                scope_type,
                branch_name,
                window_start,
                window_end,
                positive_signals,
                negative_signals,
                total_signals,
                negative_rate,
                severity,
                priority,
                status,
                detected_at,
                updated_at
             FROM intelligence_issues
             WHERE id = $1
               AND client_id = $2
               AND status IN ('OPEN', 'WATCHING')
             LIMIT 1`,
            [
                issueId,
                clientId
            ]
        );

    return rows[0] || null;
}

async function fetchIssueSignals(
    db,
    issue
) {
    const params = [
        issue.client_id,
        issue.dimension,
        issue.window_start,
        issue.window_end
    ];

    let branchClause = '';

    if (
        issue.scope_type ===
        'BRANCH'
    ) {
        params.push(
            issue.branch_name
        );

        branchClause =
            ` AND COALESCE(s.branch_name, '') =
              COALESCE($5, '')`;
    }

    const { rows } =
        await db.query(
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
                e.sent_at AS occurred_at
             FROM intelligence_signals s
             JOIN evaluations e
               ON e.id = s.evaluation_id
              AND e.client_id = s.client_id
             WHERE s.client_id = $1
               AND s.dimension = $2
               AND e.sent_at >= $3
               AND e.sent_at < $4
               ${branchClause}
             ORDER BY e.sent_at DESC,
                      s.id DESC`,
            params
        );

    return rows;
}

async function upsertIssueEnrichment(
    db,
    issueId,
    enrichment,
    metadata
) {
    const { rows } =
        await db.query(
            `INSERT INTO issue_enrichments (
                issue_id,
                likely_cause,
                confidence,
                why_text,
                recommended_action,
                success_metric,
                classification,
                model_provider,
                model_name,
                created_at,
                updated_at
             )
             VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,
                NOW(),NOW()
             )

             ON CONFLICT (issue_id)

             DO UPDATE SET
                likely_cause =
                    EXCLUDED.likely_cause,

                confidence =
                    EXCLUDED.confidence,

                why_text =
                    EXCLUDED.why_text,

                recommended_action =
                    EXCLUDED.recommended_action,

                success_metric =
                    EXCLUDED.success_metric,

                classification =
                    EXCLUDED.classification,

                model_provider =
                    EXCLUDED.model_provider,

                model_name =
                    EXCLUDED.model_name,

                updated_at =
                    NOW()

             RETURNING *`,
            [
                issueId,
                enrichment.likely_cause,
                enrichment.confidence,
                enrichment.why_text,
                enrichment.recommended_action,
                enrichment.success_metric,
                enrichment.classification,
                metadata.provider,
                metadata.model
            ]
        );

    return rows[0];
}

async function enrichIssue(
    db,
    options = {}
) {
    const clientId =
        Number(options.clientId);

    const issueId =
        Number(options.issueId);

    if (
        !Number.isInteger(clientId)
    ) {
        throw new Error(
            'clientId is required'
        );
    }

    if (
        !Number.isInteger(issueId)
    ) {
        throw new Error(
            'issueId is required'
        );
    }

    const issue =
        await fetchIssueForEnrichment(
            db,
            clientId,
            issueId
        );

    if (!issue) {
        const error =
            new Error(
                'Active issue not found'
            );

        error.code =
            'ISSUE_NOT_FOUND';

        throw error;
    }

    const signals =
        await fetchIssueSignals(
            db,
            issue
        );

    const evidencePackage =
        buildIssueEvidence(
            issue,
            signals,
            {
                limit:
                    options.evidenceLimit ||
                    5
            }
        );

    // This guard happens before any network call.
    const messages =
        buildEnrichmentMessages(
            issue,
            evidencePackage
        );

    const aiResult =
        await callHumainJson({
            env:
                options.env,

            config:
                options.config,

            fetchImpl:
                options.fetchImpl,

            messages
        });

    const canonicalAiOutput = {
        likely_cause:
            aiResult.data?.likely_cause,

        confidence:
            normalizeAiConfidence(
                aiResult.data?.confidence
            ),

        why_text:
            aiResult.data?.why_text,

        recommended_action:
            aiResult.data?.recommended_action,

        success_metric:
            aiResult.data?.success_metric,

        classification:
            'HYPOTHESIS_NOT_CONFIRMED'
    };

    const enrichment =
        validateEnrichmentResponse(
            canonicalAiOutput
        );

    const persisted =
        await upsertIssueEnrichment(
            db,
            issue.id,
            enrichment,
            {
                provider:
                    aiResult.provider,

                model:
                    aiResult.model
            }
        );

    return {
        issue,
        evidence:
            evidencePackage,

        enrichment:
            persisted
    };
}

module.exports = {
    fetchIssueForEnrichment,
    fetchIssueSignals,
    upsertIssueEnrichment,
    enrichIssue
};