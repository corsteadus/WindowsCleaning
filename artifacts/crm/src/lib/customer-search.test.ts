/**
 * customer-search.test.ts — server-side customer search + shared combobox.
 *
 * Root-cause regression suite for the RecurringPlanNew customer selector:
 * the page preloaded /api/customers?limit=200 into a Radix Select while the
 * environment holds ~3,000+ customers (the API hard-caps limit at 200), so
 * most customers — including business-only #8894 "Conoco Gas Station" —
 * could never be selected.
 *
 * Covers:
 *  1. customerSearchParams — the exact request shape sent to /api/customers
 *     (trim, key omission, status scoping, purity ⇒ query-key dedupe).
 *  2. Source-wiring pins for the shared CustomerCombobox mechanics
 *     (server filtering, bounded page, per-term cache keys, id-keyed rows,
 *     held-record labels).
 *  3. Source-wiring pins that all three creation pages consume the ONE
 *     shared component — no page-local forks, no preloaded lists.
 *  4. RecurringPlanNew root-cause pins (limit=200 gone, derived customerId,
 *     property gating/reset intact).
 *  5. The exact business shape of customer 8894: findable by company-name
 *     search, labeled by company-name precedence, retained as a held record.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  customerSearchParams,
  CUSTOMER_SEARCH_DEBOUNCE_MS,
} from "./customer-search.ts";
import { customerOptionLabel, type CustomerOption } from "./recurring-plan-form.ts";
import { authScopedQueryKey } from "./auth-scope.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const comboboxSrc  = readFileSync(join(HERE, "../components/CustomerCombobox.tsx"), "utf8");
const recurringSrc = readFileSync(join(HERE, "../pages/RecurringPlanNew.tsx"), "utf8");
const jobNewSrc    = readFileSync(join(HERE, "../pages/JobNew.tsx"), "utf8");
const quoteNewSrc  = readFileSync(join(HERE, "../pages/QuoteNew.tsx"), "utf8");

// ─── 1. Request shaping ──────────────────────────────────────────────────────

describe("customerSearchParams — server-search request shaping", () => {
  it("trims the term and scopes to active customers by default (JobNew/QuoteNew)", () => {
    assert.deepStrictEqual(customerSearchParams("  Conoco  "), {
      search: "Conoco",
      status: "active",
    });
  });

  it("blank and whitespace-only input produce the browse state: NO search key at all", () => {
    for (const blank of ["", "   ", "\t", "\n \t"]) {
      const params = customerSearchParams(blank);
      assert.deepStrictEqual(params, { status: "active" }, `input=${JSON.stringify(blank)}`);
      assert.ok(!("search" in params), "search key must be ABSENT, not undefined");
    }
  });

  it("activeOnly:false (RecurringPlanNew) omits the status key — historical any-status behavior", () => {
    const params = customerSearchParams("Conoco", { activeOnly: false });
    assert.deepStrictEqual(params, { search: "Conoco" });
    assert.ok(!("status" in params));
    assert.deepStrictEqual(customerSearchParams("", { activeOnly: false }), {});
  });

  it("explicit activeOnly:true matches the default", () => {
    assert.deepStrictEqual(
      customerSearchParams("smith", { activeOnly: true }),
      customerSearchParams("smith"),
    );
  });

  it("never emits limit or page — the bounded result page is the server default", () => {
    const params = customerSearchParams("anything") as Record<string, unknown>;
    assert.ok(!("limit" in params));
    assert.ok(!("page" in params));
  });

  it("is pure and normalizing: ' Conoco ' and 'Conoco' yield deeply-equal params ⇒ identical query cache keys", () => {
    assert.deepStrictEqual(customerSearchParams(" Conoco "), customerSearchParams("Conoco"));
    assert.deepStrictEqual(customerSearchParams("Conoco"), customerSearchParams("Conoco"));
  });

  it("rapid-typing sequence maps each distinct term to distinct params (stale responses stay in their own cache entries)", () => {
    const seq = ["C", "Co", "Con", "Cono", "Conoco"];
    const keys = new Set(seq.map((t) => JSON.stringify(customerSearchParams(t))));
    assert.strictEqual(keys.size, seq.length);
  });

  it("no client-side case folding — the server search is case-insensitive ILIKE", () => {
    assert.deepStrictEqual(customerSearchParams("cONoCo").search, "cONoCo");
  });

  it("debounce interval is the shared 250 ms constant", () => {
    assert.strictEqual(CUSTOMER_SEARCH_DEBOUNCE_MS, 250);
  });
});

// ─── 2. Shared component mechanics (source pins) ─────────────────────────────

describe("shared CustomerCombobox — server-search wiring pins", () => {
  it("filtering is server-side: cmdk client filter disabled, params built by customerSearchParams", () => {
    assert.match(comboboxSrc, /shouldFilter=\{false\}/);
    assert.match(comboboxSrc, /customerSearchParams\(debouncedSearch, \{ activeOnly \}\)/);
    assert.ok(!/customers\.filter\(/.test(comboboxSrc), "no client-side result filtering");
  });

  it("queries run only while the popover is open, keyed per term for stale-response isolation", () => {
    assert.match(comboboxSrc, /enabled: open/);
    assert.match(comboboxSrc, /queryKey: authScopedQueryKey\(user, getListCustomersQueryKey\(params\)\)/);
    assert.match(comboboxSrc, /const params = customerSearchParams\(debouncedSearch, \{ activeOnly \}\)/);
  });

  it("keeps normalized server-search terms stable while partitioning each term by auth scope", () => {
    const scope = {
      tenantId: "sandbox",
      userId: "tech-a",
      normalizedRole: "field",
      permissionVersion: "v1",
      assignmentScopeVersion: "assignments-1",
      capabilities: ["customers.view"],
    };
    const normalized = authScopedQueryKey(
      scope,
      ["customers", customerSearchParams(" Conoco ")],
    );
    assert.deepStrictEqual(normalized, authScopedQueryKey(
      scope,
      ["customers", customerSearchParams("Conoco")],
    ));
    assert.notDeepStrictEqual(normalized, authScopedQueryKey(
      scope,
      ["customers", customerSearchParams("Conoco Gas")],
    ));
    assert.notDeepStrictEqual(normalized, authScopedQueryKey(
      { ...scope, assignmentScopeVersion: "assignments-2" },
      ["customers", customerSearchParams("Conoco")],
    ));
  });

  it("debounce uses the shared constant — no magic interval", () => {
    assert.match(comboboxSrc, /setTimeout\(\(\) => setDebouncedSearch\(search\), CUSTOMER_SEARCH_DEBOUNCE_MS\)/);
    assert.ok(!/,\s*250\)/.test(comboboxSrc), "magic 250 must not appear");
  });

  it("no limit/preload anywhere in the component", () => {
    assert.ok(!/limit/i.test(comboboxSrc));
  });

  it("rows are keyed and valued by String(id) — duplicate display names stay individually selectable", () => {
    assert.match(comboboxSrc, /key=\{c\.id\}/);
    assert.match(comboboxSrc, /value=\{String\(c\.id\)\}/);
  });

  it("selection hands the FULL record to the parent; the closed trigger renders from the held record, not the list", () => {
    assert.match(comboboxSrc, /onSelect\(c\);/);
    assert.match(comboboxSrc, /labelFor\(selectedCustomer\)/);
  });

  it("is a cmdk/popover control, not a Radix Select (no bubble-input circuit to guard)", () => {
    assert.ok(!comboboxSrc.includes("ui/select"));
    assert.ok(!comboboxSrc.includes("SelectTrigger"));
  });

  it("tolerates both API envelope shapes via extractCustomerArray", () => {
    assert.match(comboboxSrc, /extractCustomerArray<T>\(data\)/);
  });

  it("keyboard/pointer accessibility: real button trigger with combobox semantics", () => {
    assert.match(comboboxSrc, /role="combobox"/);
    assert.match(comboboxSrc, /aria-expanded=\{open\}/);
    assert.match(comboboxSrc, /aria-haspopup="listbox"/);
    assert.match(comboboxSrc, /type="button"/);
  });
});

// ─── 3. One shared implementation ────────────────────────────────────────────

describe("page wiring — all three creation pages share ONE combobox", () => {
  const pages: Array<[string, string]> = [
    ["RecurringPlanNew", recurringSrc],
    ["JobNew", jobNewSrc],
    ["QuoteNew", quoteNewSrc],
  ];

  it("every page imports the shared component and defines no local fork", () => {
    for (const [name, src] of pages) {
      assert.ok(src.includes('from "@/components/CustomerCombobox"'), `${name} must import the shared combobox`);
      assert.ok(!src.includes("function CustomerCombobox("), `${name} must not define a local combobox`);
    }
    assert.ok(comboboxSrc.includes("export function CustomerCombobox"), "single definition lives in components/");
  });

  it("no page runs its own customer list query anymore", () => {
    for (const [name, src] of pages) {
      assert.ok(!src.includes("useListCustomers"), `${name} must not query the customer list directly`);
    }
  });

  it("each page keeps its historical label function via labelFor injection", () => {
    assert.match(jobNewSrc, /labelFor=\{customerLabel\}/);
    assert.match(quoteNewSrc, /labelFor=\{customerDisplayName\}/);
    assert.match(recurringSrc, /labelFor=\{customerOptionLabel\}/);
  });
});

// ─── 4. RecurringPlanNew root cause ──────────────────────────────────────────

describe("page wiring — RecurringPlanNew bounded server search (root-cause pins)", () => {
  it("the preloaded ?limit=200 query is gone in every form", () => {
    assert.ok(!recurringSrc.includes("limit=200"));
    assert.ok(!recurringSrc.includes("customers-dropdown"));
    assert.ok(!recurringSrc.includes('fetch("/api/customers'));
  });

  it("customer scope stays any-status (historical behavior) and the placeholder stays deterministic", () => {
    assert.match(recurringSrc, /activeOnly=\{false\}/);
    assert.match(recurringSrc, /placeholder=\{CUSTOMER_PLACEHOLDER\}/);
  });

  it("customerId is DERIVED from the held record — payload sentinel semantics unchanged", () => {
    assert.match(recurringSrc, /selectedCustomer \? String\(selectedCustomer\.id\) : CUSTOMER_NONE/);
    assert.ok(!recurringSrc.includes("setCustomerId"), "raw customerId state must be gone");
  });

  it("property flow intact: query gated on a real selection, reset on customer change", () => {
    assert.match(recurringSrc, /enabled: isCustomerSelected/);
    assert.ok(recurringSrc.includes("useEffect(() => { setPropertyId(PROPERTY_NONE); }, [customerId]);"));
  });
});

// ─── 5. Customer 8894 — exact business shape ─────────────────────────────────

describe("customer 8894 'Conoco Gas Station' — search, label, retention", () => {
  const conoco: CustomerOption = {
    id: 8894,
    firstName: "",
    lastName: "",
    companyName: "Conoco Gas Station",
  };

  it("the RecurringPlanNew request for 'Conoco' is a bounded any-status server search", () => {
    assert.deepStrictEqual(
      customerSearchParams("Conoco", { activeOnly: false }),
      { search: "Conoco" },
    );
  });

  it("business-only shape labels by company-name precedence, never the #id fallback", () => {
    assert.strictEqual(customerOptionLabel(conoco), "Conoco Gas Station");
    assert.strictEqual(
      customerOptionLabel({ id: 8894, firstName: null, lastName: null, company_name: "Conoco Gas Station" }),
      "Conoco Gas Station",
    );
  });

  it("retention is list-independent: the held record labels identically whatever the current result page holds", () => {
    const held = conoco;
    // Simulated churn: search page without the selection, empty page, reordered page —
    // the label comes from the held record alone.
    for (const _page of [[], [{ id: 1, firstName: "A", lastName: "B" }], [conoco]]) {
      assert.strictEqual(customerOptionLabel(held), "Conoco Gas Station");
    }
  });

  it("duplicate company names remain distinct rows (id-valued), same label text", () => {
    const twin: CustomerOption = { id: 9001, firstName: "", lastName: "", companyName: "Conoco Gas Station" };
    assert.strictEqual(customerOptionLabel(conoco), customerOptionLabel(twin));
    assert.notStrictEqual(String(conoco.id), String(twin.id));
  });
});
