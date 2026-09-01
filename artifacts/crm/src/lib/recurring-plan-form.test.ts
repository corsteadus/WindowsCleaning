/**
 * Regression tests for the Recurring Plan form sentinel contract.
 *
 * Run with:  node --test --experimental-strip-types src/lib/recurring-plan-form.test.ts
 * (Node 22.6+ / Node 24 — no extra dependencies required)
 *
 * Coverage:
 *   - No sentinel constant equals "" (guards against the Radix runtime crash)
 *   - buildRecurringPlanPayload correctly handles all three sentinel→undefined mappings
 *   - Required-field validation returns null for missing customer / name
 *   - Normal customer + property + service selections produce the correct payload
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOMER_NONE,
  PROPERTY_NONE,
  SERVICE_NONE,
  CUSTOMER_PLACEHOLDER,
  SERVICE_ANY_LABEL,
  buildRecurringPlanPayload,
  customerOptionLabel,
  selectedCustomerLabel,
  selectedServiceLabel,
  type CustomerOption,
  type RecurringPlanFormValues,
} from "./recurring-plan-form.ts";

// ── Base valid form values used as a starting point in most tests ──────────────
const BASE: RecurringPlanFormValues = {
  customerId:             "42",
  propertyId:             PROPERTY_NONE,
  name:                   "Quarterly Windows",
  status:                 "active",
  frequencyType:          "quarterly",
  preferredDay:           "",
  preferredTime:          "",
  nextRunDate:            "",
  serviceType:            SERVICE_NONE,
  estimatedAmount:        "",
  defaultDurationMinutes: "",
  defaultServiceNotes:    "",
};

describe("Recurring Plan form — sentinel constant contract", () => {
  it("CUSTOMER_NONE is not an empty string — prevents Radix crash", () => {
    assert.notStrictEqual(CUSTOMER_NONE, "", "CUSTOMER_NONE must not be ''");
    assert.ok(CUSTOMER_NONE.length > 0, "CUSTOMER_NONE must be non-empty");
  });

  it("PROPERTY_NONE is not an empty string — prevents Radix crash", () => {
    assert.notStrictEqual(PROPERTY_NONE, "", "PROPERTY_NONE must not be ''");
    assert.ok(PROPERTY_NONE.length > 0, "PROPERTY_NONE must be non-empty");
  });

  it("SERVICE_NONE is not an empty string — prevents Radix crash", () => {
    assert.notStrictEqual(SERVICE_NONE, "", "SERVICE_NONE must not be ''");
    assert.ok(SERVICE_NONE.length > 0, "SERVICE_NONE must be non-empty");
  });
});

describe("Recurring Plan form — required-field validation", () => {
  it("returns null when customerId is CUSTOMER_NONE (nothing selected)", () => {
    const result = buildRecurringPlanPayload({ ...BASE, customerId: CUSTOMER_NONE });
    assert.strictEqual(result, null, "unselected customer must block submission");
  });

  it("returns null when customerId is empty string (legacy guard)", () => {
    const result = buildRecurringPlanPayload({ ...BASE, customerId: "" });
    assert.strictEqual(result, null, "empty customerId must block submission");
  });

  it("returns null when name is blank", () => {
    const result = buildRecurringPlanPayload({ ...BASE, name: "" });
    assert.strictEqual(result, null, "blank name must block submission");
  });

  it("returns null when name is whitespace-only", () => {
    const result = buildRecurringPlanPayload({ ...BASE, name: "   " });
    assert.strictEqual(result, null, "whitespace-only name must block submission");
  });

  it("returns null when frequencyType is empty", () => {
    const result = buildRecurringPlanPayload({ ...BASE, frequencyType: "" });
    assert.strictEqual(result, null, "empty frequencyType must block submission");
  });
});

describe("Recurring Plan form — 'No specific property' sentinel", () => {
  it("PROPERTY_NONE sentinel produces no propertyId in payload", () => {
    const result = buildRecurringPlanPayload({ ...BASE, propertyId: PROPERTY_NONE });
    assert.ok(result !== null, "should produce a payload (other fields valid)");
    assert.strictEqual(result.propertyId, undefined,
      "PROPERTY_NONE must map to undefined propertyId — not sent to API");
  });

  it("empty propertyId also produces no propertyId in payload", () => {
    const result = buildRecurringPlanPayload({ ...BASE, propertyId: "" });
    assert.ok(result !== null);
    assert.strictEqual(result.propertyId, undefined);
  });
});

describe("Recurring Plan form — service type sentinel", () => {
  it("SERVICE_NONE produces no serviceType in payload", () => {
    const result = buildRecurringPlanPayload({ ...BASE, serviceType: SERVICE_NONE });
    assert.ok(result !== null);
    assert.strictEqual(result.serviceType, undefined,
      "SERVICE_NONE must map to undefined serviceType — not sent to API");
  });
});

describe("Recurring Plan form — normal selection correctness", () => {
  it("valid customer ID is cast to number in payload", () => {
    const result = buildRecurringPlanPayload({ ...BASE, customerId: "99" });
    assert.ok(result !== null);
    assert.strictEqual(result.customerId, 99);
  });

  it("selected property ID is cast to number in payload", () => {
    const result = buildRecurringPlanPayload({ ...BASE, propertyId: "7" });
    assert.ok(result !== null);
    assert.strictEqual(result.propertyId, 7);
  });

  it("selected service type is passed through to payload", () => {
    const result = buildRecurringPlanPayload({ ...BASE, serviceType: "window_cleaning" });
    assert.ok(result !== null);
    assert.strictEqual(result.serviceType, "window_cleaning");
  });

  it("full valid submission produces correct payload shape", () => {
    const result = buildRecurringPlanPayload({
      customerId:             "42",
      propertyId:             "7",
      name:                   "Annual Gutter Clean",
      status:                 "active",
      frequencyType:          "annual",
      preferredDay:           "Saturday",
      preferredTime:          "09:00",
      nextRunDate:            "2026-09-01",
      serviceType:            "gutter_cleaning",
      estimatedAmount:        "250",
      defaultDurationMinutes: "90",
      defaultServiceNotes:    "Use ladder extension.",
    });

    assert.ok(result !== null, "should produce a payload");
    assert.strictEqual(result.customerId, 42);
    assert.strictEqual(result.propertyId, 7);
    assert.strictEqual(result.name, "Annual Gutter Clean");
    assert.strictEqual(result.frequencyType, "annual");
    assert.strictEqual(result.intervalValue, 1);
    assert.strictEqual(result.preferredDayOfWeek, "Saturday");
    assert.strictEqual(result.preferredTimeWindow, "09:00");
    assert.strictEqual(result.nextRunDate, "2026-09-01");
    assert.strictEqual(result.serviceType, "gutter_cleaning");
    assert.strictEqual(result.estimatedAmount, "250");
    assert.strictEqual(result.defaultDurationMinutes, 90);
    assert.strictEqual(result.defaultServiceNotes, "Use ladder extension.");
    assert.strictEqual(result.autoGenerateJobs, false);
  });

  it("optional fields absent when blank", () => {
    const result = buildRecurringPlanPayload({ ...BASE });
    assert.ok(result !== null);
    assert.strictEqual(result.propertyId, undefined);
    assert.strictEqual(result.preferredDayOfWeek, undefined);
    assert.strictEqual(result.preferredTimeWindow, undefined);
    assert.strictEqual(result.nextRunDate, undefined);
    assert.strictEqual(result.serviceType, undefined);
    assert.strictEqual(result.estimatedAmount, undefined);
    assert.strictEqual(result.defaultDurationMinutes, undefined);
    assert.strictEqual(result.defaultServiceNotes, undefined);
  });
});

// ── Closed-trigger label resolvers — deterministic empty states ────────────────
// Radix only renders SelectValue's placeholder for ""/undefined, so the page
// computes closed-trigger text itself.  These resolvers must NEVER yield a
// blank/whitespace label for any list size, duplicates, or loading order.

describe("selectedCustomerLabel — closed customer trigger", () => {
  const CUSTOMERS: CustomerOption[] = [
    { id: 1, firstName: "Ada", lastName: "Lovelace" },
    { id: 2, displayName: "Bernoulli Household" },
    { id: 3, firstName: "", lastName: "" },
  ];

  it("returns null for the CUSTOMER_NONE sentinel — page shows the placeholder", () => {
    assert.strictEqual(selectedCustomerLabel(CUSTOMER_NONE, CUSTOMERS), null);
  });

  it("returns null for empty string (legacy guard)", () => {
    assert.strictEqual(selectedCustomerLabel("", CUSTOMERS), null);
  });

  it("returns null on an empty list even with a real id — placeholder while loading, never blank", () => {
    assert.strictEqual(selectedCustomerLabel("1", []), null);
  });

  it("returns null when the id is not in the list — placeholder, never blank", () => {
    assert.strictEqual(selectedCustomerLabel("999", CUSTOMERS), null);
  });

  it("resolves a selected customer by first+last name", () => {
    assert.strictEqual(selectedCustomerLabel("1", CUSTOMERS), "Ada Lovelace");
  });

  it("prefers displayName when present", () => {
    assert.strictEqual(selectedCustomerLabel("2", CUSTOMERS), "Bernoulli Household");
  });

  it("blank-name customer resolves to 'Customer #id' — never a whitespace trigger", () => {
    assert.strictEqual(selectedCustomerLabel("3", CUSTOMERS), "Customer #3");
  });

  it("duplicate ids: first match wins (stable result)", () => {
    const dupes: CustomerOption[] = [
      { id: 5, displayName: "First Copy" },
      { id: 5, displayName: "Second Copy" },
    ];
    assert.strictEqual(selectedCustomerLabel("5", dupes), "First Copy");
  });

  it("large list (5000): exact string match; '042' does not match id 42", () => {
    const big: CustomerOption[] = Array.from({ length: 5000 }, (_, i) => ({
      id: i + 1,
      displayName: `C${i + 1}`,
    }));
    assert.strictEqual(selectedCustomerLabel("42", big), "C42");
    assert.strictEqual(selectedCustomerLabel("042", big), null);
  });

  it("manual selection stays authoritative across list reorder", () => {
    const reordered = [...CUSTOMERS].reverse();
    assert.strictEqual(selectedCustomerLabel("1", reordered), "Ada Lovelace");
  });
});

describe("customerOptionLabel — option rows never render blank", () => {
  it("whitespace-only displayName falls through to first/last name", () => {
    assert.strictEqual(
      customerOptionLabel({ id: 9, displayName: "   ", firstName: "Grace", lastName: "Hopper" }),
      "Grace Hopper",
    );
  });

  it("undefined names and no displayName → 'Customer #id' (no 'undefined undefined')", () => {
    assert.strictEqual(customerOptionLabel({ id: 11 }), "Customer #11");
  });

  it("all-null fields → 'Customer #id'", () => {
    assert.strictEqual(
      customerOptionLabel({ id: 12, displayName: null, firstName: null, lastName: null }),
      "Customer #12",
    );
  });

  it("single name part renders trimmed", () => {
    assert.strictEqual(customerOptionLabel({ id: 13, firstName: "Cher", lastName: "" }), "Cher");
  });
});

describe("selectedServiceLabel — closed service trigger", () => {
  const SERVICES = [
    { value: "window_cleaning", label: "Window Cleaning" },
    { value: "general", label: "General Service" },
  ];

  it("returns null for SERVICE_NONE — page shows SERVICE_ANY_LABEL", () => {
    assert.strictEqual(selectedServiceLabel(SERVICE_NONE, SERVICES), null);
  });

  it("returns null for SERVICE_NONE even when no service types exist at all", () => {
    assert.strictEqual(selectedServiceLabel(SERVICE_NONE, []), null);
  });

  it("resolves a known value to its label", () => {
    assert.strictEqual(selectedServiceLabel("window_cleaning", SERVICES), "Window Cleaning");
  });

  it("unknown value falls back to the raw value — never blank", () => {
    assert.strictEqual(selectedServiceLabel("roof_wash", SERVICES), "roof_wash");
  });

  it("selected value with an empty options list falls back to the raw value", () => {
    assert.strictEqual(selectedServiceLabel("window_cleaning", []), "window_cleaning");
  });
});

describe("display constants contract", () => {
  it("CUSTOMER_PLACEHOLDER and SERVICE_ANY_LABEL are non-empty display strings", () => {
    assert.ok(CUSTOMER_PLACEHOLDER.length > 0);
    assert.ok(SERVICE_ANY_LABEL.length > 0);
  });

  it("sentinels can never collide with a real numeric id string", () => {
    assert.ok(Number.isNaN(Number(CUSTOMER_NONE)));
    assert.ok(Number.isNaN(Number(SERVICE_NONE)));
  });
});

describe("sentinel → omitted-key payload mapping (wire format)", () => {
  it("SERVICE_NONE: serialized payload has no serviceType key (API persists null)", () => {
    const payload = buildRecurringPlanPayload({ ...BASE, serviceType: SERVICE_NONE });
    assert.ok(payload !== null);
    const wire = JSON.parse(JSON.stringify(payload));
    assert.ok(!("serviceType" in wire), "serviceType key must be absent on the wire");
  });

  it("PROPERTY_NONE: serialized payload has no propertyId key", () => {
    const payload = buildRecurringPlanPayload({ ...BASE, propertyId: PROPERTY_NONE });
    assert.ok(payload !== null);
    const wire = JSON.parse(JSON.stringify(payload));
    assert.ok(!("propertyId" in wire), "propertyId key must be absent on the wire");
  });

  it("a selected service survives the wire round-trip unchanged", () => {
    const payload = buildRecurringPlanPayload({ ...BASE, serviceType: "gutter_cleaning" });
    assert.ok(payload !== null);
    const wire = JSON.parse(JSON.stringify(payload));
    assert.strictEqual(wire.serviceType, "gutter_cleaning");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression: published-release interaction failure (2026-08 smoke test).
// Selecting a customer on /recurring-plans/new left the trigger on
// "Select customer…" and dependent form behavior disabled: Radix 2.2.6's
// hidden native-select bubble circuit (mounted because the Select is inside
// a <form>) can re-dispatch change events carrying value "" after the items
// unmount, and the page wired the RAW state setter into onValueChange, so
// that "" silently wiped the selection.  These tests pin (1) the pure
// transition predicate that rejects such resets and (2) the page wiring that
// routes every select through it.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { nextSelectValue, nextOptionalSelectValue, DAY_TIME_ANY } from "./recurring-plan-form.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("nextSelectValue — reset-rejection transition predicate", () => {
  it("accepts a real selection from the initial sentinel", () => {
    assert.strictEqual(nextSelectValue(CUSTOMER_NONE, "8894"), "8894");
  });

  it('REGRESSION: an empty-string dispatch after selection keeps the selection ("8894" stays "8894")', () => {
    // This is the exact published failure: bubble-circuit change event with
    // event.target.value === "" arriving right after the user picked 8894.
    assert.strictEqual(nextSelectValue("8894", ""), "8894");
  });

  it("rejects undefined, null, and non-string payloads", () => {
    assert.strictEqual(nextSelectValue("8894", undefined), "8894");
    assert.strictEqual(nextSelectValue("8894", null), "8894");
    assert.strictEqual(nextSelectValue("8894", 42 as unknown), "8894");
    assert.strictEqual(nextSelectValue("8894", {} as unknown), "8894");
  });

  it("rejects whitespace-only and literal token payloads", () => {
    for (const junk of [" ", "\t", "\n", "undefined", "null", "UNDEFINED", "Null"]) {
      assert.strictEqual(nextSelectValue("8894", junk), "8894", `junk=${JSON.stringify(junk)}`);
    }
  });

  it("still allows changing between real values and back to sentinels", () => {
    assert.strictEqual(nextSelectValue("8894", "6831"), "6831");
    // Sentinel items (Property "No specific property", Service "Any") emit
    // "none" — a legitimate, non-empty value that must pass through.
    assert.strictEqual(nextSelectValue("123", SERVICE_NONE), SERVICE_NONE);
    assert.strictEqual(nextSelectValue("123", PROPERTY_NONE), PROPERTY_NONE);
  });

  it("initial-state noise: empty dispatch before any selection keeps the sentinel", () => {
    assert.strictEqual(nextSelectValue(CUSTOMER_NONE, ""), CUSTOMER_NONE);
  });

  it("is pure w.r.t. the options list — loading/refetch churn cannot alter held state", () => {
    // The predicate takes no list argument at all: list emptiness, size,
    // duplicates, or reordering during query refreshes cannot influence the
    // held value.  (Type-level guarantee made explicit for the reviewer.)
    assert.strictEqual(nextSelectValue.length, 2);
    assert.strictEqual(nextSelectValue("8894", ""), "8894");
  });
});

describe("customerOptionLabel — shared business-name precedence", () => {
  it("REGRESSION exact 8894 shape: blank person + companyName → business name (camelCase API field)", () => {
    const c: CustomerOption = { id: 8894, firstName: "", lastName: "", companyName: "Conoco Gas Station" };
    assert.strictEqual(customerOptionLabel(c), "Conoco Gas Station");
  });

  it("snake_case company_name is normalized too", () => {
    const c: CustomerOption = { id: 8894, firstName: null, lastName: null, company_name: "Conoco Gas Station" };
    assert.strictEqual(customerOptionLabel(c), "Conoco Gas Station");
  });

  it("person name beats company name when either component exists", () => {
    assert.strictEqual(
      customerOptionLabel({ id: 1, firstName: "Steve", lastName: "Weir", companyName: "Care 4 All" }),
      "Steve Weir",
    );
    assert.strictEqual(
      customerOptionLabel({ id: 1, firstName: "", lastName: "Weir", companyName: "Care 4 All" }),
      "Weir",
    );
  });

  it("displayName (server-resolved) wins over everything when present", () => {
    assert.strictEqual(
      customerOptionLabel({ id: 1, displayName: "Care 4 All (Steve Weir)", firstName: "X", companyName: "Y" }),
      "Care 4 All (Steve Weir)",
    );
  });

  it("whitespace and literal tokens never leak into labels; id fallback still works", () => {
    assert.strictEqual(customerOptionLabel({ id: 7, firstName: " ", lastName: "\t", companyName: "  " }), "Customer #7");
    assert.strictEqual(customerOptionLabel({ id: 7, firstName: "undefined", lastName: "null" }), "Customer #7");
    const blankish: Array<string | null | undefined> = ["", " ", null, undefined, "undefined", "null"];
    for (const f of blankish) for (const l of blankish) for (const co of blankish) {
      const label = customerOptionLabel({ id: 9, firstName: f, lastName: l, companyName: co });
      assert.ok(label.trim().length > 0, `blank label for f=${JSON.stringify(f)} l=${JSON.stringify(l)} co=${JSON.stringify(co)}`);
      assert.ok(!/^(undefined|null)$/i.test(label.trim()), `literal token label: ${label}`);
    }
  });
});

describe("selectedCustomerLabel — stability across list shapes", () => {
  const c8894: CustomerOption = { id: 8894, firstName: "", lastName: "", companyName: "Conoco Gas Station" };

  it("empty list: selected id resolves to null (placeholder), never blank", () => {
    assert.strictEqual(selectedCustomerLabel("8894", []), null);
  });

  it("large list (250 rows): resolves the right row", () => {
    const big: CustomerOption[] = Array.from({ length: 249 }, (_, i) => ({ id: i + 1, firstName: `F${i}`, lastName: `L${i}` }));
    big.push(c8894);
    assert.strictEqual(selectedCustomerLabel("8894", big), "Conoco Gas Station");
  });

  it("duplicate ids: first match wins deterministically", () => {
    const dup: CustomerOption[] = [
      { id: 8894, firstName: "First", lastName: "Copy" },
      c8894,
    ];
    assert.strictEqual(selectedCustomerLabel("8894", dup), "First Copy");
  });

  it("reordered lists give the same answer when ids are unique", () => {
    const a: CustomerOption[] = [{ id: 1, firstName: "A", lastName: "A" }, c8894, { id: 2, firstName: "B", lastName: "B" }];
    const b = [...a].reverse();
    assert.strictEqual(selectedCustomerLabel("8894", a), selectedCustomerLabel("8894", b));
  });

  it("loading refresh after selection: label degrades to placeholder-null while empty, returns when data does — held VALUE untouched by design", () => {
    let held = nextSelectValue(CUSTOMER_NONE, "8894");     // user picks 8894
    assert.strictEqual(selectedCustomerLabel(held, [c8894]), "Conoco Gas Station");
    held = nextSelectValue(held, "");                       // bubble-circuit noise mid-refetch
    assert.strictEqual(held, "8894");                       // value survives
    assert.strictEqual(selectedCustomerLabel(held, []), null);          // refetch in flight → placeholder
    assert.strictEqual(selectedCustomerLabel(held, [c8894]), "Conoco Gas Station"); // data back → label back
  });
});

describe("nextOptionalSelectValue — day/time selects storing '' as 'any'", () => {
  it("REGRESSION: empty noise cannot reset a chosen day back to 'any'", () => {
    // Old wiring `v === "any" ? "" : v` stored "" for noise "" — silently
    // wiping the user's chosen day.  Guarded in sentinel space, the noise
    // keeps the current stored value.
    assert.strictEqual(nextOptionalSelectValue("monday", ""), "monday");
    assert.strictEqual(nextOptionalSelectValue("monday", undefined), "monday");
    assert.strictEqual(nextOptionalSelectValue("monday", "undefined"), "monday");
  });

  it("an actual click on the 'Any' item still clears the stored value", () => {
    assert.strictEqual(nextOptionalSelectValue("monday", DAY_TIME_ANY), "");
  });

  it("normal transitions and the unset state behave unchanged", () => {
    assert.strictEqual(nextOptionalSelectValue("", "monday"), "monday");
    assert.strictEqual(nextOptionalSelectValue("monday", "tuesday"), "tuesday");
    assert.strictEqual(nextOptionalSelectValue("", DAY_TIME_ANY), "");
    assert.strictEqual(nextOptionalSelectValue("", ""), "");
  });
});

describe("nextSelectValue — status/frequency preservation (same form, same circuit)", () => {
  it("a changed Status survives empty noise", () => {
    assert.strictEqual(nextSelectValue("paused", ""), "paused");
  });
  it("a changed Frequency survives empty noise (required-field validation cannot be tripped)", () => {
    assert.strictEqual(nextSelectValue("monthly", ""), "monthly");
  });
});

describe("page wiring — RecurringPlanNew routes every Select through a guard", () => {
  const src = readFileSync(join(HERE, "../pages/RecurringPlanNew.tsx"), "utf8");

  it("the five remaining Radix Selects (status/service/frequency/day/time) are guarded — property and customer controls are shared pickers", () => {
    assert.match(src, /onValueChange=\{\(v\) => setStatus\(\(prev\) => nextSelectValue\(prev, v\)\)\}/);
    assert.match(src, /onValueChange=\{\(v\) => setServiceType\(\(prev\) => nextSelectValue\(prev, v\)\)\}/);
    assert.match(src, /onValueChange=\{\(v\) => setFrequencyType\(\(prev\) => nextSelectValue\(prev, v\)\)\}/);
    assert.match(src, /onValueChange=\{\(v\) => setPreferredDay\(\(prev\) => nextOptionalSelectValue\(prev, v\)\)\}/);
    assert.match(src, /onValueChange=\{\(v\) => setPreferredTime\(\(prev\) => nextOptionalSelectValue\(prev, v\)\)\}/);
  });

  it("no Select wires a raw state setter or unguarded sentinel mapping into onValueChange", () => {
    for (const raw of [
      "onValueChange={setCustomerId}",
      "onValueChange={setPropertyId}",
      "onValueChange={setStatus}",
      "onValueChange={setServiceType}",
      "onValueChange={setFrequencyType}",
      'setPreferredDay(v === "any"',
      'setPreferredTime(v === "any"',
    ]) {
      assert.ok(!src.includes(raw), `unguarded wiring present: ${raw}`);
    }
    // Belt-and-braces: every onValueChange on this page must mention a guard.
    // (The customer and property controls moved into shared picker components,
    // which are not Radix Selects.)
    const handlers = src.match(/onValueChange=\{[^}]*\}\}?/g) ?? [];
    assert.strictEqual(handlers.length, 5, `expected exactly 5 guarded Radix handlers (status/service/frequency/day/time), found ${handlers.length}`);
    for (const h of handlers) {
      assert.ok(/nextSelectValue|nextOptionalSelectValue/.test(h), `unguarded handler: ${h}`);
    }
  });

  it("customer selection is a held record fed to the shared combobox with the company-aware label (no preloaded ?limit list)", () => {
    assert.match(src, /<CustomerCombobox/);
    assert.match(src, /labelFor=\{customerOptionLabel\}/);
    assert.match(src, /selectedCustomer \? String\(selectedCustomer\.id\) : CUSTOMER_NONE/);
    assert.ok(!src.includes("limit=200"), "preloaded limit=200 customer query must be gone");
    assert.ok(!src.includes('"customers-dropdown"'), "ad-hoc customers-dropdown query key must be gone");
  });
});
