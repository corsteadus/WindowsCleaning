---
name: Dashboard reporting semantics
description: Durable definitions for period-aware business metrics and historical estimate conversion.
---

Period accepted/declined metrics use only the effective current-revision customer decision with an auditable decision timestamp. Status-only legacy decisions with no trustworthy decision time are excluded rather than assigned a misleading proxy date.

**Why:** Quote creation and update timestamps are not decision events, and later revisions must not rewrite historical conversion reporting.

**How to apply:** Use immutable conversion activity timestamps for modern conversions, the controlled legacy acceptance exception only for missing historical conversion events, posted payment amounts for cash sales, and positive remaining invoice balances for outstanding/past-due totals.

All business-date reporting boundaries use America/Chicago as a fixed application rule. Public APIs must not accept caller-selected timezone overrides for dashboard or reconciliation ranges.

**Why:** A default-only timezone still permits UTC/calendar drift when an exposed query override or process timezone reaches one reporting path but not another.

**How to apply:** Derive date-only periods and SQL timestamp boundaries from America/Chicago consistently; keep alternate timezone parameters limited to isolated internal test seams.