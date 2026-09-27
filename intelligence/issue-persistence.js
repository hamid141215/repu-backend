'use strict';

const {
    USABLE_DIMENSIONS,
    ISSUE_SCOPE_TYPES,
    ISSUE_SEVERITIES
} = require('./taxonomy');

function validateIssueCandidate(issue) {
    if (!issue || typeof issue !== 'object') {
        return false;
    }

    if (!USABLE_DIMENSIONS.includes(issue.dimension)) {
        return false;
    }

    if (!ISSUE_SCOPE_TYPES.includes(issue.scope_type)) {
        return false;
    }

    if (!ISSUE_SEVERITIES.includes(issue.severity)) {
        return false;
    }

    if (
        issue.scope_type === 'CLIENT' &&
        issue.branch_name !== null
    ) {
        return false;
    }

    if (
        issue.scope_type === 'BRANCH' &&
        !String(issue.branch_name || '').trim()
    ) {
        return false;
    }

    const positiveSignals =
        Number(issue.positive_signals);

    const negativeSignals =
        Number(issue.negative_signals);

    const totalSignals =
        Number(issue.total_signals);

    const negativeRate =
        Number(issue.negative_rate);

    const priority =
        Number(issue.priority);

    if (
        !Number.isInteger(positiveSignals) ||
        positiveSignals < 0
    ) {
        return false;
    }

    if (
        !Number.isInteger(negativeSignals) ||
        negativeSignals < 0
    ) {
        return false;
    }

    if (
        !Number.isInteger(totalSignals) ||
        totalSignals < 0
    ) {
        return false;
    }

    if (
        !Number.isFinite(negativeRate) ||
        negativeRate < 0 ||
        negativeRate > 1
    ) {
        return false;
    }

    if (
        !Number.isFinite(priority) ||
        priority < 0 ||
        priority > 100
    ) {
        return false;
    }

    if (!issue.window_start || !issue.window_end) {
        return false;
    }

    const start =
        new Date(issue.window_start);

    const end =
        new Date(issue.window_end);

    if (
        Number.isNaN(start.getTime()) ||
        Number.isNaN(end.getTime()) ||
        end.getTime() < start.getTime()
    ) {
        return false;
    }

    return true;
}

async function upsertIssueCandidate(pool, issue) {
    if (!validateIssueCandidate(issue)) {
        throw new Error(
            'Invalid issue candidate'
        );
    }

    const sql = `
        INSERT INTO intelligence_issues (
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
            status
        )
        VALUES (
            $1,$2,$3,$4,$5,$6,
            $7,$8,$9,$10,$11,$12,
            'OPEN'
        )

        ON CONFLICT (
            client_id,
            dimension,
            scope_type,
            (COALESCE(branch_name, ''))
        )

        WHERE status IN (
            'OPEN',
            'WATCHING'
        )

        DO UPDATE SET
            window_start =
                EXCLUDED.window_start,

            window_end =
                EXCLUDED.window_end,

            positive_signals =
                EXCLUDED.positive_signals,

            negative_signals =
                EXCLUDED.negative_signals,

            total_signals =
                EXCLUDED.total_signals,

            negative_rate =
                EXCLUDED.negative_rate,

            severity =
                EXCLUDED.severity,

            priority =
                EXCLUDED.priority,

            updated_at =
                NOW()

        RETURNING
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
    `;

    const params = [
        issue.client_id,
        issue.dimension,
        issue.scope_type,
        issue.branch_name || null,
        issue.window_start,
        issue.window_end,
        Number(issue.positive_signals),
        Number(issue.negative_signals),
        Number(issue.total_signals),
        Number(issue.negative_rate),
        issue.severity,
        Number(issue.priority)
    ];

    const { rows } =
        await pool.query(
            sql,
            params
        );

    return rows[0];
}

async function persistIssueCandidates(
    pool,
    issues
) {
    if (!Array.isArray(issues)) {
        throw new Error(
            'issues must be an array'
        );
    }

    const result = {
        candidates: issues.length,
        persisted: 0,
        errors: [],
        rows: []
    };

    for (const issue of issues) {
        try {
            const row =
                await upsertIssueCandidate(
                    pool,
                    issue
                );

            result.persisted += 1;
            result.rows.push(row);
        } catch (error) {
            result.errors.push({
                dimension:
                    issue &&
                    issue.dimension
                        ? issue.dimension
                        : null,

                scope_type:
                    issue &&
                    issue.scope_type
                        ? issue.scope_type
                        : null,

                message:
                    error.message
            });
        }
    }

    return result;
}

module.exports = {
    validateIssueCandidate,
    upsertIssueCandidate,
    persistIssueCandidates
};