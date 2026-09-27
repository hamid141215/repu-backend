'use strict';

async function initIntelligenceSchema(pool) {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS intelligence_signals (
            id BIGSERIAL PRIMARY KEY,

            client_id INTEGER NOT NULL
                REFERENCES clients(id)
                ON DELETE CASCADE,

            evaluation_id INTEGER NOT NULL
                REFERENCES evaluations(id)
                ON DELETE CASCADE,

            branch_name TEXT,

            dimension VARCHAR(40) NOT NULL
                CHECK (
                    dimension IN (
                        'SERVICE',
                        'PRODUCT_QUALITY',
                        'STAFF',
                        'SPEED',
                        'COMMUNICATION',
                        'AVAILABILITY',
                        'FACILITY',
                        'AMBIENCE',
                        'PRICE',
                        'DIGITAL_EXPERIENCE',
                        'OTHER',
                        'UNCLEAR',
                        'NOISE'
                    )
                ),

            sentiment VARCHAR(16) NOT NULL
                CHECK (
                    sentiment IN (
                        'POSITIVE',
                        'NEGATIVE',
                        'NEUTRAL',
                        'MIXED'
                    )
                ),

            confidence NUMERIC(5,4) NOT NULL
                CHECK (
                    confidence >= 0
                    AND confidence <= 1
                ),

            evidence_text TEXT,

            model_provider VARCHAR(80),
            model_name VARCHAR(120),

            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            UNIQUE (evaluation_id, dimension)
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_intelligence_signals_client_created
        ON intelligence_signals (
            client_id,
            created_at DESC
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_intelligence_signals_client_dimension
        ON intelligence_signals (
            client_id,
            dimension,
            created_at DESC
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_intelligence_signals_evaluation
        ON intelligence_signals (
            evaluation_id
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS intelligence_issues (
            id BIGSERIAL PRIMARY KEY,

            client_id INTEGER NOT NULL
                REFERENCES clients(id)
                ON DELETE CASCADE,

            dimension VARCHAR(40) NOT NULL
                CHECK (
                    dimension IN (
                        'SERVICE',
                        'PRODUCT_QUALITY',
                        'STAFF',
                        'SPEED',
                        'COMMUNICATION',
                        'AVAILABILITY',
                        'FACILITY',
                        'AMBIENCE',
                        'PRICE',
                        'DIGITAL_EXPERIENCE',
                        'OTHER'
                    )
                ),

            scope_type VARCHAR(16) NOT NULL
                CHECK (
                    scope_type IN (
                        'CLIENT',
                        'BRANCH'
                    )
                ),

            branch_name TEXT,

            window_start TIMESTAMPTZ NOT NULL,
            window_end TIMESTAMPTZ NOT NULL,

            positive_signals INTEGER NOT NULL DEFAULT 0
                CHECK (positive_signals >= 0),

            negative_signals INTEGER NOT NULL DEFAULT 0
                CHECK (negative_signals >= 0),

            total_signals INTEGER NOT NULL DEFAULT 0
                CHECK (total_signals >= 0),

            negative_rate NUMERIC(6,5) NOT NULL DEFAULT 0
                CHECK (
                    negative_rate >= 0
                    AND negative_rate <= 1
                ),

            severity VARCHAR(16) NOT NULL DEFAULT 'LOW'
                CHECK (
                    severity IN (
                        'LOW',
                        'MEDIUM',
                        'HIGH',
                        'CRITICAL'
                    )
                ),

            priority NUMERIC(6,2) NOT NULL DEFAULT 0
                CHECK (
                    priority >= 0
                    AND priority <= 100
                ),

            status VARCHAR(16) NOT NULL DEFAULT 'OPEN'
                CHECK (
                    status IN (
                        'OPEN',
                        'WATCHING',
                        'RESOLVED',
                        'DISMISSED'
                    )
                ),

            detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            CHECK (window_end >= window_start),

            CHECK (
                (
                    scope_type = 'CLIENT'
                    AND branch_name IS NULL
                )
                OR
                (
                    scope_type = 'BRANCH'
                    AND branch_name IS NOT NULL
                    AND BTRIM(branch_name) <> ''
                )
            )
        )
    `);

    // Legacy RI-1C identity included window boundaries.
    // Active issue identity is now independent of the rolling window.
    await pool.query(`
        DROP INDEX IF EXISTS uq_intelligence_issue_window
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_intelligence_issues_client_status
        ON intelligence_issues (
            client_id,
            status,
            priority DESC,
            detected_at DESC
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_intelligence_issues_client_dimension
        ON intelligence_issues (
            client_id,
            dimension,
            detected_at DESC
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS issue_enrichments (
            id BIGSERIAL PRIMARY KEY,

            issue_id BIGINT NOT NULL
                REFERENCES intelligence_issues(id)
                ON DELETE CASCADE,

            likely_cause TEXT,
            confidence NUMERIC(5,4)
                CHECK (
                    confidence IS NULL
                    OR (
                        confidence >= 0
                        AND confidence <= 1
                    )
                ),

            why_text TEXT,
            recommended_action TEXT,
            success_metric TEXT,

            classification VARCHAR(40) NOT NULL
                DEFAULT 'HYPOTHESIS_NOT_CONFIRMED'
                CHECK (
                    classification IN (
                        'HYPOTHESIS_NOT_CONFIRMED',
                        'VALIDATED',
                        'REJECTED'
                    )
                ),

            model_provider VARCHAR(80),
            model_name VARCHAR(120),

            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_issue_enrichments_issue_created
        ON issue_enrichments (
            issue_id,
            created_at DESC
        )
    `);


    // RI-1C.7:
    // Consolidate legacy duplicate ACTIVE issues created when
    // window_start/window_end were part of issue identity.
    //
    // Canonical issue:
    // - earliest detected issue ID is preserved
    // - latest metrics/window are copied onto it
    // - WATCHING wins over OPEN
    //
    // This runs before the new partial unique index is created.

    await pool.query(`
        WITH ranked AS (
            SELECT
                id,

                FIRST_VALUE(id) OVER (
                    PARTITION BY
                        client_id,
                        dimension,
                        scope_type,
                        COALESCE(branch_name, '')
                    ORDER BY
                        detected_at ASC,
                        id ASC
                ) AS canonical_id,

                ROW_NUMBER() OVER (
                    PARTITION BY
                        client_id,
                        dimension,
                        scope_type,
                        COALESCE(branch_name, '')
                    ORDER BY
                        updated_at DESC,
                        id DESC
                ) AS latest_rank,

                BOOL_OR(status = 'WATCHING') OVER (
                    PARTITION BY
                        client_id,
                        dimension,
                        scope_type,
                        COALESCE(branch_name, '')
                ) AS any_watching

            FROM intelligence_issues
            WHERE status IN ('OPEN', 'WATCHING')
        ),

        latest AS (
            SELECT
                r.canonical_id,
                r.any_watching,

                i.window_start,
                i.window_end,
                i.positive_signals,
                i.negative_signals,
                i.total_signals,
                i.negative_rate,
                i.severity,
                i.priority,
                i.updated_at

            FROM ranked r

            JOIN intelligence_issues i
              ON i.id = r.id

            WHERE r.latest_rank = 1
        )

        UPDATE intelligence_issues canonical

        SET
            window_start =
                latest.window_start,

            window_end =
                latest.window_end,

            positive_signals =
                latest.positive_signals,

            negative_signals =
                latest.negative_signals,

            total_signals =
                latest.total_signals,

            negative_rate =
                latest.negative_rate,

            severity =
                latest.severity,

            priority =
                latest.priority,

            status =
                CASE
                    WHEN latest.any_watching
                        THEN 'WATCHING'
                    ELSE 'OPEN'
                END,

            updated_at =
                GREATEST(
                    canonical.updated_at,
                    latest.updated_at
                )

        FROM latest

        WHERE
            canonical.id =
            latest.canonical_id
    `);

    // Preserve any enrichment history if duplicate test/legacy
    // issue rows already exist.
    await pool.query(`
        WITH ranked AS (
            SELECT
                id,

                FIRST_VALUE(id) OVER (
                    PARTITION BY
                        client_id,
                        dimension,
                        scope_type,
                        COALESCE(branch_name, '')
                    ORDER BY
                        detected_at ASC,
                        id ASC
                ) AS canonical_id

            FROM intelligence_issues
            WHERE status IN ('OPEN', 'WATCHING')
        )

        UPDATE issue_enrichments enrichment

        SET issue_id =
            ranked.canonical_id

        FROM ranked

        WHERE
            enrichment.issue_id =
                ranked.id

            AND ranked.id <>
                ranked.canonical_id
    `);

    await pool.query(`
        WITH ranked AS (
            SELECT
                id,

                FIRST_VALUE(id) OVER (
                    PARTITION BY
                        client_id,
                        dimension,
                        scope_type,
                        COALESCE(branch_name, '')
                    ORDER BY
                        detected_at ASC,
                        id ASC
                ) AS canonical_id

            FROM intelligence_issues
            WHERE status IN ('OPEN', 'WATCHING')
        )

        DELETE FROM intelligence_issues issue

        USING ranked

        WHERE
            issue.id =
                ranked.id

            AND ranked.id <>
                ranked.canonical_id
    `);

    // Exactly one ACTIVE issue per operational identity.
    // RESOLVED / DISMISSED rows are historical and therefore
    // do not block a future recurrence from creating a new issue.
    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS
            uq_intelligence_issue_active

        ON intelligence_issues (
            client_id,
            dimension,
            scope_type,
            COALESCE(branch_name, '')
        )

        WHERE status IN (
            'OPEN',
            'WATCHING'
        )
    `);

    // RI-1D.4:
    // One current enrichment per issue.
    await pool.query(`
        ALTER TABLE issue_enrichments
        ADD COLUMN IF NOT EXISTS updated_at
            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);

    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS
            uq_issue_enrichments_issue
        ON issue_enrichments (issue_id)
    `);
    console.log('Intelligence schema ready');
}

module.exports = {
    initIntelligenceSchema
};