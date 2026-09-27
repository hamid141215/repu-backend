'use strict';

const ENRICHMENT_CLASSIFICATION =
    'HYPOTHESIS_NOT_CONFIRMED';

const REQUIRED_KEYS = [
    'likely_cause',
    'confidence',
    'why_text',
    'recommended_action',
    'success_metric',
    'classification'
];

const MIN_UNIQUE_EVIDENCE = 2;

const MAX_LENGTHS = {
    likely_cause: 500,
    why_text: 1000,
    recommended_action: 1000,
    success_metric: 500
};

class EnrichmentContractError extends Error {
    constructor(
        message,
        options = {}
    ) {
        super(message);

        this.name =
            'EnrichmentContractError';

        this.code =
            options.code ||
            'ENRICHMENT_CONTRACT_ERROR';

        this.details =
            options.details ??
            null;
    }
}

function normalizeText(
    value
) {
    if (typeof value !== 'string') {
        return '';
    }

    return value
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim();
}

function assertExactKeys(
    value
) {
    const actual =
        Object.keys(value).sort();

    const expected =
        [...REQUIRED_KEYS].sort();

    if (
        actual.length !==
        expected.length
    ) {
        throw new EnrichmentContractError(
            'Unexpected enrichment fields',
            {
                code:
                    'ENRICHMENT_FIELDS_INVALID',

                details: {
                    expected,
                    actual
                }
            }
        );
    }

    for (
        let i = 0;
        i < expected.length;
        i += 1
    ) {
        if (
            actual[i] !==
            expected[i]
        ) {
            throw new EnrichmentContractError(
                'Unexpected enrichment fields',
                {
                    code:
                        'ENRICHMENT_FIELDS_INVALID',

                    details: {
                        expected,
                        actual
                    }
                }
            );
        }
    }
}

function validateStringField(
    data,
    field
) {
    const value =
        normalizeText(
            data[field]
        );

    if (!value) {
        throw new EnrichmentContractError(
            `${field} is required`,
            {
                code:
                    'ENRICHMENT_FIELD_INVALID',

                details: {
                    field
                }
            }
        );
    }

    if (
        value.length >
        MAX_LENGTHS[field]
    ) {
        throw new EnrichmentContractError(
            `${field} is too long`,
            {
                code:
                    'ENRICHMENT_FIELD_TOO_LONG',

                details: {
                    field,
                    max:
                        MAX_LENGTHS[field]
                }
            }
        );
    }

    return value;
}

function validateEnrichmentResponse(
    data
) {
    if (
        !data ||
        Array.isArray(data) ||
        typeof data !== 'object'
    ) {
        throw new EnrichmentContractError(
            'Enrichment response must be an object',
            {
                code:
                    'ENRICHMENT_OBJECT_REQUIRED'
            }
        );
    }

    assertExactKeys(
        data
    );

    if (
        data.classification !==
        ENRICHMENT_CLASSIFICATION
    ) {
        throw new EnrichmentContractError(
            'classification must remain hypothesis-only',
            {
                code:
                    'ENRICHMENT_CLASSIFICATION_INVALID'
            }
        );
    }

    const confidence =
        Number(
            data.confidence
        );

    if (
        !Number.isFinite(
            confidence
        ) ||
        confidence < 0 ||
        confidence > 1
    ) {
        throw new EnrichmentContractError(
            'confidence must be between 0 and 1',
            {
                code:
                    'ENRICHMENT_CONFIDENCE_INVALID'
            }
        );
    }

    return {
        likely_cause:
            validateStringField(
                data,
                'likely_cause'
            ),

        confidence,

        why_text:
            validateStringField(
                data,
                'why_text'
            ),

        recommended_action:
            validateStringField(
                data,
                'recommended_action'
            ),

        success_metric:
            validateStringField(
                data,
                'success_metric'
            ),

        classification:
            ENRICHMENT_CLASSIFICATION
    };
}

function assertEvidenceEligible(
    evidencePackage
) {
    if (
        !evidencePackage ||
        !Array.isArray(
            evidencePackage.evidence
        )
    ) {
        throw new EnrichmentContractError(
            'Evidence package is required',
            {
                code:
                    'ENRICHMENT_EVIDENCE_REQUIRED'
            }
        );
    }

    if (
        Number(
            evidencePackage
                .unique_evidence_count
        ) <
        MIN_UNIQUE_EVIDENCE
    ) {
        throw new EnrichmentContractError(
            'Insufficient unique evidence for AI enrichment',
            {
                code:
                    'ENRICHMENT_EVIDENCE_INSUFFICIENT'
            }
        );
    }

    const usable =
        evidencePackage.evidence
            .filter(
                (item) =>
                    item &&
                    normalizeText(
                        item.text
                    )
            );

    if (
        usable.length <
        MIN_UNIQUE_EVIDENCE
    ) {
        throw new EnrichmentContractError(
            'Insufficient usable evidence for AI enrichment',
            {
                code:
                    'ENRICHMENT_EVIDENCE_INSUFFICIENT'
            }
        );
    }

    return usable;
}

function buildEnrichmentMessages(
    issue,
    evidencePackage
) {
    if (!issue) {
        throw new EnrichmentContractError(
            'Issue is required',
            {
                code:
                    'ENRICHMENT_ISSUE_REQUIRED'
            }
        );
    }

    const evidence =
        assertEvidenceEligible(
            evidencePackage
        );

    const immutableFacts = {
        issue_id:
            issue.id ?? null,

        dimension:
            issue.dimension,

        scope_type:
            issue.scope_type,

        branch_name:
            issue.branch_name ??
            null,

        severity:
            issue.severity,

        priority:
            Number(
                issue.priority
            ),

        negative_signals:
            Number(
                issue.negative_signals
            ),

        total_signals:
            Number(
                issue.total_signals
            ),

        negative_rate:
            Number(
                issue.negative_rate
            ),

        window_start:
            issue.window_start,

        window_end:
            issue.window_end
    };

    const evidenceOnly =
        evidence.map(
            (item) => ({
                evaluation_id:
                    item.evaluation_id,

                branch_name:
                    item.branch_name ??
                    null,

                confidence:
                    Number(
                        item.confidence
                    ),

                text:
                    normalizeText(
                        item.text
                    ),

                occurred_at:
                    item.occurred_at ??
                    null
            })
        );

    const system = [
        'You are Repu operational intelligence.',
        'Return exactly one non-empty JSON object.',
        'Use only the supplied issue facts and customer evidence.',
        'The cause is a hypothesis, not a confirmed fact.',
        'When evidence is limited, still provide the most plausible cautious hypothesis and lower the confidence score.',
        'All Arabic text fields must be concise and operational.',
        'confidence must be a JSON number between 0 and 1.',
        `classification must equal "${ENRICHMENT_CLASSIFICATION}".`,
        'Return exactly these six keys and no others: likely_cause, confidence, why_text, recommended_action, success_metric, classification.',
        'Do not return an empty object.'
    ].join('\n');
    const userPayload = {
        task:
            'Generate a cautious hypothesis-based operational enrichment for this issue.',

        immutable_issue_facts:
            immutableFacts,

        evidence:
            evidenceOnly,

        output_contract: {
            likely_cause:
                'Required non-empty Arabic cautious hypothesis.',

            confidence:
                'Required JSON number from 0 to 1.',

            why_text:
                'Required non-empty Arabic explanation tied directly to the evidence.',

            recommended_action:
                'Required non-empty Arabic operational action that tests or addresses the hypothesis.',

            success_metric:
                'Required non-empty Arabic measurable outcome for the next observation period.',

            classification:
                ENRICHMENT_CLASSIFICATION
        }
    };
    return [
        {
            role:
                'system',

            content:
                system
        },

        {
            role:
                'user',

            content:
                JSON.stringify(
                    userPayload
                )
        }
    ];
}

module.exports = {
    ENRICHMENT_CLASSIFICATION,
    REQUIRED_KEYS,
    MIN_UNIQUE_EVIDENCE,
    MAX_LENGTHS,
    EnrichmentContractError,
    normalizeText,
    validateEnrichmentResponse,
    assertEvidenceEligible,
    buildEnrichmentMessages
};