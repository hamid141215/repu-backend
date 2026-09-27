'use strict';

const {
    USABLE_DIMENSIONS,
    MIN_AGGREGATION_CONFIDENCE
} = require('./taxonomy');

const MIN_NEGATIVE_SIGNALS = 2;
const MIN_NEGATIVE_RATE = 0.40;

function round2(value) {
    return Math.round(
        (Number(value) + Number.EPSILON) * 100
    ) / 100;
}

function normalizeBranch(value) {
    const branch = String(value || '').trim();
    return branch || null;
}

function isUsableSignal(signal) {
    if (!signal || typeof signal !== 'object') {
        return false;
    }

    if (!USABLE_DIMENSIONS.includes(signal.dimension)) {
        return false;
    }

    const confidence = Number(signal.confidence);

    if (
        !Number.isFinite(confidence) ||
        confidence < MIN_AGGREGATION_CONFIDENCE
    ) {
        return false;
    }

    return [
        'POSITIVE',
        'NEGATIVE',
        'NEUTRAL',
        'MIXED'
    ].includes(signal.sentiment);
}

function getSignalTime(signal) {
    const value =
        signal.occurred_at ||
        signal.sent_at ||
        signal.created_at ||
        null;

    if (!value) {
        return null;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

function calculateRecencyScore(
    newestNegativeAt,
    now = new Date()
) {
    if (!newestNegativeAt) {
        return 0;
    }

    const ageMs =
        now.getTime() -
        newestNegativeAt.getTime();

    const ageDays =
        ageMs / (1000 * 60 * 60 * 24);

    if (ageDays <= 7) return 10;
    if (ageDays <= 30) return 5;

    return 0;
}

function calculatePriority(input) {
    const negativeRate =
        Number(input.negativeRate) || 0;

    const negativeSignals =
        Number(input.negativeSignals) || 0;

    const distinctNegativeBranches =
        Number(input.distinctNegativeBranches) || 0;

    const scopeType =
        input.scopeType || 'CLIENT';

    const now =
        input.now instanceof Date
            ? input.now
            : new Date(input.now || Date.now());

    const newestNegativeAt =
        input.newestNegativeAt instanceof Date
            ? input.newestNegativeAt
            : input.newestNegativeAt
                ? new Date(input.newestNegativeAt)
                : null;

    // 35 points: negative rate
    const rateScore =
        Math.min(
            Math.max(negativeRate, 0),
            1
        ) * 35;

    // 25 points: evidence volume
    // Full score at 20 negative signals.
    const evidenceScore =
        Math.min(
            negativeSignals / 20,
            1
        ) * 25;

    // 20 points: recurrence.
    // First signal contributes no recurrence.
    // Full score at 10 negative signals.
    const recurrenceScore =
        Math.min(
            Math.max(
                negativeSignals - 1,
                0
            ) / 9,
            1
        ) * 20;

    // 10 points: cross-branch spread.
    // Only meaningful for CLIENT scope.
    const branchSpreadScore =
        scopeType === 'CLIENT'
            ? Math.min(
                distinctNegativeBranches / 3,
                1
            ) * 10
            : 0;

    // 10 points: recency.
    const recencyScore =
        calculateRecencyScore(
            newestNegativeAt,
            now
        );

    return round2(
        rateScore +
        evidenceScore +
        recurrenceScore +
        branchSpreadScore +
        recencyScore
    );
}

function calculateSeverity(priority) {
    const value = Number(priority);

    if (value >= 80) return 'CRITICAL';
    if (value >= 60) return 'HIGH';
    if (value >= 35) return 'MEDIUM';

    return 'LOW';
}

function buildAggregate(
    signals,
    {
        clientId,
        dimension,
        scopeType,
        branchName = null,
        windowStart,
        windowEnd,
        now
    }
) {
    const positiveSignals =
        signals.filter(
            (signal) =>
                signal.sentiment === 'POSITIVE'
        ).length;

    const negativeSignals =
        signals.filter(
            (signal) =>
                signal.sentiment === 'NEGATIVE'
        ).length;

    const totalSignals =
        signals.length;

    const negativeRate =
        totalSignals > 0
            ? negativeSignals / totalSignals
            : 0;

    const negativeOnly =
        signals.filter(
            (signal) =>
                signal.sentiment === 'NEGATIVE'
        );

    const distinctNegativeBranches =
        new Set(
            negativeOnly
                .map(
                    (signal) =>
                        normalizeBranch(
                            signal.branch_name
                        )
                )
                .filter(Boolean)
        ).size;

    const negativeTimes =
        negativeOnly
            .map(getSignalTime)
            .filter(Boolean)
            .sort(
                (a, b) =>
                    b.getTime() - a.getTime()
            );

    const newestNegativeAt =
        negativeTimes[0] || null;

    const priority =
        calculatePriority({
            negativeRate,
            negativeSignals,
            distinctNegativeBranches,
            scopeType,
            newestNegativeAt,
            now
        });

    const severity =
        calculateSeverity(priority);

    return {
        client_id: clientId,
        dimension,
        scope_type: scopeType,
        branch_name:
            scopeType === 'BRANCH'
                ? normalizeBranch(branchName)
                : null,

        window_start: windowStart,
        window_end: windowEnd,

        positive_signals: positiveSignals,
        negative_signals: negativeSignals,
        total_signals: totalSignals,

        negative_rate:
            round2(negativeRate),

        distinct_negative_branches:
            distinctNegativeBranches,

        newest_negative_at:
            newestNegativeAt
                ? newestNegativeAt.toISOString()
                : null,

        priority,
        severity
    };
}

function qualifiesAsIssue(aggregate) {
    return (
        aggregate.negative_signals >=
            MIN_NEGATIVE_SIGNALS &&
        aggregate.negative_rate >=
            MIN_NEGATIVE_RATE
    );
}

function groupByDimension(signals) {
    const groups = new Map();

    for (const signal of signals) {
        if (!groups.has(signal.dimension)) {
            groups.set(
                signal.dimension,
                []
            );
        }

        groups.get(
            signal.dimension
        ).push(signal);
    }

    return groups;
}

function buildIssueCandidates(
    signals,
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

    const windowEnd =
        options.windowEnd ||
        now.toISOString();

    const windowStart =
        options.windowStart ||
        new Date(
            now.getTime() -
            (30 * 24 * 60 * 60 * 1000)
        ).toISOString();

    const usable =
        signals.filter(isUsableSignal);

    const candidates = [];

    // --------------------------------------------------------
    // CLIENT scope
    // --------------------------------------------------------

    const clientGroups =
        groupByDimension(usable);

    for (
        const [dimension, group]
        of clientGroups.entries()
    ) {
        const aggregate =
            buildAggregate(
                group,
                {
                    clientId,
                    dimension,
                    scopeType: 'CLIENT',
                    windowStart,
                    windowEnd,
                    now
                }
            );

        if (qualifiesAsIssue(aggregate)) {
            candidates.push(aggregate);
        }
    }

    // --------------------------------------------------------
    // BRANCH scope
    // --------------------------------------------------------

    const branchSignals =
        usable.filter(
            (signal) =>
                normalizeBranch(
                    signal.branch_name
                )
        );

    const branchGroups =
        new Map();

    for (const signal of branchSignals) {
        const branch =
            normalizeBranch(
                signal.branch_name
            );

        const key =
            `${branch}::${signal.dimension}`;

        if (!branchGroups.has(key)) {
            branchGroups.set(
                key,
                {
                    branch,
                    dimension:
                        signal.dimension,
                    signals: []
                }
            );
        }

        branchGroups.get(
            key
        ).signals.push(signal);
    }

    for (
        const group
        of branchGroups.values()
    ) {
        const aggregate =
            buildAggregate(
                group.signals,
                {
                    clientId,
                    dimension:
                        group.dimension,
                    scopeType: 'BRANCH',
                    branchName:
                        group.branch,
                    windowStart,
                    windowEnd,
                    now
                }
            );

        if (qualifiesAsIssue(aggregate)) {
            candidates.push(aggregate);
        }
    }

    return candidates.sort(
        (a, b) =>
            b.priority -
            a.priority
    );
}

module.exports = {
    MIN_NEGATIVE_SIGNALS,
    MIN_NEGATIVE_RATE,
    isUsableSignal,
    calculateRecencyScore,
    calculatePriority,
    calculateSeverity,
    qualifiesAsIssue,
    buildIssueCandidates
};