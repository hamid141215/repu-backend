#!/bin/bash
set -Eeuo pipefail

# Reconcile rows accepted by the old app between schema migration and cutover.
# This path runs UPDATEs only; it never reapplies schema changes.
readonly get_config='/opt/elasticbeanstalk/bin/get-config'
readonly migration_script='db/run-repu-feedback-migration.js'

if [[ ! -x "$get_config" ]]; then
    echo 'Repu legacy backfill cannot run: Elastic Beanstalk get-config is unavailable.' >&2
    exit 1
fi

node_bin="$(command -v node || true)"
if [[ -z "$node_bin" ]]; then
    echo 'Repu legacy backfill cannot run: Node.js runtime is unavailable on this platform.' >&2
    exit 1
fi
if [[ ! -f "$migration_script" || ! -d node_modules/pg ]]; then
    echo 'Repu legacy backfill cannot run: application migration files or pg dependency are missing.' >&2
    exit 1
fi

pg_url="$("$get_config" environment -k PG_URL)"
if [[ -z "$pg_url" ]]; then
    echo 'Repu legacy backfill cannot run: PG_URL is not configured.' >&2
    exit 1
fi
export PG_URL="$pg_url"
unset pg_url

exec "$node_bin" "$migration_script" --backfill-legacy
