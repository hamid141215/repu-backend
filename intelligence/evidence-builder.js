'use strict';

const MIN_EVIDENCE_CONFIDENCE = 0.70;
const DEFAULT_EVIDENCE_LIMIT = 5;
const MAX_EVIDENCE_LIMIT = 20;

function normalizeEvidenceText(value) {
    if (typeof value !== 'string') {
        return '';
    }

    return value
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeBranch(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return null;
    }

    const normalized =
        String(value).trim();

    return normalized || null;
}

function isSignalInIssueScope(
    issue,
    signal
) {
    if (
        issue.scope_type === 'CLIENT'
    ) {
        return true;
    }

    if (
        issue.scope_type === 'BRANCH'
    ) {
        return (
            normalizeBranch(
                signal.branch_name
            ) ===
            normalizeBranch(
                issue.branch_name
            )
        );
    }

    return false;
}

function compareEvidence(a, b) {
    const aTime =
        Date.parse(
            a.occurred_at || ''
        );

    const bTime =
        Date.parse(
            b.occurred_at || ''
        );

    const safeATime =
        Number.isFinite(aTime)
            ? aTime
            : 0;

    const safeBTime =
        Number.isFinite(bTime)
            ? bTime
            : 0;

    if (safeATime !== safeBTime) {
        return safeBTime - safeATime;
    }

    const aConfidence =
        Number(a.confidence) || 0;

    const bConfidence =
        Number(b.confidence) || 0;

    if (
        aConfidence !==
        bConfidence
    ) {
        return (
            bConfidence -
            aConfidence
        );
    }

    return (
        Number(b.evaluation_id || 0) -
        Number(a.evaluation_id || 0)
    );
}

function buildIssueEvidence(
    issue,
    signals,
    options = {}
) {
    if (!issue) {
        throw new Error(
            'issue is required'
        );
    }

    if (!Array.isArray(signals)) {
        throw new Error(
            'signals must be an array'
        );
    }

    const requestedLimit =
        Number(options.limit);

    const limit =
        Number.isInteger(
            requestedLimit
        )
            ? Math.max(
                1,
                Math.min(
                    requestedLimit,
                    MAX_EVIDENCE_LIMIT
                )
            )
            : DEFAULT_EVIDENCE_LIMIT;

    const eligible =
        signals.filter(
            (signal) => {
                if (!signal) {
                    return false;
                }

                if (
                    signal.dimension !==
                    issue.dimension
                ) {
                    return false;
                }

                if (
                    signal.sentiment !==
                    'NEGATIVE'
                ) {
                    return false;
                }

                if (
                    Number(
                        signal.confidence
                    ) <
                    MIN_EVIDENCE_CONFIDENCE
                ) {
                    return false;
                }

                if (
                    !isSignalInIssueScope(
                        issue,
                        signal
                    )
                ) {
                    return false;
                }

                return (
                    normalizeEvidenceText(
                        signal.evidence_text
                    ).length > 0
                );
            }
        )
        .map((signal) => ({
            signal_id:
                signal.id ?? null,

            evaluation_id:
                signal.evaluation_id,

            branch_name:
                normalizeBranch(
                    signal.branch_name
                ),

            confidence:
                Number(
                    signal.confidence
                ),

            text:
                normalizeEvidenceText(
                    signal.evidence_text
                ),

            occurred_at:
                signal.occurred_at ??
                null
        }))
        .sort(compareEvidence);

    const seen =
        new Set();

    const uniqueEvidence = [];

    for (const item of eligible) {
        const key =
            item.text
                .toLocaleLowerCase('ar');

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);

        uniqueEvidence.push(item);
    }

    const branchSet =
        new Set(
            eligible
                .map(
                    (item) =>
                        item.branch_name
                )
                .filter(Boolean)
        );

    return {
        issue_id:
            issue.id ?? null,

        dimension:
            issue.dimension,

        scope_type:
            issue.scope_type,

        branch_name:
            normalizeBranch(
                issue.branch_name
            ),

        window_start:
            issue.window_start ??
            null,

        window_end:
            issue.window_end ??
            null,

        negative_signal_count:
            eligible.length,

        unique_evidence_count:
            uniqueEvidence.length,

        distinct_branch_count:
            branchSet.size,

        evidence:
            uniqueEvidence.slice(
                0,
                limit
            )
    };
}

module.exports = {
    MIN_EVIDENCE_CONFIDENCE,
    DEFAULT_EVIDENCE_LIMIT,
    MAX_EVIDENCE_LIMIT,
    normalizeEvidenceText,
    isSignalInIssueScope,
    buildIssueEvidence
};