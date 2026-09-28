# Phase 2A review and QA

Worktree: `D:\repu-backend\.phase2a`, detached from release `04320a2`.
No commit, push, deployment, schema change, new dependencies or AI calls.

Modified files: `server.js`, `spa/src/App.tsx`, `spa/src/components/layout/sidebar.tsx`, `spa/src/lib/queries.ts`, `spa/src/index.css`, `intelligence/issue-read-api.js`, `spa/src/types/issues.ts`, `spa/src/routes/issues.tsx`, `tests/issue-read-api.test.js`.

Added files: `intelligence/issue-read-api.js`, `spa/src/types/issues.ts`, `spa/src/routes/issues.tsx`, `tests/issue-read-api.test.js`, `PHASE2A_REVIEW.md`.

## Product reads

- `GET /api/intelligence/issues`: authenticated identity from `req.clientData.id`; ignores query `client_id`.
- `GET /api/intelligence/issues/:issueId`: tenant-scoped lookup; foreign IDs return 404 before evidence queries.
- Default statuses: OPEN and WATCHING. Filters: status (comma separated), severity, dimension, scope_type, branch (exact), q (literal case-insensitive substring in dimension/branch).
- page >= 1 (maximum 1,000,000); pageSize default 20, maximum 100. Invalid inputs return 400.
- Ordering: priority, updated_at, detected_at, id descending. One list SQL statement shares a filtered CTE for count and pagination and joins enrichment/count only for the requested page.
- List contains no evidence texts, provider/model metadata, raw payloads or privacy tokens. Enrichment summaries are limited to 240 characters per text field.
- Detail reads full enrichment plus up to 10 eligible negative signal metadata rows, confidence descending, then signal creation time and ID descending. The detail query does not select evidence text.

## Evidence interpretation and privacy

There is no issue-to-signal FK. Match tenant and dimension, evaluation `sent_at >= window_start` and `< window_end`, with trimmed branch equality for BRANCH and all branches for CLIENT. Evaluation and signal tenants must agree. The detail query uses the issue window captured by its tenant-scoped lookup.

`evidenceCount` counts currently linked negative signal rows with confidence >= 0.70 and nonempty evidence text, the existing eligibility criterion. It can be lower than `negativeCount` when an eligible negative signal has empty evidence text. It is not a unique-text count or a historical snapshot and is independent of stored total/negative metrics. Duplicate texts may represent separate evaluations. Preview can contain fewer than the count because it is capped at 10. No fuzzy matching is used.

Evaluation evidence text is not selected by the detail query and is never serialized. The evidence preview returns only evaluation ID, branch, dimension, sentiment, confidence and signal creation time. Structured evaluation name and phone columns are not selected for evidence counting or detail reads.

## Frontend

- Hash routes: `admin.html#/issues` and `admin.html#/issues/:issueId`.
- Main sidebar: الرئيسية، الإشارات، القضايا، الفروع، الملخص التنفيذي. Secondary navigation unchanged.
- Card list with server filters/pagination; summary explicitly covers current page only; HIGH count uses the existing severity enum without thresholds.
- Normal detail click opens a native modal drawer (desktop, full width on narrow screens); direct/new-tab link opens the detail page. Native modal manages keyboard focus, Escape and focus restoration.
- Enrichment is optional; unconfirmed classification displays «فرضية تحتاج تحقق». No enrichment request/button or operational actions.
- Homepage and branches remain unchanged.

## Executed validation

- `node tests/issue-read-api.test.js`: 23 unit/structural tests passed, including branch trimming, CLIENT/BRANCH scopes, window boundaries, empty evidence text and free-text privacy regression. SQL and identity guards use mocked DB responses; this is not PostgreSQL integration coverage.
- `node tests/humain-adapter.test.js`: existing HUMAIN mock tests passed. This is the only pre-existing test file in the clean release; dirty-tree tests were not imported.
- `node --test tests/issue-read-api.test.js` encountered sandbox spawn EPERM; direct file execution passed.
- Backend/test `node --check` and `git diff --check` passed.
- TypeScript project check passed. `npm.cmd run build` stopped in Vite with spawn EPERM and a Tailwind native-binding load error. No production server was started or queried.

## Required manual build and staging QA

Run from ordinary PowerShell:

```powershell
Set-Location D:\repu-backend\.phase2a\spa
npm.cmd run build
```

On a local/staging server with authorized existing data, using desktop (1440px) and mobile (390px and 320px):

1. Log in as viewer, manager and owner; open sidebar القضايا. Confirm RTL, readable cards and no document horizontal overflow (the existing mobile nav scrolls within itself).
2. Verify default request includes OPEN,WATCHING and does not include resolved/dismissed issues.
3. Verify status, severity, dimension, scope, exact branch and search update network query and reset page to 1; count and next/previous agree. Search is by stored dimension code or branch name.
4. Use filters with no matching real issues; verify «لا توجد قضايا تشغيلية مطابقة للفلاتر الحالية.» and no unsupported positive claim.
5. Open a real issue drawer; check counts, priority, scope, period and negative rate against API. Test close button, Escape, backdrop, keyboard focus containment and focus return.
6. Open direct detail link, refresh it and return to list with filters preserved.
7. For an enriched real issue verify cause, why, suggested action, metric, timestamps and «فرضية تحتاج تحقق». For a real unenriched issue verify «لم يُنشأ تحليل سببي لهذه القضية بعد» and no AI request.
8. Verify evidence metadata, confidence, branch, date, preview cap and count eligibility. Confirm «نصوص الأدلة غير معروضة حفاظًا على الخصوصية.» appears even when evidenceCount is positive.
9. Use a second tenant's real issue ID with the first tenant's authentication: 404, no existence disclosure. Verify evidence response includes no text/customer/contact fields.
11. Confirm homepage, complaints workflow, branches and executive brief still operate as before.

Do not add fake product data, invoke pipelines/enrichment, mutate issues or contact production for this QA.
