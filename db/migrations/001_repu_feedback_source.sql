-- Apply after the existing V1 initDB schema. Safe to rerun in a transaction.
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS source_kind TEXT;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS access_method TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS branch_id INTEGER;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS submission_key UUID;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS submission_fingerprint CHAR(64);

UPDATE evaluations
SET source_kind = 'REPU'
WHERE source_kind IS NULL AND source IN ('nfc', 'dashboard');

UPDATE evaluations
SET access_method = 'UNKNOWN'
WHERE access_method IS NULL;

-- Only exact, unique names within the same tenant are eligible. Existing
-- branch IDs are never overwritten; ambiguous and unmatched rows stay NULL.
WITH matched AS (
    SELECT e.id AS evaluation_id, MIN(b.id) AS branch_id
    FROM evaluations e
    JOIN branches b ON b.client_id = e.client_id AND b.name = e.branch
    WHERE e.branch_id IS NULL AND e.branch IS NOT NULL AND BTRIM(e.branch) <> ''
    GROUP BY e.id
    HAVING COUNT(*) = 1
)
UPDATE evaluations e SET branch_id = matched.branch_id
FROM matched WHERE e.id = matched.evaluation_id;

DO $$ BEGIN
    ALTER TABLE evaluations ADD CONSTRAINT evaluations_source_kind_check
        CHECK (source_kind IS NULL OR source_kind = 'REPU');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE evaluations ADD CONSTRAINT evaluations_access_method_check
        CHECK (access_method IN ('UNKNOWN', 'QR', 'NFC', 'LINK'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE evaluations ADD CONSTRAINT evaluations_submission_pair_check
        CHECK ((submission_key IS NULL) = (submission_fingerprint IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_branches_client_id_id ON branches (client_id, id);
DO $$ BEGIN
    ALTER TABLE evaluations ADD CONSTRAINT evaluations_branch_same_client_fk
        FOREIGN KEY (client_id, branch_id) REFERENCES branches (client_id, id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_evaluations_client_submission_key
    ON evaluations (client_id, submission_key) WHERE submission_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_evaluations_client_branch_id
    ON evaluations (client_id, branch_id) WHERE branch_id IS NOT NULL;

-- The SELECT is also the migration report; no customer data is returned.
SELECT
    COUNT(*) FILTER (WHERE branch IS NOT NULL AND BTRIM(branch) <> '' AND branch_id IS NOT NULL)::integer AS matched,
    COUNT(*) FILTER (WHERE branch IS NOT NULL AND BTRIM(branch) <> '' AND branch_id IS NULL
        AND (SELECT COUNT(*) FROM branches b WHERE b.client_id = e.client_id AND b.name = e.branch) = 0)::integer AS unmatched,
    COUNT(*) FILTER (WHERE branch IS NOT NULL AND BTRIM(branch) <> '' AND branch_id IS NULL
        AND (SELECT COUNT(*) FROM branches b WHERE b.client_id = e.client_id AND b.name = e.branch) > 1)::integer AS ambiguous,
    COUNT(*) FILTER (WHERE branch IS NULL OR BTRIM(branch) = '')::integer AS no_branch
FROM evaluations e;
