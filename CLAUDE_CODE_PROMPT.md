# Prompt for Claude Code — Integrate RepuSystem UI with Backend

You are working on the RepuSystem project. The user has a finished UI design (single HTML file) and an existing backend. Your job is to convert the HTML into a production Next.js 14 app, wire it to the real backend, and deploy it.

## Phase 1 — Discover the existing system (do this FIRST, before writing any code)

Investigate the repository thoroughly. Report back what you find before proceeding:

1. **Backend stack**
   - Read `package.json` / `pyproject.toml` / equivalent. What's the runtime, framework, ORM?
   - Where is the API server entry point?
   - Where is auth configured? (JWT? Sessions? Supabase Auth? Custom?)
   - What's the base URL pattern? (`/api/v1/...`, `/api/...`, etc.)

2. **Database schema**
   - Find schema files (migrations, `schema.prisma`, SQL files, Supabase tables)
   - List every table relevant to: businesses/tenants, branches, complaints, reviews, NFC cards, users/team, settings
   - Map relationships (foreign keys)
   - Note RLS policies if Supabase

3. **API endpoints**
   - List every existing endpoint (method, path, what it returns)
   - Note any auth headers/cookies required
   - Test 2-3 endpoints with curl and paste real response samples
   - Identify gaps: which endpoints does the UI need that don't exist yet?

4. **Auth flow**
   - How does a user log in today? (form? OAuth? magic link?)
   - How is the session maintained?
   - How are multi-tenant boundaries enforced (which business does a user belong to)?

5. **Hosting**
   - Where is the backend deployed? (Vercel, Railway, Render, VPS, Azure?)
   - Is there a frontend already deployed? Where?
   - DNS provider?

**Stop and present a written summary of all 5 above before continuing.** Wait for the user's confirmation before Phase 2.

---

## Phase 2 — Plan the integration

Based on Phase 1 findings, produce a written integration plan:

### Frontend architecture
- Next.js 14 with App Router
- TypeScript strict
- Tailwind CSS (matching tokens from the HTML)
- TanStack Query for server state
- React Hook Form + Zod for forms
- shadcn/ui for primitive components (button, dialog, dropdown, etc.) styled to match the existing design
- Recharts (matching the existing chart styling)
- next-intl for i18n (Arabic primary, English secondary)
- Full RTL support via Tailwind RTL plugin

### Folder structure
```
apps/web/
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx                 # Sidebar + topbar shell
│   │   ├── page.tsx                   # Overview / home
│   │   ├── reviews/page.tsx
│   │   ├── complaints/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx          # Complaint detail
│   │   ├── branches/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── analytics/page.tsx
│   │   ├── reports/page.tsx
│   │   ├── nfc/page.tsx
│   │   ├── campaigns/page.tsx
│   │   ├── customer-preview/page.tsx
│   │   ├── team/page.tsx
│   │   └── settings/page.tsx
│   ├── customer/
│   │   └── [businessId]/[branchId]/   # Public customer-facing review page
│   │       ├── page.tsx               # Star rating
│   │       ├── feedback/page.tsx      # Low-rating feedback form
│   │       └── thank-you/page.tsx     # Thank-you + coupon
│   └── layout.tsx
├── components/
│   ├── ui/                            # shadcn primitives
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   └── Topbar.tsx
│   ├── kpi-card.tsx
│   ├── branch-card.tsx
│   ├── complaint-row.tsx
│   ├── review-card.tsx
│   ├── nfc-card.tsx
│   └── charts/
├── lib/
│   ├── api.ts                         # Typed API client
│   ├── auth.ts
│   ├── queries.ts                     # TanStack Query hooks
│   └── utils.ts
├── types/                             # TypeScript types from API
└── messages/                          # i18n translations (ar.json, en.json)
```

### Data fetching pattern
- Server components for initial page load (fast TTFB)
- Client components for interactivity, mutations, and live updates
- TanStack Query handles caching, refetching, optimistic updates
- All API calls go through one typed `apiClient` (`lib/api.ts`)
- Auth token attached via interceptor or cookie

### API contract
List every endpoint the UI needs. For each one:
- Method + path
- Request body shape
- Response shape
- Auth required (yes/no)
- Status: EXISTS / NEEDS_CREATING / NEEDS_MODIFYING

### Migration approach
Match the HTML file 1:1 visually first, then connect data. Do not redesign.

**Stop and present this plan. Wait for confirmation before Phase 3.**

---

## Phase 3 — Build the missing backend pieces

For every endpoint marked `NEEDS_CREATING` or `NEEDS_MODIFYING`:
- Add it to the existing backend (don't create a new backend)
- Match the existing code style and patterns in the repo
- Add validation (Zod / Pydantic / equivalent)
- Add proper auth and tenant scoping
- Write a quick test or curl example for each
- Update OpenAPI docs if the project has them

Common endpoints the UI will need:
- `GET /api/overview` — KPIs + activity feed for the home page
- `GET /api/complaints` (filter, paginate)
- `GET /api/complaints/:id`
- `PATCH /api/complaints/:id` (status, assignee)
- `POST /api/complaints/:id/comments`
- `GET /api/reviews`
- `POST /api/reviews/:id/reply`
- `GET /api/branches`
- `GET /api/branches/:id`
- `GET /api/analytics/nps?range=30d`
- `GET /api/analytics/branch-comparison`
- `GET /api/analytics/complaint-reasons`
- `GET /api/nfc-cards`
- `POST /api/nfc-cards`
- `POST /api/campaigns/send-review-request`
- `GET /api/team`
- `POST /api/team/invite`
- Public: `POST /api/public/reviews` (for the customer-facing page)

Confirm each endpoint works via curl before wiring the UI to it.

---

## Phase 4 — Build the Next.js app

1. **Scaffold the Next.js app inside the monorepo** (or as a sibling project — match the user's preference)
2. **Install dependencies:**
   ```
   next@14 react@18 typescript tailwindcss @tanstack/react-query
   react-hook-form zod @hookform/resolvers
   recharts lucide-react
   next-intl
   tailwindcss-rtl
   @tabler/icons-react
   class-variance-authority clsx tailwind-merge
   ```
   Plus shadcn/ui CLI for the primitives.

3. **Port design tokens from the HTML file** into `tailwind.config.ts`:
   - `--primary: #0052FF`, hover `#0040C9`, light `#EFF4FF`
   - Border `#E6E8EB`, border-strong `#D4D7DB`
   - Text scale: `#0A0E1A` / `#4A5163` / `#8B92A3` / `#B0B6C3`
   - Semantic: good `#10B981`, warn `#F59E0B`, bad `#EF4444`, purple `#8B5CF6`
   - Fonts: IBM Plex Sans Arabic (primary), Inter (numbers, monospace fallback)
   - `font-feature-settings: "ss01", "cv11"` for IBM Plex
   - All radii match: 6/7/8/10/12px

4. **Build the shell** (sidebar + topbar) as in the HTML — same widths, same spacing, RTL-aware.

5. **Port pages one by one** in this order — each page is feature-complete (with real data, loading states, error states, empty states) before moving to the next:
   1. Login / auth
   2. Overview (home)
   3. Complaints (list + detail)
   4. Reviews
   5. Branches (list + detail)
   6. Analytics
   7. Reports
   8. NFC cards
   9. Campaigns (send review request)
   10. Customer-facing review page (public, no auth)
   11. Team
   12. Settings

   For every page:
   - Match the HTML pixel-by-pixel (typography, spacing, colors, icons)
   - Use Tabler icons (already in the HTML)
   - Wire to real API
   - Add loading skeleton matching the layout
   - Add error state (retry button, clear message)
   - Add empty state (icon + message + primary action)

6. **Charts:** Use Recharts. Match the styling exactly — colors, no gridlines on x-axis, dashed gridlines on y-axis, rounded bar tops, proper Arabic labels.

7. **Forms:** React Hook Form + Zod. WhatsApp send action calls the backend, which then forwards to WhatsApp Cloud API (already integrated for PropAgent — reuse that integration if possible).

8. **Multi-tenancy:** Every API call scoped to the current business. Pull from the auth session. Never trust client-supplied business IDs.

---

## Phase 5 — Customer-facing flow (public)

This is the page customers see when they tap an NFC card or scan a QR.

URL pattern: `https://app.repusystem.[domain]/r/{shortCode}`
- `shortCode` resolves to `{businessId, branchId, nfcCardId?}` via a server lookup
- Server records the touch (analytics)
- Page renders the star rating UI from the HTML
- 4-5 stars → redirect to that branch's Google Maps review URL (from `branches.googleReviewUrl`)
- 1-3 stars → show feedback form, on submit POST to `/api/public/complaints`, then show thank-you + coupon code
- Whole flow must work without authentication
- Whole flow must be fast on cellular (no client-side bundle for the first paint — server-render the star UI)

---

## Phase 6 — Auth and middleware

- Use the existing auth mechanism. Do not introduce a new one.
- If the backend uses JWT in cookies, the Next.js middleware verifies on every protected route.
- If Supabase, use `@supabase/ssr`.
- Public routes: `/`, `/login`, `/r/[shortCode]`, `/r/[shortCode]/feedback`, `/r/[shortCode]/thank-you`. Everything else: authenticated.
- After login, redirect to `/` (overview).
- On 401 from API, force re-login.

---

## Phase 7 — Real-time updates (optional, do this last)

The overview's "Live activity" feed and the complaint list status should update without a page refresh.

Options (pick what fits the existing backend):
- Supabase Realtime (subscribe to complaint/review table changes) if backend is Supabase
- Server-Sent Events on a `/api/events` endpoint
- Polling every 30 seconds via TanStack Query's `refetchInterval`

Start with polling. Add realtime later only if it adds real value.

---

## Phase 8 — Deploy

1. **Domain.** Confirm the production domain with the user (e.g., `app.repusystem.com` or a `mawjatalsamt` subdomain).
2. **Hosting.** Vercel for the Next.js app. Backend stays where it is.
3. **Environment variables.** Set up `.env.local` (dev) and Vercel env (prod):
   - `NEXT_PUBLIC_API_URL`
   - `NEXTAUTH_SECRET` / Supabase keys / whatever auth needs
   - `WHATSAPP_*` if the frontend triggers WhatsApp directly (it shouldn't — backend handles it)
3. **CORS.** Make sure the backend allows the frontend's domain.
4. **Build.** Verify `next build` is clean — no TypeScript errors, no warnings about missing env vars, no console errors in the browser on each page.
5. **Smoke test in production** every page, every primary action.
6. **DNS.** Point the chosen subdomain to Vercel.

---

## Quality bar — do not skip

- **No mock data anywhere in the final build.** Every number, every name, every status comes from the API.
- **No `any` in TypeScript.** Type everything from the API responses.
- **Loading, error, empty states** for every data-driven view. Skeletons match the real layout.
- **RTL is correct.** Numbers, dates, and Latin text within Arabic stay LTR (`dir="ltr"` on those spans). Icons that imply direction (back/forward arrows) flip in RTL.
- **Accessibility:** keyboard navigation, focus rings, proper aria-labels on icon-only buttons.
- **Performance:** Lighthouse > 90 on every page in production.
- **The visual design matches the HTML file exactly.** No "improvements," no extra padding, no different fonts. The user approved the HTML — don't change it.

---

## Workflow rules

- **Commit frequently.** After every page is wired, commit with a clear message.
- **Test as you go.** Don't move to the next page until the current one works end-to-end with real data.
- **Ask before assuming.** If the schema doesn't have a field the UI needs (e.g., `branch.googleReviewUrl`), ask the user — don't silently add a column.
- **Don't redesign.** If something in the HTML looks "wrong" to you, leave it. The user approved this design.

---

## What to deliver at the end

1. A working Next.js app deployed at the agreed domain
2. All UI pages wired to real backend data
3. Customer-facing review flow working from a real NFC tap or shared link
4. A `README.md` in the frontend app explaining: how to run locally, env vars, deployment, where the API is
5. A short changelog of what was added/changed in the backend

**Start with Phase 1. Report back what you found before doing anything else.**
