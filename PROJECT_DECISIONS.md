# Project decisions and working context

**Last updated:** 2026-09-21

## How to use this file

This is the running memory for work on this repo. It exists so that a lost chat, a new
machine, or a fresh session can pick up without re-deriving anything.

Read it before starting work. Update it whenever:

- The user makes a decision
- A recommendation is made and accepted or rejected
- Work is parked, and why
- We start waiting on the client for something, or an answer arrives

Keep it factual. Everything here should trace to something actually verified in the repo, not
assumed. Where something is unverified, say so explicitly.

**Read this alongside `.agents/memory/project-architecture-map.md`.** The two divide cleanly
and neither replaces the other: that file maps the repository as built — topology, runtime and
data flows, library choices, verification baseline, technical risks. This file carries the
decisions, the roadmap, and what we are waiting on people for. When they disagree about a
technical fact, the architecture map was measured more recently; when they disagree about a
decision or its reasoning, this file is the record.

`.agents/memory/MEMORY.md` indexes the other agent-memory notes, several of which capture real
traps (Radix Select pitfalls, advisory lock namespaces, the convert-core adapter pattern).
Worth a look before touching those areas.

---

## Where things stand right now — read this first

**As of 2026-10-05. All fourteen of Kyle's Testing Edits of 2026-10-01 are built and
browser-verified** — phases 16 through 21 — along with a **usability sweep** of every
screen they touched, which found and fixed 36 things before he sees any of it.

**Everything is live on Sandbox 2** (bundle `index-CYXe_Ae1.js`, built 2026-10-05 07:32
GMT): phases 16–21 verified **25/25** against the deployed app, and the four fixes that
reading those screenshots turned up verified **8/8** after the republish that carried them.

**The release message has gone to Kyle and Lute.** What we are waiting on them for is listed
under "Waiting on the client" — eight items, none of which blocks Phase 13 or 14.

**Phase 13 — sub-customers is live on Sandbox 2**, and **Gate Code and Access Notes are
gone for good** — out of the code, republished, and the columns dropped on 2026-10-05,
verified 9/9 against the deployed app afterwards.

**Phase 14 — Phase A of the calendar is complete.** Steps 3, 4 and 5 are all done: filters
with the §11.6 preferences behind them, the job side drawer, Move Entire Day, scheduling
blocks, the conflict validation that turns a block from advice into a rule, and bulk
invoicing with a review. **All five prototype tasks can now be done from the calendar**,
which is what the approval gate is about — the spec allows no further calendar complexity
until they are fast and need minimal training. **Two of the four architectural blockers are
cleared** (§11.6 and §11.4), both by using tables Step 1 created and nothing had read.

**Phase 14 is live on Sandbox 2 — republished 2026-10-09 and verified against the deployed
app, not the bundle.** Routes: all four answer. Behaviour: a day blocked on the live build
refuses a booking and names the block, Move Entire Day answers, bulk invoicing previews a
month without creating anything, and the per-user preferences come back (6/6). Screens: the
filter bar, **Block days**, **Create invoices**, the day's move control and the job drawer
are all there and working (8/8). The one test block written during the check was lifted;
nothing of the client's was touched.

**Kyle's 8 October corrections are read and checked** (see below). Nothing he flagged is a
defect in what is waiting to be published, but one of his items — **#15** — connects to it:
the hard-block rule had only been put on three of the seven paths that create a job, and the
estimate conversion was one of the four without it. That is now closed. After the republish:
**#15 and #23 are done (2026-10-10, in the working tree)**; then #3 (waiting on Kyle's screenshot) and #6's typed deactivation cause, which needs an announced migration. #7, #15, #23 and #31 are done 2026-10-10. Phase 15 go-live needs a date from
Lute; Phase 12b email and A#9 still wait on his keys, and six of Kyle's checklist items
cannot be tested until they arrive.

Three things to put to Kyle with the republish, all recorded in their phases: whether a
quote's validity should run from **delivery** (the assumption built) or from creation;
whether appointment **durations** should offer 15 and 45 minutes as well; and which other
profile fields are commercial-only.

The calendar note below is older and still true as a description of the spec work.

**As of 2026-09-11.** Everything below this section is detail; this is the state of play.

**The work:** building the calendar described in the Corstead spec (v1.0, 31 Aug 2026). Of its
34 V1 items, **6 are done, 10 partial, 18 not started**. Only 1 of the spec's 5 prototype tests
passes. The sequencing plan is the Roadmap section.

**What is in flight:**

| | State |
|---|---|
| **Step 1 — the four calendar tables** | Committed (`a8a245e`) and **live on the Neon development branch** — 75 tables, constraints proven by test. Not on production, and the backfill migration has not run anywhere |
| **Step 2 — Scheduling Queue and On Hold** | **Complete** — API committed (`e64476d`), three-tab UI built 2026-09-11 and uncommitted. None of it has run against a real database yet |
| **Database move to Neon** | Recreated in `us-west-2` on 2026-09-11, schema pushed and constraints re-proven. Development is usable now; production is empty and untouched |
| **Notify-before-send** | Parked deliberately. Investigated and planned, not built |

**The immediate next actions, in order:**

1. Point the Replit **development** environment at the Neon dev branch (`DATABASE_URL`), and
   set `APP_MIGRATIONS_ENABLED = "true"` so the backfill migrations run there. Everything else
   waits on this — the queue endpoints have never run against a real database
2. Verify Step 2 end to end once the database is connected — the queue has never met a real
   row. It unlocks two prototype tests
3. Fix the migration gate to allow a production environment — required before any cutover
4. Move Neon project ownership to Lute; he asked for it, and the account was created on our side

**The single most important constraint:** Lute wants no interruption to Kyle's testing. Do not
let the database move stall the feature build.

**Do not** run `git commit` or `git push` — hand the user the message to paste.

---
## Phases 1–7 are deployed and verified on Sandbox 2 — 2026-09-25

`a8c38c0` is pushed and republished. The deployed bundle
(`/assets/index-Cgd1zUPe.js`) carries every Phase 1–7 marker and no longer carries
`gateCode` at all. **Sandbox 2 now runs the same code as the working tree** — the
gap recorded earlier, where it was still on pre-Phase-1 code, is closed.

**The run:** `scratchpad/sandbox2-accept.mjs`, headed, against
`https://sandbox-2-data-free-corsteadllc.replit.app` — 36 checks across all seven
phases, scenarios and edge cases, signed in as `team_admin` and as `team_tech`, with
a guest browser for the customer's own estimate link.

**Result: 36/36.** Five reported as failures on the first pass; all five were faults
in how the test asked, re-asked correctly in `scratchpad/sbx2-failures2.mjs` and all
five passed. They are worth writing down because they will trip the next test author:

| What looked broken | What was actually true |
|---|---|
| "Account type is not first on the form" | There is **no `/prospects/new` route** — the form is a dialog opened by **New Prospect** on `/prospects`. The test had been reading the nav sidebar. The dialog reads: Account type → Residential/Commercial → Contact information → Salutation → First name |
| "Customer Since is not set to today" | The field is **`customerDate`**, not `customerSince`, in the API and in the column (`customer_date`). Sending `customerSince: "2001-01-01"` on create stores `2026-09-24`; a later PATCH cannot move it; the profile shows it read-only |
| "A duplicate dropdown option is not refused" | It is: the second add returns **HTTP 409 `"ZZ Dup Probe" is already an option`** and no second row is written. The test read the page 1.2s later, by which time the toast had gone |
| "Gate Code and Access Notes are still there" | **No screen asks for them** anywhere on the profile. The `access_notes` and `gate_code` **columns** are still on `properties`, and the API still answers with those keys — dropping them is **Phase 9**, as planned. Not a defect |

**Verified on the deployed build, not localhost:** the five custom-field types and
their dropdown choices (values survive a reload; a blank date stays blank, not
"null"); a service typed while quoting joining the company-wide catalogue and
landing as a priced line; the customer's secure estimate link opening without a
sign-in and turning the estimate Viewed; Draft → Sent → Viewed, manual correction
with a reason, Accepted refused (400), unknown status refused (400), missing
estimate 404, field tech 403; one Communication & Activity tab with the estimate
email and the profile's own changes, newest first, filters that lose nothing
(1 email + 0 text + 4 changes = 5); the Overview's General Notes and created-by /
last-updated-by; and the full delete — 400 without confirmation, a dialog that
counts "1 job, 1 estimate, 1 invoice", a button that stays disabled until the name
is typed, nothing left in the database, and an audit row naming who did it.

**The database was returned to exactly what it was:** 1 customer (Lute Atieh),
1 property, 0 quotes, 0 jobs, 0 invoices, 0 services, 0 custom fields, 0 catalogue
options. The acceptance script's own cleanup crashed on
`custom_field_definitions.name` — **the column is `label`** — so the leftovers were
removed by hand (`scratchpad/sbx2-cleanup2.mjs`, `sbx2-cleanup3.mjs`), including
dropdown choices orphaned under `profile_catalog_items.catalog_type =
'custom_field_<id>'` once their definition is gone. **Deleting a custom field does
not take its choices with it** — worth fixing when Phase 8 touches this area.

**Still true, and Kyle should be told before he tests:** there is no email provider
on the sandbox, so an estimate is never actually delivered — the estimate page shows
the secure link with a **Copy secure link** button, and that is how to open the
customer's view. The service catalogue, dropdown lists and custom fields are empty
**by design**, because creating them is itself what Kyle asked to be able to do.
Conversion (estimate → job) is **not built yet** — it is Phase 10 — so his lifecycle
steps 05–08 will not complete.

---

## Phase A4 — conversion: choose the services, arrival window + duration, Schedule + invoice — 2026-10-29

**Built and browser-tested (MCP, local server); API walkthrough 23/23** (`scratchpad/a4-walkthrough.mjs`).
Toheed asked for this phase to be built "as a senior engineer": easy for the office, proper on
the server. So every choice the screen offers is checked again on the server, the money is
the server's own sum, and everything is one transaction and one click.

- **Services ticked from the customer's choice** (`EstimateConversionDialog.tsx`): every service
  offered is listed per location; the accepted ones start ticked, declined ones show **"Declined by
  the customer"** unticked. The office can untick (not doing it now) or tick a declined one back
  (customer changed their mind by phone). A location with nothing ticked gets **no job** and says
  so. A live total (discounts, then tax, the server's rules) and an amber note **"Different from
  what the customer accepted: adding X; leaving out Y"**, which also goes into the estimate's
  history. An unticked "to be quoted" service no longer blocks scheduling the rest.
  Server (`conversionSelection`): only the estimate's own services, at least one; the customer's
  copy of a line when they took it; `addedLineItemIds` / `removedLineItemIds` recorded.
- **Exact time or arrival window, plus how long the job takes** (`resolveScheduleTimes`): the office
  picks a start, "Exact time" or "Arrival window" (1–4 h), and a duration (30 min–12 h); one line
  says what the customer will be told ("Arrive between 9:00 AM and 11:00 AM · about 2 hours 30 min
  of work"). **The server works out the end itself** (start + duration) and refuses durations
  outside 15 min–12 h / 5-min steps, windows outside 30 min–8 h / 15-min steps, and anything past
  midnight; errors name the address, not "Location #30". Older clients that send an end still
  work. New column `jobs.arrival_window_minutes` (null = exact); the job page shows "Arrival window
  — Arrive between …". *Not yet:* the window in appointment emails and on the calendar card.
- **Schedule + create invoice**: a second button makes a **draft invoice, due in 30 days**, linked to
  the jobs, in the **same transaction** (both or neither), **one line per service** with its share
  of the discount and its tax to the cent (`conversionInvoiceLines`), and the server checks the
  invoice total equals the jobs' total or saves nothing. The office lands on the invoice, ready to
  "Email invoice" (A3). The same click again, or a second conversion, makes no second invoice.
- **Invoices in documents**: the profile's **Photos & Files** lists its invoices (number, amount,
  status, date), each opening the live PDF — drawn when opened, so never stale, and no storage needed.
- **Already right before A4, kept**: the preview reads the accepted snapshot (not the live quote);
  the conversion is idempotent, locked per estimate and checks blocked days.

**Migration `job-arrival-window-v1`** (one nullable column on jobs; additive). Applied to the local
copy only; Sandbox gets it through the gate at the next republish.

**Browser (MCP):** dialog opened with the customer's two services ticked, Screens "Declined by the
customer", $450 after 10%; ticked Screens, unticked Lake house → that location "no job", total
$405, the change note; Arrival window 2 h + 2 h 30 → summary line; **Schedule + create invoice** →
landed on the $405 draft invoice with both services, toast "1 job scheduled · invoice … created";
the job shows its arrival window; the estimate history "1 job · 1 declined service added · 1
accepted service left out · invoice … created"; Photos & Files lists the invoice PDF. At 375 px:
nothing ticked → "Tick at least one service" with both buttons off; 2 PM + 12 h → "runs past
midnight"; no sideways scroll. Fixed while testing: a duplicate test id and the Arrival label
sitting beside its toggle. Tests: API +7, CRM +7; CRM 853/853; API only the 14 DATABASE_URL
baseline files; typechecks clean. All ZZ rows and the throwaway local account removed.

---

## Phase A3 — the customer's invoice page, its PDF, and its opens — 2026-10-29

**Built and browser-tested (MCP, local server); API walkthrough 25/25** (`scratchpad/a3-walkthrough.mjs`).
Video 7: invoices had no customer link at all and only the browser's Print. Now an invoice goes
out the way an estimate does.

- **Email invoice** (`components/SendInvoiceDialog.tsx`, `routes/invoice-public.ts`) replaces the
  old inline composer: any of the profile's addresses (a new one saved to the profile first), a
  message with tags (`{{invoice_page_link}}`, `{{invoice_link}}` = PDF, `{{balance_due}}`,
  `{{due_date}}` …), PDF attached as an option, a preview, communication safety, one email per
  click (idempotency), Email History, and the invoice's own Communications list. An email that
  cannot reach the invoice (no link, no PDF) is refused. **A voided or fully credited invoice
  cannot be sent.** A **draft** that is emailed becomes **Sent**; the automatic "invoice sent"
  event is **not** queued then (the customer has just been emailed it).
- **The customer's page** `/invoice/:token` (`pages/PublicInvoice.tsx`), no sign-in: the business,
  the lines, total, paid, credited, **balance due today** and a banner (due by / past due / paid
  in full / cancelled), Print / PDF. **The invoice is live, not a snapshot**: an old email shows
  today's balance. The invoice's **Notes are the office's and are never shown** to the customer
  (page or PDF), nor the customer's email/phone on the page — *to ask Kyle whether he wants a
  customer-facing message on invoices.*
- **PDF** (`lib/invoice-document.ts`, our own PDF writer): INVOICE, dates, Bill to, service
  address, lines with discounts/tax, totals, Paid/Credited, Balance due; PAID / OVERDUE / VOID
  stamp; the company footer. The office has a **PDF** button on the invoice.
- **Opens**, same rules as A2: each address its own key; staff opens not counted; a reload
  within 30 min is one visit; office emailed "INV-… opened by …" on each address's first open,
  then at most daily, **never once paid, voided or credited**. The A2 Settings switch now reads
  "opens an estimate **or an invoice**". **Copy customer link** makes a link whose opens count as
  a copied link.
- **History** on the invoice: emailed (to whom, PDF attached), link copied, opened (which
  address, visit n), printed, office emailed — with who did it.
- Links are kept only as hashes; `/public/invoices/` tokens are redacted from the request log;
  public routes rate-limited like the estimate's.

**Migration `invoice-public-v1`** (additive: three new tables `invoice_public_links`,
`invoice_deliveries`, `invoice_activities`, five indexes; nothing existing touched). Applied to the
local copy only; Sandbox gets it through the gate at the next republish.

**Browser (MCP):** dialog lists both addresses, warns and disables Send with no link, preview
filled; sent to two with the PDF → both rows "Not opened yet", the invoice Sent; office PDF
correct and without Notes; Copy link toast; the office opening Bob's link counted nothing;
signed out, Bob's page correct (lines, $400 due by date, no notes), Print/PDF opened the PDF,
no sideways scroll at 375 px; a bad link shows "Invoice unavailable"; back as the office: Bob
"Opened once", history readable with names, the office emailed once; **Mark Paid** → the
customer's page "Paid in full … Thank you!", $0.00, and Ann's open then sent no notice.
Tests: API +9 (`invoice-public.test.ts`), CRM +4 (`invoice-history.test.ts`); CRM 846/846; API
only the 14 DATABASE_URL baseline files; both typechecks clean. Local test used a throwaway
`zz_a3_admin` account on the disposable DB, deleted after; all ZZ rows removed.

---

## Phase A2 — estimate history, opens per address, the office told — 2026-10-29

**Built and browser-tested (MCP, local server); API walkthrough 19/20** (the 20th, a second
copied-link open, was refused by the public link's own rate limit after ~25 rapid calls; the
same open run alone counts). CRM 848/848, API 998 + the 14 baseline `DATABASE_URL` files,
both typechecks clean. **Migration `estimate-opens-v1`** (additive: `estimate_delivery_requests`
`open_key_hash` + partial unique index, `open_count`, `first_opened_at`, `last_opened_at`,
`open_notified_at`; `estimate_public_links.open_count`, `open_notified_at`;
`quote_settings.open_notification_enabled` default true) — local copy only; Sandbox at the
next republish through the gate.

- **Opens per address (Video 7):** the link is one per send, so each recipient's copy carries
  its own key (`?r=`, 16 chars; only its hash is stored; `lib/estimate-opens.ts`). The page and
  the PDF count an open against that address; no key or an unknown key counts on the link
  ("Copied link"). A reload / the PDF within 30 minutes is the same visit. **A signed-in team
  member's open counts for nothing** (the old "Copy link opens count as viewed" defect).
- **Office told on open (must-have):** "Q-… opened by …", on each address's first open, then
  at most once a day (the recommendation put to Kyle); never once the estimate is decided;
  claimed under a row lock so two opens cannot both send it. Settings → "When a customer opens
  or accepts" has an on/off (default on).
- **Readable history** (`crm/src/lib/estimate-history.ts`): every activity as a sentence with
  who did it — the team member's name (the lifecycle now returns `actors`), "Customer", or
  "Corstead (automatic)" — and the address (sent to, opened through). Online vs verbal
  acceptance told apart. The Delivery section shows "Opened N times, last …" per address.
- The A1 Print link and the page's own reload carry the key.

---

## Phase A1 — the customer's decision, confirmed, kept and thanked — 2026-10-28

**Built and browser-tested (MCP, local server, 2026-10-29); API walkthrough 20/20.** Browser:
accept 1 of 2 with a comment → dialog, thank-you, recap, comments, survives reload; Print opens
the PDF and logs `printed`; decline Cancel records nothing, decline with reason + "contact me"
→ office notice; 375px no sideways scroll; Customer Notes card on the estimate and in the
conversion dialog; Settings edit + tag button + email off → new message shown and
`customer_thank_you_skipped` (turned_off), then restored; technician PUT → 403. **Two fixes
from the browser run:** a declined estimate showed every service ticked and green (now none);
the estimate header said "Draft" for an accepted estimate (`STATUS_CFG` had no `accepted` /
`viewed`). Not changed: the header total stays the offered total after a partial accept.
ZZ records removed from the local copy. CRM 829/829, API 965 + the 14 baseline
`DATABASE_URL` failures, CRM build OK. **Migration `estimate-acceptance-v1`** (additive:
`quotes.customer_notes`, `customer_notes_at`; `quote_settings.acceptance_message`,
`acceptance_email_enabled` default true, `acceptance_email_subject`, `acceptance_email_body`),
applied to the local copy only; runs on Sandbox through the gate at the next republish.

- **Defect fixed (Video 7 must-have):** the comment typed while accepting was discarded
  (`declineReason` was set null on accept). Now it is the estimate's **Customer Notes** —
  on the estimate page (amber card above the lines), in the conversion dialog, in the
  acceptance activity, and in the office's acceptance email. A replayed accept does not
  overwrite it.
- **Customer page:** Accept and Decline each open a confirmation ("Almost done!" with an
  optional comment; decline with an optional reason and "contact me"); a failed decision keeps
  the dialog and its text. After accepting: "Estimate status – Accepted", "Thank you for
  confirming!", the business's own message, a recap of the accepted services and total, and
  their comments. **Print / PDF** button (the public PDF; logged as `printed`).
- **Customer thank-you email** on the customer's own acceptance only (`lib/estimate-thank-you.ts`):
  to the addresses the estimate was sent to, else the profile's email; communication safety per
  address; Email History (`sentBy` "Corstead (automatic)"); activities `customer_thanked` /
  `_failed` / `_skipped`. Never on an office conversion.
- **Office told of a decline** too, with the reason and the follow-up request.
- **Settings → After a customer accepts** (administrators): the thank-you message, whether the
  email is sent, its subject and body, with tag buttons; blank uses Corstead's short default
  (shown as the placeholder). `PUT /quote-settings/acceptance`.
- Locally `OFFICE_EMAIL_ADDRESS` is now set in `start-api.ps1` (zz.office@example.com, mock).

---

## Videos 7, 8 and 9 — analysed against the code, 2026-10-28

Sources: three PDFs from Kyle (summary + cleaned transcript: V7 estimate package, V8 profile
communication, V9 prospect → customer) and a Word file `FUsIRs.docx` (a long generated spec
for V7 and V8 only; **no V9**). **The PDFs are Kyle's words and win where they differ**; the
Word file adds detail Kyle never asked for (5 online + 5 PDF formats, slogan, decline-reason
list, IP/device tracking, template cloning, upsell section) — treat that as optional.
Phases 1–8 were republished 2026-10-27; all six migrations applied 11:34 UTC.

**Where they differ:** auto job on acceptance — Word: a template setting; V7 PDF #13 and V9:
reconcile with office-controlled conversion. Customer comment on accept — Word: saved with the
proposal; PDF #07 (**must-have**): a **"Customer Notes"** field on the estimate **and** in the
acceptance email. Only the PDF has: open-notification email to the business (**must-have**, for
invoices too), package by link **or** attachment plus extra attachments, Print on the
customer page, a customisable thank-you screen, residential/commercial audiences, line items
ticked or unticked by default (to confirm), Gmail connection / bounces / CRM-upload attachments
(V8, "scope not final"), SMS provider undecided (Kyle to ask Lute, likely Twilio).

**Corstead today (code read 2026-10-28):**

| Need | Today |
|---|---|
| Accept / Decline on the customer page | Exists, **one click, no confirm**. One textarea is labelled "decline reason"; **a comment typed while accepting is discarded** (`estimates.ts` sets `declineReason` null on accept) — defect against V7 #07 |
| Customer ticks services (partial accept) | Exists, all ticked by default; stored as `acceptedSnapshot`, conversion honours it |
| Thank-you / recap after accepting | A banner on the same page; not customisable |
| Print on the customer page | Missing (public PDF endpoint exists) |
| Open tracking | Only `firstOpenedAt` on the link; **one link shared by all recipients**, so which address opened is unknowable; staff "Copy link" opens count; **no notification**. Invoices: no public link at all |
| Office told of a decision | Accept only (fixed-wording email); decline: nothing. **No customer thank-you email** |
| Estimate history | Raw activity names, no actor/recipient; office vs customer acceptance stored but not shown; opens not shown |
| Package content (intro, service pages, disclaimers, closing, W-9/licence/insurance, photos) | **Missing**: services have only a short description; no templates/sections; no company-wide uploads; no rich-text editor; `@dnd-kit` present |
| Profile email composer | Inline dialog, **no template picker**; three separate tag engines |
| SMS | No provider; rows logged `provider_unconfigured` |
| Letters | Missing |
| Communication history | Email History (open + resend) and a feed; not unified, no delete, no search; estimate sends likely appear twice |
| Conversion | **One estimate at a time**; lines can't be unticked; declined lines not shown; exact start/end only (no window, no duration field); **no "schedule + invoice"**; same record kept (good); preview reads live quote, not the accepted snapshot |
| Invoice PDF / auto-filed documents | Missing (browser print only) |

**Proposed phases (order):**
- **9 — the customer's decision done right:** confirm dialog; **Customer Notes** saved on the
  estimate and in the office email; customisable thank-you recap; Print/PDF on the customer
  page; customer thank-you email (template); office told on decline too; readable estimate
  history (who, office vs customer, which address).
- **10 — opens tracked and notified:** a token per recipient; each open an activity; email the
  business on open (throttled); staff previews not counted; then invoices get a public page,
  a PDF and the same tracking.
- **11 — the Estimate Package** (two parts): templates (title, audience, company fields,
  colour, accept/decline shown, expiry, thank-you text, accept email) and generic sections
  (intro, service pages chosen by the estimate's services, disclaimers, pricing from the
  estimate, closing, PDF documents, photos, custom), reorder, rich text (new dependency),
  merge fields, preview, snapshot at send; chosen in the send dialog (basic vs package).
- **12 — communication centre on the profile:** Email / Text / Letter tabs; templates with
  Use / Edit / Delete in the profile composer; one tag engine; SMS composer ready but sending
  waits on a provider; letter templates, multi-select print (our PDF writer); one history
  table (type, by, related record + View), delete single/bulk with confirm and its own
  permission, filter.
- **13 — conversion:** several estimates at once; tick/untick lines (customer's choice
  pre-set, declined shown); arrival window or exact time + duration; "Schedule + create
  invoice"; preview from the accepted snapshot; invoice PDF filed into documents.

**Regrouped 2026-10-28 (Toheed asked: what can start with no open question).**
Group A, in order — A1 customer decision (Customer Notes fix, confirm, thank-you, Print,
thank-you email, decline notice); A2 estimate history + opens per recipient + open
notification (default: first open per address, then daily); A3 invoice customer page + PDF +
open tracking; A4 conversion (untick lines, declined shown, snapshot preview, arrival window /
duration, Schedule + invoice, invoice in documents); A5 profile email templates + one tag
engine + letters; A6 one communication history with delete and filter.
Group B (waits): the Estimate Package builder (Q1/3/6, object storage, rich-text
dependency), auto job on accept (Q2), several estimates at once (Q4), SMS sending (provider),
credit-card button (payment provider), Gmail / bounces / CRM-file attachments (scope not final).

**To ask Kyle** (with my recommendation): name; auto job on accept (no — office converts, but
the accepted estimate is flagged and notified); default ticked (yes); two estimates → one job
per location (yes); open notifications (first open per address at once, then at most daily);
one good online layout + colour first, more later; credit-card button after a payment
provider; no customer email on office conversion. SMS provider: Lute.

---

## Phase 8 — branding: the business's name, details and logo on its estimates — 2026-10-27

**Built and browser-tested through the Playwright MCP against the real new server** (the local
disposable database). Kyle's Video 6: "businesses format their own estimate: what is shown,
footer, terms, logo." (Terms were already in Quote settings.)

**Settings → Company & branding** (administrators; `components/CompanyBrandingCard.tsx`):
business name, phone (formatted as typed), email, website, address, **logo**, a **footer on every
estimate page** (licence, insurance …, up to 1,000 characters), and two choices — **show quantity
and unit price** (off: only each service's amount) and **show each service's description**. The
logo is converted in the browser (PNG, JPEG or WebP) to a JPEG at its own proportions, at most
600 × 200, transparent parts white, and kept in the database (≤ 500 KB; the server reads its real
size from the file), so it needs no file store and the PDF can embed it.

**Where it shows:** the **estimate PDF** (logo, name, address, phone · email · website, the
footer, the choices), the **customer's estimate page** (logo, name, contact lines; it follows the
same choices), the **printed estimate** — which until now had "Superior Professional Window
Cleaning" written into the code and said QUOTE; it now says ESTIMATE, is the business's, follows
the choices, shows descriptions and the footer — and the **estimate email** (the logo at the
top; `{{business_name}}` is the profile's name). Until the profile is filled in, the name falls
back to the email sender name and nothing else is shown. "Primary service property" is never
shown to a customer. Public, for the customer's page and emails only: `/api/public/branding`
(name, contact lines, choices, footer) and `/api/public/branding/logo.jpg`; everything else
about the profile needs sign-in, and only an administrator can change it (an office admin
gets 403).

**Migration `company-profile-v1`**: creates `company_profile` (one row per organization; logo
and footer size checks). Dry-run on the shared database inside a rolled-back transaction:
applies and verifies cleanly; nothing left.

**For Kyle (defaults built):** unit prices and descriptions shown unless turned off; the
footer prints small on every page.

---

## Phase 7 — the estimate as a PDF, and the estimate email — 2026-10-27

**Built and browser-tested through the Playwright MCP against the real new server** (a local
disposable database, below). Kyle's Video 6 and answer #5: "a link that opens the estimate as a
PDF is the standard; attaching the PDF is an option."

**The PDF** (`lib/pdf-writer.ts`, `lib/estimate-pdf.ts`): Corstead writes it itself — no new
dependency — in the standard Helvetica fonts with their real widths, so text is measured,
right-aligned and wrapped exactly. It is drawn from the same snapshot as the customer's page,
so the services (grouped by location when there are several), each description, "To be
quoted", each discount by name, the sales tax and the total always agree. Several pages are
numbered; a draft says "DRAFT ESTIMATE". Phones print as (816) 555-0177 and "Primary service
property" is never printed. **Routes:** `GET /quotes/:id/pdf` for the office (the latest
finalized revision, else the estimate as it stands, marked draft) — the estimate page's new
**PDF** button; `GET /public/estimates/:token/pdf` for the customer, behind the same link guard
and rate limits as their page, and opening it counts as opening the estimate.

**The email** (Kyle's Video 6): the estimate page's delivery card is now **Email the
estimate…** (`components/SendEstimateDialog.tsx`, `routes/estimate-email.ts`). **To:** any of
the profile's own addresses, several at once; another address is **saved to the profile
first** ("save this address") — an email still never goes to an address that is not on the
profile. **Message:** Corstead's own, or **start from a template**; written as plain text, with
tag buttons (`{{estimate_link}}` the PDF, `{{estimate_page_link}}` accept online, first name,
total, valid until, sender, business …); Corstead turns it into HTML and escapes what was
typed. **Attach the estimate as a PDF** is an option; an email with neither a link nor the PDF
is refused. **Preview** shows it filled in, sandboxed. **Send:** each address passes the same
communication safety as any email (unsubscribed / blocked / quiet hours are skipped and
said so); one secure link is made for the send; each email is written to the profile's
**Email History** (who sent it) and the estimate's delivery state says sent or failed; an
Idempotency-Key makes a double click send once. Attachments now work for SMTP, SendGrid and
Mailgun (`lib/email.ts`). The old "Queue delivery" (which sent nothing in Sandbox) is gone; its
link-making is now shared (`lib/estimate-link.ts`).

**Found and fixed:** an estimate with a service at a second location and no appointment there
left that location out of its snapshot, so it could never be converted ("Location #… is not in
the accepted estimate"). The snapshot now includes every location a service is for.

**Not yet:** attaching other files and company-wide general uploads (insurance, service
sheets) — they need the object storage bucket, which only Replit has; building them after the
republish so they can be tested for real.

**How this was tested (new):** a disposable Postgres on this machine (port 5433, in the
scratchpad) with the shared database's **schema only** plus logins, services and settings — no
customer data — and the pending migrations applied to that copy only; the new server runs
against it. The shared database was only read. This also ran the phase 4 and 5 walkthroughs for
real (20/20 and 13/13, through conversion to two discounted jobs and a $255 invoice), and the 14
database tests that never run without a database: 89 of 94 pass; 2 files cannot load in this
runner (`.js` imports) and 3 jobs-route tests are stale against the current delete and PATCH
code (they expect `jobs` before `schedule_entries`) — older than these phases, to fix separately.

---

## Phase 6 — sales tax — 2026-10-26

**Built; browser-tested through the Playwright MCP with the new routes stubbed (Settings rates,
the estimate's tax choice and totals, Tax Exempt, Taxable services, the invoice form, phone and
desktop); the real run, through the jobs and the invoice, waits for the republish.** Kyle's
answer #2: "optional, never by default, on estimates and invoices"; state and county rates set
up by the business, "either rate alone or both added together"; "each service has a Taxable
setting".

**The rule** (`api-server lib/sales-tax.ts`, the same in `crm lib/sales-tax.ts`, checked to agree
on 2,000 random estimates): tax is on the amount **after discounts** — the discounts are shared
between taxable and untaxed lines by amount — on **taxable lines only**, rounded once to the
cent; a **Tax Exempt customer is never taxed** (the estimate screen shows why; the server refuses
a tax choice for them, an estimate's frozen rate is ignored for them, and an invoice with tax
for them is refused). Rates are 0–20%; an estimate's combined rate is frozen onto it
(`quotes.tax_rate`, `tax_label`, and the chosen rate ids), so changing a rate in Settings never
changes an estimate already made, and a save that does not change the choice never re-freezes.

**Where it is.** **Settings → Sales tax** (administrators): state and county rates, turned off
rather than deleted. **Service Catalog**: Taxable on each card and in Add service (off unless
ticked). **Estimate screen**: a Sales tax card (state rate, county rate, or both; "Use this
location's" suggests them from the location's state and county; "Turn tax off"; a warning when
nothing on it is Taxable) and **Taxable on each line** — Kyle's materials-taxed/labour-not case;
a line starts as its service is set up. The tax shows by name on every total: the estimate, the
print, the **customer's page** (worked out again on the services they tick), the convert dialog.
**Jobs and invoices**: a partial accept taxes only what was accepted; converting shares the tax
by each location's taxable work (`jobs.tax_total`); the job's generated invoice puts the tax on
its line and header; **bulk invoicing** adds each job's tax; the **manual invoice form** fills a
job's tax and can add a chosen rate to the lines ticked Taxable.

**Found and fixed while testing:** the New invoice form's customer picker was always empty (it
read `data` but the list answers `{ customers, … }`), so no invoice could be started from it.

**Migration `sales-tax-v1`**: creates `tax_rates` (kind/state/rate checks) and adds
`services.taxable`, `quote_line_items.taxable` (false), `quotes.tax_rate`, `tax_label`,
`tax_state_rate_id`, `tax_county_rate_id` (null) and `jobs.tax_total` (0) — every existing
total is unchanged. Dry-run on the shared database with the phase 5 migration first, inside a
rolled-back transaction and **running the real code**: $500 − Senior 10%, $200 of it taxable at
Missouri 4.225% + Jackson County 1.25% = tax $9.86, total $459.86 stored; Tax Exempt → tax 0 and
the choice refused; a 25% rate refused by the database; nothing left after ROLLBACK.

**For Kyle (defaults built):** tax after discounts; per-line Taxable starting from the service;
invoices round tax per line, estimates once on the whole.

---

## Phase 5 — discounts on estimates, and discounts that follow the profile — 2026-10-26

**Built; browser-verified locally with the discount routes stubbed (9/9; regressions phase 1
19/19, 3 15/15, 4 19/19); the real run, through the jobs and the invoice, waits for the
republish.** Kyle, Video 5: "dollar discounts or percentage discounts … name the discounts …
add more discounts if I want to stack them", and his answer #3: discounts that follow the
customer (senior, military) now.

**The rule** (`api-server lib/discounts.ts`, the same in `crm lib/discounts.ts`), in whole
cents: a **percentage is of the subtotal — they do not compound** (two 10% off $500 is $100);
a dollar discount is its amount; in order, each is **cut to what is left, so a total is
never below zero**. At most 10 per estimate; a percentage at most 100 (also a database check).
Tax (phase 6) will be worked out on the amount after discounts.

**Where it shows.** The estimate screen has a **Discounts** card while editing (name, % or $,
amount, remove, "Add a discount", and the profile's saved ones one tap away), and every total
lists each discount by name: the estimate, the print, the **customer's page** — where the
discounts are worked out again on the services they tick — the new-estimate screen, and the
convert dialog. **Discounts that follow this profile** sit in the profile's Estimates
section; each is **added to the profile's new estimates** (Kyle's default) and can be removed
there; removing it from the profile leaves estimates already made as they are.

**Money, end to end.** Every change to an estimate's lines or discounts ends in one writer
(`lib/quote-totals.ts`: subtotal, each discount's dollars, discount total, total). The
finalized revision carries the discounts. **A partial accept** works them out again on what
was accepted (a percentage of less is less; a dollar discount stays). **Converting** shares the
discount between the locations' jobs in proportion to their services, to the cent
(`shareDiscount`); each job's total is after its share and it keeps the share in the new
`jobs.discount_total`. **Generating the invoice** for such a job now uses that job's own amount
and shows its discount on the line — it used to take the whole estimate's total, which was
wrong for an estimate with more than one location (fixed with this). Jobs made the old way are
unchanged. **Not covered:** bulk invoicing and the manual invoice form use the job's total
(after discounts, so the amount is right) without naming the discount.

**Migration `estimate-discounts-v1`**: creates `customer_discounts` and `quote_discounts`
(with kind/value checks) and adds `jobs.discount_total` (default 0). Dry-run on the shared
database inside a rolled-back transaction, **running the real totals code**: profile discount
copied onto a new estimate, $500 − Senior 10% − $25 coupon = $425 stored, a 150% discount
refused by the database, existing jobs all 0, nothing left after ROLLBACK.

**For Kyle (defaults built, his call):** percentages of the subtotal, not compounding; a
discount never takes a total below zero; a profile's discount is copied onto new estimates
only, not onto estimates already made.

---

## Phase 4 — callbacks — 2026-10-26

**Built; browser-verified locally with the callbacks API stubbed (19/19; regressions 1b
13/13, phase 3 15/15); the real run waits for the republish** (it needs the new table).
Kyle, Video 4: "someone in the office, or even a virtual assistant, going through a list and
calling customers or prospects … whether we actually spoke to the prospect, left a message,
or neither … scheduling a callback", booking the work from there if they say yes, and the
notes to hand while on the phone.

**Callbacks** is the fourth section under the profile, between Estimates and Email History,
and in Jump To (`components/ProfileCallbacks.tsx`): the calls to make, soonest first and
marked Overdue / Today / Coming up, with who and why; **Schedule a callback** (date, time in
Chicago time, someone in the office, a reason); and **Calls made** with what happened. A
deactivated profile's callbacks are read-only. **The call screen** (`components/CallbackDialog.tsx`):
their phone to tap, email, each estimate with its price and location, the recent notes; then
**Spoke with them / Left a message / No answer, no message**, what was said, an optional
note about them or the property (to the specific notes), and **the next callback** — on by
default unless they spoke, the next weekday at 10:00, the same person. **"They want to go
ahead — book it"** records the call as spoken and starts booking: a prospect's estimate →
the convert picker (phase 1); a prospect with no estimate → a new estimate; a customer → a
new job. **The call list** (`pages/Callbacks.tsx`, in the sidebar for office staff):
every open callback, Overdue / Today / Coming up, Everyone or Mine; Call opens the same
screen, and book it opens the profile straight into booking (`?book=1`, used once).

Server (`routes/profile-callbacks.ts`, `lib/callbacks.ts`): each call is a row — when,
who, why, then the outcome, note, when and by whom; the next callback is a **new row**, so the
history of attempts stays. Recording an outcome closes only an **open** callback, writes the
call to the profile's **callback notes** (dated and signed, e.g. "Callback: Left a message …
Next callback Oct 29, 10:00 AM."), and books the next one, **in one transaction**; a second
save of the same call is refused. Only active office staff (customers.manage) can be given
callbacks; technicians are refused the list and the profile routes; `/callbacks` is
customers.view to read and customers.manage to change. Deleting a profile deletes its
callbacks (purge order). **Migration `profile-callbacks-v1`**: creates `profile_callbacks`
(customer cascade, assigned user set null, status and outcome checks) and two indexes. Dry-run
on the shared database inside a rolled-back transaction: applies and verifies cleanly.

---

## Phase 3 — photos, videos and files by location — 2026-10-26

**Built; browser-verified locally with the storage bucket stubbed (15/15); the real run waits
for the republish** (it needs the new column, and only Replit has the bucket). Kyle, Videos 4
and 5: photos, documents and videos "organised by job location", and photos that keep "the
same resolution and the same size".

**Photos & Files** (`components/FilesTab.tsx`, `lib/profile-files.ts`): **Upload to** picks
one of the profile's live locations (primary first, and the default) or the whole profile.
Files show **grouped under their location** as a grid of previews; a location with no files is
left out, and a file whose location is removed falls back to the whole profile. **Nothing is
resized or cropped**: tiles and the viewer show the original whole (`object-contain`), and
**Open original** / **Download** give the file as uploaded. **Videos** can now be uploaded and
play in the viewer; the file route now answers **byte ranges** (206), which iPhones need to
play a video at all and every browser needs to skip ahead (`lib/byte-range.ts`). The viewer
also **moves** a file to another location and **deletes** it — the old hover-only buttons
never showed on a touch screen.

Routes: `POST /attachments` takes `propertyId`; new `PATCH /attachments/:id` moves a file
(logged as "file_moved"). Both accept only a location **on that same profile**.
**Migration `attachment-location-v1`**: adds the nullable `attachments.property_id`
(references properties, on delete set null) and its index. Dry-run on the shared database
inside a rolled-back transaction: applies and verifies cleanly (0 attachments today).

---

## Phase 2 — email history: open any email, and resend it — 2026-10-26

**Built and unit-tested; the browser walkthrough waits for the republish** (it needs the new
column). Kyle, Video 4: "the date and time, what we emailed, and who sent the email … open
the email and view its content … resend that same email."

The activity feed only ever had a **redacted** line for an email (communication safety);
the full message is in `email_logs`. So the Email History section now leads with **Emails
sent** (`components/EmailHistory.tsx`): subject, status, time **in Chicago time**, recipient
and **who sent it** — a person, "Automatic: Estimate sent", or "Campaign: …". **View** opens
the message exactly as sent, in a **sandboxed frame** (no script in an email can run in
Corstead). **Resend** opens the profile's composer with the subject and message filled in;
it goes through the same send path and safety checks, and is logged as a new email.

Routes: `GET /customers/:id/emails` and `/emails/:emailId` (and `/prospects`), which need
**communication.view** and are refused to technicians; one email is only read through its
own profile. **Migration `email-log-sender-v1`**: adds the nullable `email_logs.sent_by`,
which the one-off send now fills in; older emails say "Sender not recorded". Dry-run on the
shared database inside a rolled-back transaction: applies and verifies cleanly (4 emails,
none rewritten). **Not covered:** event-driven automation emails write only the redacted
line, never an `email_logs` row, so they do not appear here yet.

---

## Phase 1b — sections under the profile, and Jump To to them — 2026-10-26

**Built and browser-verified locally (13/13; regression Phase 1 19/19, A 33/33). No
migration.** Kyle's answer #4. Under the profile: **Photos & Files**, **Estimates** and
**Email History & Activity**, in his order, closed by default and loaded only when opened
(`components/ProfileSection.tsx`). **Jump To** opens a section where it is and scrolls to it
— it never leaves the page, so an unsaved edit is not interrupted; Jobs, Invoices, Payments,
Contacts and Locations stay views of their own and still ask before leaving unsaved edits.
**Callbacks** joins as a fourth section in phase 4. Jump To's "Files" is now "Photos &
Files", Kyle's word.

---

## Kyle's answers to the Videos 4–6 questions, 2026-10-26

| # | Kyle | What it means for the work |
|---|---|---|
| 1 | **Estimate → Invoice: on hold.** He thinks the estimate would need scheduling first; he will follow up | Keep estimate → job → invoice. **Build nothing** for it |
| 2 | **Sales tax, optional, never by default, on estimates and invoices.** The business sets up **state and county rates**; base = state, county added when it applies; either rate alone **or both added together**. **Each service has a Taxable setting.** "We may need to refine the tax setup further" | New phase: a rates set-up in Settings, Taxable on the Service Catalog, a tax choice on estimates and invoices that taxes only taxable lines, carried estimate → job → invoice. Money code; migration |
| 3 | **Customer-linked discounts now** (senior, military): assigned to the profile, used again without setting up | The discounts phase grows: named $ / % discounts on an estimate, stacked, **and** discounts kept on the profile that apply to its new estimates. Migration |
| 4 | **Both**: Photos, Estimates, Callbacks and Email History as **expandable sections under the profile**, **and** Jump To kept on the right to go straight to one | The profile page gets those sections at its foot; Jump To opens and scrolls to the section. Phases 2–4 land as sections |
| 5 | Basic estimate email: **a link that opens the estimate as a PDF** is the standard; **attaching the PDF is an option** on the send screen | Needs a real PDF of the estimate (server-side) and attachments in outgoing email |

**Defaults built unless Kyle says otherwise:** tax is worked out on the amount **after**
discounts; a **Tax Exempt** customer's estimate and invoice are not taxed (the choice is off,
with the reason shown); a profile's discount is **added to each new estimate** and can be
removed there; the profile's county suggests the county rate.

**Revised order:** 1 ✅ (Sandbox check pending) → **1b** expandable sections + Jump To →
2 email history (full message, resend) → 3 photos/files by location → 4 callbacks →
5 discounts (estimate + customer-linked) → 6 sales tax → 7 basic estimate email with PDF
link and attachment → 8 branding. Discounts before tax, because tax is on the discounted
amount. On hold: estimate → invoice. Blocked: deposits paid online, SMS.

---

## Phase 1 — estimates on the profile, and converting from one — 2026-10-24

**Built and browser-verified locally (19/19; regression: B2 18/18, A 33/33). Not yet
pushed. No migration.** Kyle, Videos 4 and 5.

**The Estimates view** (`components/ProfileEstimates.tsx`) is a card per estimate: number,
status, **price or "To be quoted"**, the appointment **in Chicago time**, **the estimator**,
**every location by name**, created and valid-until dates, and whether jobs were made from
it; Open, Convert (or Schedule, for a customer) and Delete. The server sends a `summary`
with each estimate (`api-server lib/profile-estimates.ts`): locations from the appointment,
the lines and the quote; estimator and time from the appointment; lines still to be
quoted; latest revision; jobs made.

**Convert to Customer** — in the header of a prospect with estimates, and on each card.
Choose the estimate they are going ahead with; **see what is in it** (each service, its
location, its customer description, its price); an estimate never finalized is finalized
on the way ("Finalize & continue"); then the estimate page's own scheduling dialog opens
(a date per location, crew, technician, job notes, the verbal yes on the phone). One job
per location; the prospect becomes a customer. An estimate already scheduled is not
offered again. Finalizing from outside the estimate page is one helper now,
`crm/src/lib/estimate-actions.ts`, also used by the Add form's Save and email.

**No job from a service still to be quoted** (Kyle's blank rule, 2026-10-24): the picker
says so and holds the button, the scheduling dialog says so first, and
`POST /quotes/:id/convert-and-schedule` refuses (409 `estimate_unpriced`).

Found on the way: appointment times showed in the **viewer's** time zone (1:00 AM in
Pakistan for a 3 pm Chicago visit); the card and picker now show the business's time.

---

## Logins on Sandbox 2, and Lute's "view as" idea — 2026-10-24

**Checked:** the three team logins (`team_admin` super admin, `team_office` office admin,
`team_tech` field tech) all sign in on Sandbox 2. **Created** a login for Lute through
`POST /admin/users` as `team_admin`: username `lute` (sign-in accepts "Lute"), role
**owner**, verified in a browser. The password was given to Toheed only; it is in no file.

**Lute then asked for admin.** Not done: Corstead refuses by design to promote an existing
account to Super Admin (`PATCH /admin/users/:id` → 403 "Existing users cannot be promoted to
Super Admin"); Super Admin can only be given when an account is created. Choices for Toheed:
keep Owner, or have `team_admin` deactivate `lute` and create a new Super Admin account
(a new username, since `lute` is taken). No database edit was made around the rule.
**Toheed chose a second account:** `lute_admin`, **Super Admin**, created through
`POST /admin/users` (the permitted path) and verified; `lute` stays as Owner.

**Future, not now (Lute):** a Super Admin control — an icon or drop-down — to **view the app
as another role** (Owner, Office Admin, Sales, Field Tech), as learning-management systems
do. Build note: do it on the server, as a per-session "view as" that can only **lower** the
capabilities the session has, never raise them, with a banner that says it is on; a
client-only switch would show screens the server still answers at Super Admin level.

---

## Videos 4, 5 and 6 — analysed against the code, 2026-10-24

Sources: the three PDFs (summary + cleaned transcript), read in full. **Reference walkthroughs
of The Customer Factor, not approvals of every feature.** "Luke" in the transcripts is Lute
(speech-to-text); in Video 4 "Luke" is also the sample prospect. Nothing built yet.

| Video | What Kyle shows | Corstead today |
|---|---|---|
| 4 | Collapsible sections under the profile: files, estimates, callbacks, email/text history, convert | The same tools sit behind **Jump To** (his answer #6). Inline collapsible sections: ask once he has reviewed the screenshots |
| 4, 5 | Photos, documents, **videos**, organised **by job location** | Files are per profile only, shown as an icon list with no preview; no video type allowed; no location |
| 5 | Photos **must not be squished** | No image preview at all yet, so nothing distorts — but any preview built must keep the aspect ratio and original file |
| 4, 5 | Estimate history on the profile: price, location, who it was assigned to; open, edit, delete | The Estimates view lists number, status, total and delete. **No location or assignee in the list** |
| 4 | **Callbacks** for office staff or a VA: pop-up with contact details, record the outcome (spoke / left message / neither), schedule the next callback; book the work from there if they say yes | **Missing.** Pieces exist: dated callback notes (piece C), `tasks` (due date, assignee, linked record), and convert-and-schedule |
| 4 | Convert a prospect by **picking one of their estimates**, viewing it, carrying it into the job, assigning the crew | **Exists on the estimate page** (`EstimateConversionDialog`: per location, crew, technician, times, job notes) once an estimate is finalized. Not offered from the profile, and no "choose among the estimates" step |
| 4 | Email/text history: date, time, sender, **open the content, resend** | The Communication & Activity feed shows date, sender, title and one truncated line. **No full view, no resend.** No SMS provider |
| 5 | Estimate screen: update, print, email, text, delete, **save as PDF** | Update, print (browser print, so PDF only by the browser), email (queued delivery), delete exist. Text needs an SMS provider. **No real PDF file** |
| 5 | "Estimate to Invoice" in one click | **Conflicts with Corstead's flow** (estimate → manual convert → job → invoice). Ask Kyle; default: keep estimate → job |
| 5 | **Customer-visible** job notes on the estimate | Exists per service (#31). An estimate-wide customer note is not shown on the public page — to check |
| 5 | **Discounts**: $ or %, named, stacked; **customer-linked** (senior, military) that follow the customer | `quotes.discount_total` column exists, always 0; **no UI, no rules**. Customer-linked discounts: nothing |
| 5 | **Tax**: county % from the profile automatically, manual % on the estimate, **on the total or per item** (materials taxed, labour not) | `tax_total` always 0; **no rate anywhere**. Kyle earlier: optional, never on by default, on invoices (piece D). Now estimates too |
| 5 | **Deposit** ($ or %) **paid when the customer accepts** | **Blocked: no payment provider.** Recording a deposit by hand would be possible |
| 6 | Basic estimate email: sender shown, attach or not, **estimate-link tag**, service templates, several recipients with "save this address", attach files and **company-wide general uploads** (insurance, service sheets), **preview** | One-off composer exists (one recipient, no templates, no attachments). Delivery creates a secure link and raises `quote.sent` (the automation template sends it). Templates and `{{…}}` placeholders exist. **Missing:** estimate-link placeholder in the composer, templates there, several recipients, attachments, general uploads, preview |
| 6 | Basic = a plain **PDF, no Accept button**; premium "estimate package" next video | Corstead's link opens an **interactive** page with Accept/Decline — closer to his premium. **The basic, PDF-only option is missing** |
| 6 | Businesses format their own estimate: what is shown, footer, terms, **logo** | Terms exist (company setting). No logo, no field choices, no footer |

**Order I would build in** (each a phase; several need an announced migration):
1. Estimates on the profile with location and assignee, and **"Convert using this estimate"**
   from the profile (the business-flow spine; mostly UI over what exists).
2. **Callbacks**: outcome + next callback, a callback list for the VA, booking from it.
3. **Communication history**: open the full message, resend.
4. **Files by location**, photo/video previews that keep their proportions.
5. **Basic estimate email**: templates, link placeholder, recipients, attachments, general
   uploads, preview, and a view-only (PDF) estimate.
6. **Discounts**, then **tax**, then estimate **branding** (logo, footer, fields).
7. **Deposits** — after a payment provider is chosen (Lute).

**To ask Kyle:** "Estimate to Invoice" vs estimate → job; tax on estimates and invoices or
invoices only, and a county rate table vs one rate; which taxes per item (a flag on the
service?); customer-linked discounts now or later; collapsible sections under the profile
vs Jump To (after his screenshot review); PDF attachment in the email vs a link only.

---

## Live on Sandbox 2 and verified — 2026-10-24

Commits `a1c873f` (pieces A, B1, B2) and `94efde0` (piece C, blank vs $0, one Deactivated)
were pushed and republished by Toheed. **The startup gate applied both migrations**
(`profile-note-entries-v1`, `kyle-answers-2026-10-24-v1`: `applied`, 2026-10-23 18:27 UTC);
bundle `index-BDp2QkLH.js`. Verified **against the deployed app** in a headed browser:

| | Result |
|---|---|
| A — the one-page profile | **33/33** |
| B1 — the Add form | **23/23** |
| B2 — the estimate on the Add form (blank refused, **$0 sent**) | **18/18** |
| C, Deactivated, blank vs $0 on the estimate page, edit keeps locations | **24/24** |

Three failures on the way were **the tests, not the app**, each fixed in the test: A still
expected an Archive button; B1 unticked the estimate box by its old name; the new walkthrough
typed the deactivation reason into the wrong box. All ZZ records were removed; 124, 125, 297
and quotes 62/63/92 untouched. Note times show in the viewer's own time zone.

---

## Kyle's answers of 2026-10-24, built — blank vs $0, and one "Deactivated"

**Built and tested in the working tree; waits on the republish.** CRM 756/756, API 858
(the same 14 `DATABASE_URL` failures). Migration `kyle-answers-2026-10-24-v1` — and
`profile-note-entries-v1` from piece C — were **dry-run against the shared database inside
a transaction and rolled back**: both apply and verify cleanly; nothing was kept.

**The new code needs both migrations before it serves.** It reads `price_pending`,
`deactivated_from` and `profile_note_entries`. The startup gate applies them before the
server listens, **only when `APP_MIGRATIONS_ENABLED=true`** (and the Sandbox identity
Secrets) — so check that Secret before republishing. The old code is unaffected by the new
columns, so the migrations may safely run first.

**Blank vs $0.** `quote_line_items.price_pending`. Every writer reads the sender's price
through `priceOf` (`lib/estimate-pricing.ts`): null, blank or missing is pending; any
number, 0 included, is a price. Every reader gives a pending line back as `unitPrice: null`
(the quote read, the finalized snapshot), so edits and Finalize keep it pending. `/deliver`
refuses only pending lines; **$0 now sends**. The estimate page, its edit form, print and
the public page show "To be quoted". Existing $0 lines stay $0 (nothing recorded which were
blanks). `openapi.yaml` updated, and the generated client/zod types hand-edited to match
(`unitPrice: number | null`, `pricePending`); **regenerate with pnpm** when next possible.

**Found and fixed on the way:** editing an estimate (`PATCH /quotes`) dropped every line's
location and upsell flag — the same fault Finalize had. It now carries them over.

**One Deactivated.** Archive is gone from the profile menu; Deactivate is offered to a
prospect as well as a customer, and both stored values show as **Deactivated**. A profile
remembers its list on deactivation (`customers.deactivated_from`; for profiles deactivated
earlier, from whether they have a customer-since date). **Reactivate returns it to that
list** — it used to turn a prospect into a customer — and editing a deactivated prospect no
longer reactivates it. Every `/prospects/:id` route serves a deactivated prospect. The
Customers list shows customers only (the lifecycle chips that mixed in prospects are gone);
each list has **Include deactivated profiles**; Residential/Commercial stays.

---

## Kyle's answers to the open redesign questions, 2026-10-24

| | Kyle | Where we stand |
|---|---|---|
| Fax | With the other phones | **As built** (piece A, B1) |
| Non-Profit, Tax Exempt | Under the collapsed More Details | **As built** |
| Previous/Next | Prospects and customers are **separate lists**; within each, residential (last name) and commercial (company) in **one** alphabetical sequence; arrows follow it; filter Residential/Commercial in search | Arrows **as built**. The Customers list still mixes in prospects under "All Lifecycle" — **to change** |
| Archived vs Deactivated | **The same thing; call it Deactivated.** Off the active list and the arrows; kept with its history; found by search with **"Include Deactivated Profiles"**; can be reactivated to its list. Separate from permanent delete | **To change.** Two actions exist (Deactivate, Archive) and two statuses. Found while checking: **reactivating a deactivated prospect makes it a customer** (`status: "active"` maps to `customer`), and a deactivated prospect shows under the Customers list's Inactive filter. Nothing records which list a deactivated profile came from |
| Clicking an email | Corstead's own composer, logged in Communication & Activity | **As built** |
| Blank vs $0 | **Blank = not priced, cannot be sent. $0.00 = a valid price, can be sent.** No separate Free option | **Reverses the 2026-10-23 decision.** Today blank and $0 are both stored as 0 (`NOT NULL DEFAULT 0`), and `/deliver` refuses any $0 line. Telling them apart needs a stored "not priced yet" mark — a column, so an announced migration |
| Screenshots | He is reviewing them; feedback to come; more videos coming | Waiting |

---

## Profile redesign, piece C — dated, signed notes, 2026-10-23

**Code built and tested; the migration has NOT run anywhere.** Kyle's answer: "Specific
and callback notes: each entry dated and signed; existing notes preserved."

**What changes on the profile.** Specific notes and Callback notes become logs: newest
first, each entry with **who wrote it and when**. A new note is typed in the box above
the log and saved by the page's one **Update** (the bar says "a new note"). An entry can
be **archived**, with a confirmation, never edited: a signed note stays as written.
General notes and Directions stay single boxes. Technicians cannot read these notes
(403, like Previous/Next); Kyle listed what they see, and these are not on it.

**Storage.** A new table, `profile_note_entries` (`lib/db/src/schema/profile_notes.ts`),
created by the versioned migration **`profile-note-entries-v1`**, registered last in
`REQUIRED_MIGRATIONS`, so the Sandbox startup gate applies it. **Additive only:** each
profile's current specific and callback text is copied in as its first entry (marked
"before dated notes", dated at the profile's last save, unsigned); `customers.specific_notes`
and `customers.callback_notes` are **not touched**, and the page stops writing them. The
migration refuses to run outside Sandbox or over a table it did not make; its rollback
refuses once anyone has written a note. Profile delete erases the notes.
Routes: `GET/POST /customers/:id/notes` (and `/prospects`), `DELETE …/notes/:noteId`.

**Before the migration has run** (between a deploy and the gate, or with the gate off)
the page shows the old text **read-only** and everything else keeps saving — checked
5/5 against the shared database, where the table does not exist yet.

**What the migration will carry over today: nothing.** The shared database has 4
profiles and none has specific or callback text (checked read-only, 2026-10-23).

---

## Profile redesign, piece B2 — the estimate on the Add Prospect form, 2026-10-23

**Built and browser-verified locally (16/16; the estimate page's own booking re-checked
4/4 over HTTP). Not committed, not pushed — waits with A and B1 for Kyle. No migration.**

**What it does (Kyle, Video 3).** The Add Prospect form has an **Estimate** section, on by
default ("Book an estimate now"): services from the catalogue, each with quantity, a price
**or none**, **which location** (Main or a named one from the same form) and the
customer-visible description (#31); then, optionally, date, start time, duration and the
estimator ("between 3 and 4" = 3 pm for an hour, Chicago time). **Create Prospect & Save
Estimate** opens the new prospect. **Save and email estimate** is offered only when every
service is priced and there is an email; it finalizes and sends, and opens the estimate.

**How it is saved.** `estimate` travels beside `intake`; the server writes the prospect,
its intake, then the estimate (and appointment) **in the same transaction**, using the
very code the estimate page books with — `createQuoteTx` / `createScheduledQuoteTx` /
`parseQuoteAppointment`, extracted from `POST /quotes/with-appointment` (which still
behaves the same). Line locations are given by position and mapped to the properties as
they are created.

**Decision — a blank price is $0, "to be quoted"** (Toheed, 2026-10-23; no migration).
The column is `NOT NULL DEFAULT 0`, so a blank was already stored as 0, and **nothing
stopped a $0 estimate being finalized and emailed**. Now `POST /quotes/:id/deliver`
refuses any estimate with a $0 line (400 `estimate_unpriced`, naming the lines), checked
against the finalized snapshot. **To confirm with Kyle:** a deliberately free line cannot
be sent either.

**Bug found and fixed — Finalize wiped the service descriptions (#31).** The estimate
page sent no `serviceNotes` to Finalize, and Finalize replaces the lines, so **every
estimate finalized from the estimate page lost its customer-visible descriptions**, and
every line was put at the quote's main location. Proven by probe before the fix (`LOST`)
and after (`KEPT`). Fixed on the server (a line's description, location and upsell flag
are carried over when the sender leaves them out) and on the page (it sends them). **This
is live on Sandbox 2 until the republish**; estimates finalized there may already have
lost descriptions.

**Sending is "queued", not "emailed".** `/deliver` records the request and raises
`quote.sent`; the email itself goes out through the **"Estimate sent" automation, which
is still inactive**. The form says "queued for email", as the estimate page does. For
Kyle's Save-and-email to reach a customer, that rule must be switched on.

**Seen, not touched:** 5 estimate appointments and 5 estimate locations from 21–22
September point at quotes that no longer exist (before profile delete existed), and 11
line-description rows at deleted lines (left by the old Finalize). Harmless; delete only
with approval.

---

## Profile redesign, piece B1 — the Add form, built in the working tree, 2026-10-22

**Built and browser-verified locally (23/23, plus 6/6 over HTTP for the initial-job
path). Not committed, not pushed, waiting with piece A for Kyle's approval. No
migration.** Built from Kyle's answers of 2026-10-21 while waiting on his reply.

**The form now reads like the profile page:** account type, Name, Contact information
(the six phones each with **whose number it is**; as many emails as needed, each with
its person and routing), Service address (**Main** plus **up to two more named
locations**, County / Subdivision / Birthday, **How did they hear about us?** from the
managed list), Notes (General **and Directions**), and **More details** collapsed
(Non-profit, CC fee, Tax exempt, tags, stars, alt contact, alt phone type). A person
named once — Lauren — can be picked again on the next phone or email. Nothing that
was on the old form was dropped; the free-text "How did they hear" gave way to the
dropdown, as Kyle asked. Initial Job, the estimate checkbox and the duplicate check are
unchanged.

**How it is saved:** the extras travel as `intake` beside the ordinary fields and are
written **in the same transaction** as the profile, on both create paths (`POST
/customers`, `/prospects`, and `/customers/with-initial-job`), after the main property
so extra locations list after it. Phones and emails become contact channels (the
source since piece A); named people become contacts, one per distinct name; extra
locations become owned properties; the marketing source is written both ways, as
Profile Details does. The flat phone and email columns are derived from the intake
**before** the duplicate check, so the check sees exactly what is saved. An incomplete
location or a half-named person is caught on the form, and refused by the server
(400 `invalid_intake`) before anything is written. `lib/intake.ts`,
`lib/intake-writer.ts`; the form's logic is `crm/src/lib/intake-form.ts`.

**Follow-up:** `intake` is not yet in the OpenAPI spec; the client passes it past the
generated types. Regenerate the client (needs pnpm) when the spec is next touched.

**Not in this piece — B2, the estimate on the same screen** (services, estimator, time,
blank price, Save and email). It needs one transaction for profile + estimate +
appointment, and the blank-price path is untested. Next.

---

## Profile redesign, piece A — built in the working tree, 2026-10-21

**Built, tested and browser-verified locally (33/33). Not committed, not pushed, not on
Sandbox 2.** Toheed chose to build the real page instead of a mock-up, show Kyle
screenshots or a recording, and publish only after Kyle approves. **No migration.**

**What the profile is now.** One page instead of twelve tabs. In order: Name
(residential/commercial switch), Contact information (the six phones, each with whose
number it is and a call link; every email with its person, routing, a send button and
**Pause sending**), Service address (Main first, named extra locations, Maps link, then
County, Subdivision, Birthday and the marketing-source dropdown), Notes (General,
Directions, Specific, Callback), Custom fields, and **More details** collapsed (type,
group, payment terms, Non-profit / Tax exempt / No card fee, tags, stars, prospect date,
alt contact, Customer since, Linked profiles, created / last updated by). Always editable;
**one sticky Update button** saying what is unsaved, with Discard. The page is locked
while it saves, and leaving with unsaved edits asks first (arrows, Back, Jump To, tab
close).

**Header**, sticky: Back, **Previous / Next arrows**, name and badges, New Estimate,
Schedule Job, Send Email, and **More** (Deactivate, Archive, Reactivate, Delete).
**Jump To** rail: Estimates, Jobs, Invoices, Payments, Communication & Activity, Files,
Contacts, Locations — the old full views, unchanged. The statistics row and the
default-property banner are gone (Kyle: no statistics on the profile).

**How it is wired.**

- **Contact channels are the source; the old flat columns are a mirror.** Every channel
  create / edit / delete rewrites `customers.homePhone … fax, email` in the same
  transaction (`lib/contact-mirror.ts`), so sending, search, the duplicate check, import
  and the crew read the same facts without changing. An older profile's numbers that never
  became channels are shown in their slots and left alone.
- **An older profile's own email is never replaced** by adding a second address — found in
  the walkthrough, fixed on both sides, tested.
- **Send Email** accepts any active email channel of that profile, and nothing else.
- **Previous / Next**: `GET /customers/:id/neighbors` (and `/prospects/…`), same lifecycle
  only, so archived and inactive are skipped; residential by last name, commercial by
  company; one interleaved list. Technicians get 403.
- Catalog options and custom-field definitions are managed in **Settings** (they already
  were). `ProfileDetailsTab` and `ProfileCustomFieldsCard` are no longer rendered; kept
  until Kyle approves, then delete.

**Defaults built that Kyle has not confirmed** (each a one-line change): Fax in the
phones; Non-profit / Tax exempt in More details with badges by the name; one interleaved
Previous/Next list; email opens Corstead's Send Email. A phone with a label outside the
six (e.g. "Office") is listed read-only on the page, with no screen to edit it now that
Profile Details is gone; **none exist** on the shared database (checked 2026-10-21).

**Next:** screenshots / recording to Kyle → on approval commit, push, republish, verify on
Sandbox 2. Then piece B (the Add form), then C (dated, signed notes — additive migration,
announce first).

---

## Profile redesign — Kyle's answers to the combined questions, 2026-10-21

All twelve were answered. **Still nothing built.** He approved a clickable mock-up
before any code, and said he will record **three to five more videos** (hoped for
the same day) “before we finalize the full layout”. **So the mock-up waits for
those videos**; drawing it now means redrawing it.

### Decisions

| | Decision |
|---|---|
| Sales tax | **Wanted, optional, never on by default**, on an **invoice**. **Tax Exempt stays** |
| Previous/Next | **Active profiles only.** Prospects through prospects, customers through customers. **Archived excluded.** Residential sorted by **last name**, commercial by **company name**, prospect or customer alike |
| Technicians | See the customer information tied to **their assigned work**: phones, service addresses, directions, job notes. Later, **Admin-switchable** permissions for job pricing and invoicing |
| More Details (collapsed) | Profile Type, Payment Terms, Linked Profiles, who created the record, **Tags**, and other rarely used account settings |
| Phones | **Home, Work, Cell, second Cell, Alt, Fax**, each able to say whose number it is |
| Job locations | **Up to three named** at creation; **unlimited** afterwards |
| Marketing source | A **customisable dropdown**, not free text |
| Estimate at creation | On the **same screen**: services, estimator, schedule. **Blank price allowed.** Once priced: **Save and email the estimate**. He wrote “assuming we're understanding the workflow the same way”, so the mock-up has to prove it |
| Notes | Specific and callback notes: **each entry dated and signed; existing notes preserved** |
| **Fax, County, Subdivision, Birthday** | **Visible in the main section**, toward the bottom of the customer-information block. **Not** under More Details. This **overrides** the earlier suggestion |
| Clickable contact | Phone to call, email to send, address to open in maps |
| Left out this round | Range pricing, calendar colour-coding by customer type, appointment times on emailed estimates |

### Two answers are new features, not layout

Neither belongs inside the redesign, and each touches rules that must not be
rushed.

**Optional sales tax on invoices.** Money code: invoice totals, payment
allocation, reconciliation, and the bulk-invoice planner. Corstead has no tax rate
anywhere; `taxAmount` is stored per invoice and per line and defaults to 0. Open:
where the rate lives (one company rate, or by county — he mentioned county earlier),
whole invoice or per service, and what happens when a Tax Exempt customer is
invoiced. Proposed default to confirm: one company rate, a per-invoice tick, and a
block or warning for a Tax Exempt customer.

**Admin-switchable permissions.** Corstead has roles mapped to capabilities; whether
an Admin can switch a capability on or off **per role or per person** from a screen
is **to be verified**, and if not, it is a new settings screen and probably a new
table (an additive migration, announced first).

### Small ambiguities to put back to him

1. **Fax** is listed among the phones (#5) **and** among the fields to place at the
   bottom (#10). Which?
2. **Tax Exempt and Non-Profit.** On The Customer Factor, Non-Profit sits at the very
   top. Visible beside the name, or under More Details?
3. **Previous/Next order.** Residential and commercial **interleaved in one
   alphabetical list** (last name or company name, whichever applies), or residential
   first and then commercial? And are **deactivated** profiles skipped, as well as
   archived?
4. **“Email clickable to send”.** Through **Corstead's own Send Email** (logged in the
   history, honours unsubscribes) or the computer's mail program (`mailto:`, which
   does neither)? Recommended: Corstead's. **A phone number cannot offer “text”**:
   there is no SMS provider.
5. **Existing free-text marketing values.** The Add form writes `howHeard` (text);
   Profile Details writes a catalogue id; and the legacy customer import writes
   text. The dropdown must not lose what was imported.

### Work, in the order I would do it

| | Piece | Migration |
|---|---|---|
| A | Shared profile form and layout; sticky Update; Previous/Next; Jump To; clickable contact | none expected |
| B | Add form: three named locations, six phones with names, marketing dropdown, estimate block, Save and email | none expected |
| C | Dated, signed notes | **additive**, announced first |
| D | Optional sales tax on invoices | to be scoped; **separate phase** |
| E | Admin-switchable technician permissions | to be scoped; **separate phase** |

Waiting on the new videos, then a mock-up for approval.

---


## Profile redesign — Video 3, scheduling the estimate at intake, 2026-10-20

Source: `Video 3 Summary - Creating New Prospect Finalize.pdf`. Same caveat as
Video 2: a walkthrough of The Customer Factor, “not an automatic approval of
every feature for Corstead”. The transcript is built from narration supplied in
chat and was not checked against the recording. **Nothing built.**

### What it shows

On the **same screen** as the prospect's details: pick a service from the preloaded
list; quantity and price (or a range); the job location **per service line**
(main address, or a saved one such as “Mom's house”); an estimator and a time
window (“between 3 and 4”); a second service for another address; and **customer-
visible detail notes** per line. Then **Save** (profile created, estimate on the
schedule) or **email the estimate now** if a price was quoted on the phone.
Afterwards the saved profile **looks like the form it was entered on** and is
edited in place with one Update button, which he suggests could float.

### Two things this changes

**1. The Add form's “Schedule the estimate next” probably did not mean what we built.**
His own checklist item (File 2, #15) was *“schedule the estimate during the same
setup process”*. What exists is a checkbox that, after saving, sends you to the
estimate page. Video 3 shows he meant the services, estimator and time on the
same form. Treat the earlier reading as incomplete, not as done.

**2. He likes that the profile resembles the add screen.** That points to **one
shared form** for creating and for editing, with the intake extras shown only on
creation. Today they are two unrelated layouts (`NewCustomerForm` in
`Customers.tsx`; the tabbed `CustomerDetail`). One form learnt once is also the
training answer Video 1 asked for.

### Against what exists

| Video 3 | Corstead today |
|---|---|
| Quantity × price, flat price | **Has it** on quote lines |
| Job location per service line, several locations in one estimate | **Has it** (line-level property; one job per location on conversion) |
| Customer-visible detail note per service | **Has it** — item #31's service Description, shown to the customer |
| Assigned employee hidden from the customer | **Matches** — the public estimate page shows no assignee and no appointment |
| Estimator and time window | **Has it** (assignee, start, duration), but on the estimate page, not the Add form |
| Services and times **on the Add form** | **No** — a checkbox only |
| **Range price** ($350–$500) | **No.** He says Superior does not use it |
| Estimate with **no price** (about **99%** of his intake) | Blank price is coerced to 0 in the quote code; **the whole path is unverified** and must be tested before any claim |
| Save, **or email the estimate immediately** | **No** single action: create, finalize, then deliver. And the Estimate-sent automation is still off |
| **Dated** notes and callback notes **with who wrote them** | **No.** `specific_notes` and `callback_notes` are single text boxes. Only the whole-record audit shows who changed what |
| Directions editable on the profile | Has a `directions` box |
| Job locations opened, edited and added from the profile | **Has it** (Properties tab) |
| Second email for the spouse, with her name | **Has it** (named contact channels) |
| Floating Update button | **Decided** in Kyle's Video 1 answers: one Update, always visible |

### Cost to flag honestly

This is **not a layout change.** One-screen intake means creating the prospect, its
locations, the estimate lines and the appointment together. Today those are two
atomic calls (create the customer; then `quotes/with-appointment`). Chaining them
risks a prospect that exists with no estimate if the second fails, unless the work
is made one transaction. It also has to respect blocked days, the duplicate-check
panel and the estimator rules. Dated notes with an author need an **additive
migration** (a notes-entries table), which is announced first: it lands on the
branch Kyle is testing in.

### To put to Kyle, with a default so he can answer “yes”

1. Services, estimator and time **on the Add form** itself, in a section that is
   collapsed unless he ticks “schedule the estimate”? Default yes.
2. A **blank price** is allowed and means “to be quoted”, and such an estimate is
   not emailed until it has a price? Default yes.
3. **Range pricing**: park it? Default yes.
4. A second button, **Save and email estimate**, once a price is entered? Default yes.
5. Specific and callback notes become **dated entries with the author's name**;
   the existing text becomes the first entry? Default yes.
6. Should the emailed estimate show the **appointment date and time**? He is unsure
   himself. Default no, as today.

**Suggested order of work, once the videos are in:** the shared profile form and
layout first (Videos 1–2), then the intake estimate block (Video 3), then dated
notes, because each is easier on top of the last and only the last needs a migration.

---


## Profile redesign — Video 2, the Add Prospect intake, 2026-10-20

Source: `Video 2 Summary - Creating New Prospect Profile Info.pdf` (summary +
cleaned transcript). **Its own implementation note governs how to read it:**
*“This video is a feature and layout reference. It does not, by itself,
finalize every demonstrated field as a Corstead V1 requirement.”* It shows
how The Customer Factor takes a new prospect on a live call. **Nothing built.**

### Where a second summary says more than the source does

A condensed version pasted into the chat uses “must” language and adds things.
The PDF and transcript are the source; these are **not** requirements:

| The pasted summary says | The source says |
|---|---|
| Calendar **colour-coding** by customer type | Not mentioned. Only that The Customer Factor's calendar can be **filtered** by type |
| Types and tags “fully searchable across **all** system modules” | Not said |
| Types and tags as a requirement | “We do not use that for our company”; the PDF: *“this company does not currently rely on that field”* |
| Lead source “to measure advertising effectiveness” | Only “click Facebook. It is that simple” |
| Notes: dated notes and callback notes | Four kinds: dated, callback, general, and **directions** — the last is what “the crew sees”. The pasted version drops it |
| “Up to 3 **or more** job locations during initial creation” | Up to **three** at creation; more can be added **after** |
| Sales tax “automatically bypassed” | “The system does not charge sales tax for that customer” (see below: Corstead calculates none) |

**The transcript is speech-to-text, and its names are wrong.** “Luke Tia” is
Lute Atieh, “Loot called today” is “Lute called today”, and “Corested.us” is
corstead.us. Do not use them as data.

**“Tabs” means something different in each video.** In Video 1 it is the
profile's tabs. In Video 2 it is the **main navigation** (The Customer Factor's
top bar against Corstead's left sidebar), and he says explicitly that cleaning
that up is for *eventually* — “For now, let us focus on adding a prospect.”

### What the Add form already has, and what it lacks

`Customers.tsx` `NewCustomerForm`, shared by prospects and customers.

| From Video 2 | Corstead today |
|---|---|
| Residential/Commercial, one click, template changes | **Has it**, first on the form |
| Salutation | **Has it** |
| Home, Work, Cell, Alt phone, Fax | **Has them.** Not a second cell |
| Whose number it is, per phone | **Not at creation.** A single “Alt. Contact Name” only. Named contacts exist once the profile does |
| County, subdivision | **Has them** (he says his company does not need them) |
| Non-profit / tax exempt | **Has the checkboxes** |
| Custom “Type” grouping | **Exists as Profile type / Profile group** (managed dropdowns) — on Profile Details, not on the Add form |
| **Up to three job locations at creation** | **No.** One address on the form; further service addresses are added later under Properties |
| **Address autocomplete** | **No**, and still blocked on **Lute** (account and billing cost) |
| Marketing source as a click | **Free text** on the Add form (`howHeard`), while Profile Details has a managed **dropdown** (`marketingSourceId`). Two different fields for one question |
| Dated notes, callback notes, general notes, directions | The form has **General Notes only**. The `customers` table already has `notes`, `specific_notes`, `callback_notes` and `directions` columns; what the screens show of the last three is **to be verified** |
| Calendar filtered by customer type | **No** — calendar filters are by crew and technician |

### Found while checking: the tax-exempt flag changes nothing

`customers.tax_exempt` is stored and shown, but **no code reads it to calculate
tax.** Invoices carry a typed `taxAmount` that defaults to 0 and no rate exists
anywhere that was found. “Automatically bypass sales tax” therefore has nothing to
bypass today. **To ask Kyle:** should Corstead calculate sales tax at all yet?

### Questions to put to Kyle, each with a default so he can answer “yes”

1. **Phones at intake:** fixed fields as on The Customer Factor (Home, Work, Cell,
   Cell 2, Alt, Fax), each with a “whose number” name, stored as Corstead's
   existing labelled contact channels? Default yes.
2. **Job locations at intake:** the first address is the main service address and
   up to two more can be named (“Mom's house”), stored as properties? Default yes.
3. **Marketing source:** the managed dropdown on the Add form, replacing free text?
   Default yes.
4. **Notes at intake:** General Notes and Directions on the form; dated and
   callback notes as entries on the profile? Default yes.
5. **Tax exempt:** keep the checkbox, calculate nothing until he says Corstead
   should charge sales tax? Default yes.
6. **Customer type and calendar filter:** park it, since his company does not use
   it? Default yes.

Still waiting on further videos. Plan unchanged: a one-page “what I understood”
with before/after screenshots and click counts, approved before building.

---


## Profile redesign — Video 1 and Kyle's answers, 2026-10-19

**Nothing is built yet, deliberately.** Kyle is recording a numbered series of
videos with written checklists, in a separate Drive folder, and said the rest
will cover the sections below the main profile. The rule agreed with Toheed: do
not assume what he has not said; take what he gives, confirm what he does not.
The material so far is in `Requirements PDFs/Layout files/` (Video 1 summary +
transcript, two screenshots of The Customer Factor's prospect profile).

### What he asked for, in his words

Reorganise the prospect and customer profiles, and possibly other areas, for
speed and training. **No features removed.** The Customer Factor is the
reference for structure and accessibility, **the older interface, not the new
one** (the screenshots carry a “Click to View New User Interface” banner, so they
are the classic one). Not to be copied visually. Priority is fewer clicks.

### His answers to the six questions put to him

| | Decision |
|---|---|
| **Saving** | Fields stay editable with **one Update button**, not “Save”. It must be **always visible**, even while scrolling |
| **Layout, top to bottom** | Name and customer/prospect status → contact information (phones, emails, and the contact names attached) → service address → General Notes → Custom Fields |
| **Profile statistics** | **Remove entirely** from the profile (Total Jobs, Revenue, Last Service, Windows). They belong to the reporting and search work later. This is firmer than the “move them lower down” that was proposed |
| **Prospect → customer** | Stays tied to estimate acceptance, which can happen two ways: the customer accepts (the office is notified, an authorised user converts and creates the job) or the office marks it Accepted by hand after a verbal or other acceptance. **The office controls the conversion. Never automatic** |
| **Reference** | The older Customer Factor interface |
| **Navigation** | Previous/Next arrows beside the name, **alphabetical by last name through the customer database**. And a **Jump To** panel on the right: estimates, scheduling, jobs, invoices, communication history |

### How these meet what already exists

- The conversion rule is **already how it works.** Item #23 (2026-10-10) put
  Accepted into Correct Status, with a required reason written to the history;
  that is exactly his “office manually accepts” path. There is no standalone
  “make them a customer” button and none is to be added — The Customer Factor has
  one, and copying it would have contradicted his own earlier rule that a
  prospect is not scheduled directly.
- The “customer accepts” path only works end to end once the **Estimate sent**
  automation is switched on; today it is off, so the customer has no emailed link.
- Removing the statistics removes the only place they are shown. They are not
  deleted; whether reporting or search exposes them today has still to be
  checked, or they will have no home.
- A **sticky Update button** with arrows and Jump To means an edit can be lost
  by leaving the page. Needs an unsaved-changes warning.

### Still open, and not to be guessed

1. **Previous/Next scope.** Prospects with prospects and customers with
   customers, or one list? Archived and inactive profiles skipped? Order for a
   commercial profile — company name, or the contact's last name?
2. **Where the rest of the profile goes.** Profile type/group, payment terms,
   marketing source, tax-exempt and no-CC-fee flags, linked profiles, the
   record (created/updated by), and the communication-safety card. He said
   only that they should not come first.
3. **What a field technician sees.** He named technicians; whether they open the
   profile or the job page was not said, and a technician's view is restricted.
4. **Jump To's full contents.** He listed five. Files, Payments and Callbacks
   (The Customer Factor's “Due To Be Contacted?”) were not mentioned.
5. **Add-customer flow**, which he said will need aligning with the new design.
6. **“Other areas of the program”**, and whether that includes the calendar
   (the spec's approval gate applies there).

Waiting on the remaining videos before building. Plan: a one-page “what I
understood” with before/after screenshots and click counts, approved first.

### Two discrepancies between summaries, for whoever reads this next

The PDF and transcript are the source. A second summary pasted into the chat
said **“inline or instant editing”** (the transcript says only “edit it easily”)
and listed **Invoices** among the scattered essentials (the transcript puts them
under “dive deeper”). Neither is a requirement.

---


## #3 — the custom fields were there all along, one tab over, 2026-10-12

**This item was recorded as “waiting on Kyle's screenshot” for four days.
It should not have been.** Asking the system directly answered it in an
hour, and the answer was not what the note assumed.

### What he reported, and what is true

> Custom fields can be created in Settings, but the fields are not
> appearing on Prospect or Customer profiles.

`scratchpad/p3-custom-fields-v2.mjs`, **11/11**: a field made in Settings
reaches every customer **and** prospect profile, including profiles created
before the field existed; a dropdown carries its choices; a value saves and
reads back on both. None of it is broken.

The browser said why he saw otherwise:

| | Overview | Profile Details |
|---|---|---|
| customer | **not visible** | visible, editable |
| prospect | **not visible** | visible, editable |

A profile opens on **Overview**. The fields live on **Profile Details**, one
tab across. He added a field, opened a profile, and concluded they had not
arrived.

**The same mistake was made twice in this session by the person testing it.**
The #6 browser walkthrough failed on its first run for exactly this reason —
the Communication Safety card sits on the Communication & Activity tab, and
the test looked at Overview. A thing that is one tab away is, to the person
looking, not there.

### The fix

`ProfileCustomFieldsCard` puts the same fields on Overview, with the same
`PUT /{customers|prospects}/:id/custom-fields`. It deliberately does **not**
offer creating, deleting or editing a dropdown's choices — managing fields
stays in Settings and on Profile Details. Here you only fill them in, which
is what #3 asks for: “available for users to enter or select a value
directly on the profile”. Saving invalidates the other screen's query so the
two cannot disagree, and the card renders nothing at all when the company
has no custom fields.

`CustomFieldInput` moved to its own file rather than being copied. Two
copies would drift, and a dropdown that keeps an off-list value on one
screen but clears it on the other is exactly the kind of difference nobody
notices until a value goes missing. `custom-fields.test.ts` follows it; what
it asserts is unchanged.

There is precedent for this in the same file: *“General notes, on the
Overview rather than buried in Profile Details.”*

### Two probe mistakes worth writing down

The first run reported four failures. **Three were mine**, and each would
have been filed as a product bug by a less careful reading:

- A **prospect is a `customers` row** with `lifecycle_status = 'prospect'`,
  not a `leads` row. Passing a lead id gives a plain 404.
- Values are saved with **`PUT /customers/:id/custom-fields`**, not a PATCH
  on `profile-details`.
- A dropdown's choices catalogue is reached at **`/catalogs/custom-field-<id>`**
  — hyphens. The stored `catalog_type` is `custom_field_<id>` with
  underscores, and mixing them up gives “Catalog not found”.

Also true, and not a bug: **`POST /custom-fields/definitions` ignores a
`choices` array.** Choices are a separate catalogue, added after the field,
which is what the UI does.

This is the second time in three days that a confident first reading of a
client's report was wrong — see the #15 entry. The rule that worked both
times: reproduce it against the client's own data before believing the
diagnosis.

### Verified

| | |
|---|---|
| `scratchpad/p3-custom-fields-v2.mjs` | **11/11** over HTTP |
| `scratchpad/p3-where-is-it.mjs` | the before/after on both profile types |
| `scratchpad/p3-walkthrough.mjs` | **8/8** headed — fill both fields on Overview, save, reload, and Profile Details agrees |
| CRM | **694/694**, pretest 10/10, profile-details 3/3, customer-hub 7/7 |
| Migration | **none** |

**With this, every item in Kyle's 8 October correction notes is done:**
#3, #6 (bar bounces, which need a provider that reports them), #7, #15,
#23 and #31.

---


## #6 — unsubscribe, and why an address is off, 2026-10-12

#6 asked for five things: an Unsubscribe link in every customer-facing
email; unsubscribing keeps the address on the profile but stops sending;
a bounce deactivates automatically; an authorised user can deactivate by
hand; the reason is shown; and it can be turned back on. Four of those are
now done, one was already done, and one cannot be done with Gmail.

### No migration — the column already existed, in another table

The plan recorded on 2026-10-10 was to add a typed `sending_paused_cause`
to `contact_channels`, and to announce the migration first. **That was
unnecessary.** `communication_suppressions.reason` is already constrained to
exactly the set Kyle described:

| Kyle's words | Stored as |
|---|---|
| Customer Unsubscribed | `marketing_unsubscribe` |
| Email Bounced | `provider_permanent_failure` |
| Manually Deactivated | `manual` |

…along with `complaint` and `invalid`, plus `active`, `created_at`,
`deactivated_at`, `source` and `actor`. Creating and lifting a suppression
both have routes. **Nothing read any of it**, which is why it looked absent.

### The link

`lib/unsubscribe.ts` mints and reads a signed token, and
`routes/unsubscribe.ts` serves the page. Two decisions worth keeping:

**Nothing happens on a GET.** Spam filters, link checkers and corporate mail
gateways follow every URL in a message before a human sees it. An
unsubscribe that acted on the click would cut off customers who never
touched it. The link opens a page with a button; only the button acts. A
test asserts the GET handler never reaches `upsertSuppression`.

**The token is signed.** An unsigned link naming the address would let
anyone unsubscribe anyone else's customers by typing an email into a URL.
It is `base64url(address).HMAC-SHA256(address)`, compared in constant time;
swapping the address while keeping the signature is tested and refused.

**The scope is `global`**, and the page says so to the customer:
“That includes estimates, appointment reminders and invoices — not just
general messages.” Anything narrower would be theatre, because every
automation rule written so far is classified transactional, so a `marketing`
suppression would block nothing we actually send.

**A missing secret produces no link, never a forgeable one.** With no
`UNSUBSCRIBE_SECRET` the footer carries a written instruction instead —
silence is the one option #6 rules out. A secret under 16 characters counts
as absent: it looks configured and is not.

### What the office sees

The profile said **“Durably suppressed for this channel”** — true, and of no
use to anybody deciding what to do. It now reads *“Not receiving emails —
Customer unsubscribed. Since 12/10/2026. The address stays on the profile;
only sending is stopped.”*, with a **Turn email back on** link guarded by the
same `communication.settings` capability the server checks. Lifting
deactivates the suppression row rather than deleting it, so the history that
it happened survives.

`customerSafetySummary` now carries the suppression's reason, scope, date
and source. The global one wins when an address has more than one, because
that is the one that stops everything.

### Not done, and it is not a matter of effort

**A bounce cannot deactivate an address automatically on Gmail SMTP.** Gmail
returns a bounce as an email to the sender; it has no webhook to call. The
`provider_permanent_failure` reason exists and the screen already renders
it, so the moment a provider that reports bounces is connected the rest
works. `lib/email.ts` already supports **SendGrid** and **Mailgun**, both of
which do. That is Lute's decision, not a build.

### A new Secret is needed

```
UNSUBSCRIBE_SECRET = <32+ random characters>
```

Without it every email still carries a way out, but as written instructions
rather than a link. Replit deployments carry their own environment — see the
11 October entry — so it must be redeployed, not only saved.

### Verified

| | |
|---|---|
| `scratchpad/p6-unsubscribe-api.mjs` | **21/21** over HTTP — the link opens with no session; opening it unsubscribes nobody; confirming does; the reason, scope and source are right; the address stays on the profile; the sending path then answers 422 `hard_suppression`; a forged link is refused and Kyle's own address is untouched; an authorised user lifts it and the history survives |
| `scratchpad/p6-walkthrough.mjs` | **14/14** headed — the customer's page and the office's, step by step |
| `unsubscribe.test.ts` | 23 unit and source-guard tests |
| CRM | **684/684**, pretest 10/10 |
| API | **785/799** — the same 14 `DATABASE_URL` failures. Pretest 34/34 |
| Migration | **none** |

---


## Email is live on Sandbox 2 — and lands in spam, 2026-10-11

The Secrets are on the deployment and the published app sends for real:

```
POST /emails/send-one -> {"sent":1,"failed":0,"provider":"smtp"}
```

`provider` is the only honest check. Before the redeploy the same call
answered **`mock`** while still reporting `sent: 1, failed: 0` and writing
`status: "sent"` into `email_logs` — a send that looks successful in every
record the office can see, and never left the building.

**What the mock problem actually was:** Replit **deployments carry their own
environment**. `sandbox-2-data-free-corsteadllc.replit.app` is a deployment,
not the Repl, so adding Secrets to the Repl changed nothing until it was
redeployed. The Repl's own secrets manager showed `SMTP_HOST` present the
whole time.

### The mail arrived — in the spam folder

Gmail accepted it and filed it as spam: *“This message is similar to messages
that were identified as spam in the past.”* **Nothing is wrong with the
application** — it sent correctly, from the right address, with the right
name. The domain's authentication is incomplete:

| Record | State |
|---|---|
| SPF | **present** — `v=spf1 include:dc-aa8e722993._spfm.corstead.us ~all`, which resolves on to `include:_spf.google.com`, so Google is authorised |
| DKIM | **present** — a valid RSA key on `google._domainkey.corstead.us` |
| DMARC | **missing** — `_dmarc.corstead.us` has no TXT record at all |
| MX | Google Workspace |

DMARC is the gap. Without it a receiver has no policy to apply and no
reporting address, and a domain that has only just started sending
automated mail is exactly the pattern filters distrust.

**The fix is one DNS record, and it belongs to Lute — the domain and the
mailbox are his:**

```
_dmarc.corstead.us   TXT   v=DMARC1; p=none; rua=mailto:info@corstead.us
```

`p=none` is deliberate: it monitors and rejects nothing, so no legitimate
mail can be lost while it beds in. Tightening to `p=quarantine` is a later
decision once the reports show only Corstead's own senders.

**This is a go-live blocker in practice, not in code.** Estimates and
invoices that land in spam are the same as estimates and invoices that were
never sent, and the system will report every one of them as delivered.

---


## Email — the rules, and a defect found writing them, 2026-10-11

**The 2026-10-10 work is live on Sandbox 2, verified 18/18** against the
deployed app: the bundle carries all four items' markers, and on the live
API Accepted-without-a-reason answers `400 reason_required`, a correction
unblocks the conversion, a channel saves as None and reads back `null`, and
a customer description reaches the job. Nothing of the client's was touched.

### Found writing the templates — a placeholder reaching a customer

`interpolate` in the dispatcher left an unknown placeholder **standing**:

```js
template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? `{{${key}}}`))
```

Harmless while the provider was a mock that logged. The day Gmail was
connected it became a customer-facing defect, and an easy one to hit:
`getContext` fills `amount` from the row's own `amount` column, and
**`invoices` has no such column** — it has `totalAmount`. An invoice
template saying “for {{amount}}” would have posted exactly that.

Now `interpolateTemplate` in `communication-event-core.ts`, where it can be
tested without a database: a placeholder with no value is removed, and the
sentence is tidied after so nothing is left with a double space or a space
before its full stop. Six assertions, including `{{amount}}` itself.

### The rules, written inactive

`automation_rules` held nothing, so no event matched anything. Five rules
now exist, **all `active = false`** — `processEvent` reads only active ones,
so none can fire until somebody switches it on from the Automations screen.

| # | Name | Trigger | Uses |
|---|---|---|---|
| 1 | Estimate sent | `quote_sent` | `customerName`, `quoteNumber` |
| 2 | Appointment booked | `appointment_scheduled` | `customerName`, `scheduledDate` |
| 3 | Work completed | `job_completed` | `customerName`, `jobNumber` |
| 4 | Invoice sent | `invoice_sent` | `customerName`, `invoiceNumber` |
| 5 | Payment received | `payment_received` | `customerName`, `amount`, `paymentDate` |

Rule 4 deliberately asks for **neither** `{{amount}}` (no such column on an
invoice) **nor** `{{dueDate}}` (nullable). The wording is ours and is meant
to be replaced the moment Kyle sends his — changing it is a minute's work,
writing it was not.

`customers` **has no `customer_type` column** — worth knowing, since the
word appears all over the UI. A test profile exists for the first real send:
**customer 297, “MAIL TEST / Do Not Contact”**, named so it cannot be
mistaken for a customer.

### Order that matters

The `interpolateTemplate` fix is **not yet pushed**. It must be live before
any rule is activated, or the first missing value is posted to a customer
as `{{...}}`.

### Who owns the mailbox

Corrected 2026-10-11: `info@corstead.us` and its App Password are **Lute's**,
not Kyle's. Anything about the mail connection goes to Lute. Kyle still owns
the checklist items, the template wording, and File #3.

---


## Email — Gmail connected and proved, 2026-10-10

Kyle sent the App Password the same day it was asked for. It authenticates
against `smtp.gmail.com` on **587 and 465**, and — the part that matters —
a real message went out through **the app's own `lib/email.ts`**, not through
raw nodemailer. `detectProvider()` reported `smtp`, not `mock`, and Gmail
returned a message id. The mock reports success too, so the provider it names
is the only honest test.

It was sent to `info@corstead.us`, the sending account's own inbox. No other
address was touched.

### Configuration, for whoever sets the Secrets

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=info@corstead.us
SMTP_PASS=<the 16-character App Password>
EMAIL_FROM_ADDRESS=info@corstead.us
EMAIL_FROM_NAME=Superior Professional Window Cleaning
OFFICE_EMAIL_ADDRESS=info@corstead.us
PUBLIC_APP_URL=<the sandbox URL>
```

**Replit Secrets only.** The password arrived in a chat screenshot and must
not reach the repo, a report, or this file.

### The stranger's address, dealt with

`lute@gmail.com` sits on customer 125, the profile Lute made while testing on
8 October, and is almost certainly somebody else's mailbox. It is now on the
system's own **suppression list** (`POST /communication-safety/suppressions`,
channel `email`, reason `manual`, scope `global`). The dispatcher's
`evaluateRecipientEligibility` returns **blocked** for it and **eligible** for
`info@corstead.us`, so the guard bites rather than merely existing.

The client's record was **not** edited — the address stays on the profile
exactly as Lute typed it. Lift the suppression from the same screen once the
real address is known.

### What is proved, and what is not

| | |
|---|---|
| the credential | **proved** — authenticates on both ports |
| `lib/email.ts` over SMTP | **proved** — a real message delivered, provider `smtp` |
| the suppression | **proved** — blocked at the dispatcher's own check |
| the rule match | **read, not run.** `eventAutomationTrigger` is `eventType.replace(".", "_")`, so `quote.sent` looks for a rule whose `trigger_type` is `quote_sent`. The column is free text, so the four types named in the schema comment are not a limit |
| event → rule → campaign → send | **not run end to end** |

The last line is a gap and is worth saying plainly. Running it needs the
queue turned on against the shared branch with a live mail provider, and the
sandbox refused to start that worker. That refusal is right: it is precisely
the combination that could post real mail to a real person. It wants a
deliberate decision, not a side effect of a test.

### Still missing before an estimate email can leave

1. **The Secrets above**, on Replit.
2. **`automation_rules` is empty.** Nothing matches any event. One row per
   event the company wants to send on, out of `quote.sent`, `quote.accepted`,
   `appointment.scheduled`, `appointment.changed`, `job.completed`,
   `invoice.sent`, `payment.received`, `recurring_plan.due`.
3. **`email_templates` is empty.** A rule can carry its own subject and body,
   so a template is optional — but the wording is Kyle's to choose.
4. **The queue is not running.** `BACKGROUND_PROCESSING_ENABLED=true` is not
   enough on a sandbox: `shouldStartMutationWorkers` also requires `REPL_ID`
   to be set **and to equal `APP_MIGRATION_SANDBOX_REPL_ID`**. Setting the
   first and not the second leaves the scheduler silently off.
5. **The real address for customer 125.**

The office acceptance notice (`lib/estimate-accepted-notice.ts`) is the
exception: it calls `sendEmailTo` directly, so it starts working on the
Secrets alone, with no rule, template or queue.

### A trap, found the hard way

**Deleting a test customer does not take its queued communication events with
it.** Today's runs left **20 pending `appointment.scheduled` events** pointing
at quotes 99–110 and jobs 224–247, all long deleted. With no provider they sat
there harmlessly; with Gmail connected and the queue on they are the first
thing the dispatcher picks up. All 20 were confirmed orphaned — their quote or
job no longer exists — and removed. The queue is back to 68 succeeded, none
pending. **Every harness that creates an appointment must clear its events**,
and the check before any republish is `communication_events` where status is
not `succeeded`.

`scratchpad/gmail-verify.mjs`, `email-live-test.mjs`, `suppress-stranger.mjs`,
`clean-orphan-events.mjs`, `email-readiness.mjs`. None holds the password; it
is passed as an argument.

---


## #31 — the customer-facing service description, closed 2026-10-10

Kyle asked that every service line carry a Description of what the customer
is receiving; that it exist on the quote **and on the job the quote becomes**;
that it carry forward on conversion; and that it stay apart from Job Notes and
Tech / Crew Notes, which are internal and are not for the customer.

### Half of it already worked

A quote line has had its own Description since his earlier edit-list #9, stored
as `estimate_line_metadata.service_notes`, and `PublicEstimate.tsx` already
shows it to the customer under the service. The conversion already carried it
too — `persistAcceptedEstimateJobsCore` spreads the whole snapshot line into
the job's `line_items`, `serviceNotes` included.

### The two things that did not

**The job screen never showed its services at all.** A job keeps them in
`jobs.line_items`, a JSON string, and nothing read it. The description was
arriving and being thrown away at the last step.

**The same idea is spelled two ways, and `description` means opposite things
on each path:**

| Path | service name | customer-facing text |
|---|---|---|
| an accepted estimate converted | `description` | `serviceNotes` |
| `POST /customers/with-initial-job` | `serviceName` | `description` |

Renaming either rewrites history already sitting in that column, so
`lib/job-services.ts` reads both and hands the rest of the app one shape.
`serviceName` is the tell: where it exists, `description` is the customer's
text; where it does not, `description` is the name and the customer's text
came under `serviceNotes`. A test asserts the failure that would look like
working software — the service's own title echoed into the description, so
every line appears to have one.

**No migration.** `line_items` is free text; nothing new is stored.

### What the screen does now

`JobDetail` grew a **Services** card above the notes: each service with its
price, and underneath it the words the customer was given, or a plain
“No customer description was written for this service” when there are none —
silence there would read as though there were nothing to say.

The Notes card below now states, on the screen, that both fields are internal
and that what the customer was promised belongs in the descriptions above.
That line is the point of #31 rather than decoration: it is what stops the
promise being typed into the crew's notes.

`line_items` is free text with years of imports in it, so the reader survives
null, empty, malformed JSON, an object instead of an array, and junk mixed
with good rows — a job screen that throws because one old row is odd is worse
than one that shows no services.

### Verified

| | |
|---|---|
| `scratchpad/p31-walkthrough.mjs` | **11/11** headed, step by step — the description written on the estimate reaches the job's own record, the Services card shows it, and the description, the job note and the tech note are each in their own place |
| CRM | **676/676**, pretest 10/10, profile-details 3/3, customer-hub 7/7, dashboard 1/1 |
| API | **759/773** — the same 14 `DATABASE_URL` failures. Pretest 34/34, profile-details 10/10, customer-hub 46/48 (two of the same 14) |
| Migration | **none** |

A trap worth writing down: the first run of the browser check “proved” the job
note and tech note were absent. They were not — they sit in textareas, whose
content is a value and not page text, and `innerText()` does not see it. The
check now reads the textarea values.

### Not done, and deliberately

Invoices are not named in #31 and were left alone. A job created by hand from
`JobNew` has no estimate behind it, so it has no description to carry — the
card simply does not appear.

---


## #7 — email routing by contact, closed 2026-10-10

Kyle asked that each email address be assignable to one of eight choices:
All Emails; General Emails; Billing; Estimates; General and Estimates;
Billing and Estimates; General and Billing; **None**. And he was explicit that
None is not a deactivation — it only means the address joins no routine
category, and is separate from the unsubscribe, bounce and manual
deactivation behaviour of his #6.

### What was already there, and what was missing

`contact_channel_purposes` has existed since the profile work, holding any
subset of `general | billing | estimates`. Three purposes have **eight**
subsets, so seven of Kyle's eight already worked. The missing one was the
empty set, and it was refused twice over:

| Where | What it did |
|---|---|
| `PurposePicker` | `if (next.length) onChange(next)` — unticking the last box did nothing at all, so None could not even be expressed |
| `channelPurposePatch` | threw `At least one valid channel purpose is required` |
| `readChannels` | `purpose: purposes[0] ?? "general"` — had None ever been stored, the screen would have read it back as General |

**No migration.** The table already allows zero rows; nothing was asked to
store anything new.

### What changed

`channelPurposePatch` returns `[]` instead of throwing, and `purpose: null`
instead of inventing `"general"`. Both write paths skip the insert when the
list is empty, because an empty `values()` is an error in Drizzle. Omitting
the field still means "leave what is stored alone", which is exactly why None
has to be an explicit empty array rather than an absence.

On the screen the three checkboxes became one list of Kyle's eight named
choices — which is also what he asked for, "assigned one of these options".
Checkboxes could express all eight in principle, but None was only reachable
by clearing the last tick, and that was the click being swallowed.
`lib/channel-routing.ts` holds the names and the mapping, and a test asserts
the list is the full power set rather than eight entries somebody counted by
hand.

One small thing found on the way: the row's **Save** button had no label, and
the page carries several buttons reading "Save". It now says which address it
saves — for a screen reader as much as for a test.

### Verified

| | |
|---|---|
| `scratchpad/p7-routing-api.mjs` | **21/21** over HTTP — each of the eight settable on create; None survives the round trip and reads back as None; nothing is written for it; None does **not** pause sending; an existing address moves to None and back; a patch about something else leaves routing alone; pausing and routing stay independent; an unknown purpose is dropped |
| `scratchpad/p7-walkthrough.mjs` | **10/10** headed, step by step — the eight read exactly as Kyle wrote them, None selects, saves, and **still says None after a page reload** |
| API | **759/773** — the same 14 `DATABASE_URL` failures. Pretest 34/34, profile-details 10/10 |
| CRM | **663/663**, pretest 10/10, profile-details 3/3, customer-hub 7/7. Both typecheck clean |
| Migration | **none** |

`profile-details-core.test.ts` had never been registered in the api-server
`test` script either — it only ran under `test:profile-details`. Registered,
which is where the extra five come from.

A guard in `profile-details-ui.test.ts` asserted that `ProfileDetailsTab.tsx`
literally contained `"general"`, `"billing"` and `"estimates"`. Those moved
into the shared lib, which is the improvement, so the guard now checks that
the screen draws on that lib instead of keeping its own copy.

### What #6 still needs, and why it has not started

~~#6 wants a **typed** deactivation cause~~ **(Superseded 2026-10-12: the typed reason already exists on `communication_suppressions`, and no migration was needed. The paragraph below is kept for the reasoning.)** #6 wants a typed deactivation cause — Customer Unsubscribed, Email
Bounced, Manually Deactivated — shown on the profile. Today there is only
`sending_paused_reason`, free text, which cannot tell a system cause from
somebody's note. That wants one additive column, and **a migration hits the
branch Kyle is testing in immediately**, so it waits to be announced rather
than being slipped in. The rest of #6 — the unsubscribe link in a sent email,
and deactivating on a bounce — needs the provider that is still not connected.

---


## #15 and #23 — one bug, closed 2026-10-10

Kyle filed them separately. #23 asked for **Accepted** in the Correct Status
list. #15 reported that the scheduling button "remains inactive and cannot be
clicked". They are the same bug seen from two ends, and neither can be fixed
without the other.

### What it actually was

The first reading in this file (Step 4c, since marked wrong) said the estimate
carried no location. Against Kyle's real rows that is false. Every quote on the
sandbox — 62, 63 and 92 — has a `property_id`, an `estimate_locations` row, and
a revision whose frozen snapshot carries one location. Asking the deployed API
settled it:

```
quote 92 — accepted: false   requiresVerbalAcceptance: true   locations: 1
```

The screen had everything it needed except an **acceptance**. `ready` demanded
`verbal && verbalNote.length >= 10`, the box asking for that sat in an amber
panel well above the button, and the button itself said nothing. Kyle's other
way to record an acceptance — the customer's own click on the secure link —
needs the email provider that is still not connected. So he had no route at
all, and a control that would not say what it wanted.

### What changed

**#23 — the missing door.** `accepted` joins `MANUALLY_CORRECTABLE_STATUSES`,
reversing the earlier rule that acceptance may only be the customer's. The rule
was protecting the *evidence*, not the channel, so the evidence is kept:
`correctionRequiresReason` makes Accepted the one correction that must say why,
at least 10 characters, and the reason goes into `activity_logs` with the
before and after. `isAcceptedEstimate` now honours a corrected `accepted`,
which is what makes it reach #15.

Two guards stay. The derived shades `scheduled` and `accepted_scheduled` are
still untypeable — they describe facts, not opinions. And a quote the customer
accepted on their own link still answers **409**; the office cannot overrule
them. What did get *looser*, deliberately: the Correct status button used to
disappear whenever the status read accepted, so an office mistake could never
be undone. It now hides only on the customer's own acceptance, which is exactly
what the server refuses.

**#15 — the button explains itself.** A new `lib/conversion-readiness.ts`
returns the list of what is still missing; `ready` is that list being empty and
the screen prints the same list above the button. One function, so the control
and its explanation cannot drift into a button that is off for a reason nobody
is shown. It also catches an end time before a start time, which the server
refuses and the dialog used to let through as a 400.

### Found only in the browser

Correct the status to Accepted, reopen the scheduling screen, and it still said
nobody had accepted it. The preview query is mounted for the life of the page,
so toggling `enabled` served the first answer it ever got. Three things
together: the correction invalidates `estimate-conversion-preview`, the dialog
asks again on every open (`staleTime: 0`, `refetchOnMount: "always"`), and the
dialog renders its loading state on `isFetching` rather than `isLoading` — so
it shows nothing while it is replacing what it showed, instead of a stale
answer that flickers into a correct one. The unit tests all passed throughout;
only a real browser caught it.

`rows` also used to be seeded once and never resynced, so a changed snapshot
kept the old rows. It now rebuilds when the locations change and keeps what the
office has typed when they have not.

### Verified

| | |
|---|---|
| `scratchpad/p15-23-api.mjs` | **17/17** over HTTP — no reason, a keystroke and a line of spaces all refused; a real reason accepted and logged; the preview flips to `accepted: true`; the job is created on the chosen day at the quoted price; a derived status still refused; an office correction undone; a customer-accepted quote answers 409 |
| `scratchpad/p15-23-browser.mjs` | **17/17** headed — the dead button, the reasons it gives, Accepted in the list, Save held until a reason is written, and the button coming alive |
| API | **754/768** — the same 14 `DATABASE_URL` failures, nothing new. Pretest 34/34 |
| CRM | **648/648**, pretest 10/10. Both typecheck clean |
| Migration | **none** |

`estimate-lifecycle.test.ts` had never been registered in the api-server `test`
script and so had never run in the full suite; it is registered now, which is
where 12 of the extra tests come from.

### Cleanup, and a trap in the old harnesses

No ZZ rows remain; customers 124 and 125, quotes 62, 63 and 92, job 163 and
invoice 40 are all untouched. Five ZZ crews had survived earlier runs because
`DELETE FROM crews` was wrapped in `.catch(() => {})` and was failing on the
`crew_members` foreign key, silently, every time. **Delete the members first,
and do not swallow the error.** The `ZZ Live check` block of 2027-04-14 was
also still in `calendar_events` — lifting a block keeps its record, by design —
and has now been removed with the rest.

### Still open from the same notes

#7 (the eight email-routing choices, including **None**), #3 (where the custom
field section sits — waiting on Kyle's screenshot), #31 (a customer-facing
description per service line, carried into the job). #6 and the six blocked
items wait on the Gmail App Password. File #3, the Prospect Checklist itself,
has still not been sent.

---


## Email — the Gmail credential, tested 2026-10-10

Kyle sent a password for Gmail and said to go ahead and connect. It was tested
against `smtp.gmail.com` on both 587 (STARTTLS) and 465 (SSL) with
`nodemailer.verify()`, which authenticates and stops — **no message was sent**.

Google answers, on both ports:

```
534-5.7.9 Application-specific password required.
```

**That error is good news twice over.** It is not `535-5.7.8 Username and
Password not accepted`, which is what a wrong address or a wrong password
returns. Reaching the second-factor stage means `info@corstead.us` **is** the
right account and the password **is** correct. What stops it is that the account
has 2-Step Verification on, and Google has not accepted a plain account password
over SMTP since it withdrew less-secure-app access. It needs either a 16-character
**App Password** (`myaccount.google.com` → Security → 2-Step Verification → App
passwords) or OAuth2. The App Password is the five-minute answer; OAuth2 is a
build. **Asked Kyle for the App Password on 2026-10-10.**

`lib/email.ts` already has the SMTP path, so nothing needs writing for the
connection itself — `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`,
`SMTP_USER=info@corstead.us`, `SMTP_PASS=<app password>`,
`EMAIL_FROM_ADDRESS=info@corstead.us`, as Replit **Secrets**. The password
arrived in a chat screenshot and must not reach the repo or a client report.

### What the sandbox looks like underneath, checked the same day

| | Reading | What it means |
|---|---|---|
| `communication_events` | 68 rows, **all `succeeded`**, none pending | Connecting a provider releases **no backlog**. The mock reported success on every one, so nothing retries |
| `automation_rules` | **0 rows** | A `quote.sent` event still matches nothing. The App Password alone does not make an estimate email leave |
| `email_templates` | **0 rows** | Same |
| `email_logs`, `email_campaigns` | empty | Nothing half-finished |
| Customer addresses | **2** | See the warning below |

So the office acceptance notice (`lib/estimate-accepted-notice.ts`) starts working
the moment the provider is configured — it calls `sendEmailTo` directly. The
estimate and invoice chain still needs the rule, the template and the queue, as
the "Email, corrected" section already says.

**A warning worth acting on before the provider goes on.** The only two addresses
in the sandbox are `kstaffinvest@gmail.com` on customer 124 (Kyle's own, fine) and
**`lute@gmail.com` on customer 125** — the profile Lute created when he started
testing on 2026-10-08. That is almost certainly a stranger's mailbox, not Lute's.
With a real provider configured, the first thing anyone sends to customer 125
reaches that stranger with Corstead's name on it. Ask Lute for the real address
and correct the row **before** the Secrets go in, not after. Customer 125 is real
client data, so it is corrected, never deleted.

`scratchpad/gmail-verify.mjs` (takes the password as an argument so it is not in
the file), `scratchpad/email-readiness.mjs`, `scratchpad/email-addresses.mjs`.

---


## Phase 14, Step 4c — the other doors onto a blocked day, closed 2026-10-09 (live)

Found while checking whether anything in Kyle's 8 October corrections touches
the work waiting to be published. It does, and this is the link.

### What was wrong

Step 4c put the hard-block rule on three paths: `POST /jobs`, the reschedule,
and the day move. **Seven places create a job.** The other four never asked,
and one of them is the path Kyle's **#15** is about to unblock — so the day
that screen starts working is the day an accepted estimate could be scheduled
onto Christmas.

The rule is now on every path a person books from:

| Path | Before | Now |
|---|---|---|
| `POST /jobs` | guarded | guarded |
| `PATCH /jobs/:id` | guarded | guarded |
| `POST /calendar/move-day` | guarded | guarded |
| `POST /quotes/:id/convert-and-schedule` | — | **refuses, per location** |
| `POST /recurring-plans/:id/generate-job` | — | **refuses** |
| `POST /customers/with-initial-job` | — | **refuses** |
| the 06:15 recurring engine | — | **left alone, on purpose** |

One estimate can become several jobs, one per address, so the conversion
checks **every location it would book** and refuses before writing anything,
releasing its idempotency claim on the way out.

### The one left alone

The overnight engine generates work at 06:15 with nobody at a screen. A
generator that silently skips a customer's service is worse than one that
books it on a day the office then has to move. That is a decision for the
client, and it joins the question already open about that cron.

### Verified

`scratchpad/p14f-block-gaps-api.mjs` **13/13** over HTTP: each of the three
refuses a hard-blocked day with the block named, each still books a clear one,
and the refusal writes nothing. Three source guards added. API **742/756** —
the same 14 `DATABASE_URL` failures. CRM 624/624. No migration.

### Found on the way — a first reading of #15, since corrected

**This section was wrong and is kept only so the mistake is not made twice.**
It said `conversion-preview` reports no locations and that this is why Kyle's
button never enables. The conclusion came from a quote I had created myself,
from the profile, with no appointment — that quote genuinely has no location.
Kyle's quotes are not that quote. See "#15 and #23" below, where the real
cause is named against his actual data.

What survives from it: a quote created without an appointment still has no
`estimate_locations` row, because only `POST /quotes/with-appointment` writes
one. That matters for his edit-list #16, "create a quote directly from the
profile", and is a real gap — it is simply not what #15 was.

### Worth keeping — a shared database is not an empty one

Three of the Step 5 test's assertions failed and nothing had regressed: the
client started testing on Sandbox 2 on 8 October, and their completed job and
draft invoice were being counted by assertions that read `count(*) FROM
invoices`. Every count in that test is now scoped to the customers the run
itself created. A test that counts a whole table in a shared database reports
somebody else's work as your bug.

And again, from the other side: a run killed mid-flight never reaches its
cleanup, so its `ZZ` customer stays and the next run cannot create its own
(the phone number collides). `scratchpad/cleanup-zz.mjs` clears the strays.

---

## Phase 14, Step 5 — bulk invoicing, done in the working tree 2026-10-07

Spec **V1 #26** and **§13.1**, the fifth of the five prototype tests. With this
**Phase A is complete**: the five tasks the approval gate is about can all be
done from the calendar.

### The shape is Move Entire Day's

One planner, called from one place, answering both the review and the run —
so the screen cannot promise one thing and the button do another. Everything
in the range that will not be billed is named with the reason rather than
quietly dropped: already invoiced, not marked complete, cancelled, or no
amount on the job.

`POST /invoices/bulk` with `preview: true` creates nothing.

### One invoice per customer

Three visits in a month is **one bill**, which is how the office posts it and
how the customer expects to read it. Each line still names its job, so an
invoice can always be taken back apart. Two jobs at two addresses still share
one bill — the invoice carries no property rather than the wrong one.

Ticking is **per job, not per customer**: a week often holds one visit the
office wants to hold back, and the totals follow the ticks.

### It cannot bill the same work twice

Twice over, because the database does not stop it: `invoice_jobs` is unique on
*(invoice, job)*, not on job, and deliberately — a reissue links the same job
to its replacement invoice.

1. Work already on an invoice never enters the plan.
2. The plan is made before the transaction opens, so inside it the jobs are
   locked and looked at again. Somebody else reviewing the same week gets a
   409 naming the jobs rather than a second bill.

A range is billed **whole or not at all**. A half-billed week cannot be seen
without opening every job.

### Decided here

- **Work that is not marked complete is named, not billed.** §13.1 asks for a
  warning; a job the crew has not finished turns into a phone call, and
  marking it complete is one click away. Worth putting to Kyle if the office
  ever wants to bill ahead of completion.
- **Invoices are created as drafts** with a due date 30 days out, the same
  convention the single-job path uses. Nothing is sent to anybody.

### Verified

17 unit tests on the planner and the route, 3 on what the screen writes,
7 UI guards, `scratchpad/p14e-bulk-invoice-api.mjs` **22/22** over HTTP and
`scratchpad/p14-bulk-invoice-browser.mjs` **16/16** headed. Nothing regressed:
filters 15/15, move-day 11/11, conflicts 15/15 (see below). CRM **624/624**, API
**739/753** — the same 14 `DATABASE_URL` failures. No migration.

### Worth keeping — a month off by one

The dialog opened on **September** while October was on screen. The calendar
counts months from 0, as `Date` does; the range helper counted from 1. Nothing
in the types could catch it, and the unit test agreed with the helper because
it was written from the same wrong assumption. The browser caught it in one
look, and the helper now takes the index the grid uses, documented and tested
at both ends of the year.

### Worth keeping — the drop that landed a row out, and the hour spent on it

Drags in the Step 4c test sometimes land one row below the day they were
aimed at, which reads as *"the dialog never opened"* rather than as a drop on
the wrong day. **Not root-caused.** The obvious explanation was wrong and was
measured away: at the moment of the drag `window.scrollY` is 0 and the
document is exactly as tall as the viewport, so nothing is scrolling — not
dnd-kit's auto-scroll, not the queue panel resizing above the grid.

What the test does now: measures nothing until the card and the day cell have
stopped moving, aims at the day cell (`data-testid="calendar-day"`) rather
than at a block pill that is re-rendered whenever blocks are re-read, and
**retries a missed drop out loud**, printing where the card actually landed.
Two runs in three are clean; the third spends its retries and stops after ten
checks. The behaviour itself is covered three ways over — unit, HTTP and
several green browser runs — so this is a harness fault, and it is written
down rather than left for somebody to rediscover.

**And the one that wasted the most time:** a browser run that is killed never
reaches its cleanup, so its `ZZ` customer stays in the shared database. The
next run cannot create its own customer (the phone number collides), every
later step fails strangely, and the failures look exactly like the drag bug
above. `scratchpad/cleanup-zz.mjs` purges the strays; run it after stopping a
test by hand.

### Found on the way, not fixed

`invoice_lines.invoice_id` has **no foreign key**, and the database currently
holds **10 orphaned line rows from 21–24 September** pointing at invoices that
no longer exist. Nothing reads them, so nothing is wrong today. Adding the key
is a migration and deleting the rows is a data change in the branch Sandbox 2
shares — both need saying out loud first.

---

## Phase 14, Step 4c — conflict validation, done in the working tree 2026-10-06

Spec **V1 #34**, with **#12** and **§7.15**. Step 4b drew blocked days on the
calendar; **nothing stopped work being booked onto one**. A block was advice.
This is the step that makes it a rule, and Step 4 is now complete.

### Where the rule lives

On the server, on every path that can put work on a day:

- `POST /jobs` — a job cannot be created on a hard-blocked day;
- `PATCH /jobs/:id` — nor rescheduled onto one, checked beside the existing
  completed/invoiced lock and **inside the same locked transaction**, so a
  block created mid-request cannot be stepped over;
- `POST /calendar/move-day` — the day being moved **to** gets the same say a
  single drag gets.

All three share one helper (`calendar-blocks-store.ts`), and it reads **one
day**, not a window: a drag that waits on a month of rows is a drag that feels
broken.

### Hard refuses, soft still only warns

The API refuses **hard** blocks and lets **soft** ones through. A warning the
server answers by itself is a refusal wearing a different word — and only the
person booking knows whether the exception is deliberate. So the soft question
is asked on the screen, in the dialog that already held crew double-bookings:
**one dialog for both reasons**, because being asked twice about one drag is
how people learn to click through without reading.

The month grid also answers a hard block *locally*, from the blocks already
painted on the day, so the refusal arrives in the gesture rather than as a
bounced save. The server remains the thing that enforces it. A unit test reads
both files and fails if the two rule sets drift apart.

### What the checks are made of

- The reschedule check runs on the row **as it will be**, not on the patch
  alone: putting a blocked crew on a job already sitting on that day is the
  same move by another name, and the date never changes.
- A calendar card carries its crew, not its technician, so an **employee**
  block cannot be matched in the grid. The server still refuses it and its
  message is what the failed move shows. A refusal that arrives a moment late
  beats a drag that ignores a block.
- Move Entire Day skips only the jobs the target day refuses. One crew blocked
  there leaves the rest of the day free to move.

### Two things the browser found

- **"Staying on 16 Oct — ZZConfAda — completed."** The day-move dialog printed
  `reason === "invoiced" ? "invoiced" : "completed"`: a two-way guess, where the
  planner now has three reasons. A blocked job was labelled *completed*, which
  sends somebody looking at the wrong job. It names the block now.
- **Two spellings of one date in one dialog.** The heading said "Oct 18, 2026"
  and the line under it said "2026-10-18 is blocked: Closed", because that
  sentence is composed by the rule. Every place a block's message is shown now
  passes it through `readableBlockMessage`.

### Verified

26 unit tests (12 on the server rules and routes, 10 on the grid's own answer,
plus the planner's new reason), `scratchpad/p14d-conflicts-api.mjs` **20/20**
over HTTP and `scratchpad/p14-conflicts-browser.mjs` **15/15** headed. Nothing
regressed: 4a HTTP 15/15, 4b HTTP 17/17, and in the browser filters 15/15,
drawer 14/14, move-day 11/11, blocks 10/10. CRM **613/613**, API **722/736** —
the same 14 `DATABASE_URL` failures. No migration: `calendar_events` already
held everything this needed.

### Worth keeping — a drag that landed a row out

The first browser run reported "the dialog never opened". It had opened for the
first two drags and not the third, and the job had moved to a day nobody
dropped it on. **dnd-kit scrolls the page while a drag is in flight**, so a day
cell measured before the drag started is a row out by the time the pointer gets
there. The helper now measures the target twice *during* the drag and once more
before releasing. A fixed `waitForTimeout` would have hidden it — the failure
was geometry, not timing.

And one for the toolbox: **this shell's heredoc eats one level of
backslashes**, so a patch script written that way produced `/d{4}-d{2}-d{2}/`
from `\d{4}-\d{2}-\d{2}`. It typechecked, and the function silently returned
its input. Patch scripts that carry a regex now build the backslash explicitly.

---

## Phase 14, Step 4b — scheduling blocks, done in the working tree 2026-10-06

Spec **V1 #12**, **§7.15** and **§11.4**. `calendar_events` was created in Step 1
and, like `calendar_preferences` before it, **nothing had ever read or written
it**. That is the second of the four architectural blockers cleared by using the
table it was built for.

### A block is not a job

§11.4 is explicit, and it matters arithmetically: if a blocked day were stored as
a job it would be counted in that day's job count and its scheduled value. It is
a `calendar_events` row, and the test proves the consequence — a blocked day
reports **0 occurrences and a zero total**.

### Hard refuses, soft warns

- **hard** — the day the business is closed. A booking is turned away.
- **soft** — a crew on training, a van in for service. The scheduler is told and
  decides.

**Soft is the default**, because that is this calendar's posture everywhere else
(`crew-overlap.ts` warns rather than refuses): only the person booking knows
whether the exception is deliberate. The dialog says what each one does in
words — "Work cannot be booked on these days until the block is lifted" against
"whoever books it is told about the block first" — rather than leaving "hard"
and "soft" to be guessed at.

A soft block beside a hard one **does not soften it**, and the message names the
block: *"2026-12-25 is blocked: Christmas Day"*. An unexplained refusal is the
kind people learn to click past.

### Scope, range and hours

A block can cover the company, one crew or one person; one day or a range; the
whole day or a few hours. The hours clash only when they overlap, and a job with
no time set is told about a timed block rather than quietly let through.

### Lifting keeps the record

A lifted block is switched off, not erased: a day that was blocked in March is
part of why that month's schedule looked as it did. The route has no `DELETE
FROM` at all, and a test asserts it.

### Verified

16 unit tests on the rules, `scratchpad/p14c-blocks-api.mjs` **17/17** over HTTP,
and `scratchpad/p14-blocks-browser.mjs` **10/10** headed: a day is blocked from
the month, the pill appears on it, hard and soft are drawn in different colours,
the block is stored as a `scheduling_block` with no job behind it, and lifting it
from the grid leaves `is_active = false` in the table. CRM **596/596**, API
**705/719** — the same 14 `DATABASE_URL` failures. One Step 3 guard was updated,
because the filter bar's `&&` became a ternary when the Block days button joined
it on that row.

### Worth keeping — two false passes in one test

Both of these made the test *pass* while the product did nothing:

- **The toast counts as page text.** The test waited for "ZZ Van serviced" to
  appear on the page; the toast said exactly that, so it waited on the toast and
  not on the grid. The block pills now carry `data-testid="calendar-block"`, and
  the test reads only those.
- **`String.replace` turns `$` into `# Project decisions and working context

**Last updated:** 2026-09-21

## How to use this file

This is the running memory for work on this repo. It exists so that a lost chat, a new
machine, or a fresh session can pick up without re-deriving anything.

Read it before starting work. Update it whenever:

- The user makes a decision
- A recommendation is made and accepted or rejected
- Work is parked, and why
- We start waiting on the client for something, or an answer arrives

Keep it factual. Everything here should trace to something actually verified in the repo, not
assumed. Where something is unverified, say so explicitly.

**Read this alongside `.agents/memory/project-architecture-map.md`.** The two divide cleanly
and neither replaces the other: that file maps the repository as built — topology, runtime and
data flows, library choices, verification baseline, technical risks. This file carries the
decisions, the roadmap, and what we are waiting on people for. When they disagree about a
technical fact, the architecture map was measured more recently; when they disagree about a
decision or its reasoning, this file is the record.

`.agents/memory/MEMORY.md` indexes the other agent-memory notes, several of which capture real
traps (Radix Select pitfalls, advisory lock namespaces, the convert-core adapter pattern).
Worth a look before touching those areas.

---

## Where things stand right now — read this first

**As of 2026-10-05. All fourteen of Kyle's Testing Edits of 2026-10-01 are built and
browser-verified** — phases 16 through 21 — along with a **usability sweep** of every
screen they touched, which found and fixed 36 things before he sees any of it.

**Everything is live on Sandbox 2** (bundle `index-CYXe_Ae1.js`, built 2026-10-05 07:32
GMT): phases 16–21 verified **25/25** against the deployed app, and the four fixes that
reading those screenshots turned up verified **8/8** after the republish that carried them.

**The release message has gone to Kyle and Lute.** What we are waiting on them for is listed
under "Waiting on the client" — eight items, none of which blocks Phase 13 or 14.

**Phase 13 — sub-customers is live on Sandbox 2**, and **Gate Code and Access Notes are
gone for good** — out of the code, republished, and the columns dropped on 2026-10-05,
verified 9/9 against the deployed app afterwards.

**Phase 14 — the calendar is under way.** Step 3 is done (filters, the §11.6 preferences
behind them, and the job side drawer), and **Step 4's Move Entire Day** with it — all in the
working tree, none republished. What is left of Step 4 is **scheduling blocks (#12)** and
**fuller conflict validation (#34)**. Phase 15 go-live needs a date from Lute; Phase 12b
email and A#9 still wait on his keys.

Three things to put to Kyle with the republish, all recorded in their phases: whether a
quote's validity should run from **delivery** (the assumption built) or from creation;
whether appointment **durations** should offer 15 and 45 minutes as well; and which other
profile fields are commercial-only.

The calendar note below is older and still true as a description of the spec work.

**As of 2026-09-11.** Everything below this section is detail; this is the state of play.

**The work:** building the calendar described in the Corstead spec (v1.0, 31 Aug 2026). Of its
34 V1 items, **6 are done, 10 partial, 18 not started**. Only 1 of the spec's 5 prototype tests
passes. The sequencing plan is the Roadmap section.

**What is in flight:**

| | State |
|---|---|
| **Step 1 — the four calendar tables** | Committed (`a8a245e`) and **live on the Neon development branch** — 75 tables, constraints proven by test. Not on production, and the backfill migration has not run anywhere |
| **Step 2 — Scheduling Queue and On Hold** | **Complete** — API committed (`e64476d`), three-tab UI built 2026-09-11 and uncommitted. None of it has run against a real database yet |
| **Database move to Neon** | Recreated in `us-west-2` on 2026-09-11, schema pushed and constraints re-proven. Development is usable now; production is empty and untouched |
| **Notify-before-send** | Parked deliberately. Investigated and planned, not built |

**The immediate next actions, in order:**

1. Point the Replit **development** environment at the Neon dev branch (`DATABASE_URL`), and
   set `APP_MIGRATIONS_ENABLED = "true"` so the backfill migrations run there. Everything else
   waits on this — the queue endpoints have never run against a real database
2. Verify Step 2 end to end once the database is connected — the queue has never met a real
   row. It unlocks two prototype tests
3. Fix the migration gate to allow a production environment — required before any cutover
4. Move Neon project ownership to Lute; he asked for it, and the account was created on our side

**The single most important constraint:** Lute wants no interruption to Kyle's testing. Do not
let the database move stall the feature build.

**Do not** run `git commit` or `git push` — hand the user the message to paste.

---
## Phases 1–7 are deployed and verified on Sandbox 2 — 2026-09-25

`a8c38c0` is pushed and republished. The deployed bundle
(`/assets/index-Cgd1zUPe.js`) carries every Phase 1–7 marker and no longer carries
`gateCode` at all. **Sandbox 2 now runs the same code as the working tree** — the
gap recorded earlier, where it was still on pre-Phase-1 code, is closed.

**The run:** `scratchpad/sandbox2-accept.mjs`, headed, against
`https://sandbox-2-data-free-corsteadllc.replit.app` — 36 checks across all seven
phases, scenarios and edge cases, signed in as `team_admin` and as `team_tech`, with
a guest browser for the customer's own estimate link.

**Result: 36/36.** Five reported as failures on the first pass; all five were faults
in how the test asked, re-asked correctly in `scratchpad/sbx2-failures2.mjs` and all
five passed. They are worth writing down because they will trip the next test author:

| What looked broken | What was actually true |
|---|---|
| "Account type is not first on the form" | There is **no `/prospects/new` route** — the form is a dialog opened by **New Prospect** on `/prospects`. The test had been reading the nav sidebar. The dialog reads: Account type → Residential/Commercial → Contact information → Salutation → First name |
| "Customer Since is not set to today" | The field is **`customerDate`**, not `customerSince`, in the API and in the column (`customer_date`). Sending `customerSince: "2001-01-01"` on create stores `2026-09-24`; a later PATCH cannot move it; the profile shows it read-only |
| "A duplicate dropdown option is not refused" | It is: the second add returns **HTTP 409 `"ZZ Dup Probe" is already an option`** and no second row is written. The test read the page 1.2s later, by which time the toast had gone |
| "Gate Code and Access Notes are still there" | **No screen asks for them** anywhere on the profile. The `access_notes` and `gate_code` **columns** are still on `properties`, and the API still answers with those keys — dropping them is **Phase 9**, as planned. Not a defect |

**Verified on the deployed build, not localhost:** the five custom-field types and
their dropdown choices (values survive a reload; a blank date stays blank, not
"null"); a service typed while quoting joining the company-wide catalogue and
landing as a priced line; the customer's secure estimate link opening without a
sign-in and turning the estimate Viewed; Draft → Sent → Viewed, manual correction
with a reason, Accepted refused (400), unknown status refused (400), missing
estimate 404, field tech 403; one Communication & Activity tab with the estimate
email and the profile's own changes, newest first, filters that lose nothing
(1 email + 0 text + 4 changes = 5); the Overview's General Notes and created-by /
last-updated-by; and the full delete — 400 without confirmation, a dialog that
counts "1 job, 1 estimate, 1 invoice", a button that stays disabled until the name
is typed, nothing left in the database, and an audit row naming who did it.

**The database was returned to exactly what it was:** 1 customer (Lute Atieh),
1 property, 0 quotes, 0 jobs, 0 invoices, 0 services, 0 custom fields, 0 catalogue
options. The acceptance script's own cleanup crashed on
`custom_field_definitions.name` — **the column is `label`** — so the leftovers were
removed by hand (`scratchpad/sbx2-cleanup2.mjs`, `sbx2-cleanup3.mjs`), including
dropdown choices orphaned under `profile_catalog_items.catalog_type =
'custom_field_<id>'` once their definition is gone. **Deleting a custom field does
not take its choices with it** — worth fixing when Phase 8 touches this area.

**Still true, and Kyle should be told before he tests:** there is no email provider
on the sandbox, so an estimate is never actually delivered — the estimate page shows
the secure link with a **Copy secure link** button, and that is how to open the
customer's view. The service catalogue, dropdown lists and custom fields are empty
**by design**, because creating them is itself what Kyle asked to be able to do.
Conversion (estimate → job) is **not built yet** — it is Phase 10 — so his lifecycle
steps 05–08 will not complete.

---

﻿
﻿
** in the replacement string, so a patch
  script writing `page.$eval` produced `page.$eval` — which then failed with
  "Failed to find element", a message that sounds like a missing element rather
  than a corrupted call.

And once more: `innerText` applies CSS `text-transform`, so a case-sensitive
comparison against an uppercased pill is always false — which reads as "the
block is gone" when it never arrived.

---

## Phase 14, Step 4a — Move Entire Day, done in the working tree 2026-10-06

Spec **V1 #11**, and the third of the five prototype tests (§18). Rain moves a
day; the office should not reschedule twenty-five jobs one at a time.

### Three things make it safe rather than merely quick

1. **It refuses nothing silently.** Completed and invoiced work keeps its date —
   the same `schedule-change-lock.ts` rule a single drag obeys, so a day move
   cannot do what a drag would have refused — and every job left behind is
   **named, with the reason**, in the confirmation before anything happens.
2. **It can be asked what it would do.** `preview: true` returns the plan and
   changes nothing. The route calls the planner **once**, so the confirmation
   screen and the move cannot disagree; a test asserts there is only one call
   site.
3. **It tells nobody.** Phase 11's rule is that nothing reaches a customer
   without somebody answering a prompt — and a prompt asked twenty-five times is
   not an answer. The dialog says how many customers have work on the day and
   states plainly that **nobody will be told automatically**.

That last one is a decision, not an omission. Spec §8.6 asks for a batch review
screen before messages are released, and that is **question 3 on the list
waiting for the client**. Until it is answered, moving a day changes the
schedule and tells no one, which is the reversible choice.

### Every move is still a move

One `activity_logs` row per job, `job_rescheduled`, with the note *"Moved with
the whole day from … to …"* and the person who did it. A day move is not a
back-door around the history somebody reads when a customer asks why.

### Verified

`scratchpad/p14b-move-day-api.mjs` **15/15** over HTTP and
`scratchpad/p14-moveday-browser.mjs` **11/11** headed, against three jobs on one
day with one of them invoiced: the preview names the invoiced job and changes
nothing, the move puts two jobs on the next day, the invoiced one keeps its
date, the grid redraws, **nothing is queued to any customer**, and the history
gains one entry per job moved. Eight unit tests cover the planner, including
that a preview and a move produce the same plan. CRM **590/590**, API
**689/703** — the same 14 `DATABASE_URL` failures. Typechecks clean. The
database is back to 0 jobs and 0 invoices.

### Still to come in Step 4

Scheduling blocks (#12, which is what `calendar_events` was created for and
nothing yet reads) and fuller conflict validation (#34).

---

## Phase 14, Step 3 — calendar filters and the job drawer, done in the working tree 2026-10-05

The roadmap's Step 3 — *"Filters + job side drawer"* (V1 #16, #17, #21, #24) —
**both halves**, and with the first of them the **§11.6 blocker**, which the audit
of 2026-09-04 described as *"Every filter and display setting resets on reload."*

### The table had been waiting since Step 1

`calendar_preferences` was created by `a8a245e` and **nothing had ever read or
written it**. It now has `GET` and `PUT /api/calendar/preferences`:

- **No capability beyond being signed in.** They are the person's own settings,
  and a field technician is as entitled to remember their filters as anyone.
- **No row is written until something changes.** Somebody who has never touched
  the calendar gets the defaults and leaves no trace.
- **A patch moves only what it names**, so a screen that knows about two
  settings cannot reset the sixteen it has never heard of.
- **Every rule mirrors a check constraint on the table.** A value the database
  would refuse comes back as a 400 naming the setting, not a 500 from a
  constraint nobody sees. A test reads the schema file and fails if the two
  lists drift apart.

### An empty filter means everything

The one rule worth stating plainly: an untouched filter must never hide work.
`selectedAssignments: []` means every assignment, not none — the difference
between a calendar with a filter and a calendar that lies about what is booked.

### The footers count what is on screen

While a filter is on, the day totals and the month summary are recomputed from
the visible cards instead of the server's whole-month figures. Leaving the
server totals there would put eleven jobs under a cell showing three — the same
class of fault the Quotes tiles had on 2026-10-05, found by reading a
screenshot. When nothing is filtered the server's aggregates are used, as
before: they cost the same whatever the month holds.

The bar also says what it is hiding — *"2 jobs are hidden by these filters"* —
rather than leaving an unexplained gap in the month.

### Verified

`scratchpad/p14a-api.mjs` **16/16** over HTTP and
`scratchpad/p14-filters-browser.mjs` **15/15** headed, against five jobs across
two crews and one unassigned: the bar offers only the assignments actually
booked with a count each, choosing one narrows the grid *and* the month value
from $450 to $325, finished work can be put away, and — the point of the whole
thing — **the filters survive a reload**, read back from the row saved against
that person. CRM **568/568**, API **681/695** (the same 14 `DATABASE_URL`
failures). Typechecks clean. The database is back to 0 jobs, 0 crews and 0
preference rows.

### Worth keeping

- **A crew needs a lead who is a real user** (`leadUserId`, a canonical id from
  `/team-users/active`), and the lead is added to its own members.
- **A job cannot be created as completed on a future date.** The product is
  right; the test had to put finished work in the past.
- **"Nothing booked this month" was a query in flight**, not a fault. The first
  run screenshotted the empty state two seconds in. Wait for the month, not for
  the clock — the fourth time this session a fixed sleep has lied.

---

### The job drawer — the other half of Step 3

Clicking a card on the month used to leave the month: it navigated to
`/jobs/:id`, and getting back meant the browser's back button and a reload of
the grid. The office's question about a card is almost always the same one —
who is it for, where, when, who is going, what is it worth, is it invoiced —
and it should not cost the month to answer.

**It opens with the answer already in it.** The card the person clicked is in
memory, so the drawer paints from that immediately and the full job fills in the
phone number, the street address and the notes a moment later. The merge is a
pure function with one rule: **the detail wins only where it has an answer.** A
half-loaded job must not blank out what the card already showed, and a null
total is not a zero.

`onOpenJob` keeps its meaning — it is what the drawer's own "Open the job"
button calls — so every other caller of `MonthCalendar` is unaffected.

**Money stays hidden** from a viewer the server already decided should not see
it: the occurrence carries null for a field technician, and a total arriving on
the detail does not reveal it.

### Verified

`scratchpad/p14-drawer-browser.mjs` **14/14** headed: the drawer opens over the
month without the URL changing, names the customer, reads the time as *1:30 PM –
3:00 PM*, says what the work is and who is going, shows the property's label
first and then its full address once the job arrives, shows the value, closes on
Escape, and opens the full record when asked. CRM **585/585** with 17 new unit
tests and 7 new guards.

### Worth keeping

- **`@/` does not resolve under `node --test`.** A lib imported at runtime by a
  unit test must use a relative path; the alias only survives where a type-only
  import is erased. `calendar-filters.ts` got away with it, `job-drawer.ts` did
  not.
- The drawer test asked for the street address the instant it opened and failed.
  Both readings were correct — the card knows the property's **name**, the job
  knows its **address** — which is the behaviour, not a fault.

---

## Gate Code and Access Notes — gone, 2026-10-05

Kyle (2026-09-23, #2): *"Remove entirely as built-in fields — the property form
**and** their display on assigned jobs. Corstead must not prompt anyone to store
gate codes or card details; a company that wants it can make its own custom
field. **Liability is the reason.**"*

The screens and the write path went in Phase 8. This is the rest: the schema,
the contract and the seed data.

### The order mattered, and it is now done

**The columns are gone from the database**, dropped at 2026-10-05 after the
republish that carried the code removal. Until then the API deployed on Sandbox 2
selected both by name — Drizzle writes an explicit column list — so dropping them
first would have broken **every property query Kyle makes**.

So the sequence is: remove from the code → commit, push, **republish** → *then*
drop. Only the first step is done. `scratchpad/p13b-drop-columns.mjs` is written
and waiting, and it **refuses to run** until the deploy is ready.

Its first version asked the wrong question. It read the deployed client bundle
for `gateCode`, which has been clean since Phase 8 took the fields off the
screens — so it answered "ready" while the deployed API would still have broken.
It now signs in to the deployed API and reads an actual property: if the response
still carries those keys, that build still selects the columns. Run before the republish it said
**"STILL answers with gateCode/accessNotes — it would break"** and stopped; run
after it, it said the deployed API no longer answers with them and went ahead.

**No data was lost**: 0 rows held a value in either column.

### Verified on Sandbox 2 after the drop

`scratchpad/verify-after-drop.mjs` **9/9** against the deployed app: it signs in, the
properties list answers with both properties and neither dropped key, a profile loads
with its properties, jobs, quotes and invoices, a property can still be **created and
edited**, and the jobs list — which shows property details — answers. `properties` now
has 37 columns.

One check in that script read the wrong key and reported *"0 properties"*: the list
answers `{ data, page, pageSize, total, hasMore }`, not `{ properties }`. The deployed
list really returns both. A test fault, caught by asking the database what it held.

### What changed

- `lib/db/src/schema/properties.ts` — both columns gone.
- `lib/api-spec/openapi.yaml` — `accessNotes` and `gateCode` removed from all
  three Property schemas, and orval re-run. The API stops answering with keys
  nothing fills in.
- `seed-demo.ts`, `scripts/seed.sql`, `scripts/seed.ts` — nine `INSERT INTO
  properties` statements in each of the first two, and two parameterised ones in
  the third. Where an access note said something real about the job ("Tenant must be
  notified 48 hrs in advance") it became part of the service notes, which is what
  it always was.

### Rewriting SQL by script, carefully

Removing a column from an `INSERT` means removing its value from every tuple,
and getting that wrong would **shift every later value one field to the left** —
seeding a gate code into `service_notes` rather than nowhere. So:

1. The rewrite ran against **copies** first.
2. A separate checker, `scratchpad/check-inserts.mjs`, counts columns against
   values for every `INSERT INTO properties` in both files. **28 statements, 0
   mismatches**, before and after.
3. The first attempt did get it wrong, and the checker is not what caught it —
   reading the output did: the VALUES terminator ran past the closing bracket and
   swallowed `RETURNING id INTO p_hartley1`, leaving a stray bracket. Fixed by
   ending the list at the last balanced tuple.

### Verified

`scratchpad/verify-properties-without-gatecode.mjs` **7/7** over HTTP: a property
can still be created, edited and read back on the profile; the response carries
neither key; and **an old client that sends a gate code is not obeyed** rather
than quietly storing one. API **669/683** (the same 14 `DATABASE_URL` failures),
CRM **558/558**, every typecheck clean.

---

## Phase 13 — sub-customers, done in the working tree 2026-10-05

Kyle (2026-09-23, answer #5): *"Linking only. Any profile can sit beneath a main
profile, residential or commercial, one or many. **No 'bill to parent', no
combined invoices** — linking changes nothing about billing. Can come later;
must not delay the basics."*

So the whole phase is one nullable column and the rules around it. The hardest
part was deciding what **not** to build.

### Two levels, and why

He said "beneath a main profile", which reads as two. Chains would mean deciding
what a grandparent's lists, totals and invoices do — exactly the "later" he
warned against. So a profile that already has profiles beneath it is not offered
a main profile, and a profile that has one cannot be made somebody's main
profile. The rule is enforced from **both directions** and both are tested.

Deeper nesting would be a change to one function, not a rewrite. It is question
5 on the list waiting for him.

### Nothing about money moved

`MainProfileCard` shows **no totals, no balances, no invoices** — a test asserts
the file contains no currency formatting at all, because a number there would be
the first step towards the combined billing he ruled out. Another test reads the
money libraries and fails if any of them starts reading `parentCustomerId`. The
API test proves it from the other end: an invoice raised on a sub-profile does
not appear on the main profile's detail.

### Deleting a main profile frees the ones beneath it

The important one. A sub-customer is a **separate profile**, not a belonging, so
erasing a main profile must leave its sub-profiles standing. Two things make
that true: `ON DELETE SET NULL` on the column, and `SUB_PROFILE_UNLINK` running
with the lead unlink before the purge's deletes — the purge counts what still
points at the profile afterwards and would otherwise roll back.

Proven three ways: the constraint itself in a rolled-back transaction, the purge
statement's position in `customer-purge.ts`, and over HTTP — delete the main
profile, and the profile beneath it answers 200 with nothing above it.

### The shape

- `customers.parent_customer_id`, nullable, self-referencing, `ON DELETE SET
  NULL`, indexed, with a check constraint that a profile cannot be its own main
  profile. The database holds that one itself.
- `lib/customer-hierarchy.ts` — `decideMainProfile()` returns link, unlink, or an
  error with its own status: 400 for itself, 404 for a profile that does not
  exist, 409 for a third level or an archived main profile. **A bad id is a 400
  with a reason, not an empty result.**
- `PUT /api/customers/:id/main-profile` (and the prospects alias), which locks
  the account, reads both sides, decides, writes, and records the change in the
  history in words: *"ZZUnit Four now sits beneath ZZ Acme Holdings"*. A route of
  its own rather than another field on the generic PATCH, so a refusal can say
  which rule it broke.
- The profile detail carries `mainProfile` and `subProfiles`, so the card needs
  no request of its own.

### Verified

`scratchpad/p13-ddl.mjs` **3/3** on the constraints, `scratchpad/p13-api.mjs`
**18/18** over HTTP, `scratchpad/p13-browser.mjs` **10/10** headed. CRM
**558/558** (6 new guards), API **669/683** — the same 14 `DATABASE_URL`
failures, 11 more tests and all of them passing. Typechecks clean. The database
is back to its 2 customers with **no** links, which is how Kyle will find it.

**No migration.** The column is additive and nullable, declared in the Drizzle
schema, and nothing deployed reads it.

### Worth keeping

- **The purge's safety net is what makes a new foreign key risky.** It counts
  what still points at the profile after the deletes and rolls back if anything
  does. Any future column pointing at `customers` needs a line in that file, not
  just an `ON DELETE` rule.
- A PowerShell `cd` inside a compound command does not survive to a later
  `[System.IO.File]::ReadAllText` with a relative path — the second one resolved
  against the old directory and silently read nothing. Use absolute paths, or the
  editing tools.

---

## Sandbox 2 checked after the republish — 2026-10-05

The user republished. The bundle moved from `index-043EjDyX.js` to
`index-CGgtUgPk.js`, and **everything from phases 16 to 21 is live**, server as
well as client: `scratchpad/verify-sandbox2.mjs` is **25/25** against the
deployed app, including `/api/quote-settings` answering with Kyle's four presets,
the custom field filter refusing a bad id with a reason, the fifteen-minute
time list with his own 8:00/8:15/8:30/8:45 example, a phone number formatting
itself to `(816) 555-1234` as it is typed, and no Company Name on a residential
profile. Nothing was created on the shared database to check it; the only thing
typed into a form was a phone number, never saved.

### Four things the screenshots showed

Reading the screenshots rather than only the assertions is what found these.

1. **A quote badged Open while the Open tile read 0**, and the six tiles summed
   to **one of two quotes**. An estimate with an appointment derives as
   `scheduled`, which reads as Open — and the tiles counted `draft` only, so it
   was counted nowhere. Clicking the Open filter hid it too. Both now go through
   a new `estimateStatusGroup()` in `lib/estimate-status.ts`, and a test asserts
   that **every** derived status falls into one of Kyle's six with the same
   label it is badged with.
2. **"Manage your pricing and offerings"** still sat under the Service Catalog
   heading, after #8 took pricing out of it.
3. **The two legacy services showed `$150.00`** with the explanation only in a
   `title` attribute, invisible unless hovered. It reads `was $150.00` now.
4. **The New Quote status selector still said Draft and Sent** — the words #10
   replaced. It uses `ESTIMATE_STATUS_LABELS` now; the stored values are
   unchanged.

### Verified

`scratchpad/verify-open-count.mjs` **6/6** against the real data: the scheduled
estimate is counted as Open, the six tiles account for both quotes, and the Open
filter lists that estimate and hides the other. CRM **552/552**, with the Phase
17 test that asserted the old shape updated to the new one. API untouched.

**All four are live**, verified 8/8 on the deployed app by
`scratchpad/verify-sandbox2-fixes.mjs`: the Open tile counts the scheduled estimate, the
six tiles account for both quotes, the Open filter lists it and hides the other, the
catalogue no longer offers to manage pricing, an old price reads `was $150.00`, and a new
quote's status reads Open.

**It took three republishes**, and that is the thing to remember: the first two rebuilt
from a workspace that did not have the commit, producing a *freshly built* bundle with the
old code in it — the asset's `Last-Modified` was minutes old while its contents predated the
fix. Replit builds from the workspace's files, not from GitHub, so a push is not a deploy:
the workspace has to pull first. Checking the bundle for a string that **should have gone**
is what caught it; checking only for the new string would have looked like a caching fault.

### Worth keeping

- **Read the screenshots.** 25 assertions passed on a screen whose tiles were
  visibly wrong; the arithmetic error was only apparent by looking.
- A filter chip renders its count in an inline span with no space, so its text
  is `Open1` while the tile beside it reads `1 Open`. Four runs went into that.

---

## Phase 21 — finding a profile by its custom fields, done in the working tree 2026-10-05

Kyle's Testing Edits of 2026-10-01, the last part of **#3**: *"These custom
fields should later be searchable/filterable so a company can categorize and
find prospects or customers based on the values entered."*

**This completes all fourteen of his items.**

### Two different questions

The sentence asks for two things, and they want different answers:

- **The search box** answers "is this text anywhere on this profile". Custom
  field values are now part of that, always as a contains match. One `EXISTS`
  subquery rather than a join, so a profile with three matching fields is still
  one row — checked.
- **A filter** answers "which profiles have *this* value in *this* field", and
  what a match means depends on the field. A dropdown choice, a date, a tick and
  a **number** are exact; free text is a contains match. Filtering a window
  count of 12 must not return the profile with 120, and that is a test.

### What the screen says

The filter sits under the existing ones on Prospects and Customers (one file
serves both). The value control follows the field's type — a select of the
field's own choices for a dropdown, Ticked / Not ticked for a checkbox, a number
or date box, a text box — and underneath it a line says *what a match means*:
"Matches exactly", "Matches the chosen option", "Matches anywhere in the text".
Without that, "12 found nothing" is a mystery.

Choosing a field with **no value** asks who has that field filled in at all,
which is how you find the profiles somebody has not categorised yet. Changing
the field clears the value, because last field's value rarely fits the next one.
A company with no custom fields sees no filter.

### Decisions worth knowing

- **A field id that does not exist is a 400 with a reason**, not an empty list.
  A stale bookmark should say so rather than look like "no matches".
- **A value's own wildcards are escaped.** Without it, filtering for `100%`
  would have matched every profile. `containsPattern` escapes `%`, `_` and `\`,
  and the API test proves `100%` matches only itself.
- **A checkbox accepts yes / true / 1 / ticked** from a form and stores "true";
  anything else is refused with a reason rather than silently finding nothing.
- **No new table.** Values already live in `custom_field_values`; a dropdown's
  choices already live in `profile_catalog_items` under a catalogue per field,
  which the filter reads through the existing `/catalogs/custom-field-<id>`.
- **One additive index**, `(definition_id, value)`, for the exact-match path,
  declared in the Drizzle schema as well as on the database. A contains match
  cannot use a btree index; if the data ever grows enough to matter the answer
  is a trigram index, not this one.

### Verified

`scratchpad/p21-api.mjs` **21/21** over HTTP and `scratchpad/p21-browser.mjs`
**16/16** headed. CRM **547/547** (20 new unit tests, 7 new guards), API
**658/672** — the same 14 `DATABASE_URL` failures, 12 more tests and all of them
passing. Typechecks clean. The database is back to its 2 customers with **no**
custom field definitions, which is how Kyle will find it: he has not created any
yet, so the filter will stay hidden until he does.

### Worth keeping

- **A list that debounces cannot be read after a fixed sleep.** Two assertions
  failed while their own printed detail showed the right answer, because the
  first read landed mid-refetch. They poll for the expected set now. That is the
  third time today a `waitForTimeout` lied.
- **Test data needs distinct phone numbers.** Three prospects sharing one were
  refused as duplicates — correct of the product, wrong of the test — and the
  failure showed up five assertions later as "no Bob".
- **A custom field's key is unique**, so ZZ definitions left by a previous run
  collide. Deactivating them is not enough; the test deletes them at both ends.
- **A lib imported by a test must use `.ts` in its own imports.** `./x.js`
  resolves in the bundle but not under `node --experimental-strip-types`.

---

## Phase 20 — time, done in the working tree 2026-10-04

Kyle's Testing Edits of 2026-10-01, **#14**: *"Anywhere Corstead asks the user to
select a time, use 15-minute increments … Each hour should offer :00, :15, :30,
and :45. Use standard AM / PM formatting. Apply this consistently … throughout
the platform."*

Two halves: how a time is **chosen**, and how it is **read**.

### Chosen: one selector, fifteen sites

`<input type="time">` was in nine files, fifteen times. It let anybody type 8:07,
and it showed the time in whatever format the browser's locale chose — **on a
machine set outside the United States, with no AM or PM at all**, which is the
part of #14 that could not be fixed by asking people to be careful.

All fifteen are now `TimeSelect`: a native `<select>` of the day's ninety-six
quarter hours, labelled "8:15 AM", storing the same `HH:mm` the API already
took. Native on purpose — one tap on a phone, and typing jumps the keyboard.

The sites: the estimate appointment in the builder and on the quote, converting
an estimate into jobs, the scheduling queue, a new job, an existing job,
rescheduling from the schedule, the first job booked while creating a profile,
and quiet hours in Settings.

**A time already booked off the grid is kept, not moved.** A job sitting at 8:20
shows "8:20 AM (as booked)" in its own place between 8:15 and 8:30. Opening a
form should never quietly reschedule somebody's work, and a snap-to-nearest
would have done exactly that.

### Read: seven formatters became one

Dashboard, Jobs, Schedule, JobDetail, MonthCalendar and `crew-overlap` had each
grown their own, and no two agreed: `8:15am`, `8:15 am`, `8:15a`. All six now
call `formatTimeOfDay`. The quote's appointment line printed a 24-hour
`2026-10-10 14:30`; it reads `2026-10-10 at 2:30 PM Chicago`.

Four of the six were found by sweeping for `% 12 || 12` **after** the browser
pass caught the fifth. Neither method alone would have found them all, and the
guard test now sweeps the tree rather than naming screens.

### One thing that had to change underneath

`liveTimeControlValue` — which reads the live DOM value when a job is submitted,
so an uncommitted picker cannot be lost — tested `control.type === "time"`. A
`<select>` reports `select-one`, so it would have silently fallen back to React
state and the guard would have been dead code. It now accepts both.

### Left alone, deliberately

- **Durations** (30 / 60 / 90 / 120 minutes) are a length, not a time of day.
  They are already multiples of fifteen. Whether Kyle wants 15 and 45 offered
  there is a question for him, not an assumption.
- **No server-side rule** that a time must be on the quarter hour. The grid is
  what Corstead offers; rejecting an off-grid value would make existing jobs
  unsaveable, which is the opposite of keeping them.

### Verified

`scratchpad/p20-time.mjs` **15/15** headed, including: a select rather than an
input, ninety-six options, Kyle's own 8:00/8:15/8:30/8:45/9:00 example, nothing
between the quarters, midnight and noon reading as twelve, 5:30 PM in the
evening, an 8:20 job kept and then moved onto the grid and stored as 08:30, no
lowercase am/pm left on the jobs list or the dashboard, and quiet hours on the
same grid with "Any time" for an empty one. CRM **532/532** (12 new unit tests,
5 new guards; one existing test expected the old lowercase style and was
updated). API untouched. Typechecks clean.

### Worth keeping

- **Inserting an import after "the last line starting with `import`" splits a
  multi-line import** and breaks three files at once. Insert before the *first*
  import line. A file with no imports at all needs the top of the file.
- **Settings loads its quiet-hours card on a separate query, four seconds in.**
  A fixed 2.5-second wait reported a missing control that was merely late — the
  second false failure of the day from a `waitForTimeout`. Wait for the thing.

---

## The usability sweep, 2026-10-04 — before Kyle sees any of it

The user: *"koi bhe usability issue nahi hona chaiye, bad impression hota hy
client py."* So the nine screens phases 16–19 touched were measured rather than
eyeballed: `scratchpad/usability-audit.mjs` walks each one and reports every
control a person can type into that has no readable name, any database wording
that reached the screen, any date printed as `2026-11-18`, and every disabled
button. **36 findings. Now 0.**

### The serious one: an edit deleted a line's description

The quote page's edit panel had never caught up with Phase 18. On it, the
service title was still an editable input (#9 says it must not be), **"Add Item"
still added a blank custom line** (#7 removed exactly that), and there was no
per-quote Description box at all.

Worse than missing: **destructive**. The save rewrites every line, and it sent no
`serviceNotes`, so the server stored null. Editing a price on an existing quote
silently erased the description written in the builder. Nothing warned anybody
and nothing in the test suite looked.

A second fault came out of fixing it: saving and reopening Edit within the second
handed back the version from **before** the save, and saving again put the old
value back. The response already carries the whole quote, so it is now written
into the cache instead of waiting for a refetch to land.

`ServicePickerDialog` moved out of `QuoteNew.tsx` into its own component so both
screens add a line the same way. Two copies of Kyle's rules is how the panel
drifted in the first place.

### The ones a client notices in a demo

- **`Window_cleaning`.** A service stores its category's code and the card
  printed it with CSS `capitalize`, which capitalises the first letter and leaves
  the underscore. It now shows the catalogue's own name, through a new
  `useServiceCategoryName()`. My first audit pass missed this because the regex
  wanted a lowercase first letter — `text-transform` had already changed it.
- **"Add countie".** The placeholder was the catalogue's title with an `s`
  stripped off. Each catalogue now states what one of its entries is called.
- **A disabled "Queue delivery"** with no reason beside it; it now says to
  finalize the estimate first.
- **`replace("_", " ")`** on a delivery status, which would leave the second
  underscore in anything like `sent_to_provider`.

### Twenty-four controls had no name

Including both boxes in the builder's Notes & Terms card — found by the Phase 19
browser test, which could not type into a field a person can see. The rest:
every appointment field, the delivery recipients, the quote's edited notes and
terms, the line quantity and price, the quiet-hours timezone, the custom-field
row, the catalogue add boxes, and the profile search. A visible `<Label>` with no
`htmlFor` names nothing.

### Two things the audit got wrong

Worth knowing, because both would waste the next session's time:

- **A dropdown built on Radix renders a hidden native `<select>`** for form
  submission, marked `aria-hidden`. Eight of them looked like unnamed controls;
  the name belongs on the trigger, where it already was. The audit now skips
  anything inside `[aria-hidden="true"]`.
- **`team_admin` is the signed-in account's own email**, on every screen in the
  page chrome. Account data, not product wording.

### Verified

`scratchpad/usability-audit.mjs` **0 findings** across nine screens and
`scratchpad/p19b-quote-edit.mjs` **16/16**, both headed. The nine assertions in
`src/pages/usability-sweep.test.ts` hold each fix in place. CRM **515/515** —
one existing test had to be pointed at the dialog's new home, because it asserted
where the picker lived rather than that it worked.

---

## Phase 19 — quote validity and the company's terms, done in the working tree 2026-10-04

Kyle's Testing Edits of 2026-10-01, **#11, #12 and #13**. #12 was recorded as
"already true" on 2026-10-03 — the link did die — but it died on a schedule that
had nothing to do with the validity Kyle was describing, so it is covered here
and now proven end to end.

### What was actually wrong before

Three things, none of them visible from the screens:

1. **Nothing connected the date to the expiry.** `quotes.valid_until` was a date
   somebody typed, shown on the quote. The customer's link died from
   `estimate_public_links.expires_at`, set to **thirty days after sending**,
   hard-coded. The two numbers never had to agree, and usually did not.
2. **The link's life was clamped to 60 days** —
   `Math.min(60, …expiresInDays ?? 30)` — so Kyle's own 90-day example would
   have been silently shortened to 60.
3. **A quote marked valid until the 3rd stopped working on the 3rd**, because
   `expires_at` was an instant thirty days from the moment of sending. Delivered
   at nine in the morning, the link died at nine in the morning on its last day.

### The company decides once

A new `quote_settings` table: one row, `validity_days` (1–365, default 30) and
`terms` (nullable, **no default**), with the same `organization_key` singleton
shape as `communication_notification_settings` beside it. **There is no row
until somebody saves** — a company that never opens Settings gets thirty days
and no terms, and nothing has to be seeded.

`GET /api/quote-settings` is open to anyone who may see a quote, because the
builder shows the expiry and fills in the terms. `PUT` needs `admin.settings`.

**Not in `openapi.yaml`.** The only other company-settings feature
(`/communication-safety/notification-settings`) is not either; it is called with
a plain `protectedFetch`. Following that saved regenerating 310 orval files for
two endpoints.

### #11 — nobody types a date again

The Valid Until field is gone from the builder and from the quote's edit panel.
Both now **show** the date, with the number of days and where it came from. The
server calculates it: at creation from the company setting, and again at
delivery — **the clock starts when the customer is given the quote**, not when a
draft was raised, and the quote's own date is moved to match so the two can
never disagree. Kyle did not say which; this is the assumption, and it is in the
message to him.

### #12 — the record stays, the link stops

`expires_at` is now the **last second of the valid-until day in the business's
timezone**, so the date the customer reads is the date it stops working. Proven:
the link opens on 200 while valid, 404s once expired, an acceptance through it
404s too, and the quote is still on the profile afterwards.

### #13 — the company's own words, and only the company's

A Terms and Conditions box in Settings, empty until written in, with a line
saying Corstead supplies no wording of its own. New quotes are filled in from
it; an edit on a quote belongs to that quote and never touches the setting —
both checked. **A test asserts that neither the server lib nor the form nor the
card contains sample wording**, placeholder included, so a well-meaning
"Payment due on completion…" cannot creep back in.

### Two faults found next to the work

- **A second status selector** sat in the quote's edit panel, left over from
  before Phase 17's correction control. It offered **"Approved"**, which
  `assertStaffWritableQuoteStatus` rejects with a 400 — a control that could
  only ever fail — and still used the wording Kyle replaced in #10. Removed
  rather than relabelled: the page already has one place to correct a status.
- **The builder's Notes and Terms boxes had no label attached to them**
  (`<Label>` with no `htmlFor`). The browser test found it by failing to type
  into a field a person can see. Same family as the `F`-wrapper fault in
  Customers.tsx.

Three screens also printed the expiry as the raw `2026-11-18`; they now read
`Nov 18, 2026` like every other date.

### Reuse rather than a second convention

`lib/date.ts` already held the authoritative business timezone and
`addDaysToDateOnly`. The first draft of `quote-settings.ts` reimplemented both.
It now imports them, and `BUSINESS_TIME_ZONE` is exported from `date.ts` so the
one new thing — the *instant* a business day ends, which needed the zone's offset
resolved twice for days either side of a daylight-saving change — is the only
timezone code added.

### Verified

`scratchpad/p19-quote-settings.mjs` **40/40** headed, `scratchpad/p19a-api.mjs`
**16/16** over HTTP, and the table's own constraints **4/4** (a validity of 0,
of 400, over-long terms, and a second row for the same organization are all
refused). CRM **506/506**, API **646/660** — the same 14 `DATABASE_URL`
failures, 12 more tests than before and all of them passing. Typechecks clean.

**No migration.** The table is additive, declared in the Drizzle schema so
`drizzle-kit push` keeps it, and the code defaults when the row is absent. The
database is back to its 2 customers, 2 quotes and 2 services, with
`quote_settings` deliberately left **empty** so Kyle finds thirty days and no
terms.

### Worth keeping

- **A fixed `waitForTimeout` after a save is not a verification.** One check
  read the database before the mutation landed and reported a failure that had
  not happened. Wait for the response.
- **`input[type="date"]` is not the same question as "can the expiry be typed".**
  The estimate appointment legitimately has a date field; two checks had to be
  narrowed to "every date input belongs to the appointment".

---

## Phase 18 — the service catalogue and quote lines, done in the working tree 2026-10-04

Kyle's Testing Edits of 2026-10-01, #7, #8 and #9 — the largest of his items,
because it changes how every quote is priced.

### What made it safe

Two things found before any code was written:

- **A quote line already stores its own price** (`unit_price`, `total_price`), so
  the catalogue price was only ever a default. Removing it disturbs no existing
  quote or job.
- **A per-line, per-quote note already existed** —
  `estimate_line_metadata.service_notes` — written at finalize and already shown
  on the customer's estimate. #9 needed plumbing, not a new structure.

And a survey of the data: **2 services**, both priced, and **no quote line
without a service**, so dropping the custom line item orphaned nothing.

### #8 — the catalogue keeps a name and a category

Price, pricing type and unit are no longer asked for anywhere. **The columns were
not dropped**: `base_price` and `pricing_type` are now nullable, so the two
services that carry $150 keep it, shown quietly on the card with a note that the
quote decides what is charged. The unit is derived from the pricing type rather
than being a separate question.

**Categories left the code.** Six were hard-coded in `service-validation.ts`;
they are now ordinary `profile_catalog_items` rows under `service-categories`,
seeded from the fixed list plus anything in use. `ServiceCategoryPicker` adds and
removes them in place, on both the Service Catalog page and the quick-add used
from quotes and jobs — one component, because both needed the same thing.

### #7 — services only

The custom line item is gone: both its buttons, the empty-line default, and the
blank-row filtering that existed to tidy up after it. A new quote starts with no
lines and points at the Service Catalog, where an existing service is picked or a
new one created.

### #9 — a locked title, and a description for this quote

The line shows the catalogue service's name as **text, not a field**. Under it is
a Description box that belongs to that service on that quote alone: it does not
touch the catalogue entry, and the same service added to another quote starts
empty — both checked.

`quotes.ts` now carries it through create, rewrite and single-line-add via one
`saveLineServiceNotes` helper, and returns it when a quote is read. Writing an
empty box removes the row rather than storing a blank note.

### The contract had to move first

`basePrice` was `required` in `openapi.yaml`, so the spec was edited and `orval`
re-run before anything would compile. That rippled into four call sites — which
were exactly the ones that needed changing.

**Two latent faults were caught by it:** `String(null)` would have written the
word `"null"` into `base_price`, and `Number(null)` would have given a service
with no price a price of **0**.

### Verified

`scratchpad/p18a-catalog.mjs` **13/13** and `scratchpad/p18bc-quote-lines.mjs`
**15/15**, both headed. CRM **487/487**, API **634/648** (the same 14
`DATABASE_URL` failures). All typechecks clean. The database keeps its 2 services,
6 categories and the client's own profiles.

### Worth keeping

- **A patch-script guard of the form `if (!s.includes("Name"))` matches the name
  inside code the same script just inserted**, and silently skips the import.
  This bit twice more here. Guard on the exact declaration and check the result.
- **The quote builder preselects a customer from `?customerId=`**, which is far
  steadier in a test than driving the picker, and the save button carries
  `data-testid="save-quote-top"`.

---

## Phase 17 — the quote statuses, done in the working tree 2026-10-04

Kyle (Testing Edits, 2026-10-01, #10) named six, and asked that the two kinds of
Pending stay apart "so the office can immediately tell whether the customer has
opened the quote".

| Reads as | Derived from |
|---|---|
| **Open** | `draft`, `scheduled` |
| **Pending – Sent Only** | `sent` |
| **Pending – Sent and Viewed** | `viewed` |
| **Accepted** | `accepted`, and `accepted_scheduled` once it is a job |
| **Declined** | `declined` |
| **Closed** | `expired` |

**Only the wording moved.** The derivation behind it — sent, opened, decided,
expired — is untouched, so nothing about how a status is reached has changed.

His 2026-09-24 list had a separate **Accepted & Scheduled**; the 2026-10-01 list
does not, so an estimate already turned into a job now reads **Accepted** like any
other. The dashboard's own queue ("N estimates need to be scheduled") is what
still separates them, and it had to stop counting by grouping: `needsScheduling`
now counts the `accepted` status directly, or a scheduled one would have been
counted as still waiting.

Changed in: `crm/src/lib/estimate-status.ts`, `Quotes.tsx` (filters and chips),
`api-server/src/lib/estimate-dashboard.ts`.

### StatusBadge learned an override

The list and the profile's Quotes tab render `StatusBadge`, which carries **its
own** label map shared with jobs, invoices, leads and customers. An invoice's
`draft` is still a draft, so renaming it there would have been wrong. It now takes
an optional `label`, and the estimate screens pass their own wording while keeping
the colours.

### Verified

`scratchpad/p17-statuses.mjs` **18/18**, headed: four estimates taken to Open,
Pending – Sent Only, Pending – Sent and Viewed and Declined, then read on the
estimate page, in the list filters, in the correction dialog and on the dashboard.
CRM **480/480**, API **621/635** (the same 14 `DATABASE_URL` failures), typechecks
clean.

### Two traps worth keeping

- **The SPA leaves the previous page in the DOM for a moment.** Waiting on a
  heading every estimate page shares ("Estimate lifecycle") reads the *old* page
  and the old status. Wait for something unique to the record first.
- **The client has estimates of their own in this database** (Kyle's and Lute's
  test profiles). Absolute counts on the dashboard are therefore not ours to
  assert; judge the records the run created, by id.

---

## Phase 16 — the profile screens, done in the working tree 2026-10-03

Kyle's Testing Edits of 2026-10-01, items #1, #2, #3 (the part left over), #4, #5
and #6. Built and checked one at a time, in a browser, as asked.

| | What changed | Checks |
|---|---|---|
| **#1** | **Company / Business Name shows only on a Commercial account.** Switching back to Residential also clears it, so a name typed and then abandoned is not saved from behind a hidden field | 7/7 |
| **#2** | **Phone numbers punctuate themselves** on all five fields. `8165551234` becomes `(816) 555-1234` as it is typed — bracket at three digits, dash at seven. A leading 1 is kept as a country code. Anything with letters, a `+`, or more than ten digits is left exactly as written, because an extension or an international number is the person telling us something | 10/10 |
| **#4** | **The Lifecycle selector is gone** from both the create form and the profile editor. A record made from Prospects is a prospect, one made from Customers is a customer, and the way across stays the conversion after acceptance. The profile still *shows* what it is | 6/6 |
| **#5** | **"Notes" is "General Notes"** on the create form and the profile tab, as it already was on the Overview | 10/10 |
| **#6** | **The delete confirmation lost the typed name.** One plain question, the warning about what else goes, and two buttons. This reverses Phase 5, at Kyle's request | (same run) |
| **#3** | **Window & Property Details is gone** from both screens. Custom Fields, which the business defines, replace it. **The four columns stay on `customers`** so nothing already typed is lost — dropping them is its own announced change | 8/8 |

**41/41 across the six runs.** CRM suite **478/478**, typechecks clean. The
database was left with its two client-owned profiles and nothing of ours.

### Two things found along the way

- **Every field on the create form was nameless.** The `F` wrapper rendered a
  `<label>` as a *sibling* of the control, with no `htmlFor` — so screen readers
  had no name for any field, clicking a label focused nothing, and
  `getByLabel` could never find one. The control now sits inside its label.
  **This made a test falsely pass before it was fixed**: "0 fields found" is true
  whether or not the field is there.
- **The local dev server served stale code** from a previous session's process.
  The edit was correct, the file on disk was correct, and the browser showed the
  old behaviour. `curl http://localhost:5174/src/pages/<file>` shows what the
  server is really serving; kill the port and restart if it disagrees.

### Still open from Kyle's #1

He asked for "any other fields that are specifically relevant to a commercial
account". Only Company / Business Name was obvious, so only that moved. The form
also carries **Birthday**, **Salutation**, **Alt. Contact Name**, **County** and
**Subdivision** — ask him which, if any, belong to one account type.

---

## The plan from 2026-10-03 — Kyle's testing edits first, our own work after

Kyle tested on **2026-10-01** and sent `Requirements PDFs/Testing Edits 10.1.26.docx`
— 14 numbered items. **Agreed with the user: build Kyle's items first, then pick our
own parked work back up.**

**He tested the 2026-09-26 build.** Three commits were pushed but never republished,
so he has not seen them: `97695f9` payments, `3494c3e` the schedule prompt,
`bb42bc9` archive / channel pause / foreign keys — 41 files between them. Some of
his points may already be answered; re-read his list against the new build once it
is republished.

### Ours, parked until Kyle's items are done

| | Where it stands |
|---|---|
| **Republish** | **Does not wait for anything.** Three rounds are pushed and unseen, and Kyle keeps testing a stale build until it happens |
| **Drop `properties.gate_code` and `access_notes`** | **Done 2026-10-05.** Code removal, republish, then the drop, verified 9/9 against the deployed app |
| **A#9 — address a message to the contact that owns the channel** | Deliberately held for Phase 12b: it means making the sending path resolve recipients from contact channels, which is also what makes A#7's pause bite |
| **Phase 13 — sub-customers** | **Done in the working tree, 2026-10-05.** Not republished; see its own section |
| **Phase 14 — calendar** | Not started. The largest remaining piece |
| **Phase 15 — go-live** | Not started |
| **Phase 12b — email delivery** | Blocked on Lute: provider keys, plus an automation rule, a template, and the queue running |

### Kyle's 14 items, as phases

| Phase | Items | Size |
|---|---|---|
| **16 Profile screens** | #1 the form changes with Residential/Commercial · #2 phone numbers format themselves · #4 the Lifecycle selector goes · #5 "Notes" becomes "General Notes" everywhere, not only the Overview · #6 the delete confirmation loses the typed name · the rest of #3 — the old "Window & Property Details" section is still on two screens | M |
| **17 Quote statuses** | #10 Open · Pending – Sent Only · Pending – Sent and Viewed · Accepted · Declined · Closed, and the dashboard module with them | M |
| **18 Service catalogue and quote lines** | #8 no price, pricing type or unit in the catalogue; categories managed in place · #7 services only, no custom line item · #9 the service name is locked, with a description for that quote alone | **L** |
| **19 Quote settings** | #11 validity in days as a company setting · #13 terms and conditions the company writes, with no Corstead default | M |
| **20 Time** | #14 fifteen-minute increments and AM/PM everywhere | M |
| **21 Custom field search** | #3's new part — find prospects and customers by what is in their custom fields | M |

**Order: 16 → 17 → 18 → 19 → 20 → 21.** Sixteen is small, visible and low risk;
seventeen answers the grouping question we had open with him; eighteen is the
largest and changes how every quote and job is priced.

**Progress, 2026-10-05: 16 through 21 are all done** — each has its own section above,
each browser-verified, none republished yet. **Kyle's list is finished.**

All fourteen are built: #1, #2, #3, #4, #5, #6, #7, #8, #9, #10, #11, #12, #13 and #14.
#3 took two phases — Phase 16 replaced the old Window & Property Details section, and
Phase 21 made the fields searchable.

Phase 19 took #12 with it: the table above lists only #11 and #13 because #12 had been
recorded as already true, which was half right. See the Phase 19 section.

### Two of his items reverse or change what we built

- **#6 reverses Phase 5.** The typed-name confirmation was deliberate. He wants a
  plain "are you sure?" with Delete and Cancel, keeping the warning about what else
  goes.
- **#10 changes Phase 6 and the Phase 10 dashboard.** Draft → Open, Sent → Pending –
  Sent Only, Viewed → Pending – Sent and Viewed, Expired → Closed, and
  **"Accepted & Scheduled" is not on his list at all**.

### Already true, checked against the code on 2026-10-03

- **#12** — an expired link already dies: `publicEstimate()` returns null once
  `expiresAt` has passed, so the customer gets a 404 while the quote stays on the
  profile.
- **#5** — "General Notes" is on the Overview from Phase 7, but the Notes **tab**
  and the new-profile form still say "Notes".
- **#3** — custom fields exist from Phase 4, but `CustomerDetail.tsx:1573` and
  `Customers.tsx:582` still render the old "Window & Property Details" section
  beside them.

---

## Phases 8 and 9 — in progress, 2026-09-30

Two of the four pieces are built and verified. The rest is listed at the end with
why it is not done yet.

### The baseline corrected two things we both believed

1. **A#21 already works in the API.** Archiving a whole profile returns 200, the
   profile **stays searchable**, is **marked** `archived`, and **un-archives**.
   The 409 *"Promote another contact before archiving the only active primary"*
   fires only when archiving **one contact**, never a profile. An earlier reading
   of this file said archiving was blocked by that warning; it is not.
   *(My first baseline reported "not searchable while archived" — that was my own
   script reading the wrong key: the list responds under `customers`, not `data`.)*
   **What is actually missing is the button.** `CustomerDetail` offers only
   *Deactivate* (which sets `inactive`), and the status dropdown carries
   `<option value="archived" disabled>Archived — use Deactivate</option>`.

2. **Contact channels are not read by the sending path at all.** Only
   `routes/customers.ts` touches `contact_channels` outside their own routes;
   email goes out against `customers.email`. So A#7 and A#9 are really one job,
   and A#7's switch is recorded and shown today, with nothing yet consulting it.

### Built — Kyle A#7, a channel switched off for sending

`contact_channels` gains `sending_paused_at`, `sending_paused_by` and
`sending_paused_reason` (additive). `PATCH /contact-channels/:id` takes
`sendingPaused`, and the profile shows a **No sending** box on each channel row.

This is deliberately **not** archiving: the number stays on the profile to read and
to ring; Corstead simply stops writing to it. Pausing an already-paused channel
keeps the original time and reason; turning it back on clears all three.

`scratchpad/phase8-a7.mjs` **13/13**, headed.

A real UI fault was found and fixed on the way: the box was controlled but never
updated its own draft, so a click did not move it until the server answered.

### Built — Kyle A#21, archiving a whole profile

The API already did the work; the screen had no way to ask for it. `CustomerDetail`
now offers **Archive** beside Deactivate, sharing one dialog because both ask for a
reason and both are logged. The archive wording says what it means: the profile
stays searchable, is marked **Archived**, comes back at any time, and nothing is
deleted. Archive is hidden once a profile is archived, and **Reactivate** brings it
back. The status dropdown's disabled option now points at the button rather than at
Deactivate.

`prospectLifecycleTransition` also stopped calling both things the same: archiving
logs `archived`, deactivating logs `deactivated`. Nothing read the old literal.

`scratchpad/phase8-a21.mjs` **14/14**, headed.

### Built — Phase 9, the foreign keys

**Twelve foreign keys on eight tables that had none.** This is what has been
letting every orphan class we have swept up all session exist:

| | ON DELETE |
|---|---|
| `properties.customer_id`, `contacts.customer_id`, `contact_channels.customer_id`, `custom_field_values.customer_id`, `account_profile_settings.customer_id`, `property_account_relationships.customer_id` → `customers` | CASCADE |
| `property_account_relationships.property_id` → `properties` | CASCADE |
| `contact_channel_purposes.channel_id` → `contact_channels` | CASCADE |
| `custom_field_values.definition_id` → `custom_field_definitions` | CASCADE |
| `invoice_jobs.invoice_id` → `invoices`, `invoice_jobs.job_id` → `jobs` | CASCADE |
| `contact_channels.contact_id` → `contacts` | **SET NULL** — a channel may belong to the account rather than a person, and may outlive one |

**Nine orphaned `property_account_relationships` rows** (customers 10–20,
properties 2–10 — residue of the 2026-09-21 lifecycle test) had to be cleared
first, because the constraint refuses them.

All twelve are now **declared in the Drizzle schema** as well as on the database.
That matters: `drizzle-kit push` syncs the database to the schema, so an
undeclared constraint would be proposed for dropping on the next push.

`scratchpad/fk-proof.mjs` **6/6**, run inside a transaction and rolled back: a raw
`DELETE FROM customers` now leaves **nothing** behind, a row cannot be attached to
an owner that does not exist, and deleting a contact leaves its channel on the
account with no owner rather than destroying it.

### Correction — the "custom field" bug was mine, not the product's

This file recorded, after the Sandbox 2 verification, that *"deleting a custom
field leaves its dropdown choices behind"*. **That was my cleanup script, not
Corstead.** `DELETE /custom-fields/definitions/:id` **soft-deletes**
(`isActive: false`) and keeps the choices on purpose, so profiles already using the
field keep their values. My cleanup ran a raw
`DELETE FROM custom_field_definitions WHERE label LIKE 'ZZ%'`, which is what
orphaned them. No product path does that. The new `definition_id` foreign key now
makes even a raw delete tidy up after itself.

### Not done yet

| | Why |
|---|---|
| **A#9 — address a message to the contact that owns the channel** | The larger half. It means making the sending path resolve recipients from contact channels, which is also what would make A#7's pause bite. Worth doing **with** Phase 12b, when there is a provider that can actually deliver |
| **Dropping `properties.gate_code` and `access_notes`** | **Must wait for a republish.** The API deployed on Sandbox 2 still has both columns in its schema; dropping them first would break every property query it makes. Remove them from the code, deploy, *then* drop |

### Verified

API suite **619/633** (the same 14 `DATABASE_URL` failures), CRM **477/477**, all typechecks clean,
the database back to its one customer and untouched by the foreign-key proof.

---

## Phase 11 — the scheduling-notification prompt, done in the working tree 2026-09-30

This finishes the work parked on 2026-09-04 (see the PARKED section below, kept for
the investigation behind it). **Kyle's #4 of 2026-09-24 is now built**, which was
the last of his six answers still outstanding.

### What it does

- **Settings → Scheduling notifications**, a channel each for email and text,
  **both off** until somebody turns them on.
- With one on, moving a job **asks**: *"Tell the customer?"*, saying what changed
  and which channel it would use, and stating plainly that nothing has been sent.
- **Nothing is ever sent by the system.** The only path that queues a job schedule
  notification is `POST /jobs/:id/schedule-notification` with `send: true`.
- Saying **no is recorded too**, as `schedule_notification_declined`, so the
  history shows a decision was made rather than looking as though nothing happened.
- A change that leaves the schedule alone — crew, technician, status, notes —
  **asks nothing**, which is Kyle's crew-only rule.

### The pieces

| | |
|---|---|
| `lib/appointment-notification-core.ts` | Pure: `scheduleChangeKind`, `decideSchedulePrompt`, `promptSummary`, `scheduleEventFor`. 20 unit tests |
| `communication_notification_settings` | **New table**, additive, created by hand (75 → 76 tables). A singleton on `organization_key`, modelled on `communication_quiet_hours` beside it |
| `GET`/`PUT /communication-safety/notification-settings` | Behind the existing `communication.settings` capability — no new capability string |
| `POST /jobs/:id/schedule-notification` | The one confirmed path. Given `schedule.manage` **explicitly**, because the generic `/jobs` rule would have handed it to a field tech's `jobs.manage` |
| `ScheduleNotificationSettings.tsx` | The switch, in Settings |
| `ScheduleNotificationPrompt.tsx` | `askAboutSchedule()` plus a host mounted **once** in `Layout` |

### Three decisions worth knowing

1. **Time-only changes now ask.** The old trigger was `dateChanged` alone, so
   moving a 9am job to 2pm told nobody and asked nobody. It is a change to the
   time, which Kyle named explicitly.
2. **A date with no time still asks.** Kyle wrote "first scheduled with a date and
   time", but the system allows a date with no time (the dashboard shows "Time not
   set"). Waiting for a time would mean an office that never sets them is never
   asked at all.
3. **Taking a job off the calendar asks too.** It is a change to the date, and a
   customer expecting a visit that is no longer booked is the worse failure. The
   office can always say no.

### The prompt is mounted once, on purpose

Two traps recorded in the parked plan, both real:

- **Undo is a forward PATCH**, not a rollback (`MonthCalendar.tsx`), so a prompt
  hung off `useUpdateJob.onSuccess` fires again when the move is undone. `moveJob`
  now takes `ask`, and the undo action passes `false`.
- **`TOAST_LIMIT` is 1** and the undo toast holds that slot, so the prompt has to
  be a dialog.

A third found while building: the reschedule dialog on the Schedule page calls
`onClose()` the moment it saves, so a prompt owned by that component would unmount
before it could be answered. Hence one host near the root and a plain
`askAboutSchedule()` that any screen can call.

### What still does not ask

Four sites used to enqueue an appointment event with nobody looking. **All four
have stopped.** Two now ask; two simply never notify, which is the safe direction
until a prompt makes sense for them:

| Site | Now |
|---|---|
| `PATCH /jobs/:id` | Asks |
| `POST /jobs` (the create-path helper) | Silent; the job page asks on the next move |
| `POST /customers/with-initial-job` | Silent, no prompt yet |
| `POST /recurring-plans/:id/generate-job` | Silent, no prompt yet |
| `recurring-plan-engine` (overnight cron) | Silent — **there is no user to ask**, which is the question still open with the client from 2026-09-04 |

`POST /quotes/:id/convert-and-schedule` was never in scope: its appointment events
are for going to *give* an estimate, not for job scheduling.

### Still true about delivery

**There is no SMS provider anywhere in the platform.** The setting offers the
channel because Kyle asked for it, and the screen says outright that a text will be
recorded but will not arrive. Email waits on Lute's provider keys. Until then the
prompt, the decision and the audit trail all work; only the delivery does not.

### Verified

`scratchpad/phase11-api.mjs` **27/27** and `scratchpad/phase11-ui.mjs` **17/17**,
the second headed, both against the local build on the shared Development database.
Suites after: **CRM 477/477**, **API 619/633** (the same 14 `DATABASE_URL`
failures). All three typechecks clean. The database was returned to its one
customer, and **104 + 15 orphaned `communication_events`** left by earlier test
runs were cleaned out with it.

Two traps for the next session:

- **`lib/db` is a composite project.** Adding a table to `src/schema` is not
  enough: consumers read `dist/*.d.ts`, so `npx tsc -p lib/db/tsconfig.json` must
  run or the API will not see the new export.
- **A guard of the form `if (s.includes("SomeName")) return` in a patch script
  matches the name inside a comment or a hook you just inserted**, and silently
  skips the edit. Two imports went missing that way. Guard on the exact
  declaration, and check the outcome rather than the script's own message.

---

## Phase 12a — the payment methods Kyle named, done in the working tree 2026-09-28

Kyle, 2026-09-24 #3: *"Treat Gift Certificate as a normal invoice payment method,
not as a separate customer-credit system … Payment method options should include
at least: Cash, Credit Card, Check, and Gift Certificate."*

**The real problem was not the two missing methods.** A payment method was picked
in four places and **every list was different**:

| Where | What it offered |
|---|---|
| `Payments.tsx` record a payment | cash, check, bank_transfer, other |
| `InvoiceDetail.tsx` record against an invoice — **Kyle's step 08** | check, cash, ach, other |
| `Payments.tsx` refund | check, cash, bank_transfer, **card**, other |
| `FinancialReconciliation.tsx` filter | cash, check, **card**, ach |
| The API (`payment-core.ts`) accepted | cash, check, ach, bank_transfer, other, manual |

So `bank_transfer` could not be recorded from an invoice at all, and the
reconciliation filter searched for `card`, which nothing ever writes.

**One list now, in `payment-methods.ts` in each package**, because the two share no
runtime code; `crm/src/lib/payment-methods-agree.test.ts` reads the API's file and
fails if they drift. Kyle's four come first in his order, then the three already in
use, which stay so no existing payment becomes unreadable:

    Cash · Credit Card · Check · Gift Certificate · ACH · Bank transfer · Other

All four pickers now render that list, and every screen shows the label rather than
the stored value — "Gift Certificate", never `gift_certificate`. `manual`, written
only by the one-click Mark Paid action, is still accepted but never offered, and
reads as "Marked paid".

**No migration.** `payments.method` is free text and `payments.reference` already
exists, so a gift certificate needs no new column: its number goes in `reference`.
The reference field names itself from the method — "Check number", "Certificate
number", and for a card **"Authorisation or receipt number"**, never anything that
would invite a card number (Kyle's #6). There is a test asserting exactly that.

### Decisions taken without Kyle, stated so they can be corrected

He was asked on 2026-09-28 and has not answered. Nothing here is hard to change:

1. **Credit Card records that a card was used**; Corstead does not take the payment
   and holds no card details. No processor is wired in — he has mentioned Square,
   Stripe is what is installed, and neither has been chosen.
2. **A gift certificate's number goes in the existing reference field.**
3. **Nothing is tracked beyond what the certificate paid.** He said it is a payment
   method, not a customer-credit system, so a certificate worth more than the
   invoice leaves no balance behind. Verified: no `customer_credit_sources` row is
   created.
4. **ACH, Bank transfer and Other stay.** He said "at least" those four.

### Verified

`scratchpad/phase12a-payments.mjs` **17/17**, headed, walking Kyle's step 08: record
a gift certificate against an invoice, check it is stored with its number, that it
clears the invoice like any other payment, that an invoice can be part-paid by card
and part by certificate, and that a method not on the list is refused (400).

Suites after: **CRM 466/466**, **API 590/604** (the same 14 `DATABASE_URL`
failures). Both typechecks clean. The database was returned to its one customer.

One existing test had to change: `payments-ui.test.ts` asserted the literal
`<option value="cash">Cash</option>`, which no longer exists now the options are
rendered from the list. It now asserts the opposite — that no method is written by
hand in either payment form.

### Traps this phase walked into

- **`npm test` did not run the new tests, and said nothing.** The registration
  anchor `src/lib/payment-core.test.ts` appears in **two** scripts in
  `api-server/package.json`, and the replacement landed in `test:customer-hub`
  rather than `test`. **Check the test count moved** after registering a file:
  595 → 604 here. Editing the parsed JSON by key is safer than a string replace.
- An invoice created from a job with no `totalAmount` has a **zero balance**, and
  `InvoiceDetail` hides the payment form when the balance is zero.
- The payment form on an invoice is behind a **"Record payment"** toggle, and its
  controls carry `aria-label="Payment method"` and `"Payment amount"`.
- Recorded payments are listed under the **Transactions** tab of `/payments`, not
  on the tab it opens on.

### Still open

Kyle's four answers above, and the choice of Square or Stripe before any real card
processing. Neither blocks his testing: every method can be recorded today.

---

## Phase 10 — Estimate → job, done in the working tree 2026-09-26

**Most of the conversion already existed.** `POST /quotes/:id/convert-and-schedule`
and `GET /quotes/:id/conversion-preview` were built and live, with
`EstimateConversionDialog` wired into the estimate page: acceptance gate,
prospect → customer, the lead marked won, one job per location, idempotency, crew
and property locking. A baseline run (`scratchpad/phase10-baseline.mjs`) proved it
converts. So A#17, A#18 and A#19 were **already satisfied** — the plan row
overstated the work.

What was genuinely missing was the two things Kyle answered on 2026-09-24.

### #1 Partial acceptance

`src/lib/estimate-acceptance.ts` — `acceptedSnapshotFor(snapshot, ids)` narrows the
accepted snapshot to the ticked lines, re-totals it, and **drops any location that
lost all of its services**, because `buildLocationJobPlans` refuses a location with
nothing to do. `ids` of `null` means the whole estimate, which is what every
acceptance before this meant. 14 unit tests.

Everything downstream needed no change: the conversion already reads
`acceptedLink.acceptedSnapshot` first, so the job's services and its total follow
the customer's choice without knowing a choice was made. Verified: a 3-service,
$540 estimate accepted as 2 services became a **$390 job for those two only**.

- `POST /public/estimates/:token/decision` takes `acceptedLineItemIds`, rejects an
  empty list and an id that is not on the estimate (400), and records the accepted
  and declined ids on the activity row and the `quote.accepted` event.
- `publicEstimate()` now keeps **offered** and **accepted** apart, so the customer's
  page can still show what they turned down. The public GET returns
  `acceptedLineItemIds`.
- `GET /quotes/:id/conversion-preview` now previews the **accepted** snapshot and
  adds `declinedLineItems`, so the office cannot schedule a service the customer
  refused.
- `PublicEstimate.tsx` — a checkbox to the left of every line, ticked lines tinted
  with an emerald left bar, a live selected total against the struck-through full
  price, a button that reads "Accept 2 of 3 services", Accept disabled with an
  explanation when nothing is ticked, and — after the decision — the lines locked,
  the declined ones dimmed and marked NOT ACCEPTED.

### #2 Telling the office

`src/lib/estimate-dashboard.ts` maps the derived statuses onto Kyle's six
groupings, and `GET /dashboard/estimate-status` returns the counts plus the
office's queue. `EstimateStatusModule.tsx` renders it at the top of the dashboard,
above the financial reporting and **outside its gate**, so a `sales` role sees the
queue without seeing invoices or payments.

**The mapping is our reading and is still to be confirmed with Kyle:**

| Grouping | Statuses |
|---|---|
| Open | `draft`, `scheduled` — written, not yet with the customer |
| Pending | `sent`, `viewed` — with the customer, waiting |
| Accepted | `accepted` — **the office's queue** |
| Accepted & Scheduled | `accepted_scheduled` |
| Declined | `declined` |
| Closed | `expired` |

`src/lib/estimate-accepted-notice.ts` builds the office email: the subject says
"Q-1042 accepted by Jane Doe — 1 of 2 services, $300.00", the body lists what was
accepted **and what was not**, and it states plainly that nothing has been
scheduled and no job created. Names and service descriptions are HTML-escaped. It
is sent after the decision commits and never awaited, and the attempt is written to
`estimate_activities` as `office_notified` / `office_notification_failed`.

**New configuration:** `OFFICE_EMAIL_ADDRESS` (falls back to `EMAIL_FROM_ADDRESS`),
and `PUBLIC_APP_URL` for the link in the email. There is no company settings store
yet; when Phase 11 builds Settings this moves there. Lute offered
**`info@corstead.us`** on 2026-09-25 — that is the address this expects.

### Email, corrected

An earlier note in this file said estimate emails cannot send because the deliver
route never calls the email library. **That was half right and the conclusion was
wrong.** The route does not call it directly, but it enqueues a `quote.sent`
communication event, and a full chain exists: event → `communication-dispatcher` →
`createCampaignWithTransaction` → `scheduler` → `campaign-processor` →
`lib/email.ts`. What actually stops it is different, and all three parts are
needed:

1. **No provider** — `detectProvider()` falls through to `mock`, which logs and
   reports success. Lute's keys fix this.
2. **No rule and no template** — `automation_rules` 0 rows, `email_templates` 0
   rows. The dispatcher works off rules, so a `quote.sent` event matches nothing.
   These are built from the CRM's own Automations and Communications screens.
3. **The queue is not running** — all 56 `communication_events` sit `pending`.

The office acceptance notice added here does **not** go through that chain; it
calls `sendEmailTo` directly, so it starts working the moment a provider is
configured, with no rule or template needed.

### Removed

The three "Approve & Convert to Job" buttons in `QuoteDetail.tsx` and their
mutation called `POST /quotes/:id/convert`, which has answered 409 since
conversion was deferred, and were hidden behind `const canConvert = false`. They
and the dead Reject button beside them are gone, along with five imports that
nothing used. Conversion happens through `EstimateConversionDialog`, which
schedules the work at the same time.

### Verified

`scratchpad/phase10-partial.mjs` **17/17** and `scratchpad/phase10-dashboard.mjs`
**24/24**, both headed, against the local build on the shared Development database,
signed in as `team_admin` and `team_tech` with a guest browser for the customer.
Suites after: **CRM 460/460**, **API 581/595** (the same 14 `DATABASE_URL`
failures as before). Both typechecks clean. The database was returned to its one
customer.

Three test faults worth knowing, none of them product faults:

- **The dashboard is `/`, not `/dashboard`** — there is no `/dashboard` route in
  the SPA.
- **Chrome's `innerText` applies `text-transform`**, so a heading styled
  `uppercase` reads back as "ACCEPTED & SCHEDULED". Compare case-insensitively.
- **Playwright leaves the pointer where it last clicked**, so a row's `hover:`
  background makes an unselected row look selected. Read the selection bar
  (`borderLeftColor`), not the background.

### Still open from this phase

- Kyle must confirm the six-grouping mapping above — asked 2026-09-25, unanswered.
- The email cannot actually leave until Lute supplies provider keys.
- `estimate_activities` rows orphaned by earlier sessions (ids 1–5,
  `appointment_scheduled`, quotes 2–6) were cleaned up by hand. The purge itself is
  correct: this phase's own `office_notified` rows were removed with their
  customers.

---


## Work plan — profiles and the lifecycle, agreed 2026-09-22

Sequenced around Kyle's nine-step lifecycle test, not around the order of the edit lists.
Item numbers: `A#` = `Requirements PDFs/Prospect Profile Notes.pdf`, `B#` =
`Requirements PDFs/Random Edits.pdf`. Text of both extracted with pdf.js into
`scratchpad/pdfjs/*.txt`; the Read tool cannot render them on this machine (no poppler).

**Rules — one shared database.** The user decided on 2026-09-22 against a separate Neon `dev`
branch: local, the Replit workspace and Sandbox 2 all use `Development`, so local work lands
where Kyle tests. Therefore:

1. Test records are named `ZZ…` and removed at the end of every run
2. **Additive migrations only** before a deploy — new tables, nullable columns, indexes,
   foreign keys. Nothing that drops or renames what the deployed Sandbox 2 code reads; that
   waits until the new code is live
3. Tell the user before any migration runs, because it takes effect in Kyle's environment
   immediately
4. Local API keeps `APP_MIGRATION_ENVIRONMENT=sandbox` with migrations and background workers off

Where the table below says "`dev` branch", read "an additive migration against `Development`,
announced first".

| Phase | Scope | Kyle's step | Needs | Size |
|---|---|---|---|---|
| **0 Setup** | Neon `dev` branch off `development` (user); local on `dev`; migration gate configured for local; commit the 2026-09-21 fixes; orphan-property SQL on `development` | — | User | S |
| **1 Profile form** | A#1 Residential/Commercial first; A#4 Customer Since set on creation and read-only; A#5 remove Preferred Contact; A#6 remove Sending Preferences (screen only — the communication-safety logic behind it stays); A#12 remove Has Screens / Hard Water / Has Tracks; A#13 remove Windows / Stories / Type | 01 | — | S |
| **2 Services and quotes from the profile** | A#22 add services from the profile and the job form, new ones join the Service Catalog; A#16 new quote from the profile's Quotes tab; A#15 schedule the estimate while creating the profile | 02–03 | — | M |
| ⤷ **Deploy** | Kyle can run steps 01–03. Sandbox 2 needs at least one catalogue service | | | |
| **3 Contacts and locations** | A#8 a name on every phone and email; A#10 main + additional service addresses; A#14 customisable dropdown lists | 01 | — | M |
| **3b Sensitive fields** | Gate Code and Access Notes removed as built-in fields everywhere, crew view included (Kyle 2026-09-23 #2) | 01, 06 | — | S |
| ⤷ **Deploy** | **Owed now.** Sandbox 2 still runs pre-Phase-1 code | | | |

### Re-ordered after Kyle's answers — 2026-09-24

Kyle's #7: *"Get the Prospect and Customer profiles working first, then move to the remaining
calendar work."* Everything below follows that. Phases 1–3b above are done in the working tree.

| Phase | Scope | Kyle's step | Needs | Size |
|---|---|---|---|---|
| **4 Custom fields** | A#2, A#3 with the types he named: text, number, date, dropdown, checkbox. Created and named from the profile; dropdown choices managed by the user. Replaces the old Window & Property Details section | 01 | Additive migration for dropdown choices | M |
| **5 Delete** | A#20 as answered: a profile deletes permanently with everything attached — jobs, estimates, invoices, payments, notes, history. Individual jobs and estimates delete from their profile sections. **Reverses** the 2026-09-22 `customer_has_history` guard, and relaxes `completed_job` / `invoice_linked_job` on this path. Irreversible, so: capability, typed confirmation, audit row | — | — | M |
| **6 Estimate statuses** | B#4 Draft, Sent, Viewed, Accepted, Declined, Expired. Automatic on send, open, accept, decline and expiry; an authorised manual correction is recorded in activity history. Shown in the list, on the estimate, and wherever it appears in scheduling | 03–04 | Possibly a status column constraint | M |
| **7 Communication & Activity** | B#5 one tab on both profile types: every email and text sent from Corstead with date, type, recipient, subject/preview, the related estimate/job/invoice, who sent it and delivery status; newest first; filters for All / Email / Text / Profile changes. B#6 audit history in the same tab, plus Created by/on and Last updated by/on on Overview. B#3 General Notes card on Overview with who and when | 09 | Migration only if who/when columns are missing | M–L |
| ⤷ **Deploy** | **The profiles are "working" in Kyle's sense.** He can test profile basics end to end | | | |
| **8 Profile housekeeping** | A#21 archive a whole profile without the primary-contact warning; archived profiles stay searchable, are marked, and can be unarchived. A#7 deactivate an email or number for email/text while keeping it on file. A#9 address a message to the contact that owns the channel | — | — | M |
| **9 Data integrity** | Foreign keys on every customer-owned table that lacks one — `properties`, `contacts`, `property_account_relationships`, `contact_channels`, `contact_channel_purposes`, `custom_field_values`, `account_profile_settings` — and on `invoice_jobs`. Replaces the route-level cleanup. **Then** drop `properties.gate_code` and `access_notes`, which is destructive and must follow the deploy above | — | Migration, announced first | S–M |
| **10 Estimate → job** | Accepted-estimate scheduling and **Convert to Customer & Job** (A#17), re-enabling the deferred convert; A#18 no job straight from a prospect; A#19 converted accounts leave the Prospects database; the office is told when an estimate is accepted | 04–05 | Answers: partial acceptance shape, how the office is told | L |
| **11 Crew and schedule changes** | Notify-before-send prompt; pricing visibility as an Admin-set permission (Kyle confirmed the rule) | 06 | Answer: does cancelling or changing crew also prompt? | M |
| **12 Billing** | Gift certificate against an invoice; a delivery provider so estimates and invoices actually leave | 07–08 | Answer: credits or separate. Provider keys from Lute | S–M |
| **13 Sub-customers** | B#1 as answered: linking only — any profile beneath a main profile, residential or commercial, one or many. **No bill-to-parent, no combined invoices.** Kyle: may come later, must not delay the basics | — | — | M |
| **14 Calendar** | The remaining spec work Kyle deferred until profiles are done: Step 3 filters and job side drawer, Step 4 move a whole day, Step 5 bulk invoicing | — | — | L |
| **15 Go-live** | Production path in the migration gate; schema on the `production` branch; nightly `pg_dump` export; prove a restore; Neon ownership to Lute; rotate the password | — | — | M |
| **Blocked** | A#11/B#2 address autocomplete — **Lute** owns the account, billing and cost check. Square vs Stripe before any payment work | — | Lute / Kyle | — |

### Kyle answered the four lifecycle questions — 2026-09-24

`Requirements PDFs/Kyle Answers - Lifecycle Questions 2026-09-24.txt`. **Nothing is waiting on
Kyle now**; only address autocomplete still waits on Lute.

| # | Question | Kyle's answer |
|---|---|---|
| 1 | Partial acceptance | **Per line item.** Every service is its own priced line, on the estimate and on the job. The customer-facing estimate puts a **checkbox on the left of each line**; ticked lines are highlighted. Acceptance is at line level, **not** a separate add-ons section. The job is built from the lines the customer actually accepted |
| 2 | How the office is told | **Both**: a dashboard notification and an email to the company's main office email. Plus an **Estimate Status module** on the dashboard grouped as Open, Pending, Accepted, Accepted & Scheduled, Declined, Closed, with accepted-and-unscheduled highlighted at the top and a count — *"3 estimates need to be scheduled."* Still no automatic conversion or scheduling |
| 3 | Gift certificates | **Just a payment method**, not the credits module. The method list needs at least Cash, Credit Card, Check, Gift Certificate |
| 4 | Schedule-change prompt | **Optional, with a Settings switch.** When on: prompt when a job is first given a date and time, and whenever the date or time changes. The prompt asks whether to send. Nothing is ever sent automatically by scheduling, dragging, moving or editing. **A crew-only change does not prompt** |
| 5 | Custom field types | Repeats his 2026-09-23 answer — text, number, date, dropdown, checkbox, user-named, user-managed choices. **Matches Phase 4 as built** |
| 6 | Gate Code / Access Notes | Repeats it — gone entirely, crew view included. **Matches Phase 3b as built** |

He closes: *"Keep development centered on completing the customer lifecycle path first."*

**What this changes**

1. **Phase 10 grew.** Partial acceptance means per-line selection on the public estimate, the
   accepted set stored with the decision (`estimate_public_links.accepted_snapshot` already
   exists), and conversion building the job from accepted lines only
2. **A dashboard Estimate Status module is new work**, and the six groupings are his words, not
   our statuses. Proposed mapping, to confirm with him: Open = draft and scheduled;
   Pending = sent and viewed; Accepted; Accepted & Scheduled; Declined; Closed = expired
3. **An office email address setting** is needed for the acceptance email
4. **Phase 11 gains a Settings switch** for scheduling notifications, and crew-only changes are
   explicitly excluded
5. **Phase 12 shrank**: gift certificate is one more entry in the payment-method list, which
   currently offers Cash, Check, Bank transfer, Other — Credit Card is missing from it too

### Kyle answered the seven profile questions — 2026-09-23

`Requirements PDFs/Kyle Answers - Profile Questions 2026-09-23.pdf` (text extracted alongside
it). It answers all seven; the four raised by the lifecycle-testing document are still open.

| # | Question | Kyle's answer |
|---|---|---|
| 1 | Video walkthrough items in scope? | **No, not this phase.** Credit cards wanted eventually, "probably through Square", processor not chosen. Surveys and printed letters later. **He asks us to clarify what we meant by "Square cards", callbacks and reviews** |
| 2 | Gate Code / Access Notes | **Remove entirely as built-in fields** — the property form *and* their display on assigned jobs. Corstead must not prompt anyone to store gate codes or card details; a company that wants it can make its own custom field. Liability is the reason |
| 3 | Delete | **Full delete, including profiles with jobs and invoices.** Deleting a profile permanently erases everything belonging to it — jobs, estimates, invoices, payments, notes, history. Deletion, not archiving. Individual jobs and estimates must also be deletable from their sections on the profile |
| 4 | Address autocomplete account | **Lute decides** the account and billing; check the cost before committing. Still wanted |
| 5 | Sub-customers | **Linking only.** Any profile can sit beneath a main profile, residential or commercial, one or many. **No "bill to parent", no combined invoices** — linking changes nothing about billing. Can come later; must not delay the basics |
| 6 | Custom field types | **text, number, date, dropdown, checkbox.** Created and named from the profile; for dropdowns the user manages the choices |
| 7 | Priority | **Profiles first, then the remaining calendar work.** Finish and surface what already exists: named contacts with several phones and emails, billing/estimate contact purposes, multiple service addresses with a main one, customisable dropdowns, the service catalog, the Communication & Activity tab, estimate statuses |

**What this changes in the plan**

1. **A#13 is now bigger, not smaller.** Gate Code and Access Notes come out of the crew's job
   view as well. They appear in `field-tech-scope.ts` (`OPERATIONAL_PROPERTY_FIELDS`),
   `routes/properties.ts`, `routes/customers.ts`, `CustomerDetail.tsx`, `Properties.tsx`,
   `ProfileDetailsTab.tsx` and `seed-demo.ts`. Dropping the columns is destructive, so it waits
   until the new code is deployed
2. **The delete policy of 2026-09-22 is reversed.** The 409 `customer_has_history` guard has to
   go, replaced by a permanent cascading delete behind a clear confirmation, plus per-job and
   per-estimate delete on the profile. That also means relaxing "Completed jobs cannot be
   deleted" and `invoice_linked_job` for this path. Being irreversible, it needs a capability,
   a typed confirmation and an audit entry
3. **Custom fields (A#2, A#3) are unblocked.** `custom_field_definitions.fieldType` already
   exists and accepts text/multiline/number/date/boolean; **dropdown and its choices do not
   exist** and need an additive migration, plus a UI to create a field from the profile
4. **Sub-customers shrank** to profile linking, and stay late in the order
5. **Phase 8 (Communication & Activity) and estimate statuses move earlier** — they are on
   Kyle's "finish these" list for the profile workflow

**Done from these answers (2026-09-24, working tree, not deployed):** Gate Code and Access Notes
are out of both property forms, both property displays, the locations card, the property and
customer API payloads, and `OPERATIONAL_PROPERTY_FIELDS` — so they no longer reach a crew's job
either. The columns still exist; dropping them is destructive and waits until this code is live.
`profile-form-edits.test.ts` now asserts their absence instead of their presence. CRM 402/402,
API 519/533 with the known 14.

**Flag for later:** the system has Stripe; Kyle is thinking about Square. Not urgent, but the
processor question should be settled before any payment work.

### Phase 4 — custom fields, done in the working tree 2026-09-24

Verified in a real browser against the local build (10/10), walked as the operator the way
Kyle's lifecycle document asks. CRM 410/410, API 525/539 with the known 14. **No migration.**

- The five types Kyle named are offered when creating a field: Text, Number, Date, Dropdown,
  Checkbox. `checkbox` is the existing `boolean`; `multiline` stays for fields already using it
- A field is created and named **from the profile**, and appears on every prospect and customer
- Each value is entered the way its type should be: number input, date picker, checkbox, select
- **A dropdown's choices live in `profile_catalog_items`**, the table that already holds every
  other profile dropdown's options, under a catalogue of its own per field
  (`custom_field_<definitionId>`, served by the existing `/catalogs/:type` routes through the
  slug `custom-field-<id>`). That reuses the add / remove / re-add behaviour built in Phase 3
  **and avoids a schema change entirely** — the alternative was a new table or column, which on
  the shared database would have meant a migration in Kyle's environment
- Creating a dropdown opens its choices immediately, so the field is never left unusable
- A value that is no longer one of the choices is still shown, so history is not silently lost
- Add and remove need `custom_fields.manage` (owner / super_admin). Removing a field deactivates
  the definition; values already entered are kept

New: `api-server/src/lib/custom-field-types.ts` (+6 tests),
`crm/src/components/custom-fields.test.ts` (8). `CatalogManager` now takes a slug and title, so
the same dialog serves profile dropdowns and custom-field choices.

### Phase 5 — deletion, done in the working tree 2026-09-24

Verified in a real browser against the local build (10/10) on a profile carrying an estimate, a
job, an invoice, a payment and notes. CRM 418/418, API 538/552 with the known 14. No migration.

- **A profile deletes permanently, with everything on it.** The 2026-09-22 `customer_has_history`
  guard is gone, as Kyle asked. The order lives in `lib/customer-purge.ts` — 40 tables, children
  before parents — because almost nothing has a foreign key to `customers`
- **The transaction refuses to commit if a table was missed.** After the deletes it counts what
  still points at the profile; anything above zero throws and rolls back
- **It cannot happen by accident.** The API refuses without `?confirm=delete-everything`, and the
  dialog counts what will go and requires the profile's name to be typed
- **The deletion is recorded.** The audit row is written after the profile's own history is
  erased, so it survives: *"ZZPhaseFive Delete deleted permanently, with 1 jobs, 1 estimates,
  1 invoices, 1 payments — by Team Admin"*
- **Single jobs and estimates delete from their own sections.** A job takes its calendar entry
  with it; an estimate takes its revisions, public links, appointments, locations and activities,
  and a job that came from it keeps its own record, pointing at nothing

Two judgement calls, both worth confirming with Kyle:

1. **A job billed on an invoice still cannot be deleted on its own** (`invoice_linked_job`), since
   deleting it would corrupt the invoice. The message now says to delete the invoice first, or
   the whole profile. The completed-job guard is gone
2. **An accepted estimate can now be deleted**; the old `estimate_locked` refusal is gone

Two bugs found and fixed on the way:

- `DELETE /quotes/:id` removed the quote and its line items only, orphaning revisions, public
  links, appointments, locations and activities
- `DELETE /jobs/:id` left the job's `schedule_entries` row behind, so the calendar kept it

New: `api-server/src/lib/customer-purge.ts` (+9 tests), rewritten
`api-server/src/routes/customer-delete-cleanup.test.ts` (7),
`crm/src/pages/profile-delete.test.ts` (8). `scratchpad/validate-purge.mjs` plans every statement
against the live schema — it caught `estimate_line_metadata`, which has no `quote_id`.

### Phase 6 — estimate statuses, done in the working tree 2026-09-24

Verified in a real browser against the local build, **24 checks covering every status and the
edge cases around them**. CRM 426/426, API 544/558 with the known 14. No migration.

Kyle's V1 set (Random Edits #4) now exists end to end: **Draft, Sent, Viewed, Accepted,
Declined, Expired**, plus the finer *Scheduled* and *Accepted & Scheduled* the system already drew.

- **The status is derived, not stored.** `deriveEstimateStatus` reads what actually happened —
  sent, opened, decided, expired — so it cannot drift from the facts. **Expired needs no cron**:
  an undecided estimate past its link's date simply reads as expired
- **One value on every screen.** The list, the profile's Quotes tab and the estimate page all
  show the same `displayStatus`; a new `lib/estimate-status-batch.ts` derives a whole page in
  four set-based reads rather than a query per row
- **The list's filters were the old column's words** — Approved, Rejected. They are now Kyle's
  statuses, and the counters and colouring follow the derived status too
- **An authorised employee may correct a status**, and the correction is written to the activity
  history with the old and new value and any reason given
- **Acceptance is never typed in.** The correctable set is draft, sent, viewed, declined,
  expired; the API refuses `accepted` (400), and refuses any correction at all once the customer
  has accepted (409). A field tech is refused (403)

Checked in the browser, each as it happens in real use: a new estimate is Draft; with an
appointment it is Scheduled; finalizing and sending makes it Sent; the customer opening the link
makes it Viewed; accepting makes it Accepted; declining another makes it Declined; pushing the
link's date into the past makes a third Expired. Then: the correction dialog offers only the
correctable statuses, the correction sticks and is audited, `accepted` and nonsense statuses are
refused, a missing estimate is a 404, a field tech gets 403, and the list and profile agree.

New: `api-server/src/lib/estimate-status-batch.ts` (+6 tests), 6 more cases in
`estimate-lifecycle.test.ts`, `crm/src/lib/estimate-status.ts`,
`crm/src/pages/estimate-status-ui.test.ts` (8).

### Phase 7 — Communication & Activity, done in the working tree 2026-09-24

Verified in a real browser (15/15) on a profile given a real history: created, notes written, an
estimate finalized and emailed, a status corrected. CRM 446/446, API 544/558 with the known 14.
No migration.

- **B#5 — one tab.** "Communications" and "Activity" were two separate tabs; they are now one
  **Communication & Activity**, newest first, with the four filters Kyle named: All activity,
  Email, Text, Profile changes. Each item says what it was, to whom, its delivery state, and
  links to the estimate, job or invoice it belongs to. The merge and the filters live in
  `crm/src/lib/activity-feed.ts`, so they are tested without a browser
- **B#6 — the audit.** Profile changes appear in the same tab with the old and new value and who
  made the change. The tab writes nothing and says so: *"History is recorded automatically and
  cannot be edited here."* The Overview carries **Created by / Created on / Last updated by /
  Last updated on**, read from the recorded history rather than from new columns
- **B#3 — General Notes on the Overview**, editable in place, with *"Last updated by … on …"*
  under it, and a line saying job, estimate and location notes stay with their own records

**Gap found and fixed:** an estimate emailed to a customer is recorded in
`estimate_delivery_requests`, not in `message_logs`, so **no estimate that went out appeared in
the profile's communications at all**. The profile payload now includes deliveries, mapped into
the same shape (negative ids, so they cannot collide with message logs) and masked the same way.

New: `crm/src/lib/activity-feed.ts` (+12 tests), `crm/src/pages/communication-activity-ui.test.ts` (8).

### Phase 1 — done in the working tree, 2026-09-22

Verified in a real browser against the local build (13/13) and by tests; **not deployed**.

- **A#1** the new-account form opens with a Residential / Commercial choice, above Contact Information
- **A#4** Customer Since is set by the server — the day an account is created as a customer, or
  the day a prospect first becomes one — and is never moved afterwards. Any client-supplied
  `customerDate` is dropped on create and on edit. The profile shows it read-only. New
  `lib/customer-since.ts`, used by `POST`, `PATCH` and `POST …/status` in `routes/customers.ts`.
  This also covers conversion through `/customers/:id/status`, which previously set no date at all
- **A#5, A#6** Preferred Contact and Sending Preferences removed from both forms. The columns and
  the communication-safety rules that read them are untouched
- **A#12, A#13 (partial)** Has Screens / Hard Water / Has Tracks, Type, Windows and Stories removed
  from both property forms (`CustomerDetail.tsx` and `Properties.tsx`). Their values still ride
  along in form state, so editing an older property does not wipe what it has. Gate Code and
  Access Notes stay until Kyle answers

Tests: `api-server/src/lib/customer-since.test.ts` (8), `crm/src/pages/profile-form-edits.test.ts` (7).
Suites: API 510/524 with the known 14 `DATABASE_URL` failures; CRM 386/386.

### Phase 2 — done in the working tree, 2026-09-22

Verified in a real browser against the local build (11/11) and by tests; **not deployed**. CRM
395/395. No server change and no schema change.

- **A#22** New `components/QuickAddService.tsx` adds a service to the company-wide Service
  Catalog from the estimate's service picker and from the job form, and puts it straight onto
  the estimate line or the job (price filled in). An empty catalogue opens the picker on the
  quick-add. Offered only with `services.manage`; others are told to ask an admin. It is not a
  `<form>`, because the job form contains it. The request body is built by the new
  `serviceDraftToBody()` in `lib/service-form.ts`, which the Service Catalog page now uses too,
  so both store a service identically
- **A#16** The profile's New Estimate was hidden for prospects (`lifecycleStatus ===
  "customer"` only) — the account type that needs it most. Now offered to prospects and
  customers, in the header and inside the Quotes tab
- **A#15** The New Prospect form has "Schedule the estimate next", ticked by default. Saving
  goes straight to that prospect's new estimate with the appointment date focused. The
  appointment is not embedded in the prospect form because on the server an appointment only
  exists on an estimate (`POST /quotes/with-appointment`); duplicating that logic in the dialog
  would also lose atomicity. **Confirm with Kyle this is what he meant**

**Interpretation to confirm with Kyle (A#22):** "add and delete services from the prospect or
customer screen" was read as: add new catalogue services wherever services are chosen, and
remove them from an estimate or job as lines. There is no per-customer service list in the
data model, and none was added.

Tests: `crm/src/pages/profile-services-quotes.test.ts` (7), two new cases in
`crm/src/lib/service-form.test.ts`.

### Phase 3 — done in the working tree, 2026-09-22

Verified in a real browser against the local build (11/11) and by tests; **not deployed**. CRM
402/402, API 519/533 with the known 14. No schema change.

The audit came first, and most of Phase 3 already existed:

- **A#10 was already built** — the Properties tab adds any number of service addresses, one
  marked default. Verified with a second address; nothing changed. The UI says "Default
  property" / "Primary" where Kyle says "Main Service Address"; wording left alone unless he asks
- **A#8 was half built** — every channel could already belong to a named contact, but naming
  someone new meant leaving for the Contacts tab first. The channel form now offers
  "+ New person…": first and last name, the contact is created, then the channel is attached to
  them. A failed channel save does not create the person twice on retry
- **A#14 had the API but no UI** — each of the four Profile Details dropdowns now has "Manage
  options" (with `catalogs.manage`): add, remove, and for payment terms the days until due

Bugs found on the way, all fixed:

1. **Re-adding a removed dropdown option failed.** Remove only deactivates, and
   `(catalog_type, code)` is unique, so re-adding hit the index and returned the raw
   "duplicate key" text. `POST /catalogs/:type` now brings the old row back, and refuses an
   option that is already active with `"X" is already an option`. New `lib/catalog-options.ts`
2. **Profile Details never refreshed the profile it sits on.** It invalidated `["customer", id]`
   while the page caches under `["auth-scope", fingerprint, "customer", id]`. Now uses
   `authScopedQueryKey`
3. **Its `apiFetch` parsed every response as JSON**, so any 204 (a catalogue DELETE) reported an
   error after succeeding. It also showed errors as raw JSON; it now shows the message
4. **Customer delete still orphaned Profile Details data** — `contact_channels` (and their
   purposes), `custom_field_values` and `account_profile_settings` carry no foreign key either.
   The delete now clears them too. `routes/customer-delete-cleanup.test.ts` guards the list

Tests: `api-server/src/lib/catalog-options.test.ts` (6),
`api-server/src/routes/customer-delete-cleanup.test.ts` (3),
`crm/src/components/profile-details-phase3.test.ts` (7).

**Found on the way — fixed:** `index.ts` ignored the error Express 5 passes to the `listen`
callback, so a failed bind logged "Server listening" and exited with code 0. It now aborts with
the real error and exit code 1.

After this: calendar Steps 3–5 (filters and side drawer, move a whole day, bulk invoicing).
Go-live track, separately: production path in the migration gate, production schema, nightly
export, restore test, Neon ownership to Lute, password rotation.

---

## We ran Kyle's own lifecycle test against Sandbox 2 — 2026-09-21

Kyle's `Requirements PDFs/Customer Lifecycle Testing - General.pdf` is his nine-step
acceptance script. We walked all nine steps in a real browser against
`https://sandbox-2-data-free-corsteadllc.replit.app` as `team_admin` and `team_tech`, before
he does. Script: `scratchpad/lifecycle.mjs`. Result: **23 checks passed, 5 gaps, 7 failures.**

All test data was removed afterwards; the sandbox is back to its single original prospect.
**Except** seven orphaned `properties` rows (ids 2–8) — see the data-integrity findings below.

### Blockers — Kyle's test cannot complete today

| # | Finding | Evidence |
|---|---|---|
| 1 | ~~**The Service Catalog is empty (0 rows in `services`).** Finalizing an estimate requires at least one catalogue service, so steps 03–05 cannot start at all~~ **Wrong — corrected 2026-09-24.** `POST /quotes/:id/finalize` takes the lines to finalize **in the request body**; it does not read them from the estimate. The 400 came from our own script sending `{}`. The UI sends the estimate's own line items, so finalizing works with an empty catalogue. An empty catalogue is still friction — there is nothing to pick from — but it blocks nothing | `POST /quotes/:id/finalize` → 400 `At least one service is required` when `lineItems` is absent |
| 2 | **Estimate → job conversion is disabled in code**, deliberately, with the implementation commented out awaiting "accepted-estimate scheduling". Both routes refuse | [`routes/quotes.ts:811`](artifacts/api-server/src/routes/quotes.ts) and [`routes/jobs.ts:548`](artifacts/api-server/src/routes/jobs.ts) → 409 `estimate_conversion_deferred` |
| 3 | **No delivery provider is configured in the sandbox.** Estimate emails and texts are recorded as `provider_unconfigured` and never leave. The public link is real, but has to be copied by hand | `POST /quotes/:id/deliver` delivery row: `status: provider_unconfigured` |

Items 1 and 3 are environment, not code. Item 2 is the one real piece of missing work on the
test path, and it is exactly the "accepted-estimate scheduling" Kyle's step 05 describes.

### Defects found

| # | Finding | Detail |
|---|---|---|
| 4 | **The estimate appointment silently refuses to save.** The form says *"the selected property becomes its first location"*, but choosing the property does **not** tick it under "Estimate locations", and the save is rejected. The error — *"Choose a valid Chicago date, time, duration, active Field or Team Technician, and active customer location"* — never says which of the five is wrong. Kyle hits this on step 02 | `appointmentFallbackPropertyId` stays `""` and `appointmentPropertyIds` stays empty even with a property selected. See `prepareQuoteAppointment` in [`quote-appointment-submission.ts:108`](artifacts/crm/src/lib/quote-appointment-submission.ts) |
| 5 | **The crew cannot see the customer's phone number.** With a property attached, the tech's job page shows name, email, address and notes — but no phone, on either the schedule or the job page. Kyle's step 06 expects contact details | `crew-job-with-property.png`; customer had both `cellPhone` and `homePhone` |
| 6 | **Deleting an invoice leaves its `invoice_jobs` rows behind.** The job is then permanently undeletable: `DELETE /jobs/:id` refuses with `invoice_linked_job` for an invoice that no longer exists | Confirmed by SQL: `invoice_jobs` rows for invoices 1 and 2 survived their deletion |
| 7 | **Deleting a customer leaves their `properties` rows behind.** Seven orphans are sitting in the sandbox now. No FK cascade | `SELECT … FROM properties p LEFT JOIN customers c … WHERE c.id IS NULL` returns ids 2–8 |
| 8 | **The global error handler returns `err.message` verbatim on 500.** A Drizzle error message carries the failing SQL and its parameters; on the login route that includes the submitted username. Affects every route, not just login | [`app.ts:53-61`](artifacts/api-server/src/app.ts); the login route has no `try`/`catch` of its own ([`auth.ts:259`](artifacts/api-server/src/routes/auth.ts)) |

### Gaps already known, now confirmed on the test path

- No dashboard flag when an estimate is accepted (Kyle's step 04→05 handoff)
- Moving a job saves silently — no notify-before-send prompt (the parked work, step 06)
- No gift certificate payment method; offered methods are Cash, Check, Bank transfer, Other (step 08)
- No partial acceptance of an estimate (step 04)

### Friction Kyle will hit, working as designed

- A future-dated job cannot be started or completed (`future_scheduled_job`), so his step 07
  needs the job dated today
- A completed job can never be deleted (`completed_job`), so test runs cannot clean up after
  themselves through the API

### What passed, end to end

Prospect creation and profile; the profile's Activity / Notes / Communications tabs; estimate
creation against the prospect with an appointment and an assignee; print view; job scheduling
and crew assignment; the crew seeing their own job, its address and its notes, with pricing
hidden; marking complete; invoice generation and its Send control; recording a payment; and the
final profile showing the estimate, job and invoice together.

### Fixed the same day — 2026-09-21

Five of the findings above are fixed in the working tree. Typecheck clean on both packages;
CRM 379/379 pass, API 502/516 with the same 14 pre-existing `DATABASE_URL` failures.
**None of this is on Sandbox 2 yet** — it runs deployed code, so these are verified by tests and
by root-cause tracing, not yet in a browser.

| # | Fix |
|---|---|
| 4 | `appointmentFallbackPropertyId` and `appointmentDurationTouched` were hidden inputs written imperatively through refs; a remount reset them to their `defaultValue`, so the selected property never reached validation. Both are now bound to React state. The error also names the fields that are actually wrong instead of listing all five requirements |
| 5 | The job payload served `customers.phone`, a legacy column nothing writes any more. New `primaryCustomerPhone()` resolves cell → home → legacy → work, so the crew sees a number |
| 6 | Deleting an invoice now removes its `invoice_jobs` rows in the same transaction |
| 7 | Deleting a customer now removes their properties, contacts and property relationships, and **refuses with 409 `customer_has_history`** when jobs, estimates, invoices or payments exist. Previously it was a bare `DELETE` with no guard at all — it orphaned everything silently |
| 8 | 5xx responses return `Internal server error` plus a `reference` that the logs carry. 4xx keep their message, which is written for the caller. New `clientErrorResponse()` |

New tests: `crm/src/lib/quote-appointment-submission.test.ts` (6),
`api-server/src/lib/error-response.test.ts` (8), `api-server/src/lib/customer-phone.test.ts` (8).
All three are registered in their package's `test` script.

**Policy call made in #7, worth confirming with the client:** deleting a customer who has
history is now refused rather than allowed to destroy it. Kyle's outstanding question about what
the profile Delete button should mean can relax this later.

**The real fix for #6 and #7 is a schema migration.** `properties.customer_id`,
`contacts.customer_id` and `invoice_jobs` carry **no foreign key at all** — only
`communication_preferences` has `onDelete: "cascade"`. Route-level cleanup was chosen because
dev and Sandbox 2 still share one database and a migration there would hit Kyle's environment.
Add the FKs once the dev branch is split.

**Not fixed — needs a decision, not code:** the empty Service Catalog (finding #1). Either ask
Kyle for his real service list or seed a few samples through `POST /services`. Nothing else on
the test path moves until this exists.

### ✅ Cleanup done — 2026-09-22

The test runs had left 7 orphaned `properties` (ids 2–8) and 16 orphaned `contacts` (ids 1–7,
9–17), all from before the customer-delete fix. The seven properties were visible on Sandbox 2's
Properties page. The user ran the `DELETE … WHERE NOT EXISTS (customer)` statements on
`Development` in the Neon SQL editor. Verified afterwards: 0 orphans; the database holds one
customer (9, Lute Atieh), property 1 and contact 8; Sandbox 2 shows only property 1.

An earlier attempt did not reach `Development`; the cause was not confirmed (the SQL editor's
branch dropdown pointing at `production` is the likely one). **Check that dropdown says
`Development` before running anything meant for Sandbox 2.**

---

## Project shape

Corstead CRM for a window-cleaning business, imported from a Replit project.

- pnpm workspace. Packages: `artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts`
- `artifacts/crm` — React 19 + Vite frontend
- `artifacts/api-server` — Express API
- `lib/db` — Drizzle schema, one file per table under `lib/db/src/schema/`
- `lib/api-spec/openapi.yaml` — hand-written OpenAPI 3.1, the API contract
- `lib/api-client-react`, `lib/api-zod` — **generated** by orval from that spec. Never
  hand-edit anything under `src/generated/`

**Single-tenant.** `routes/auth.ts:72` hardcodes `TENANT_ID = "single-tenant"` and
`lib/idempotency.ts:27-31` states there is no account/organization concept yet. Relevant
because the spec (§17) warns this is heading toward SaaS.

There is **no `CLAUDE.md`** in this repo. This file is the substitute.

### Key commands

| Purpose | Command |
|---|---|
| Regenerate API client after editing `openapi.yaml` | `pnpm --filter @workspace/api-spec codegen` |
| Apply schema changes | `pnpm --filter @workspace/db run push` |
| Typecheck | `pnpm typecheck` (root) |
| API tests | `pnpm --filter @workspace/api-server test` |
| CRM tests | `pnpm --filter @workspace/crm test` |

Tests use `node:test` with `--experimental-strip-types`. **New test files are not discovered
automatically** — each must be added by path to the `test` script in the relevant
`package.json`.

---

## The Corstead calendar specification

Internal product spec **v1.0, dated 31 Aug 2026**, "Calendar Functional and UX
Specification". Builds a modernised functional equivalent of a reference calendar
(thecustomerfactor.com), not a pixel copy.

Its own approval gate (§18): *"Approve the clickable calendar prototype before building full
backend logic."* Responsible: Lute Atieh. Reviewers: Kyle Stafford and Emberlynn.

### V1 readiness as of 2026-09-04

Audited at commit `3e4c71c`. **6 done / 10 partial / 18 not started** out of the 34 V1 items.

Published audit: https://claude.ai/code/artifact/7adbd4b3-79f3-4b86-bade-21d4f9407018

**Done:** month view, adjacent-month spill days, drag one job to another date, invoice-status
colours, completed-job display, undo.

**Built and solid:** bounded calendar reads (`GET /calendar/occurrences`, `/calendar/totals` —
totals summed in the DB, one row per day, so a busy month costs what a quiet one does),
`lib/calendar-drag.ts` (preserves time on a month move, per spec §3.2), `lib/crew-overlap.ts`
(satisfies acceptance test 7), `lib/schedule-change-lock.ts` (refuses to move completed or
invoiced work).

**Of the spec's five prototype tests (§18), only one passes today** — "reschedule one
customer". The other four need the scheduling queue, move-entire-day, filters, and bulk
invoicing.

Note: the spec's gate said prototype approval should come *before* full backend logic, but
backend logic was already built. That is a deviation worth being deliberate about.

### Four architectural blockers

The month grid was built on the existing `jobs` table, and the spec's §11 data model cannot be
expressed in that schema. These gate roughly half the remaining V1 list, and should be settled
**before** more calendar UI is written.

| Spec | Missing | Blocks |
|---|---|---|
| §11.2 | `schedule_entries` table | Schedule is inline on `jobs` (`scheduledDate`, `scheduledStartTime`, `scheduledEndTime`), so **one job = one date**. Blocks on-hold, multi-day jobs, daily value allocation (§7.19), unique-job counting (§9.2), move entire day, recurring exceptions |
| §11.3 | Assignment link table | Only one `crewId` + one `assignedTechnicianUserId`. Blocks multiple assignments, crew subtotals, grouped display, separate crew lanes, the §9.4 "counts once" rule |
| §11.4 | ~~Shared calendar-event table~~ **cleared 2026-10-06** | `calendar_events` was created in Step 1 and read by nothing. Scheduling blocks now live in it, drawn on the month and counted as no work at all. Estimate, prospect and personal appointments can follow the same path |
| §11.6 | ~~`calendar_preferences`~~ **cleared 2026-10-05** | The table was created in Step 1 and read by nothing. It now backs `GET`/`PUT /api/calendar/preferences`, and the calendar's filters survive a reload |

The spec's own warning (§17) applies here first: *"calculation rules must be defined before
totals are coded."*

---

## Roadmap — remaining calendar work, in order

**28 items pending** (10 partial + 18 not started). Sequenced around the spec's own approval
gate (§18): get the five prototype tests passing first — only one passes today — then finish
the rest of V1.

### Phase A — reach the approval gate

| Step | Work | V1 items | Unlocks |
|---|---|---|---|
| 1 | **Data model — the four blocker tables** | foundation for #14, #15 | everything else |
| 2 | Scheduling Queue + On Hold | #7, #8, #10, #25 | prototype test 1 |
| 3 | ✅ **Done 2026-10-05** — filters (with §11.6 preferences) and the job side drawer | #16, #17, #21, #24 | prototype test 4 |
| 4 | ✅ 2026-10-06 — Move Entire Day, scheduling blocks, and conflict validation on every path that books a day | #11, #12, #34 | prototype test 3 |
| 5 | ✅ 2026-10-07 — bulk invoice creation with review, one bill per customer, no work billed twice | #26 | prototype test 5 |

Then take it to Lute Atieh, with Kyle Stafford and Emberlynn reviewing. The spec is explicit
that no further calendar complexity is approved until the five tasks are fast and need
minimal training.

### Phase B — the rest of V1

| Step | Work | V1 items |
|---|---|---|
| 6 | Weekly and monthly totals, monthly summary block (§5.5) | #19, #20 |
| 7 | Recurring: this-occurrence vs entire-series prompt, with exception records | #13 |
| 8 | Week View as a real 30-minute time grid; navigation dropdowns, sticky toolbar, week start setting | #2, #4, #5 |
| 9 | Quick Add | #6 |
| 10 | Appointment-card field customization + per-user saved preferences | #18, #30 |
| 11 | Print calendar, PDF output, CSV appointment export | #27, #28, #29 |
| 12 | Permissions (pricing visibility split) + audit logging of calendar moves | #31, #32 |
| 13 | The parked notify-before-send work (see above) | — |

### Step 1 progress — started 2026-09-05

Written, **not yet applied to any database**:

| File | What |
|---|---|
| `lib/db/src/schema/schedule_entries.ts` | One row per day a job is worked. `status` includes `queued`, so the scheduling queue is a query on this table rather than a separate one |
| `lib/db/src/schema/schedule_assignments.ts` | Many assignments per day. Three typed columns (`crew_id` / `user_id` / `queue_key`) with a check that exactly the one matching `assignment_type` is filled, instead of a polymorphic id |
| `lib/db/src/schema/calendar_events.ts` | Blocks, tasks, personal appointments, holidays, birthdays — deliberately not fake jobs |
| `lib/db/src/schema/calendar_preferences.ts` | 13 scalar columns plus `list_settings` jsonb for the five list-shaped preferences |
| `artifacts/api-server/src/migrations/calendar-schedule-entries-v1.ts` | Creates the four tables idempotently and backfills one primary entry per dated job |
| `artifacts/api-server/src/migrations/calendar-schedule-entries-v1.test.ts` | 14 tests, all passing |

Committed as `a8a245e`. The monthly-totals fix that followed is `bc8f651`.

Registered in `lib/db/src/schema/index.ts`, in `REQUIRED_MIGRATIONS`, and in the api-server
`test` script.

**Decisions taken here:**
- `jobs.scheduled_date` stays as a mirror of the primary entry (dual-write), following the
  precedent set by `crew_members` against the legacy text on `crews`
- Money is whole cents in `allocated_value_cents`, held as `numeric(18,0)` — see the startup
  note below for why an integer would have been a bug
- The migration creates the tables as well as backfilling, so production does not depend on
  the development-only `drizzle-kit push` path
- Full §11.5 recurrence-series exceptions are **not** built here. `schedule_entries` carries
  `recurring_plan_id` and `occurrence_key` so Step 7 can add them without a second migration

**Verified on 2026-09-05:** full workspace typecheck passes across all four projects; the
migration's 17 tests pass along with the 11 migration-runner tests. Test counts match the
known baseline below, so nothing here regressed anything.

#### ⚠️ This migration runs at server startup

`artifacts/api-server/src/index.ts:29` awaits `runRequiredMigrationsAtStartup(pool)` **before**
`app.listen`, and this migration is `required: true` in `REQUIRED_MIGRATIONS`. So on Replit it
runs on the next boot after the code is pulled, and **if it throws, the server does not
start.** The gate in `evaluateMigrationGate` decides which of three things happens:

| Environment | Result |
|---|---|
| `APP_MIGRATIONS_ENABLED` not `"true"` | Skipped silently. Server boots, **tables are never created** |
| Enabled, but environment is not `sandbox` or the Repl identity does not match | **Throws — server will not start** |
| Enabled, `APP_MIGRATION_ENVIRONMENT=sandbox`, and `REPL_ID` matches `APP_MIGRATION_SANDBOX_REPL_ID` (or `REPLIT_DOMAINS` matches `APP_MIGRATION_SANDBOX_DOMAIN`) | Runs, then the ledger makes it a no-op on later boots |

Because a failure here is a failed boot rather than a failed command, two things were changed
after the first draft, both found by reading what the live data can actually contain:

- **`allocated_value_cents` is `numeric(18,0)`, not `integer`.** `jobs.total_amount` is
  `numeric(10,2)` and so reaches 9,999,999,999 cents — nearly five times an int4's limit. One
  large job would have aborted the migration. This also matches the existing cents convention,
  `financial_approval_policies.threshold_cents`.
- **Time checks accept optional seconds.** The API has always taken `HH:mm` *and* `HH:mm:ss`,
  so job rows carry both shapes; an `HH:mm`-only check would have rejected real data.

`preflight` also counts jobs that could not become a valid entry — malformed date or time,
negative amount, negative duration — and refuses with a sentence naming the problem, rather
than letting Postgres raise a bare constraint name during boot.

**Still to do for Step 1 — needs a database, which this machine does not have.**

The working arrangement (agreed 2026-09-05): code is written locally, the user pulls it into
Replit, and it runs against the Replit database. A separate database is planned later, not now.
So anything schema-related has to be correct *before* it is pulled — there is no local database
to try it against.

On Replit, after pulling:

1. Confirm the gate env vars are set, or the migration is silently skipped and no table appears
2. Restart the server — the startup gate applies it — or run it explicitly:
   `pnpm --filter @workspace/api-server run migration:run -- calendar_schedule_entries_v1`
3. `pnpm --filter @workspace/api-server run migration:verify -- calendar_schedule_entries_v1`
   to confirm every dated job received a primary entry

`drizzle-kit push` is optional here: the migration creates the tables itself, precisely so
production does not depend on the development-only push path. Run push only to keep a dev
database in step with the TypeScript schema.

**No table has been created and no row has been written yet.**

### Step 2 progress — started 2026-09-10

Foundation laid, built to the layering agreed in the Architecture section since this is all new
code. Applied to the Neon development branch and verified there.

| File | What |
|---|---|
| `artifacts/api-server/src/lib/schedule-queue-core.ts` | Pure rules — the seven §4.3 waiting reasons, bounded page parsing, keyset cursors, hold/release decisions, days-waiting. No database, no I/O |
| `artifacts/api-server/src/lib/schedule-queue-core.test.ts` | 21 tests |
| `lib/db/src/schema/schedule_entries.ts` | Added `queue_status`, two check constraints, and the `(status, created_at, id)` queue index |
| `artifacts/api-server/src/migrations/calendar-queue-entries-v1.ts` | Adds that column and index, and backfills queued entries for undated open jobs |
| `artifacts/api-server/src/migrations/calendar-queue-entries-v1.test.ts` | 13 tests |

Suite: 444 tests, 429 pass; the 15 failures are the known `DATABASE_URL` baseline.

**Two gaps in Step 1 that this closes:**

1. `calendar_schedule_entries_v1` backfilled only *dated* jobs, leaving undated ones — exactly
   the "Ready to Schedule" work — with no entry at all.
2. The seven §4.3 waiting reasons had nowhere to live. `on_hold_reason` is free text; these are
   a fixed set, so they get their own constrained column.

**Why a second migration rather than editing the first:** the framework checksums each
definition and refuses drift, so a changed checksum requires a new id.

**Design decisions worth keeping:**

- `queue_status` is deliberately separate from `status`. `status` says *where* work sits
  (queued / scheduled / on_hold / canceled); `queue_status` says *why* it is still sitting
  there. A constraint enforces that only queued or held work carries one.
- **Keyset pagination, not offset.** The queue reorders as people work it — scheduling a job
  from page one shifts everything after it, and `OFFSET` would silently skip a row. Cursors
  carry `(queued_at, id)` so ties cannot skip either.
- **Bounded reads from the start**, following `calendar-range.ts`: 100 rows per page maximum.
  Note that the existing `GET /jobs/unscheduled` and `GET /recurring-plans/due` are **not**
  bounded — they return every row. Worth fixing when the queue replaces them.
- `enrichJobs` (`routes/jobs.ts:228`) is not N+1 — it batches with `inArray`, five queries
  regardless of job count. Reusable as-is.

**Verified against the Neon development branch**, not just in tests: an invented waiting reason
is rejected, and a waiting reason on scheduled work is rejected by the scope constraint.

#### API layer — built 2026-09-11

The full stack below the UI now exists, in the layering agreed on 2026-09-07. **474 tests, 460
pass, 14 fail** — the fails are the known `DATABASE_URL` baseline, and there is one fewer of
them than before (see the `@workspace/db/schema` note below).

| File | Holds | Tests |
|---|---|---|
| `lib/schedule-queue-core.ts` | Decisions, cursors, page shaping. No I/O | 45 |
| `lib/schedule-queue-scope.ts` | Who sees which rows, and whether money | 3 |
| `repositories/schedule-entry.ts` | Drizzle/SQL only, no rules | via the real DB |
| `services/schedule-queue.ts` | Transactions, `jobs` mirroring, audit trail | via the real DB |
| `routes/schedule-queue.ts` | Parse, authorize, respond | — |

**Endpoints:** `GET /schedule-queue?tab=ready|on_hold&limit=&cursor=&status=`,
`GET /schedule-queue/statuses`, `POST /schedule-queue/:id/{schedule,hold,release}`,
`PATCH /schedule-queue/:id/status`.

**Decisions made while building, worth not re-deriving:**

- **Every transition re-reads under `FOR UPDATE` inside its own transaction.** The unlocked read
  says whether the request is worth attempting; the locked one says whether it is still true.
  Without it two browsers acting on the same card both pass the check and the second write wins
  silently.
- **400 versus 409 is load-bearing.** A malformed request is 400 ("fix your input"); a
  well-formed request against the wrong state is 409 ("someone else moved this, reload"). The UI
  branches on the `code` field.
- **Holding preserves the date** in `original_scheduled_date` and clears `jobs.scheduled_date`,
  so held work stops painting on the calendar through the legacy mirror column.
- **Scheduling clears `queue_status`**, because the scope constraint allows a waiting reason only
  off the calendar.
- **Counts come from their own grouped query**, not from the page. A page is 100 rows; the filter
  chips describe the whole tab.
- **`field_tech` can read the queue but not move work through it** — `schedule.view` yes,
  `schedule.manage` no. So the scoping predicate is live, not dead code: a tech sees only
  assigned work and no amounts. Locked down by test. Note the real role name is `field_tech`,
  **not** `field_technician`; `hasCapability` on an unknown role silently returns false, which
  makes a typo look like a passing authorization test.
- **`/schedule-queue` does not match the `/schedule` prefix rule** (`matchesPrefix` needs an
  exact match or a trailing slash), so it has its own rules. Asserted by test, because if that
  ever changed the POSTs would fall through to no capability at all.

**Incidental fix:** `lib/field-tech-scope.ts` imported `@workspace/db`, whose root opens a
connection pool at import time — so every module building a predicate from it was untestable
without a live database, including its own test. Now imports `@workspace/db/schema`. That is the
14th failure gone, and the pattern to copy elsewhere.

#### UI layer — built 2026-09-11

**373 CRM tests, all passing.** Typecheck clean.

| File | Holds |
|---|---|
| `crm/src/lib/schedule-queue-view.ts` | Labels, waiting badges, chips, page accumulation. No fetch, no React |
| `crm/src/lib/schedule-queue-view.test.ts` | 22 tests |
| `crm/src/lib/schedule-queue-api.ts` | Hand-written client, same pattern as `calendar-api.ts` |
| `crm/src/components/SchedulingQueue.tsx` | The three tabs, cards, filter chips, schedule/hold dialogs |
| `crm/src/pages/Schedule.tsx` | Renders the queue; the old panels became a fallback |

**Decisions worth keeping:**

- **The queue supersedes two older panels** — "Needs Scheduling" and "Due for Service" — but both
  are still rendered *when the queue endpoint fails server-side*. The backfill runs at server
  startup, so between deploying this build and setting `APP_MIGRATIONS_ENABLED = "true"` there is
  a window where the queue has no table to read. The office must not be left with nothing. A 4xx
  does **not** trigger the fallback: that would be our bug, not a missing table. Delete the
  fallback once the queue has run in production for a while.
- **"Repeat Service Due" is passed in, not fetched by the queue.** A plan that is due has not
  produced a job yet, so there is no `schedule_entries` row to read. The grid was extracted to
  `DueForServiceGrid` so the tab and the fallback panel render the same cards.
- **Filter chips keep the canonical reason order, not count order.** A list that reorders as work
  moves through it is hard to click twice — the chip you wanted has moved.
- **`appendPage` de-duplicates on entry id.** React strict mode double-invokes effects, which
  makes a duplicated page easy to write and nearly invisible: the list just grows with repeats.
  It also returns the same array when nothing is new, so React skips a render.
- **A hidden amount renders as nothing, never `$0.00`.** Field techs receive `null`; a zero would
  claim the job is free.
- **A filtered-empty tab does not say "the queue is clear"** — that would be untrue with a filter
  on.

**Incidental fix:** `crm/src/lib/auth-scope.test.ts` — the raw-fetch security audit could not run
on Windows at all. `URL.pathname` yields `/E:/…`, which resolves against the current drive as
`E:\E:\…`; and the assertion compared POSIX paths that Windows can never produce. Now uses
`fileURLToPath` and normalizes separators. An audit that cannot run protects nothing.

**⚠️ `npx vite build` fails on this machine** — `@rollup/rollup-win32-x64-msvc` is missing from
`node_modules`, the same broken-install problem recorded under environment gotchas. Not a code
defect; it builds on Replit. Typecheck and the test suite are the signal here.

**Still to do for Step 2:** none of this has run against a real database. That happens when
Replit points at Neon and migrations are enabled.

### Detailed breakdown — what each step contains

Spec section references in brackets. Items marked DONE are already built and must not be redone.

**Step 1 — Data model**
- `schedule_entries` [11.2] — job ID, start/end date+time, no-specific-time flag, all-day flag,
  duration, schedule status, primary-occurrence flag, multi-day segment number, allocated job
  value, recurrence-occurrence ID, rescheduled count, original scheduled date, on-hold reason,
  callback date, created/updated by + timestamps
- Assignment link [11.3] — schedule-entry ID, assignment type (Employee/Crew/Queue), assignment
  ID, primary yes/no, value-allocation percentage, planned hours
- Shared calendar-event table [11.4] — estimate appointments, prospect appointments, tasks,
  personal appointments, scheduling blocks, holidays, employee birthdays. Explicitly **not**
  fake jobs. Wire the existing `tasks` table in
- `calendar_preferences` [11.6] — 18 per-user settings: default view, last viewed date, week
  start, Sunday visibility, selected appointment types, selected assignments, grouped/separate,
  displayed card fields, total settings, invoice-status display, completed-job visibility,
  holiday visibility, birthday visibility, colour mode, expanded sidebar sections, sidebar
  order, sidebar open/closed
- Recurrence series gaps [11.5] — `recurring_plans` exists but has no series exceptions,
  cancelled occurrences, or rescheduled occurrences
- Audit record [11.7] — action, old value, new value, reason, whether the customer was
  notified, bulk-operation ID

**Step 2 — Scheduling Queue + On Hold [4]**
- One queue, three tabs: Ready to Schedule, On Hold, Repeat Service Due [4.1]
- Queue card: 13 fields incl. days waiting, preferred crew, last contact, next callback,
  on-hold reason [4.2]
- Seven named statuses replacing abbreviations — Needs Contact, Contacted, Callback Scheduled,
  Waiting on Customer, Waiting on Materials, Weather Hold, Ready to Schedule [4.3]
- Eleven queue actions incl. call, email, text, record contact attempt, set callback [4.4]
- Drag queue to calendar: 7-step flow with a compact scheduling panel, then recalculate totals
  and show undo [4.5]
- Drag calendar to On Hold: 8-step flow. Reason required, optional callback date, recurring
  occurrence-or-series prompt, job is **preserved not cancelled** [4.6]

**Step 3 — Filters + job drawer [7, 6.7, 2.3]**
- Left settings panel: collapsible, remembers open/closed per user, per-section expand state,
  Reset Filters, active-filter count, updates with no page reload [2.3]
- WARNING — By Appointment Type [7.2]: the reference list mixes seven different data types.
  **Do not hard-code as one DB field.** Customer type / recurrence / frequency / classification
  tag / event type / job status / assignment status stay separate underneath, however the UI
  presents them
- Filters always multi-select; "Only This Type" shortcut on hover. No Single/Multiple mode [7.3]
- By Assignment — populated dynamically from active employees, crews, queues. **Never
  hard-code crew or employee names** [7.4, 7.5]
- Grouped vs Separate assignment display; cap Separate in Month View around four [7.6]
- Invoice status filter [7.7] — colours DONE
- Jobs Completed show/hide; totals must state whether hidden completed jobs are excluded [7.8]
- Job totals settings: Gross vs Net, define both explicitly [7.9]
- Number of jobs daily — exclude tasks, personal appointments, blocks, holidays, birthdays,
  cancelled jobs [7.10]
- Job side drawer: 11 actions — open customer, open job, edit date/time, reassign crew, mark
  complete, create/view invoice, call/text/email, add note, put on hold, copy, cancel [6.7]
- Hover details: full name, service address, phone, service type, time+duration, assignment,
  value, invoice status, notes indicator [6.7]

**Step 4 — Move Entire Day, blocks, validation [8.2, 7.15, 7.21, 8.3-8.5]**
- Move Entire Day: 11-step flow — drag the date header, review affected jobs, choose what
  moves, conflict validation, recurring resolution, bulk notification review list, undo [8.2]
- Scheduling blocks: full-day in Month View, time-range in Week View; scoped to company, crew,
  employee or several; reason required; hard blocks reject drops, soft blocks warn [7.15]
- Drag and drop validation — 12 rules incl. overlapping assignments, hard blocks, appointment
  limits, daily hours, employee unavailable, outside business hours, past date, completed,
  invoiced, reason required, recurring selection, notification decision [7.21].
  Crew overlap and completed/invoiced locks are DONE
- Copy appointment — copies customer, address, service lines, notes, preferred crew; **never**
  invoice, payment, completion status, signature, actual time [8.3]
- Reorder No-Specific-Time jobs within a day [8.4]
- WARNING — critical protections must not be disableable by an ordinary user [7.21]

**Step 5 — Bulk invoice creation [13.1]**
- 8-step flow: show completed uninvoiced jobs in range, select all or individual, warn about
  jobs not marked complete, preview totals, create, update colours. Duplicate protection —
  ignore jobs that already have invoices

**Step 6 — Totals [9, 5.3, 5.4, 5.5]**
- Day footer: job count, scheduled value, duration, crew subtotals, completed count [5.3]
- Weekly total — **not** placed only inside Sunday's cell, since Sunday can be hidden [5.4]
- Monthly summary: scheduled jobs, open estimates, on-hold, completed, uninvoiced — five rows,
  recalculating with active filters [5.5]
- WARNING — terminology: call it **Scheduled Job Value**, never "Sales" [9.1]
- Unique job counting — one job counts once despite multiple dates, crews, or segments [9.2]
- Daily allocation for multi-day jobs [9.3] — **decided: full value on the first scheduled
  day, later days zero.** Monthly reporting uses the same anchor, so a job may report in a
  month in which some of its work is not performed
- Multiple crews: one primary, company counts once, primary crew gets the value [9.4]
- On-hold value shown separately from scheduled value [9.5]
- Cancelled jobs excluded from counts and value, still in history [9.6]
- Filtered totals must state that they are filtered [9.7]

**Step 7 — Recurring occurrence vs series [7.16]**
- Moving, editing, cancelling or holding recurring work asks: this occurrence only, or the
  entire series. Needs the exception records from step 1

**Step 8 — Week View, navigation [3.2, 3.4, 3.5, 7.12]**
- Week View as a real time grid: 30-minute rows, vertical drag changes time, horizontal drag
  changes day, all-day and No Specific Time sections at top, crew conflicts shown, optional
  per-crew lanes [3.2]
- Navigation: prev/next, month dropdown, year dropdown, Today, Week, Month, optional Day,
  Sunday-start or Monday-start [3.4]
- Sticky toolbar while scrolling — a recommended improvement over the reference, which repeats
  navigation at the bottom
- Jump to Current Date on/off; when off, remember the last viewed range for the session [3.5]
- Sunday show/hide, warn if Sunday has appointments, state whether weekly totals include
  hidden Sunday work [7.12]

**Step 9 — Quick Add [10.2]**
- Search existing customer or prospect by name/phone/email/address, pick record, choose Job /
  Estimate Appointment / Prospect Appointment / Task / Personal Appointment / Scheduling Block,
  confirm service location, date, time, duration, assignment, service type, value, save,
  calendar updates immediately

**Step 10 — Card customization + preferences [6.3, 6.4, 6.5, 6.6, 11.6]**
- Fixed fields: time, customer or business name, status badge. Everything else optional [6.3]
- Residential default is last name; commercial default is business name [6.4]
- Always show the **service** address, not the billing address; hover identifies both when
  they differ [6.5]
- Long text truncates with ellipsis, full value on hover, never overflows into another cell [6.6]
- Live preview in display settings; do not let users make cards unreadable
- Persist all 18 preferences per user [11.6]

**Step 11 — Print, PDF, CSV [13.2, 13.3, 13.4]**
- Print monthly calendar: landscape, no navigation or sidebar, preserve filters, pricing
  optional, repeat weekday headings across pages, never clip rows
- PDF variants: calendar only / with totals / with or without pricing / one crew or all /
  include or exclude personal appointments and tasks
- CSV appointment export: 18 columns. WARNING — print layouts must be designed and tested
  separately from the browser layout [17]

**Step 12 — Permissions + audit [12, 11.7]**
- Four roles: Administrator/Owner, Office Scheduler, Crew Leader, Technician
- Financial totals, payment information, customer personal information and personal
  appointments must all be permission controlled
- Every move, assignment change, hold, cancellation and bulk operation appears in audit history

**Step 13 — Parked notify-before-send work** — see the section below

### Definition of done

Spec §16 lists **23 acceptance tests**. Those are the real completion bar, not the item list.
Two are already satisfied: the crew-overlap warning before a conflicting move (test 7) and,
partially, invoice colour transitions (test 11).

Two are easy to overlook and worth designing for early:
- Test 15 — active employee and crew filters come from company records and are **not hard-coded**
- Test 23 — two office users cannot silently overwrite each other's schedule changes. Needs
  record versioning or conflict detection [17]

### ✅ Step 1 is unblocked — value allocation answered

**Answered by Kyle Stafford on 2026-09-05: Option A — full value on the first scheduled day.**

His exact words: *"We want the job pricing on the first day of the job scheduled. The same
with monthly reporting. If the job is scheduled in August and runs into September, the pricing
for the job would be on the August reporting."*

This settles §7.18, §7.19 and §9.3 together. The rules that follow:

1. **Daily value** — the job's whole value lands on its first scheduled day. Later segments of
   the same job carry zero value. A Monday–Tuesday job worth $1,200 shows $1,200 on Monday and
   $0 on Tuesday.
2. **Monthly reporting follows the same anchor, not the segment dates.** A job starting
   28 August and finishing 2 September reports entirely in **August**. This is a stronger
   statement than daily allocation alone, and it applies to the monthly summary (§5.5) and to
   any period reporting built on scheduled value.
3. **Duration is unaffected.** Only money is anchored to the first day. Scheduled hours still
   belong to the day they are actually worked, so crew capacity and the duration totals in
   §7.20 stay honest.

**Schema consequence:** `schedule_entries` still carries a per-entry `allocatedValue` column,
populated as full-value-on-primary / zero-on-the-rest, plus the `primaryOccurrenceFlag` that
identifies the anchor day. Storing it per entry rather than deriving it keeps the switch to
duration-split a small change when the V1.1 allocation setting arrives (§15.2 lists
"multi-day value allocation" as V1.1), rather than a rebuild.

**Watch for:** monthly attribution by anchor day means a month's scheduled value can include
work physically performed in the next month. Any query that sums scheduled value by month must
join through the primary entry, not filter segment dates by range. Cross-check against the
existing reporting rules recorded in `.agents/memory/dashboard-reporting-semantics.md` before
wiring the monthly summary.

---

## DONE (was PARKED) — Notify the customer before sending on a schedule change

**Status: BUILT on 2026-09-30 — see "Phase 11" above.** The investigation below is
kept because it is what the build rests on; where the two differ, Phase 11 is what
shipped. The overnight-cron question is the one part still open with the client.

### The problem

When a job's scheduled **date** changes, `routes/jobs.ts:1033` enqueues a communication event
inside the update transaction. A background dispatcher picks it up within 30s and, if an
active automation rule matches, queues a real email. Nobody is asked.

Nudge a card by accident on the month calendar and the date change is undoable, but the
customer message is not. The customer gets two conflicting messages and calls the office.

Spec §8.6 says the opposite: do not send merely because a user dragged a job. Ask, show the
message, allow editing, record whether it went.

### What was verified (static code read, 2026-09-04)

- **`appointment.changed` has exactly one producer** — `routes/jobs.ts:1033`. Calendar drag,
  the Move dialog, and the job screen all reach it through `PATCH /jobs/:id` (frontend uses
  the generated `useUpdateJob`). So fixing it everywhere is **one call site**; fixing it for
  the calendar alone would have meant *adding* a way to tell the routes apart — more work,
  not less.
- **Nothing depends on the automatic send.** `lib/automation-engine.ts` does not consume
  appointment events at all — its triggers are `days_after_last_service` and
  `inactive_customer`. The recurring-plan engine only fires on job *creation*, never on a move.
- **An event only sends if a matching active automation rule exists** in the DB
  (`lib/communication-dispatcher.ts:462-506`). With no rule it resolves to
  `no_active_automation` and nothing happens. **Whether such a rule exists on production is DB
  config and is not visible from the repo — confirm before shipping.**
- **The dispatcher runs in-process**, `setInterval` every 30s from `lib/scheduler.ts:36-53`,
  gated by `shouldStartMutationWorkers()`. Disabled on Sandbox 2 unless
  `BACKGROUND_PROCESSING_ENABLED=true`.
- **⚠️ There is no SMS provider anywhere in the repo.** No Twilio, no `sendSms`. SMS automation
  rules only write a `message_logs` row with `body: "[redacted]"` and `status:
  "not_dispatched"` (`communication-dispatcher.ts:296-344`). The client asked for text
  notifications; **the platform cannot currently deliver them.**
- **Time-only changes send nothing today.** The trigger is `dateChanged` only. But
  `scheduleChanges` / `touchesSchedule` at `jobs.ts:883-889` already computes date + start +
  end time for the schedule-lock check — reuse that.

### Scope agreed

**In scope — five interactive sites, all with a real user present:**

| Site | Trigger |
|---|---|
| `routes/jobs.ts:1033` | `PATCH /jobs/:id` — the reschedule, primary case |
| `routes/jobs.ts:770` | `POST /jobs` |
| `lib/customer-initial-job-db-adapter.ts:163` | `POST /customers/with-initial-job` |
| `routes/estimates.ts:534` | `POST /quotes/:id/convert-and-schedule` — **N per request** |
| `routes/recurring_plans.ts:313` | `POST /recurring-plans/:id/generate-job` |

`routes/jobs.ts:643` and `:674` also call the helper but are **unreachable** — `jobs.ts:548-554`
returns 409 `estimate_conversion_deferred` whenever `quoteId !== null`.

**Out of scope:** `routes/estimates.ts:232` and `routes/quotes.ts:590` use
`aggregateType: "quote"` — these are appointments to go *give* an estimate, not job
scheduling. Awaiting client confirmation that excluding them is right.

**Parked within the parked item:** `lib/recurring-plan-engine.ts:95` runs from
`cron.schedule("15 6 * * *")` with `actorId: "scheduler"`. No user exists to prompt. Awaiting
the client's answer.

### Agreed approach

**Do not enqueue until confirmed.** `communication_events.status` is capped by a DB CHECK
constraint to `pending|processing|succeeded|retrying|dead_letter`
(`lib/db/src/schema/communication_events.ts:69-72`), and that list is duplicated in three TS
files. Adding an `awaiting_confirmation` status means constraint replacement, which
`drizzle-kit push` handles unreliably and would need a full versioned application migration.

So instead: the five sites stop calling `enqueueCommunicationEvent` for appointment events and
write a **draft row**. On confirm, the existing send path runs. No CHECK constraint surgery, no
application migration — two plain new tables.

This also fixes undo for free: a new draft supersedes any open draft for the same job, so
move-then-undo leaves nothing to send.

### Plan (5 phases)

1. **Settings foundation** — new `communication_notification_settings` table modelled directly
   on `communication_quiet_hours` (`lib/db/src/schema/communication_safety.ts:36-57`): a
   singleton keyed by `organizationKey`, per-channel booleans. `GET`/`PUT` endpoints copying
   the shape of `routes/communication-safety.ts:554-681`, guarded by the **existing**
   `requireFinancialCapability("communication.settings")` — no new capability string needed.
   OpenAPI template at `openapi.yaml:3838-3873`. UI beside `CommunicationSafetySettings` in
   `pages/Settings.tsx:435`.
2. **Stop the automatic send** — new `appointment_notification_drafts` table; new pure module
   `lib/appointment-notification-core.ts` in the style of `lib/schedule-change-lock.ts`; wire
   the five sites; switch `dateChanged` → `touchesSchedule(scheduleChanges)`; return draft ids
   in the mutation response so the UI knows to prompt.
3. **Render, review, confirm** — **the largest piece.** The body is currently only built at
   send time inside `executeRule` (`communication-dispatcher.ts:247-345`), so there is nothing
   to show anyone beforehand. Extract `interpolate` (`:60-66`) and `getContext` (`:153-245`)
   into a shared module, render at draft time, then `GET` / `send` / `dismiss` endpoints.
4. **Prompt UI** — one shared component. Copy the shape of the crew double-booking dialog at
   `MonthCalendar.tsx:505-557`.
5. **Tests** — pure logic tests plus route capability/validation tests using the express +
   fake `req.user` pattern from `routes/communication-safety.test.ts:7-64`.

**Suggested split:** phases 1–2 fix the actual bug and are shippable alone. Phases 3–4 deliver
the review experience and are the bulk of the effort.

### Two traps in the existing code

1. **Undo is a forward PATCH**, not a rollback — `MonthCalendar.tsx:348` simply moves the job
   back. A prompt hung off `useUpdateJob.onSuccess` would fire again on undo. Fire from the
   decision layer (`commitMove` / `saveEdit` / modal submit).
2. **`TOAST_LIMIT = 1`** (`hooks/use-toast.ts:7`) — the undo toast and any notify toast cannot
   coexist; the second replaces the first. Keep the prompt in a dialog.

Also: the three reschedule sites disagree on blank values. `Schedule.tsx:182` sends
`|| undefined` (omit); `JobDetail.tsx:326` sends `|| null` (clear).
`lib/job-date-commit.ts:14-22` already encodes that convention — reuse it.

---

## Decision log

### User decisions

| Date | Decision |
|---|---|
| 2026-09-04 | **Option B** — fix the notification behaviour everywhere, not calendar-only. (Client's own words: consistent no matter where the schedule change is made.) |
| 2026-09-04 | Both notification settings ship **defaulting to OFF**, so nothing can leave the system until an admin deliberately enables it |
| 2026-09-04 | The overnight-cron question is **to be asked of the client**, not decided internally |
| 2026-09-04 | **Park the notification implementation.** Do not build it yet |
| 2026-09-04 | Maintain this file as the persistent handoff record |
| 2026-09-22 | **No separate Neon `dev` branch.** Work locally against `Development` (branch `br-green-frost-aruwjw1f`, endpoint `ep-ancient-resonance-ar0ob1sr` — the one Sandbox 2 runs on); `production` is kept for go-live. Accepted consequence: local work lands in the database Kyle tests in |

### Client decisions (Lute / Kyle)

| Date | Decision |
|---|---|
| 2026-09-04 | Approved **Option B** |
| 2026-09-04 | Added: a business-level admin setting for whether schedule-change notifications are used at all — **email on/off and SMS on/off, independently** |
| 2026-09-04 | Added: **never send automatically**, even when channels are enabled. Prompt the user, let them review/edit, then confirm the channels |
| 2026-09-04 | Prompt applies on **initial scheduling as well as date/time changes** — this widened the scope from 1 call site to 5 |
| 2026-09-05 | **Multi-day value allocation: Option A** — full job value on the first scheduled day, later days zero (Kyle Stafford). Settles §7.18, §7.19, §9.3 |
| 2026-09-05 | **Monthly reporting uses the same anchor** — a job starting in August and running into September reports entirely in August (Kyle Stafford) |
| 2026-09-06 | **Republished Sandbox 2**, and offered Publisher access so deployments no longer need to go through him (Lute) |
| 2026-09-06 | **Move the database now**, before live scheduling data accumulates. Application, hosting, development and publishing all stay in Replit — only the database moves (Lute) |
| 2026-09-06 | Requirements attached to that: separate dev and production databases; schema stays owned by our migration system; automatic backups with a confirmed retention window; Lute owns the database account with our access separate; a **full restore** proven before the migration is called finished; connection/migration/backup/restore documented; and a guaranteed independent export path for changing provider later (Lute) |
| 2026-09-06 | **Gate:** provider, monthly cost, backup schedule and migration plan must be sent and approved **before** any production change (Lute) |
| 2026-09-06 | Feature work must continue in parallel so Kyle can keep testing (Lute) |
| 2026-09-07 | **Neon chosen** as the provider (user, agreeing with Lute's lean) |
| 2026-09-11 | **Sandbox 2 holds test data only — deletable without issue** (Kyle Stafford) |
| 2026-09-11 | **Superior is not running any operations through the system.** Any Superior customer, job, quote or invoice already loaded does not need to be retained and may also be deleted (Kyle Stafford) |
| 2026-09-11 | **No planned production setup changes** — *"It's whatever will use to test with superior"* (Lute Atieh) |

### My recommendations

| Date | Recommendation | Outcome |
|---|---|---|
| 2026-09-04 | Settle the four missing tables **before** writing more calendar UI | Open |
| 2026-09-04 | Option B is not just safer, it is **smaller** — A would require adding a route-source distinction that does not exist | Accepted by client |
| 2026-09-04 | Hold notifications in a new draft table rather than adding a status to `communication_events` — avoids CHECK constraint surgery across three files | Accepted, then parked |
| 2026-09-04 | Deliver phases 1–2 first as a standalone safety fix | Open |
| 2026-09-04 | Exclude estimate-visit appointments (`aggregateType: "quote"`) from this change | Needs client confirmation |

---

## Waiting on the client

### Open as of 2026-10-05 — ask whenever there is a reply

Everything Kyle asked for in his 1 October list is built and live, so these are
the only things outside our hands. **Nothing here blocks Phase 13 or 14**; the
first four were sent with the release message.

**Kyle**

| # | Ask | What it blocks |
|---|---|---|
| 1 | **Card payments** — should Corstead take cards through a processor (he has mentioned Square; Stripe is what is installed), or keep recording that a card was used, as it does now? | Any real card work. Phase 12a deliberately records only, and asks for no card details |
| 2 | **Quote validity** — do the days run from when the quote is **sent** (what we built) or from when it is created? | Nothing. It is an assumption that may need reversing; see Phase 19 |
| 3 | **Appointment duration** — offer 15 and 45 minutes as well as 30 / 60 / 90 / 120? | Nothing. One list in two screens if he wants it |
| 4 | **Commercial-only fields** — besides Company Name, which others belong only on a commercial profile? (Birthday, Salutation, Alt. Contact Name, County, Subdivision) | The rest of #1. The form hides Company Name today and nothing else |
| 5 | **Sub-customers depth** — he said "any profile beneath a main profile". Built as **two levels** (a main profile and the profiles under it), no chains. Is a sub-customer ever allowed its own sub-customers? | Nothing. Deeper nesting is a later change, not a rewrite; see Phase 13 |

**Lute**

| # | Ask | What it blocks |
|---|---|---|
| 6 | **Email provider keys — answered 2026-10-10.** Kyle sent the App Password; Gmail authenticates and the app's own send path delivers. What remains is not a key: automation rules, templates, and the queue actually running. See "Email — Gmail connected and proved" | **Phase 12b** is unblocked as far as the provider goes. **A#9** still waits on the sending path resolving recipients from contact channels |
| 7 | **Address autocomplete** (A#11 / B#2) — he owns the account and the billing, and asked for the cost to be checked first | That feature only |
| 8 | **Neon ownership and the production branch** — he asked for ownership on our side to move to his, and production decisions are his | **Phase 15 go-live.** Needs a date from him more than an answer |

### Older, still unanswered — all from the parked notification work

1. **The overnight recurring-plan cron** (`lib/recurring-plan-engine.ts:95`) creates jobs at
   06:15 with nobody at a screen. Send nothing, park a draft for morning review, or allow
   auto-send on that path alone?
2. **SMS has no provider.** The toggle and the choice can be built, but no text will reach a
   customer. Does the client want an SMS provider integrated as part of this work?
3. **Move Entire Day** (V1 #11, not built) will move 20–30 jobs at once. Spec §8.6 calls for a
   batch review screen before messages are released. Confirm that is the intent.
4. **Estimate visit appointments** are excluded from the notification change. Confirm.

All four relate to the parked notification work, so none of them blocks the calendar roadmap.

**Answered and closed:** multi-day value allocation (§7.18, §7.19, §9.3) — Kyle Stafford chose
Option A on 2026-09-05. See "Step 1 is unblocked" above. Step 1 can now start.

**Answered and closed 2026-09-11 — the production environment questions.** Asked before
committing to Neon, because a wrong answer would have meant migrating live operational data.

| Asked | Kyle Stafford / Lute Atieh |
|---|---|
| Is the data in Sandbox 2 real or test? | *"Test data. It can be deleted without any issue."* |
| Is there another live production system to preserve? | *"Superior is not currently running any part of its operations through this system."* Any Superior customer, job, quote or invoice already loaded *"does not need to be retained and can also be deleted."* |
| Any planned production setup changes in the next few months? | Lute: *"No plans. It's whatever will use to test with superior."* |

Kyle's summary: **"there is no current live operational data that needs to be preserved."**

**What this changes.** Every remaining database step got cheaper and safer:

- **No production data migration.** Migration-plan steps 5, 6 and 8 below existed to move and
  prove a live dataset. There is no live dataset. They collapse into "create the schema in the
  production branch and verify it".
- **The region mismatch is now free to fix.** Recreating the Neon project in `us-west-2` costs
  nothing, because nothing in it is precious. Do this before pointing Replit at it.
- **Cutover stops being an event.** No out-of-hours window, no two-week read-only period on the
  old database — there is nothing to fall back to.
- **The `pg_dump`-not-rebuild rule no longer applies.** It existed to carry across the GIN
  trigram indexes `replit.md` mentions. With no data to preserve, `drizzle-kit push` from our
  own schema is the correct source of truth, and anything the TypeScript does not describe was
  never wanted.
- **Sandbox 2 can be wiped whenever it is convenient**, which makes backfill migrations easy to
  test from a clean state repeatedly.

The one thing it does *not* change: **the migration gate still needs a production path** before
anything runs against a production branch. That fix is unchanged and still required.

---

## Sandbox 2 deployment

`https://sandbox-2-data-free-corsteadllc.replit.app` — logins are `team_admin` (super admin),
`team_office` (office admin), `team_tech` (field tech).

**Tested 2026-09-05, and the deployed build predates all five calendar commits.** The app is
healthy — login works, the week view renders, zero console errors — but none of the calendar
work is on it:

- The Week/Month toggle is absent. It is rendered unconditionally in
  `Schedule.tsx:557-570`, so its absence is conclusive; that toggle arrived in `24f8a66`
- `GET /api/calendar/totals` and `/api/calendar/occurrences` both return **404**, so even
  `a439f26`, the earliest calendar commit, is not deployed
- `GET /api/jobs/unscheduled` returns 200, confirming it is an older but working build

**"Rev 83" in the footer proves nothing.** `artifacts/crm/src/version.ts` has only ever been
touched by the initial import commit, so the number was never bumped and cannot identify a
build. Do not use it to decide whether a deploy landed — probe an endpoint instead.

The Replit *workspace* does have the new code — the Vite `@dnd-kit/core` resolution error the
user hit names `MonthCalendar.tsx` — but the workspace needs `pnpm install`, and the deployed
app needs a redeploy. They are two separate things.

**The migration has not run either.** `.replit` sets `APP_MIGRATIONS_ENABLED = "false"` under
`[userenv.development]`, which the gate reads as disabled, so startup skips it silently and no
table is created. `APP_MIGRATION_ENVIRONMENT` and `APP_MIGRATION_SANDBOX_REPL_ID` are already
correct; only that one value needs to become `"true"`.

## Browser test of the deployed month view — 2026-09-06

Republished at last, and tested on Sandbox 2 as `team_admin`. **The calendar work is live and
behaves.** Verified: calendar endpoints return 200; the Week/Month toggle is present; the month
grid renders with adjacent-month spill days; weekly totals and the summary block appear; zero
console errors, so `@dnd-kit` resolves correctly in the built bundle; month paging works and
prefetches the neighbouring months; completed jobs carry `aria-disabled="true"` on their drag
handles, so `schedule-change-lock` is doing its job; at 390px there is no horizontal scroll.
The summary is also correctly labelled **Scheduled Job Value**, not "Sales" (§9.1).

### ✅ Fixed 2026-09-07 — the monthly summary counted spill days, putting a job in two months

Measured directly against the API:

| Range | Jobs | Value |
|---|---|---|
| True August (`08-01`..`08-31`) | 2 | $525.00 |
| True September (`09-01`..`09-30`) | **0** | **$0** |
| September's grid (`08-31`..`10-04`) | 1 | $100.00 |

September has no scheduled work at all, yet its summary block reads "Scheduled jobs 1 ·
Scheduled Job Value $100.00". That is the 31 August job (Emberlynn Haskins, 10000 cents)
appearing as a spill day — and the same $100 is counted again in August's summary, because
August's grid runs `07-27`..`09-06` and also contains 31 August.

Drawing the spill day is correct (§3.1) and counting it in the *weekly* total is correct. What
is wrong is the **monthly** summary using the grid range. It breaks §9.2 ("one job counts
once"), it is the double-counting §17 warns about, and it contradicts the client's 2026-09-05
decision that a job's value belongs to the month of its first scheduled day.

**The fix, applied 2026-09-07.** No extra request was needed. The server's `period` is itself a
plain `days.reduce(...)` over the same per-day rows (`routes/calendar.ts:186`), and each job
sits on exactly one date, so summing the in-month subset of `days` is the identical arithmetic
over the right window.

- New `artifacts/crm/src/lib/calendar-totals.ts` holds the totals types plus `totalsByDate` and
  a new `sumDayTotals(totals, includes)`. It exists as a separate module because
  `calendar-api.ts` reads `import.meta.env` and fetches, which makes it unloadable under
  `node:test` — the same reasoning behind the server's `*-core.ts` split. `calendar-api.ts`
  re-exports it, so no caller changed.
- `MonthCalendar.tsx` now builds the set of `GridDay.inMonth` dates and sums those. Day cells
  and the weekly footers still use the full grid, which is correct — a spilled day is real
  work on that week.
- `sumDayTotals` returns `undefined` before the first response, so an unknown figure still
  renders as "—" rather than a confident `$0.00`.
- 8 tests in `calendar-totals.test.ts`, including the two-months-one-job case and the
  hidden-amounts case where a null must not sum to zero. CRM suite: 350/351, the single
  failure being the known Windows path bug.

**Still to watch:** summing per-day rows is only safe while one job occupies one date. Once
`schedule_entries` allows multi-day jobs, a job would appear on several day rows and this
would double-count it — §9.2 again. When Step 2 lands, the roll-up has to count distinct jobs,
not add day rows.

### Not yet testable

Every job in the sandbox is **completed**, so all drag handles are correctly disabled. A
successful drag, the undo toast, and the crew double-booking dialog could not be exercised.
They need at least one job in `scheduled` status, ideally two on one day sharing a crew.

## Neon — development branch is live in the right region, 2026-09-11

**The region problem is fixed.** Joel recreated the project in **AWS US West 2**, matching where
Replit runs. The old `us-east-2` project (`crimson-lab-48199662`) is retired — confirm it is
deleted if it still shows in the console.

| | |
|---|---|
| Region | AWS US West 2 — same as Replit |
| Postgres | 18.6 |
| Development endpoint | `ep-ancient-resonance-ar0ob1sr.c-4.us-west-2.aws.neon.tech` |
| Database | `neondb` |

**⚠️ The console hands out the `-pooler` host.** The string Joel sent was
`ep-ancient-resonance-ar0ob1sr-pooler...`. Strip `-pooler` before using it: the transaction-mode
pooler disables prepared statements, which `node-postgres` and Drizzle rely on. Everything below
was done against the direct endpoint.

**Schema applied 2026-09-11.** `drizzle-kit push` created **75 tables**, including all four
calendar tables, `queue_status`, `schedule_entries_queue_idx` as
`btree (status, created_at, id)`, `allocated_value_cents` as `numeric(18,0)`, and 12 check
constraints on `schedule_entries`. Nothing has been applied to `production` — it still holds
zero tables, and must stay that way until the migration gate grows a production path.

### Verified again on the new project, not assumed

Bad rows inserted inside a transaction, then rolled back. Every constraint fired:

| Attempt | Result |
|---|---|
| Queued entry with `needs_contact` | accepted |
| On hold with a reason | accepted |
| An invented waiting reason | rejected — `schedule_entries_queue_status_check` |
| A waiting reason on scheduled work | rejected — `schedule_entries_queue_status_scope_check` |
| `scheduled` with no date | rejected — `schedule_entries_scheduled_needs_date_check` |
| `on_hold` with no reason | rejected — `schedule_entries_hold_needs_reason_check` |
| Money on a non-primary day | rejected — `schedule_entries_value_on_primary_check` |

### Data: seeded, not migrated — decided 2026-09-12

Replit's own database held 3 customers, 2 jobs, 5 quotes, 3 invoices and 4 users. A full
`pg_dump` was taken and is reproducible at any time, but **it was not restored**. The user chose
to start clean instead, and that was the right call: Kyle had already confirmed the data is
disposable, and two jobs would not have exercised the queue anyway.

**The one thing that actually mattered was the logins.** An empty `users` table means nobody can
sign in — not even to create the first account. So the three sandbox accounts were seeded
directly, keeping the exact credentials Kyle and Lute already have:

| Username | Role |
|---|---|
| `team_admin` | `super_admin` |
| `team_office` | `office_admin` |
| `team_tech` | `field_tech` |

`artifacts/api-server/src/lib/seed-team-users.ts` hashes with the same `hashPassword` the login
path verifies against, refuses a role `authorization.ts` does not know, and refuses usernames
that differ only in case (`users_username_lower_unique` is case-insensitive). 8 tests. Verified
against the live database: each password is accepted and each near-miss rejected.

**Two things that could not be done from this machine**, both blocked by the permission
classifier, both needing the user to act in their own terminal or the Neon console:

- `DROP SCHEMA public CASCADE` — use Neon's **Reset from parent** on the development branch
  instead. That is how the branch was emptied.
- Bulk SQL restore (`psql -f`, and running a dump through `node-postgres`). If a real restore is
  ever needed, hand the user the `psql` command rather than attempting it here.

**Also learned:** Neon does not grant `neondb_owner` either `--disable-triggers` (needs
superuser) or `SET session_replication_role = replica`. So a **data-only** restore into an
existing schema is not possible on Neon — the only route is a full dump into an empty schema,
where foreign keys are added after the data.

### Replit ↔ Neon connected and verified end to end — 2026-09-13

After Lute added the `DATABASE_URL` Secret, a baseline of migrations #5 and #6, and a restart on
the synced code, verified from outside Replit with a real login:

| Check | Result |
|---|---|
| `team_admin` login through the dev URL | 200; user id matches the row seeded in Neon |
| Session row written to Neon by that login | yes — proves Replit reads and writes Neon |
| Ledger | **10/10 applied** (#5, #6 marked `baseline: true`) |
| `GET /schedule-queue?tab=ready` and `on_hold` | 200, empty, bounded (`limit 50`, `maxLimit 100`) |
| `GET /schedule-queue/statuses` | 200, all seven reasons |
| `tab=due`, `limit=500` | 400 with `wrong_endpoint` / `bad_limit`, as designed |

**Two traps met on the way:** an unauthenticated 401 proves nothing about whether a route
exists — `authorizeApiRequest` answers 401 for any `/api` path, real or not; only an
authenticated request separates 404 from 200. And Replit's shell `git pull` fails on GitHub auth,
but the workspace syncs through Replit's own integration (`dd8c56f Sync GitHub main through
5aa4d82`); after a sync the server still needs a **restart** to pick the code up.

### ⚠️ Step 2 gap found and closed: nothing wrote `schedule_entries` after the backfills

Testing the connected app exposed it. **No application code inserted or updated
`schedule_entries`** — only the two migrations, which run once. So a job created or re-dated after
them never reached the queue, and moving a job's date from the job page or the month grid left its
entry stale. Step 2 had been reported complete; this part was missing.

Jobs are written from nine places (`routes/jobs.ts` ×2, `estimates.ts`, `quotes.ts`,
`recurring_plans.ts`, `lib/recurring-plan-engine.ts`, `lib/customer-initial-job-db-adapter.ts`,
`routes/admin.ts`, and raw-SQL importers in `services/import/applier.ts` and
`lib/import-cf-file.ts`). Wiring each by hand would leave the next new path silently out of sync.

**Fix: `calendar_entry_sync_v1`** — a trigger on `jobs` (`AFTER INSERT OR UPDATE OF` the seven
scheduling columns only, so notes and crew edits do not rewrite entries) that maintains the
primary entry with exactly the backfills' mapping. Precedent for triggers already exists in
`communication-safety-immutability.sql`.

Rules worth not re-deriving:

- **A held entry is never demoted.** `holdEntry` sets the entry `on_hold` and *then* clears
  `jobs.scheduled_date`; without this rule the trigger would bounce it straight back to `queued`
  and lose the reason. This is the bug a naive trigger would have shipped.
- Cancellation wins over a date; a queued entry keeps a waiting reason someone already set; dating
  a job clears the reason (scope constraint); moving between two dates bumps `rescheduled_count` and
  keeps `original_scheduled_date`.
- Undated cancelled or finished jobs get no entry — same as both backfills.
- A malformed legacy date or time is treated as absent, not raised, so importers keep working.
- Reconciliation fires the trigger (`UPDATE jobs SET status = status` on jobs missing an entry)
  rather than keeping a second copy of the mapping in SQL.
- Rollback drops the trigger and function but never the entries.

**Proven on Neon, not only in tests:** 11 scenarios run inside one transaction on the development
branch and rolled back — all pass, zero trigger left behind. 17 unit tests.

**Deployed and tested end to end on the live dev app, 2026-09-13** (commit `7e838fb`, ledger 11/11,
trigger enabled). Driven through the real HTTP API as `team_admin`, against the Replit dev URL —
16 of 16 checks passed:

- A job created with no date appears in Ready to Schedule as Needs Contact with its whole value
- Changing the waiting reason, hold (moves to On Hold with its reason, leaves Ready), release
  (back as Ready to Schedule) and schedule from queue (leaves both tabs) all work
- The job page shows the new date and `scheduled` status — the legacy mirror stays in sync
- Holding twice and scheduling twice both return 409 `already_there`
- Clearing the date through the ordinary `PATCH /jobs/:id` puts the job back in the queue — the
  trigger covering a path the queue service never touches

Test customer and job were deleted through the API afterwards. Playwright MCP failed to connect
in that session, so this was HTTP-level, not a browser run: the three-tab UI itself has still not
been clicked through.

**One defect the run surfaced, fixed afterwards:** the queue service wrote the user's *email* to
`performed_by` (`team_admin@corstead.test`) while every other route writes the *name*
(`Team Admin`) — one person under two identities in the same activity feed. The rest of the app
uses name → email → id (`getPerformedBy`, copied across eight route files); the queue now uses the
same order through `actorLabel` in `lib/schedule-queue-core.ts`, tested. Needs a deploy to reach
Replit. The E2E run left nine `activity_logs` rows for the deleted test customer (id 2); they
carry no foreign key, so they outlive it. Harmless, left in place.

**Browser UI test on the live dev app, 2026-09-13** (commit `3ebd9b7` deployed). Playwright MCP
still timed out, so the test drove the cached `playwright-core` 1.63 and the locally installed
Chromium 1243 directly from a Node script — a real browser, not HTTP calls. **16 of 16 passed,
zero browser console errors:** login through the form; the queue renders with three tabs and the
old fallback panels stay hidden; cards show Needs Contact, Today and $125.00; Put on hold and
Schedule stay disabled until a reason or date is given; hold moves the card to On Hold with its
reason; release returns it as Ready to Schedule; the waiting-reason dropdown and the Contacted
filter chip work; scheduling through the dialog removes the card and writes the date and time to
the job; and queue actions are now logged as `Team Admin`, confirming the audit-identity fix
reached Replit. Test data deleted afterwards.

Two things that looked wrong in screenshots and were **measured, not fixed**:

- Dialogs looked translucent. Computed style after the animation settles is
  `rgb(245, 248, 250)`, opacity `1` — the screenshots caught the 200 ms open animation.
- Right after "Job scheduled", the tab badge, chips and the header "unscheduled" count still showed
  the old number for about a second, then all corrected once the refetch landed. A brief lag, not
  stale data. Could be made instant by decrementing counts optimistically; not worth it yet.

To rerun: the scripts live in the session scratchpad, not the repo. The approach — resolve
`playwright-core` from the npx cache whose `browsers.json` matches the installed Chromium
revision — works without the MCP server.

**Visible (headed) walkthrough for the user, 2026-09-14.** Same approach with `headless: false`
and a caption banner, following the manual test guide exactly and creating the customer and job
**through the forms**, not the API. 16 of 17 passed on the first run. The one failure was the
test, not the app: `getByRole("button", { name: "Hold" })` without `exact` matched the **On Hold
tab**, and the tech had no assigned jobs, so "no buttons" was being checked on an empty queue.
Rerun properly with an undated job assigned to `team_tech`: the tech sees that card with no
Schedule, Hold, Release or reason dropdown, no price, and the server answers a hold attempt with
**403**. 4 of 4 passed.

Two things the walkthrough confirmed for anyone testing by hand: **New Job pre-fills today's
date** — clear the field or the job goes straight onto the calendar instead of the queue; and
clearing a job's date from the job page's Edit form sends it back to Ready to Schedule on its own.

### Sandbox 2 republished — new code, but still on the old Replit database — 2026-09-14

The user now has an **owner** login, which is what republishing needed; earlier attempts silently
did nothing for lack of permission. Measured straight after publish:

| Check | Result |
|---|---|
| Published asset `Last-Modified` | 14 Sep 06:50 GMT — new build live |
| `GET /api/schedule-queue/statuses` | 200 — new API code |
| Which database | **Old Replit production DB** (`ep-rapid-base`): its `sessions` went 8 → 9 on login, Neon stayed 13 → 13 |
| `GET /api/schedule-queue?tab=ready` | **500** — `queue_status` column missing |
| Data | Old data, 3 customers |

**⚠️ Replit's publish generates its own schema SQL — from the wrong database.** Publishing showed
"Development database changes detected → Generated migrations to apply to production database"
and asked for approval. The SQL was additive (no `DROP`): the four calendar tables, their FKs and
indexes, plus three reporting indexes. But it **omitted `queue_status`, its two constraints, the
queue index, and the sync trigger and function**. It was diffed against Replit's own stale
development database (helium), where our migrations only ever reached
`calendar_schedule_entries_v1` — not against Neon. Approved deliberately, because nothing is
destructive, a full backup exists (`C:\Users\HC\Documents\corstead-backups\`) and Replit keeps
7-day point-in-time recovery, and publishing was the only way to learn which database the deployment
binds to.

**This will recur on every publish** while a Replit production database stays connected: Replit
keeps diffing helium, not the schema our migrations own. That is the strongest argument for putting
Sandbox 2 on Neon rather than patching the old database.

**Why the switch is awkward:** while `DATABASE_URL` sits in Secrets, Replit shows "External database
detected" and hides every production-database option. The Database → Settings page offers only
connection details, point-in-time recovery, scheduled backups, **Regenerate credentials** (would take
Sandbox 2 down) and **Delete database** (permanent). There is no disconnect.

**Open decision:** (a) move Sandbox 2 to Neon — one database, full schema, trigger and ledger
already verified — or (b) finish the schema on the old database by running the queue and sync
migrations against it. Recommended (a), with Lute's go-ahead before anything is deleted.

**Decided 2026-09-14 (user): (a) — Sandbox 2 moves to Neon**, since Neon is the long-term database
anyway. Deleting the Replit production database waits on Lute's explicit OK. Meanwhile Sandbox 2
runs the new code on the old database and shows "Failed to load the scheduling queue" in the queue
section; the rest of the Schedule page works. Kyle should test the queue on the dev link until the
switch is done.

### ✅ Sandbox 2 moved to Neon — done 2026-09-14

Verified after the final publish (build 12:43 GMT): login 200, **Neon `sessions` 13 → 14** on
login, `GET /schedule-queue` 200 on both tabs, statuses/customers/calendar totals 200, and the data
is Neon's (0 customers, the 3 seeded logins). The dev link and Sandbox 2 now share one database.

**What it actually took — the part not to rediscover:**

1. **Owner access.** Republish silently does nothing without it.
2. **Fresh backup first** — `C:\Users\HC\Documents\corstead-backups\replit-production-2026-09-14-before-delete.sql`
   (76 tables: 3 customers, 2 jobs, 4 users, 5 quotes, 3 invoices).
3. **Delete the Replit production database.** Replit offers no disconnect; its options (and the
   delete) are hidden while `DATABASE_URL` is in Secrets, so the Secret was removed first, the
   database deleted with Lute's agreement, and the Secret re-added with the Neon value.
4. **The trap: republishing still failed** with `The endpoint has been disabled` — the deleted
   database. The workspace Secret was right, but **Publishing → Adjust settings → Production app
   secrets** held a *separate, unsynced* `DATABASE_URL` (broken-link icon) with the old value, plus
   `PGHOST` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` / `PGPORT` that Replit had injected for the old
   database. Replit's banner explains it: production secrets created before 17 Apr 2025 do not
   sync automatically. Fix: on `DATABASE_URL`, **⋮ → Sync to workspace value**; delete the five
   `PG*` variables (nothing in the code reads them — grep confirmed); Publish.
5. Secret changes only take effect on the **next** publish; probing before "published just now"
   still shows the old build.

**Diagnosis tip:** the login route's 500 body hides the driver's cause, but the deployment log
line at `"level":50` carries it under `caused by:`. That line named the deleted endpoint.

**Follow-ups this surfaced:**
- The login route has no error handling ("Unhandled route error"), and the error handler returns
  the raw Drizzle message to the client — **SQL text and the submitted username leak in the 500
  body**. Fix: catch in the route and return a generic message; log the detail server-side only.
- Replit's publish-time schema diff runs against its own development database, not our
  migrations. With no Replit production database now attached it should stop proposing SQL, but
  watch the next publish: if it offers to create a production database, decline.

### ⚠️ Never `drizzle-kit push` a database the migration framework will run on — 2026-09-13

Once Replit finally connected to Neon, startup aborted:
`Profile details schema already exists outside the migration ledger; manual review required`.

**Cause — our own doing.** The Neon schema was built with `drizzle-kit push`, which creates the
*final* shape: every table, including the ones migrations exist to create. The ledger was empty,
so each migration thought it still had work to do. Most are `IF NOT EXISTS` and shrugged; two
deliberately refuse a pre-existing schema:

| # | Migration | On a pushed schema |
|---|---|---|
| 1–4 | account-lifecycle, properties-contacts, invoice-properties, team-users-rbac | applied |
| 5 | `profile-details-catalogs-v1` | **refuses** in preflight |
| 6 | `estimate-lifecycle-v1` | **refuses** in preflight; its `apply` has no `IF NOT EXISTS` either |
| 7–10 | dashboard indexes, crew graph, both calendar migrations | tolerant |

**Fix — baseline #5 and #6, with evidence.** Run each migration's own `verify()` and, only if it
passes, record the ledger row as `applied` (framework's advisory lock `(3, 1)`, one transaction,
matching checksum, environment `sandbox`, summary marked `baseline: true`). A read-only run of both
`verify()` calls against Neon **passed**: 6 tables + 4 property columns, and 7 tables, zero rows
seeded. The script is `lib/db/baseline-tmp.mjs`; writing the ledger was blocked by the permission
classifier, so the user runs it.

**Consequence worth knowing:** a baselined migration has no inventory backup row, so its
`rollback` will refuse. That is the safe failure — rollback would drop tables the app needs.

**Rule from here:** a fresh database for this app gets its schema from the **migrations**, not
from `drizzle-kit push`. If push is ever used, baseline the strict migrations before the server
starts against it.

### From the first project, still true

### The constraints were proven, not assumed

Inserted deliberately bad rows inside a transaction and rolled back. The database refused
every one it should:

| Attempt | Result |
|---|---|
| Primary entry carrying the job's value | accepted |
| Second segment with zero value | accepted |
| **Money on a non-primary day** | **rejected** — `schedule_entries_value_on_primary_check` |
| A second primary for the same job | rejected — `schedule_entries_one_primary_unique` |
| `on_hold` with no reason | rejected — spec §4.6 holds |
| `scheduled` with no date | rejected |
| Time carrying seconds (`09:30:00`) | accepted — the Replit-compatibility fix works |
| An invented status | rejected |

So Kyle's Option A rule — a job's whole value on the day it starts, nothing on later days — is
enforced by the database itself, not merely by application code.

### Facts learned in the process

- **Neon runs PostgreSQL 18.6; Replit runs 16.** A dump from 16 restores into 18 fine. The
  reverse does not, so moving *back* to Replit later would not be a simple restore.
- **`sslmode=require` should be `sslmode=verify-full`.** `pg` warns that `require`'s meaning is
  changing; today it behaves like `verify-full`, but a library update would silently weaken it.
  Use `verify-full` in the strings we store.
- **Use the direct endpoint, never the `-pooler` host.** The console defaults to pooling on.
- **⚠️ `pnpm --filter @workspace/db run push` fails on Windows.** `drizzle.config.ts` builds the
  schema path with `path.join`, which yields backslashes, and drizzle-kit's internal glob reads
  a backslash as an escape — "No schema files found". Not a code defect; it works on Linux.
  Workaround, without touching the committed config:
  ```
  cd lib/db
  npx drizzle-kit push --dialect=postgresql --schema=./src/schema/index.ts --url="$DATABASE_URL"
  ```

### ⚠️ Wrong region — fix before anyone tests against it

The project is in **AWS US East 2 (Ohio)**. Replit's own Postgres — which is itself Neon — is in
**us-west-2**, so the application servers are there too. Every query would cross the country,
roughly 60 ms each way, and a page that issues a handful of queries feels it.

Neon cannot move a project between regions. The fix is to create a new project in `us-west-2`
and push the schema again. **Kyle confirmed on 2026-09-11 that nothing in any of these databases
needs preserving**, so today this costs ten minutes. After Kyle starts testing against it, it
becomes a data migration.

### Still to do

- Recreate the project in `us-west-2` (above), then re-push the schema
- Point the Replit development environment at this branch by setting `DATABASE_URL`
- Run the `calendar_schedule_entries_v1` and `calendar_queue_entries_v1` backfills there — they
  need the app's migration gate, so they run on Replit rather than from a laptop
- Everything in the revised migration plan below from step 5 onward

## Database move to Neon — the agreed plan

Agreed with Lute on 2026-09-06, provider settled 2026-09-07. **Nothing has been done yet.**

**Scope: only the database moves.** Application, hosting, development and publishing all stay
on Replit. This is not a plan to leave Replit.

**Why now:** the four Step 1 tables do not exist in any database yet. Moving first means they
are created once, in the right place. Moving in six weeks would mean migrating live scheduling
data instead.

### Why Neon rather than Supabase

Supabase's value is what surrounds the database — auth, file storage, realtime, an
auto-generated REST layer. **We use none of it**: there is a local username/password login
(verified by logging into Sandbox 2 with it), and files go to Google Cloud Storage. Adopting
Supabase would mean taking a platform to use one part of it.

There is also a concrete problem: Supabase's transaction-mode pooler disables prepared
statements, which `node-postgres` and Drizzle rely on. Workable, but a permanent trap.

Neon does one thing — Postgres — and its branching maps onto Lute's dev/production requirement:
development can be a branch of production, so it holds realistic data and resets in seconds.

### Nothing about the schema changes

Worth being explicit, because it is the obvious worry. Both are PostgreSQL. Same 59 tables,
same columns, same constraints, same indexes. The schema is defined in TypeScript under
`lib/db/src/schema/` and our own migration system owns it — which is exactly what Lute asked
for. On our side the move is one connection string.

`lib/db/src/index.ts` is a plain `new Pool({ connectionString: process.env.DATABASE_URL })`
with no Replit-specific driver, so there is nothing else to unpick.

Verified: the only Postgres function used beyond the standard set is `gen_random_uuid()`,
built in since PG 13. No extensions to port.

~~**But copy production with `pg_dump`, do not rebuild it from the schema.**~~ `replit.md:69`
mentions GIN trigram indexes that do not appear anywhere in the Drizzle schema, so the live
database may hold objects the TypeScript does not describe. A dump would carry those across; a
rebuild loses them.

**Superseded 2026-09-11.** Kyle confirmed there is no operational data to preserve, so there is
nothing to dump. Build the schema from `lib/db/src/schema/` instead — it is the source of truth,
and an object the TypeScript does not describe is an object nobody asked for. If a trigram index
turns out to be needed for search performance, add it to the schema deliberately.

### Cost — estimates from published pricing, to be confirmed after a month

| Plan | Restore history | Rough monthly, both databases |
|---|---|---|
| Launch | 7 days | $25–40 |
| Scale | 30 days | $50–80 |

Compute is $0.106/CU-hour on Launch, storage $0.35/GB-month, history $0.20/GB-month. Storage
for a database this size is a rounding error; almost all of it is compute. Recommendation:
Launch plus our own nightly export, which buys longer retention for far less than Scale.

### Backups are two separate things

1. **Instant restore**, built in. Neon keeps a continuous change history, so we can rewind to
   any moment inside the window. This covers accidental deletes.
2. **Scheduled export**, which we build. Instant restore is *not a file*. Leaving Neon, or
   needing something older than the window, needs real `pg_dump` output — nightly to object
   storage, 30 days daily and 12 months monthly.

Only point 2 answers Lute's "export independently" requirement. The two are easy to conflate
and he asked for both.

### ⚠️ One code fix is required before any production cutover

`evaluateMigrationGate` refuses anything whose `APP_MIGRATION_ENVIRONMENT` is not `"sandbox"`,
and `runRequiredMigrationsAtStartup` **throws** when migrations are enabled but not eligible.
Against a production database the server would refuse to boot. The gate needs a production
path, with stricter confirmation than sandbox. This has to land before step 7 below.

### Migration plan — revised 2026-09-11

Rewritten after Kyle confirmed there is no operational data to preserve. The original plan was
shaped around moving a live dataset safely; that risk is gone.

| # | Step | State |
|---|---|---|
| 1 | Neon account with Lute as owner, us added — access separate from the start | Done; ownership to move to Lute |
| 2 | Two branches: `production` (default) and `development` | Done |
| 3 | **Recreate the project in `us-west-2`** to match where Replit runs | **Done 2026-09-11** |
| 4 | `drizzle-kit push` the schema into `development` | **Done 2026-09-11** — 75 tables, constraints proven |
| 5 | Point Replit development at Neon (`DATABASE_URL`) and set `APP_MIGRATIONS_ENABLED = "true"` | **Next — this is the blocking step** |
| 6 | Run the calendar backfill migrations there, from a clean database | Next |
| 7 | Fix the migration gate to allow a production environment | Before step 8 only |
| 8 | Create the schema in `production` and verify it matches `development` | Not started |
| 9 | Nightly `pg_dump` export to object storage — Lute's "export independently" requirement | Not started |
| 10 | Prove a restore into a scratch database before calling this finished | Not started |
| 11 | Document connection, migration, backup and restore | Not started |

**Dropped from the original plan:** copying production data across and verifying row counts;
the out-of-hours cutover window; leaving the Replit database read-only for two weeks. All three
existed to protect data that does not exist.

**Step 3 is the one with a deadline.** The Neon project sits in `us-east-2` while Replit runs in
`us-west-2` — roughly 60 ms per round trip between them, on every query. While both branches are
empty this is a delete-and-recreate. Once Kyle is testing against it, it is a data migration.

**Settled:** Lute asked for separate dev and production; the user at one point said a single
database. Neon branches give both readings what they want — one project, one bill, two isolated
databases — so this is no longer open.

---

## Architecture — asked and answered 2026-09-07

The user asked whether to restructure the codebase into MVC, with models and controllers in
separate folders, for future scalability.

**Measured first:**

| Layer | State |
|---|---|
| Models | Already separate — 59 schema files in their own package, `lib/db` |
| Controllers | Present but fat — **18,324 lines** across `routes/`, `jobs.ts` alone 1,371 |
| Domain logic | 12 `*-core.ts` pure modules — a good pattern, applied inconsistently |

**Decision: no big-bang restructure. Adopt the layering on new code, and migrate old code as we
touch it.**

Reasoning:

- **"MVC" is the wrong label here — there is no View.** This is a headless API with a separate
  React SPA. What is actually wanted is layering: routes → services → repositories → models.
  Calling it MVC invites confusion about where the V went.
- **The `*-core.ts` pattern is the codebase's best asset and a classic MVC refactor would
  destroy it.** Those modules are dependency-free, which is precisely why ~400 server tests run
  with no database. Fat models would take that away.
- **Timing.** Lute asked explicitly that feature work not stall, and the database move is
  already in flight. Two structural changes at once means debugging both together.
- **`estimate-appointment-contract.test.ts:227-308` regex-matches the source text of
  `quotes.ts`** and asserts an exact stage list. A restructure breaks it, and it guards a real
  invariant.

Target shape, to be used for Step 2 since it is entirely new code:

```
routes/schedule-queue.ts         HTTP only — parse, authorize, respond
services/schedule-queue.ts       business rules, transactions
repositories/schedule-entry.ts   Drizzle queries, no rules
lib/schedule-queue-core.ts       pure decisions, no I/O
lib/db/src/schema/*.ts           models (already there)
```

This sets the pattern at zero risk, then `jobs.ts` gets extracted when Step 4 touches it.

---

## Environment gotchas

- **Running the app locally on this Windows machine — verified 2026-09-22.** Three things block
  a plain start, none of them fixable in the repo without side effects:
  1. `pnpm-workspace.yaml` overrides away every non-Linux native binary, so Vite dies on a
     missing `@rollup/rollup-win32-x64-msvc`. The Windows builds of Rollup 4.59.0, LightningCSS
     1.31.1 and `@tailwindcss/oxide` 4.2.1 are installed in `scratchpad/win-natives` and reached
     through `NODE_PATH` — the repo and its `node_modules` are untouched.
  2. **Windows reserves TCP 8000–8099** (Hyper-V/WSL; `netsh interface ipv4 show
     excludedportrange protocol=tcp`), so the API cannot bind 8080: `listen EACCES`. The
     ranges move between reboots. Use `PORT=3001`.
  3. Git Bash rewrites `BASE_PATH=/` into `C:/Program Files/Git/`. Prefix `MSYS_NO_PATHCONV=1`.

  API: `node ./build.mjs`, then `PORT=3001 NODE_ENV=development APP_MIGRATION_ENVIRONMENT=sandbox
  APP_MIGRATIONS_ENABLED=false BACKGROUND_PROCESSING_ENABLED=false DATABASE_URL=… node
  ./dist/index.mjs`. **`APP_MIGRATION_ENVIRONMENT=sandbox` is what keeps the background
  schedulers off** — without it they start and write to whatever database `DATABASE_URL` names.
  CRM: `MSYS_NO_PATHCONV=1 NODE_PATH=<win-natives>/node_modules PORT=5174 BASE_PATH=/
  API_PROXY_TARGET=http://localhost:3001 npx vite --config vite.config.ts --strictPort`, then
  http://localhost:5174. Until the Neon `dev` branch exists this points at the same database as
  Sandbox 2.

- **`node_modules` was found broken on 2026-09-05 and has been repaired.** Every top-level
  package directory was empty (`typescript`, `drizzle-orm`, `zod`, `date-fns`) while
  `node_modules/.pnpm` still held the content — the symlinks pnpm puts at the top level were
  gone. A reinstall fixed it. If it happens again, suspect anything that copies the tree
  without preserving symlinks.

- **`pnpm` is not on PATH and cannot be put there.** `corepack enable pnpm` fails with EPERM
  because it writes to `C:\Program Files\nodejs`. Run it through corepack instead:
  `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true corepack pnpm@10 <command>`. Two gotchas: the root
  `preinstall` script needs `sh`, so **run installs from Git Bash, not PowerShell**; and any
  script that calls `pnpm` recursively (the root `typecheck` does) needs a `pnpm.cmd` shim on
  PATH forwarding to `corepack pnpm@10`.

- **Superseded by the Neon move (2026-09-11):** the database is now reachable from this machine
  with the Neon connection string; the note below describes the Replit-only era.
  **There is no local database.** No `.env` anywhere and `DATABASE_URL` is unset; `.replit`
  provisions `postgresql-16`, so the database lives in the Replit environment. Consequently
  `drizzle-kit push` and the migration CLI **cannot be run from this machine** — they have to
  run where `DATABASE_URL` exists.

- **Known pre-existing test failures** (verified 2026-09-05, unrelated to any current work):
  api-server 392/407 pass, the 15 failures all being `DATABASE_URL must be set`; crm 342/343
  pass, the one failure being a Windows path bug inside `src/lib/auth-scope.test.ts` that
  builds `E:\E:\Projects\...`. Treat both as the baseline.
- **Playwright MCP is configured** in `.mcp.json` at the repo root (`npx -y @playwright/mcp`),
  with Chromium installed. Browser tools require a session restart to load, and the server has
  timed out on connect at least once (30s) — retry rather than assuming it is missing. It was
  used to test the deployed calendar on 2026-09-06 and is the fastest way to check a deploy
  actually landed.
- **Probe an endpoint to tell whether a deploy landed.** The footer's "Rev" number comes from
  `artifacts/crm/src/version.ts`, which has not changed since the initial import, so it is
  useless for identifying a build. `GET /api/calendar/totals` returning 404 versus 200 was what
  actually settled it.
- **Replit's workspace and its published app are two different things.** Pulling code into the
  workspace does not change `sandbox-2-data-free-corsteadllc.replit.app`; that needs a
  Republish. The user could not republish until Lute granted Publisher access.
- **Never run `git commit` or `git push`.** Give the user the commit message to paste.
- `lib/db/src/schema/communication-safety-immutability.sql` is **not referenced by any code**
  — a manual DBA artifact. Its append-only triggers cover only
  `communication_preference_history` and `communication_eligibility_decisions`.
- Schema changes go through `drizzle-kit push`, **not** migration files — there are no
  checked-in Drizzle SQL migrations. A new table needs its schema file **plus** an
  `export * from "./name.ts";` line in `lib/db/src/schema/index.ts`, or push ignores it. The
  separate `artifacts/api-server/src/migrations/` framework is reserved for data-bearing or
  destructive changes.
- `routes/estimate-appointment-contract.test.ts:227-308` **regex-matches the source text** of
  `routes/quotes.ts` and asserts an exact stage-name list. Reordering or renaming stages there
  breaks it.
