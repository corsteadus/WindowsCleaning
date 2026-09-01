/**
 * Regression tests for the shared Radix Select transition guards and the
 * JobNew / AutomationNew page wiring.
 *
 * Run with:  node --test --experimental-strip-types src/lib/select-guards.test.ts
 * (Node 22.6+ / Node 24 — no extra dependencies required)
 *
 * Context: Radix (@radix-ui/react-select 2.2.6) mounts a hidden native
 * <select> ("bubble input") for any Select inside a <form>; its circuit can
 * re-dispatch a change event carrying "" after the items unmount, silently
 * wiping the controlled selection.  This shipped as the 2026-08
 * /recurring-plans/new regression; the same raw wiring existed in
 * JobNew.tsx (Property / Service / Crew) and AutomationNew.tsx (Trigger).
 *
 * Coverage:
 *   - nextSelectValue: valid-current + incoming ""/whitespace/undefined/null
 *     tokens => current; valid new values accepted (transition tables)
 *   - nextOptionalSelectValue (generic sentinel space): only a real sentinel
 *     click clears; noise never does; payload-facing "" semantics preserved
 *   - nextIdSelectValue: positive-integer acceptance; the Number("") === 0 /
 *     NaN coercion hole of the old inline mappings is closed
 *   - compatibility: the recurring-plan-form 2-arg wrapper behaves
 *     identically to the generic guard with DAY_TIME_ANY
 *   - page wiring pins: every in-form Radix Select in JobNew and
 *     AutomationNew routes through a guard via functional update; raw
 *     setters / inline `v === sentinel ? "" : …` mappings fail the suite
 *   - payload-conversion pins: submit expressions unchanged (sentinel/unset
 *     still omit optional fields; ids still Number()-cast)
 *   - rerender/list-refresh stability: guards are list-independent by
 *     construction (arity pins) plus held-value sequence simulations
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  nextSelectValue,
  nextOptionalSelectValue,
  nextIdSelectValue,
} from "./select-guards.ts";
import {
  nextOptionalSelectValue as recurringDayTimeGuard,
  DAY_TIME_ANY,
} from "./recurring-plan-form.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const jobNewSrc = readFileSync(join(HERE, "../pages/JobNew.tsx"), "utf8");
const automationNewSrc = readFileSync(join(HERE, "../pages/AutomationNew.tsx"), "utf8");

const JUNK: unknown[] = ["", " ", "\t", "\n", "  \n ", "undefined", "null", "UNDEFINED", "Null", undefined, null, 42, {}, [], true];

// ─── nextSelectValue — canonical transition table ─────────────────────────────

describe("nextSelectValue — required-select transition table", () => {
  it("valid current + every junk payload => current is kept", () => {
    for (const junk of JUNK) {
      assert.strictEqual(nextSelectValue("days_after_last_service", junk), "days_after_last_service",
        `junk=${JSON.stringify(junk)}`);
    }
  });

  it("valid new values are accepted, from placeholder state and between values", () => {
    assert.strictEqual(nextSelectValue("", "job_created"), "job_created");
    assert.strictEqual(nextSelectValue("job_created", "invoice_overdue"), "invoice_overdue");
  });

  it("placeholder state + junk stays at placeholder (no phantom selection)", () => {
    for (const junk of JUNK) {
      assert.strictEqual(nextSelectValue("", junk), "", `junk=${JSON.stringify(junk)}`);
    }
  });

  it("is list-independent by construction (arity pin — options can never influence held state)", () => {
    assert.strictEqual(nextSelectValue.length, 2);
  });
});

// ─── nextOptionalSelectValue — generic sentinel-space guard ───────────────────

describe("nextOptionalSelectValue — sentinel-space guard (JobNew Service, sentinel 'none')", () => {
  it("REGRESSION: empty noise cannot reset a chosen service to unset", () => {
    for (const junk of JUNK) {
      assert.strictEqual(nextOptionalSelectValue("Window Cleaning", junk, "none"), "Window Cleaning",
        `junk=${JSON.stringify(junk)}`);
    }
  });

  it("an actual click on the sentinel item still clears the stored value", () => {
    assert.strictEqual(nextOptionalSelectValue("Window Cleaning", "none", "none"), "");
  });

  it("normal transitions and the unset state behave unchanged", () => {
    assert.strictEqual(nextOptionalSelectValue("", "Window Cleaning", "none"), "Window Cleaning");
    assert.strictEqual(nextOptionalSelectValue("Window Cleaning", "Gutter Cleaning", "none"), "Gutter Cleaning");
    assert.strictEqual(nextOptionalSelectValue("", "none", "none"), "");
    assert.strictEqual(nextOptionalSelectValue("", "", "none"), "");
  });

  it("works for arbitrary sentinel strings (guard is not tied to one domain)", () => {
    assert.strictEqual(nextOptionalSelectValue("monday", "", "any"), "monday");
    assert.strictEqual(nextOptionalSelectValue("monday", "any", "any"), "");
    assert.strictEqual(nextOptionalSelectValue("x", "", "unset"), "x");
  });
});

describe("nextOptionalSelectValue — recurring-plan-form wrapper compatibility", () => {
  it("2-arg day/time wrapper === generic guard with DAY_TIME_ANY on a full table", () => {
    const currents = ["", "monday", "saturday", "09:00"];
    const incomings: unknown[] = [...JUNK, DAY_TIME_ANY, "monday", "tuesday", "14:00"];
    for (const c of currents) {
      for (const i of incomings) {
        assert.strictEqual(
          recurringDayTimeGuard(c, i),
          nextOptionalSelectValue(c, i, DAY_TIME_ANY),
          `divergence at current=${JSON.stringify(c)} incoming=${JSON.stringify(i)}`,
        );
      }
    }
  });
});

// ─── nextIdSelectValue — numeric-id stored state ──────────────────────────────

describe("nextIdSelectValue — id selects (JobNew Property 'none' / Crew 'unassigned')", () => {
  it("REGRESSION: empty noise keeps a chosen id (old wiring stored Number('') === 0 and silently dropped it at submit)", () => {
    for (const junk of JUNK) {
      assert.strictEqual(nextIdSelectValue(42, junk, "none"), 42, `junk=${JSON.stringify(junk)}`);
      assert.strictEqual(nextIdSelectValue(42, junk, "unassigned"), 42, `junk=${JSON.stringify(junk)}`);
    }
  });

  it("never stores 0 or NaN — non-id numeric strings keep the current value", () => {
    assert.strictEqual(nextIdSelectValue(42, "0", "none"), 42);
    assert.strictEqual(nextIdSelectValue(42, "-3", "none"), 42);
    assert.strictEqual(nextIdSelectValue(42, "3.5", "none"), 42);
    assert.strictEqual(nextIdSelectValue(42, "abc", "none"), 42);
    assert.strictEqual(nextIdSelectValue("", "abc", "none"), "");
    assert.strictEqual(nextIdSelectValue("", "0", "unassigned"), "");
  });

  it("an actual click on the sentinel item clears to '' (payload then omits the field)", () => {
    assert.strictEqual(nextIdSelectValue(42, "none", "none"), "");
    assert.strictEqual(nextIdSelectValue(7, "unassigned", "unassigned"), "");
    assert.strictEqual(nextIdSelectValue("", "none", "none"), "");
  });

  it("valid ids are accepted from unset and between values, as numbers", () => {
    assert.strictEqual(nextIdSelectValue("", "57", "none"), 57);
    assert.strictEqual(nextIdSelectValue(42, "57", "none"), 57);
    assert.strictEqual(nextIdSelectValue("", "8894", "unassigned"), 8894);
  });

  it("is list-independent by construction (arity pin)", () => {
    assert.strictEqual(nextIdSelectValue.length, 3);
  });
});

describe("held-value sequences — refresh / rerender simulations", () => {
  it("crew chosen → refetch noise → still chosen → real change → sentinel click → unset", () => {
    let crew: number | "" = "";
    crew = nextIdSelectValue(crew, "3", "unassigned");   // user picks crew 3
    assert.strictEqual(crew, 3);
    crew = nextIdSelectValue(crew, "", "unassigned");    // bubble noise mid-refetch
    assert.strictEqual(crew, 3);                          // survives
    crew = nextIdSelectValue(crew, "9", "unassigned");   // user changes crew
    assert.strictEqual(crew, 9);
    crew = nextIdSelectValue(crew, "unassigned", "unassigned"); // explicit unassign
    assert.strictEqual(crew, "");
  });

  it("service chosen → noise burst (rerender storm) → survives every dispatch", () => {
    let svc = nextOptionalSelectValue("", "Window Cleaning", "none");
    for (const junk of [...JUNK, ...JUNK]) {
      svc = nextOptionalSelectValue(svc, junk, "none");
    }
    assert.strictEqual(svc, "Window Cleaning");
  });

  it("programmatic reset path stays outside the guard: '' assigned directly is a valid stored state", () => {
    // JobNew clears propertyId via setPropertyId("") when the customer
    // changes — that reset does NOT flow through onValueChange, so guards
    // cannot and must not interfere.  From the reset state, junk keeps unset.
    let property: number | "" = 7;
    property = "";                                        // effect-driven reset
    assert.strictEqual(nextIdSelectValue(property, "", "none"), "");
  });
});

// ─── Page wiring pins — JobNew.tsx ───────────────────────────────────────────

describe("page wiring — JobNew routes every in-form Radix Select through a guard", () => {
  it("Property uses the shared picker while Service and Crew remain guarded", () => {
    assert.match(jobNewSrc, /<PropertyPicker/);
    assert.match(jobNewSrc, /onValueChange=\{\(v\) => setServiceType\(\(prev\) => nextOptionalSelectValue\(prev, v, SERVICE_NONE\)\)\}/);
    assert.match(jobNewSrc, /onValueChange=\{\(v\) => setCrewId\(\(prev\) => nextIdSelectValue\(prev, v, CREW_UNASSIGNED\)\)\}/);
  });

  it("sentinel constants are defined, non-empty, and used as the mounted item values", () => {
    assert.match(jobNewSrc, /const SERVICE_NONE\s*=\s*"none"/);
    assert.match(jobNewSrc, /const CREW_UNASSIGNED\s*=\s*"unassigned"/);
    assert.match(jobNewSrc, /<SelectItem value=\{SERVICE_NONE\}>/);
    assert.match(jobNewSrc, /<SelectItem value=\{CREW_UNASSIGNED\}>/);
  });

  it("no raw setter or inline `v === sentinel ? \"\" : …` mapping survives on any Select", () => {
    for (const raw of [
      'setPropertyId(v === ',
      'setServiceType(v === ',
      'setCrewId(v === ',
      '? "" : Number(v)',
      'onValueChange={setPropertyId}',
      'onValueChange={setServiceType}',
      'onValueChange={setCrewId}',
      '<SelectItem value="none">',
      '<SelectItem value="unassigned">',
    ]) {
      assert.ok(!jobNewSrc.includes(raw), `unguarded wiring present: ${raw}`);
    }
  });

  it("belt-and-braces: every onValueChange on this page is guarded — the customer combobox (cmdk text input, no bubble circuit) lives in the shared component now", () => {
    const handlers = jobNewSrc.match(/onValueChange=\{[^}]*\}\}?/g) ?? [];
    assert.strictEqual(handlers.length, 3, `expected exactly 3 guarded Radix handlers (service/crew/tech), found ${handlers.length}`);
    const unguarded = handlers.filter((h) => !/nextIdSelectValue|nextOptionalSelectValue|nextSelectValue/.test(h));
    assert.deepStrictEqual(unguarded, []);
  });

  it("payload conversions are unchanged: unset/sentinel still omit optional fields, ids still Number()-cast", () => {
    assert.match(jobNewSrc, /propertyId:\s+propertyId \? Number\(propertyId\) : undefined/);
    assert.match(jobNewSrc, /crewId:\s+crewId \? Number\(crewId\) : null/);
    assert.match(jobNewSrc, /serviceType:\s+serviceType \|\| undefined/);
    assert.match(jobNewSrc, /customerId:\s+Number\(customerId\)/);
  });

  it("the legitimate programmatic property reset on customer change is a direct setter call, outside any guard", () => {
    assert.match(jobNewSrc, /setPropertyId\(""\)/);
  });
});

// ─── Page wiring pins — AutomationNew.tsx ────────────────────────────────────

describe("page wiring — AutomationNew guards the Trigger select", () => {
  it("trigger value transitions go through nextSelectValue via a functional update", () => {
    assert.match(automationNewSrc, /setTriggerType\(\(prev\) => nextSelectValue\(prev, incoming\)\)/);
  });

  it("the Select still wires the named handler (guarded internally)", () => {
    assert.match(automationNewSrc, /<Select value=\{triggerType\} onValueChange=\{handleTriggerChange\}>/);
  });

  it("no unconditional raw assignment of the incoming payload survives", () => {
    for (const raw of ["setTriggerType(v)", "setTriggerType(incoming)"]) {
      assert.ok(!automationNewSrc.includes(raw), `raw assignment present: ${raw}`);
    }
  });

  it("template defaults key off the incoming value, so junk no-ops and real selections behave exactly as before", () => {
    assert.match(automationNewSrc, /TRIGGER_OPTIONS\.find\(\(t\) => t\.value === incoming\)/);
    assert.match(automationNewSrc, /if \(!templateBody\) setTemplateBody\(trig\.defaultBody\);/);
    assert.match(automationNewSrc, /if \(trig\.scheduled\) setChannel\("email"\);/);
  });

  it("payload conversion unchanged: delayDays still parseInt-gated on a scheduled trigger", () => {
    assert.match(automationNewSrc, /delayDays: \(selectedTrigger\?\.scheduled && delayDays\) \? parseInt\(delayDays, 10\) : undefined/);
  });

  it("the channel picker is plain buttons (no Radix bubble circuit) — exactly one Radix Select on this page", () => {
    const selects = automationNewSrc.match(/<Select /g) ?? [];
    assert.strictEqual(selects.length, 1);
  });
});

// ─── Trigger-select behavior table (AutomationNew semantics through the guard) ─

describe("AutomationNew trigger semantics through the guard", () => {
  it("chosen trigger survives bubble noise; required-field validation cannot be tripped after a choice", () => {
    let trigger = nextSelectValue("", "days_after_last_service");
    assert.strictEqual(trigger, "days_after_last_service");
    for (const junk of JUNK) trigger = nextSelectValue(trigger, junk);
    assert.strictEqual(trigger, "days_after_last_service");
  });

  it("switching triggers is unaffected (accepted transitions pass through)", () => {
    const from = nextSelectValue("", "job_created");
    assert.strictEqual(nextSelectValue(from, "invoice_overdue"), "invoice_overdue");
  });
});
