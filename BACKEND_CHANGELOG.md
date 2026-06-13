# Backend Changelog — Phase 3 (RepuSystem v2 / Next.js frontend)

This document records every backend change made to support the new Next.js frontend (`repu-web`). The legacy `admin.html` dashboard continues to work unchanged — all changes here are **additive**.

---

## Summary of changes

| Area | What changed |
|------|--------------|
| Schema | `evaluations.reply_text`, `evaluations.replied_at`, 2 new indexes, `branches` unique constraint on `(client_id, name)` |
| Middleware | Added `cors` middleware with explicit allowlist for the new frontend |
| Endpoints | 14 new client-scoped endpoints; 0 existing endpoints modified |
| Dependencies | Added `cors` (^2.x) to `package.json` |

No table was renamed. No column was dropped. No existing query was modified. The old `admin.html` and `reports.html` continue to work against the same backend.

---

## Schema changes

All applied inside `initDB()` with `IF NOT EXISTS` / `EXCEPTION` guards, so restarting the server on a previously-initialized DB is safe.

```sql
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS reply_text TEXT;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_evaluations_client_status
    ON evaluations (client_id, status, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_evaluations_client_rating
    ON evaluations (client_id, rating, sent_at DESC);

DO $$ BEGIN
    ALTER TABLE branches ADD CONSTRAINT uniq_branch_name_per_client UNIQUE (client_id, name);
EXCEPTION
    WHEN duplicate_table THEN NULL;
    WHEN duplicate_object THEN NULL;
END $$;
```

**If the `uniq_branch_name_per_client` constraint fails to apply on first deploy**, it means existing data has two branches with the same `(client_id, name)` for some tenant. Find them with:

```sql
SELECT client_id, name, COUNT(*) FROM branches
GROUP BY client_id, name HAVING COUNT(*) > 1;
```

Rename or delete duplicates, then restart the server.

---

## CORS

Added the `cors` middleware with an explicit allowlist. Same-origin requests from `admin.html` skip CORS entirely (browsers don't send `Origin` on same-origin requests), so this is non-breaking.

```js
const CORS_ALLOWLIST = [
    'https://app.repu.mawjatalsamt.com',
    'http://localhost:3000'
];
```

To add a new domain (e.g. staging): edit `CORS_ALLOWLIST` in `server.js` and restart. Wildcard origins are intentionally not supported — every domain must be explicit.

---

## New endpoints

All endpoints require `x-api-key` header (existing `authenticate` middleware). Every query is scoped by `req.clientData.id` — the request body/URL never specifies a `client_id` for client routes. Cross-tenant access returns `404 Not Found`, never `403`, to avoid leaking the existence of other tenants' resource IDs.

### `PATCH /api/client/complaint-settings`

Client-scoped equivalent of the super-admin `PATCH /api/clients/:id/complaint-settings`. The two endpoints share zero code — never mix `authenticate` and `superAdminAuth` in the same handler.

```bash
curl -X PATCH http://localhost:3000/api/client/complaint-settings \
  -H "x-api-key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "complaint_action": "contact_discount",
    "discount_code": "SORRY10",
    "complaint_message": "نعتذر عن أي تقصير",
    "whatsapp_contact": "966500000000"
  }'
```

Response: `{ success: true, settings: {...} }`

### Branches (client-scoped CRUD)

#### `GET /api/branches`

Returns this client's branches with computed stats per branch.

```bash
curl http://localhost:3000/api/branches -H "x-api-key: YOUR_KEY"
```

Response shape:
```json
{
  "items": [
    {
      "id": 1, "name": "فرع الرياض", "city": "الرياض", "area": "العليا",
      "nfc_id": "101", "google_link": "https://g.co/...", "is_active": true,
      "created_at": "...",
      "total_evaluations": 42, "rating_count": 30, "average_rating": 4.5,
      "complaint_count": 3, "positive_count": 28, "last_activity_at": "..."
    }
  ]
}
```

Stats are joined on `evaluations.branch = branches.name` text match — see "Known tech debt" below.

#### `GET /api/branches/:id`

Returns one branch plus a `stats` object. 404 if branch not owned by this client.

#### `POST /api/branches`

Body: `{ name, city?, area?, google_link?, nfc_id? }`. If `nfc_id` is omitted, the server generates one (`<clientId><timestamp_slice>`). NFC ID must be globally unique across all branches and clients.

```bash
curl -X POST http://localhost:3000/api/branches \
  -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"name":"فرع جدة","city":"جدة","area":"الروضة"}'
```

Errors: `400 "Branch name already exists"` if `(client_id, name)` duplicate; `400 "NFC ID already exists"` for nfc_id collision.

#### `PATCH /api/branches/:id`

Partial update. Ownership-checked: 404 if `branches.client_id != req.clientData.id`.

#### `DELETE /api/branches/:id`

Soft-delete (`is_active = false`). Ownership-checked. The branch row stays in the DB so historical evaluation rows still join correctly.

### Complaints (paginated, filtered, with computed priority)

#### `GET /api/complaints`

Query params: `page=1`, `pageSize=25` (cap 100), `status`, `branch`, `priority`, `from`, `to`, `q`.

```bash
curl "http://localhost:3000/api/complaints?page=1&pageSize=25&status=new&priority=urgent" \
  -H "x-api-key: YOUR_KEY"
```

Response shape: `{ items, total, page, pageSize, hasMore }`.

Each item includes derived fields **never stored in the DB**:
- `priority`: `'urgent' | 'medium' | 'low' | 'closed'`
- `is_overdue`: `boolean`
- `age_hours`: `number` (rounded to 1 decimal)

**Priority computation rule** (from `computeComplaintFields()` in `server.js`):
- `closed`: `complaint_status` is `'resolved'` or `'closed'`
- `urgent`: overdue (age > 24h) OR (`new` AND age > 12h)
- `medium`: `complaint_status = 'new'` and not yet urgent
- `low`: `contacted` or `in_progress`

The `priority` filter is applied **after** SQL paging because priority is derived from `now() - sent_at`. This means a page may return fewer than `pageSize` items if the priority filter excludes some — that's expected. For large datasets where this matters, switch to a SQL `CASE` precompute (left as a v1.1 task; current dataset is small enough that it stays under 100 ms).

#### `GET /api/complaints/:id`

Returns one complaint with the same derived fields. 404 if not owned.

### Reviews (paginated, filtered) + reply

#### `GET /api/reviews`

Query params: `page`, `pageSize`, `min_rating`, `max_rating`, `branch`, `has_reply` (`'true'`/`'false'`), `source`, `q`.

```bash
curl "http://localhost:3000/api/reviews?min_rating=4&has_reply=false" \
  -H "x-api-key: YOUR_KEY"
```

Returns `{ items, total, page, pageSize, hasMore }`. Only rows with `rating IS NOT NULL` are included.

#### `POST /api/reviews/:id/reply`

Body: `{ text }` (1–2000 chars). Writes `reply_text` and `replied_at = NOW()`. **Stored only in our system** — does not post to Google. v2 may add Google Reviews API integration.

```bash
curl -X POST http://localhost:3000/api/reviews/123/reply \
  -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"text":"شكراً جزيلاً على تقييمك الرائع!"}'
```

### Analytics

All analytics endpoints accept `range=30d|90d|6m|1y`. Invalid range → 400.

#### `GET /api/analytics/nps?range=30d`

Time-series of total/positive/complaint counts + satisfaction rate + avg rating. Bucket size: `day` for 30d/90d, `week` for 6m/1y.

```bash
curl "http://localhost:3000/api/analytics/nps?range=30d" -H "x-api-key: YOUR_KEY"
```

Response: `{ range, bucket, points: [{ bucket, total, positive_count, complaint_count, avg_rating, satisfaction_rate }] }`.

#### `GET /api/analytics/branch-comparison?range=30d`

Bar-chart data. Returns `{ range, branches: [...] }` with `total_evaluations`, `average_rating`, `positive_count`, `complaint_count` per branch.

#### `GET /api/analytics/complaint-reasons?range=30d`

Donut chart, **grouped by `complaint_status`** in v1 (see "Known limitations").

### Activity feed

#### `GET /api/activity?limit=20`

Lightweight feed for the overview's "النشاط اللحظي" widget. Frontend polls this every 30 s.

```bash
curl "http://localhost:3000/api/activity?limit=20" -H "x-api-key: YOUR_KEY"
```

`limit` cap is 100 (400 if exceeded).

---

## Known limitations

**Reason categorization is v2.** The `/api/analytics/complaint-reasons` donut currently groups complaints by **status** (`new` / `in_progress` / `contacted` / `resolved` / `closed`), not by **reason** (delay / quality / service / cleanliness / etc.). v2 candidate: classify the `feedback` text via Claude API into a fixed taxonomy of 6–8 reasons. Don't build until ≥500 complaints have accumulated, to confirm the taxonomy from real data rather than guesses.

---

## Known tech debt — schedule for v1.1

`evaluations.branch` is **free-text**, not a foreign key. If a branch is renamed in `branches.name`, all historical `evaluations` silently detach from the branch in aggregations.

Plan for v1.1:

1. `ALTER TABLE evaluations ADD COLUMN branch_id INTEGER REFERENCES branches(id);`
2. Backfill: `UPDATE evaluations e SET branch_id = b.id FROM branches b WHERE e.client_id = b.client_id AND e.branch = b.name;`
3. Add `branch_id` to all writes (NFC route, `/api/send`, webhook).
4. Switch all aggregations from `e.branch = b.name` to `e.branch_id = b.id`.
5. Keep `e.branch` text column for one release as a fallback, then drop.

In v1, the new `uniq_branch_name_per_client` constraint (added this phase) prevents two branches sharing a name within one client — so the text-match join is unambiguous at write time. Historical rows from before the constraint may still violate it; address case-by-case if they break a specific tenant's aggregations.

---

## Multi-tenancy verification (run before sign-off)

Pick two real `api_key`s — say `KEY_A` and `KEY_B`. The following must all return `404 Not Found` (never the other tenant's row, never a 200 with data):

```bash
# Suppose KEY_A owns branch id 5. Try to read/edit it as KEY_B.
curl -s -o /dev/null -w "%{http_code}\n" \
  http://localhost:3000/api/branches/5 -H "x-api-key: KEY_B"      # expect 404

curl -s -o /dev/null -w "%{http_code}\n" -X PATCH \
  http://localhost:3000/api/branches/5 -H "x-api-key: KEY_B" \
  -H "Content-Type: application/json" -d '{"name":"hijack"}'      # expect 404

curl -s -o /dev/null -w "%{http_code}\n" -X DELETE \
  http://localhost:3000/api/branches/5 -H "x-api-key: KEY_B"      # expect 404

# Suppose KEY_A has complaint id 42.
curl -s -o /dev/null -w "%{http_code}\n" \
  http://localhost:3000/api/complaints/42 -H "x-api-key: KEY_B"   # expect 404

# Suppose KEY_A has review id 99.
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  http://localhost:3000/api/reviews/99/reply -H "x-api-key: KEY_B" \
  -H "Content-Type: application/json" -d '{"text":"hijack"}'      # expect 404
```

Also verify list endpoints scope correctly:

```bash
# Returned ids should be disjoint sets.
curl -s http://localhost:3000/api/branches -H "x-api-key: KEY_A" | jq '.items[].id' | sort -u > /tmp/a.ids
curl -s http://localhost:3000/api/branches -H "x-api-key: KEY_B" | jq '.items[].id' | sort -u > /tmp/b.ids
comm -12 /tmp/a.ids /tmp/b.ids   # must be empty
```

---

## CORS preflight check

From a browser DevTools console on `http://localhost:3000` (i.e. a different origin than the test server, requires running the new frontend locally on port 3000):

```js
await fetch('http://localhost:3000/api/client-info', {
  method: 'GET',
  headers: { 'x-api-key': 'YOUR_KEY' },
  credentials: 'include'
}).then(r => r.status);
// expect 200 (or 401/403 if key invalid — but not a CORS error)
```

Network tab should show a preflight `OPTIONS /api/client-info` returning `204` with `Access-Control-Allow-Origin: http://localhost:3000`.

---

## Files changed

- `server.js` — middleware + schema + 14 new endpoints
- `package.json` / `package-lock.json` — added `cors` dependency
- `BACKEND_CHANGELOG.md` — this file (new)
