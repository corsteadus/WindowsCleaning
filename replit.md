# Window Cleaning CRM

## Overview

Full-stack CRM and field service management platform for window cleaning businesses. Built as a pnpm monorepo with a React + Vite frontend and an Express API backend.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod, drizzle-zod
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + TailwindCSS + shadcn/ui
- **Auth**: Replit Auth (OpenID Connect/PKCE) via @workspace/replit-auth-web
- **Forms**: react-hook-form + @hookform/resolvers
- **Charts**: Recharts
- **Animations**: Framer Motion

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   └── crm/                # React + Vite CRM frontend (root path /)
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   ├── db/                 # Drizzle ORM schema + DB connection
│   └── replit-auth-web/    # Browser auth hook (useAuth)
├── scripts/
└── ...
```

## Modules / Navigation

1. **Dashboard** — KPI stat cards, recent jobs/invoices tables, quick-action buttons (New Job, New Customer, New Estimate)
2. **Leads** — Pipeline with statuses, source, clientType, convert to customer; detail page with tabs (Overview, Notes, Activity)
3. **Tasks** — Action items, follow-ups, lead activities, priority/due dates
4. **Customers** — Full profiles with contacts, clientType, deactivation workflow, Activity tab, Files tab
5. **Properties** — Service locations per customer; one property can be the customer's "default" (see Default Property below)
6. **Quotes** — Line-item builder, convert to job, print view, can link to a lead instead of a customer
7. **Schedule & Jobs** — Weekly schedule view + job list/detail with crew assignment, status tracking
8. **Recurring Plans** — Repeat service agreements (frequency, auto-generate)
9. **Invoices** — Invoice management, status/aging, generated from completed jobs
10. **Service Catalog** — Service types, pricing models
11. **Crews** — Field crew management
12. **Admin → Customer Factor Import** (`/admin/import`, super_admin only) — staged, reviewable batch import tool (see Import Engine below)

## Database Schema

Core tables in PostgreSQL:
- `users`, `sessions` — auth (Replit OIDC)
- `leads`, `customers`, `contacts`, `properties`, `services`, `quotes`, `quote_line_items`, `jobs`, `invoices`, `crews`, `recurring_plans`, `tasks`
- `activity_logs` — entityType, entityId, action, fromValue, toValue, reason, note, performedBy, createdAt, details(jsonb)
- `attachments` — file/photo metadata per entity (customer/lead), backed by GCS object storage
- Import engine tables: `import_batches`, `import_files`, `import_staging_rows`, `import_review_queue`, `import_change_log`
- Import tracking columns on `customers`/`leads`/`properties`/`jobs`/`invoices`: `import_source`, `import_external_id`, `import_batch_id`, `is_imported`, `last_seen_import_at`, `last_import_fingerprint`, `is_suspected_duplicate`
- `customers.client_type` / `leads.client_type` — residential/commercial (default residential)
- `customers.default_property_id` — nullable; manually-chosen default property (see Default Property)

### Indexes
33 non-PK indexes added for scale (customers, jobs, invoices, quotes, leads, activity_logs, recurring_plans) — composite `(status, scheduled_date)` on jobs, GIN trigram indexes on name/email columns for fast search on large datasets. Jobs status/customer filters run sub-millisecond even at 20k+ rows.

## API Routes

All routes under `/api`:
- `GET /auth/user`, `GET /login`, `GET /callback`, `GET /logout` — auth
- `GET/POST /leads`, `GET/PATCH/DELETE /leads/:id`, `POST /leads/:id/convert`, `POST /leads/:id/notes`, `POST /leads/:id/status`
- `GET/POST /customers` (paginated: returns `{customers, total, page, pageSize, totalPages}`, supports `search`/`clientType`/`status`), `GET/PATCH/DELETE /customers/:id`, `POST /customers/:id/status`
- `POST /customers/:customerId/set-default-property`, `POST /customers/:customerId/reset-default-property`
- `GET/POST /contacts`, `PATCH/DELETE /contacts/:id`
- `GET/POST /properties`, `GET/PATCH/DELETE /properties/:id`
- `GET/POST /services`, `PATCH/DELETE /services/:id`
- `GET/POST /quotes`, `GET/PATCH/DELETE /quotes/:id`, `POST /quotes/:id/convert`
- `GET/POST /jobs` (paginated with `page`/`limit`, or bounded `view=today`/date-range/`customerId` returning arrays directly, hard cap 300 rows unconstrained), `GET/PATCH/DELETE /jobs/:id`, `GET /jobs/unscheduled`, `POST /jobs/:id/generate-invoice`
- `GET/POST /invoices`, `GET/PATCH/DELETE /invoices/:id`
- `GET/POST /crews`, `PATCH/DELETE /crews/:id`
- `GET/POST /recurring-plans`, `PATCH/DELETE /recurring-plans/:id`
- `GET/POST /tasks`, `PATCH/DELETE /tasks/:id`
- `GET /dashboard/stats`
- `GET/POST/DELETE /attachments`, `POST /storage/uploads/request-url`, `GET /storage/objects/*path`, `GET /storage/public-objects/*path`
- `GET/POST /activity-logs`
- `/admin/import/...` — see Import Engine below (super_admin only)

**Known spec/runtime mismatch**: `lib/api-spec/openapi.yaml` declares `GET /customers` as returning `Customer[]` directly, but the server actually returns `{customers, total, page, pageSize, totalPages}`. The generated `useListCustomers` hook is typed as `Customer[]` but the runtime value is the wrapped object — any new code consuming this hook must defensively handle both shapes (or unwrap `.customers`) until the spec is corrected.

## Phase 1 MVP Status

| Feature | Status |
|---------|--------|
| Authentication & user roles | ✅ Replit Auth OIDC login screen + session |
| Customer records + contacts | ✅ Full CRUD |
| Property records | ✅ Full CRUD |
| Service catalog | ✅ Full CRUD |
| Quotes | ✅ Full CRUD + convert to job + print view |
| Jobs and scheduling | ✅ Full CRUD + status tracking + weekly schedule view |
| Recurring service plans | ✅ Dedicated module |
| Crew assignment | ✅ Full CRUD |
| Mobile-friendly job execution | ✅ Responsive layout, mobile nav |
| Invoices | ✅ Full CRUD + status tracking |
| Tasks / lead activities | ✅ Dedicated tracker |
| Core dashboard | ✅ KPIs, recent jobs/invoices |
| Batch customer import (staged, reviewable, rollback-able) | ✅ |
| Payment links (Stripe) | ⬜ Phase 2 |
| SMS/email reminders | ⬜ Phase 2 |

## UX/UI Design System

- **Layout** (`Layout.tsx`): Sticky top header `h-14 z-20`, sidebar 56px wide, `GlobalSearch` in header, breadcrumb, user avatar + sign-out
- **StatusBadge**: shared dot+label component, consistent colors across jobs/quotes/invoices/customers/leads — scheduled=blue, in_progress=amber, completed/paid/approved/active=emerald, overdue/rejected/canceled=red, draft/inactive=slate
- **Cards, not tables**: Jobs/Invoices/Quotes/Customers use card layout with `border-l-4` status-colored accents
- **Loading skeletons** and **friendly empty states** (icon + message + primary action) on every list page
- **Toast pattern**: `useToast()` on all mutations (success + error variants)
- **Not-found guard**: `isError || (!isLoading && !entity)` in all detail pages
- **Confirmation dialogs**: no native `confirm()` — all destructive/irreversible actions (delete job/quote, cancel job, convert lead, mark lead lost) use a styled Dialog with explicit keep/proceed buttons, on both desktop and mobile action bars
- **Back buttons**: consistent pill-button style (not plain text links) across detail pages
- **Action hierarchy**: Hero card → primary action row → main content → sticky sidebar (large total `3xl bold`)
- **Sticky bars**: header `top-0 z-20`, filter bars `top-14 z-10`, sidebars `lg:top-20`
- Customer/job picker fields use a searchable combobox (Popover + Command), not a plain `<Select>` — see "Known spec/runtime mismatch" above for why plain selects broke at scale

## Invoicing

- `POST /api/jobs/:id/generate-invoice` creates a draft invoice from a completed job (pulls total from linked quote, 30-day due date); 400 if job not completed, 409 if invoice already exists
- List/detail views enriched with customer name + job number; `PATCH` auto-sets/clears `paidAt` on status transitions to/from `paid`
- Status actions: Mark Sent / Mark Paid / Mark Overdue / Return to Draft

## Jobs & Schedule

- Weekly schedule page (`/schedule`) groups jobs Mon–Sun with week navigation, unscheduled-jobs banner, reschedule modal
- Job list uses tab-based server-side queries (Today / Upcoming / All-paginated) — avoids loading the full jobs table into the browser
- Auto `completedAt` set/cleared on status transitions; `Convert` on a quote creates a linked job

## Quoting

- `quote_line_items` is a proper relational table (not a JSON blob); subtotal auto-calculated
- Quotes can link to either a `customerId` or a `leadId` (both nullable, exactly one expected)
- Print view at `/quotes/:id/print` (auto-opens browser print dialog, signature block, PDF-ready)

## Default Property

- `customers.default_property_id` (nullable) stores an explicit manual choice; `null` means auto-select
- `GET /api/customers/:id` returns server-computed `effectiveDefaultPropertyId` + `defaultPropertySource` ("manual" | "auto") — this is the **only** field the frontend should read for default-property display; do not reintroduce client-side `isPrimary` fallback logic
- Auto-selection priority: most recent job's property → billing-address property → oldest property
- `POST /customers/:customerId/set-default-property` / `reset-default-property`; deleting a property clears the customer's default if it was the one deleted

## Activity Logging

- Actions across customers, leads, jobs, invoices, and recurring plans are written to `activity_logs` (see schema above)
- `CustomerDetail`/`LeadDetail` Activity tabs render a timeline with per-action-type colors (red=deletions, amber=reschedules/status changes, indigo=crew/auto-generate, cyan=creations, violet=recurring plans)
- Mutations that affect a customer from another page (e.g. editing a job) must invalidate both that entity's query key and the related customer's query key so navigating back shows fresh data

## Customer Factor Import Engine

Staged, reviewable, rollback-able batch import — replaces a one-shot inline import tool. Every DB write during apply is logged to `import_change_log` with a before-state, so any applied batch can be rolled back.

**Pipeline**: upload file → normalize rows → match against existing records → stage rows + review-queue items → human review/decision → apply → (optionally) rollback.

**Matching rules — ZERO AUTO-MERGE (current policy, do not weaken without explicit request)**:
- Matching is performed **only** by exact email or exact phone. No matching by name, company name, address, or partial/fuzzy logic.
- Every match (including exact email/phone) goes to the review queue for human approval — there are **no automatic merges**.
- The only auto-approved path is a genuinely new customer (no match found at all).
- `import_match_type` recorded per row: `exact_email`, `exact_phone`, `weak_match`, `new_customer`.
- On conflicts, the CRM record wins: import only fills blank fields; any field where the CRM already has a value goes to review instead of overwriting.
- Duplicate jobs are marked `is_hidden` + `is_suspected_duplicate` (never deleted).
- Status is never auto-downgraded.

**Key services** (`artifacts/api-server/src/services/import/`): `normalizer.ts` (phone/email/name/address normalization, numeric field sanitization, fingerprinting), `matcher.ts` (exact-match lookups only), `staging.ts` (per-file pipeline), `applier.ts` (writes + change-log), `rollback.ts` (reverses change-log entries in reverse order).

**Key API routes** (`/api/admin/import/...`, `requireSuperAdmin`): batch CRUD, file upload/reclassify, paginated + searchable review queue, single/bulk review decisions, apply, rollback, purge, plus a debug-trace endpoint (`GET /admin/import/debug-trace?q=`) that traces a single customer through the whole pipeline for troubleshooting.

**Frontend**: `/admin/import` — multi-file drag/drop with auto-detected file grouping, required column-mapping step (with saved mappings + identity gate requiring name/email/phone), staging console log, filterable/searchable review queue with bulk actions, apply confirmation with pending-item guard, and a double-confirm rollback flow.

**Historical bugs fixed (informational only, rules above are current)**: `parseInt` on non-numeric CF fields (e.g. `"n/a"` star ratings) silently failed customer inserts — fixed with numeric sanitization + NaN-safe parsing; a few customers had external IDs assigned to the wrong person due to now-removed fuzzy matching — fixed via a one-time idempotent startup migration; invoices could import with a null `customer_id` — fixed via a two-layer external-ID lookup (live customers, then in-flight staging rows).

## Known Backlog / Usability Issues

- "Automations" page in the sidebar links to a feature that may be incomplete — could use a "coming soon" treatment
- "Properties" in the Admin section is separate from customer profiles — consider removing from top-level nav since properties are only meaningful in the context of a customer
- "Mark Sent" on QuoteDetail changes status immediately with no confirmation dialog (lower risk than Delete/Cancel, so left as-is intentionally)
- Mobile: the sticky action bar on JobDetail could be more compact on very small screens

## User preferences

- When the user requests a narrowly-scoped bug fix, do not perform unrelated refactors. Report exactly which files changed after each fix and wait for explicit sign-off before starting the next one.
- Keep this file lean: prefer documenting *current* architecture/behavior over a chronological changelog. Historical "Rev N" bug-fix narratives should be summarized or dropped once superseded, not accumulated indefinitely.
