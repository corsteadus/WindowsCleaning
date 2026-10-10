import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  conversionBlockers, isConversionReady, VERBAL_NOTE_MIN_LENGTH,
  type ConversionReadinessInput,
} from "./conversion-readiness.ts";
import {
  CORRECTABLE_ESTIMATE_STATUSES, CORRECTION_REASON_MIN_LENGTH, correctionRequiresReason,
  ESTIMATE_STATUS_LABELS,
} from "./estimate-status.ts";

const row = (over: Partial<ConversionReadinessInput["rows"][number]> = {}) => ({
  propertyId: 111,
  scheduledDate: "2026-11-10",
  scheduledStartTime: "09:00",
  scheduledEndTime: "11:00",
  ...over,
});

const input = (over: Partial<ConversionReadinessInput> = {}): ConversionReadinessInput => ({
  locationCount: 1,
  rows: [row()],
  requiresVerbalAcceptance: false,
  verbalRecorded: false,
  verbalNote: "",
  ...over,
});

describe("why the scheduling button is off — Kyle #15", () => {
  it("a fully filled, accepted estimate is ready", () => {
    assert.deepEqual(conversionBlockers(input()), []);
    assert.equal(isConversionReady(input()), true);
  });

  // Kyle's exact report: everything on the screen looks complete, and the
  // button still will not click. The missing piece was never on the screen.
  it("names the acceptance when that is the only thing missing", () => {
    const blockers = conversionBlockers(input({ requiresVerbalAcceptance: true }));
    assert.equal(blockers.length, 1);
    assert.match(blockers[0], /accepted this estimate/);
    // It must point at both ways out, because one of them is a different screen.
    assert.match(blockers[0], /verbal acceptance/);
    assert.match(blockers[0], /Correct Status/);
  });

  it("a ticked box with a token note is not documentation", () => {
    const short = input({ requiresVerbalAcceptance: true, verbalRecorded: true, verbalNote: "ok" });
    assert.match(conversionBlockers(short)[0], /at least 10 characters/);
    const real = { ...short, verbalNote: "Jane Doe accepted by phone on 9 Oct" };
    assert.deepEqual(conversionBlockers(real), []);
  });

  it("whitespace is not a note", () => {
    const blank = input({
      requiresVerbalAcceptance: true, verbalRecorded: true,
      verbalNote: " ".repeat(VERBAL_NOTE_MIN_LENGTH + 5),
    });
    assert.equal(isConversionReady(blank), false);
  });

  it("counts the locations that still need a date, and reads naturally", () => {
    const one = conversionBlockers(input({ rows: [row({ scheduledDate: "" })] }));
    assert.deepEqual(one, ["1 location needs a date."]);

    const two = conversionBlockers(input({
      locationCount: 2,
      rows: [row({ scheduledDate: "" }), row({ propertyId: 112, scheduledDate: "" })],
    }));
    assert.deepEqual(two, ["2 locations need a date."]);
  });

  it("catches a day that ends before it starts, which the server would refuse", () => {
    const backwards = input({ rows: [row({ scheduledStartTime: "14:00", scheduledEndTime: "09:00" })] });
    assert.deepEqual(conversionBlockers(backwards), ["1 location ends before it starts."]);
  });

  it("equal start and end is not a zero-length job", () => {
    const same = input({ rows: [row({ scheduledStartTime: "09:00", scheduledEndTime: "09:00" })] });
    assert.equal(isConversionReady(same), false);
  });

  it("a location with no schedule row at all is still reported", () => {
    const short = conversionBlockers(input({ locationCount: 2, rows: [row()] }));
    assert.deepEqual(short, ["1 location has no schedule yet."]);
  });

  it("an estimate with no address says so and stops there", () => {
    const none = conversionBlockers(input({ locationCount: 0, rows: [], requiresVerbalAcceptance: true }));
    assert.equal(none.length, 1, "one clear cause beats a list of consequences");
    assert.match(none[0], /no service address/);
  });

  it("reports every unmet condition at once, not one at a time", () => {
    const messy = conversionBlockers(input({
      locationCount: 2,
      rows: [row({ scheduledDate: "" }), row({ propertyId: 112, scheduledEndTime: "08:00" })],
      requiresVerbalAcceptance: true,
    }));
    assert.equal(messy.length, 3, messy.join(" / "));
  });

  it("the button follows the list exactly", () => {
    for (const candidate of [
      input(),
      input({ requiresVerbalAcceptance: true }),
      input({ rows: [row({ scheduledDate: "" })] }),
      input({ locationCount: 0, rows: [] }),
    ]) {
      assert.equal(isConversionReady(candidate), conversionBlockers(candidate).length === 0);
    }
  });
});

describe("the dialog uses the rule rather than a second copy of it", () => {
  const dialog = readFileSync(
    fileURLToPath(new URL("../components/EstimateConversionDialog.tsx", import.meta.url)),
    "utf8",
  );

  it("asks conversionBlockers and enables the button from its answer", () => {
    assert.match(dialog, /import \{ conversionBlockers \} from "@\/lib\/conversion-readiness"/);
    assert.match(dialog, /const ready = !!preview\.data && blockers\.length === 0/);
  });

  it("no longer carries its own hand-written readiness test", () => {
    assert.doesNotMatch(dialog, /verbalNote\.trim\(\)\.length >= 10/);
    assert.doesNotMatch(dialog, /rows\.every\(/);
  });

  it("prints the reasons where the button is", () => {
    assert.match(dialog, /data-testid="conversion-blockers"/);
    assert.match(dialog, /blockers\.map\(/);
    assert.match(dialog, /Before this can be scheduled/);
  });

  // Found in the browser: correct the status to Accepted, reopen this screen,
  // and it still said nobody had accepted it. The query is mounted for the
  // life of the page, so enabling it again served the first answer it ever
  // got. Three things together make it honest.
  it("never schedules from a cached answer", () => {
    assert.match(dialog, /staleTime: 0/);
    assert.match(dialog, /refetchOnMount: "always"/);
    assert.match(
      dialog,
      /invalidateQueries\(\{ queryKey: \["estimate-conversion-preview", quoteId\] \}\)/,
    );
  });

  it("shows nothing at all while it is replacing what it showed", () => {
    // isLoading is false on a refetch, so the stale list stayed on screen.
    assert.match(dialog, /\{preview\.isFetching && <div/);
    assert.match(dialog, /\{preview\.data && !preview\.isFetching && </);
    assert.match(dialog, /disabled=\{!ready \|\| commit\.isPending \|\| preview\.isFetching\}/);
    assert.doesNotMatch(dialog, /preview\.isLoading/);
  });
});

describe("correcting a status to Accepted — Kyle #23", () => {
  it("Accepted is offered, and every option has a label", () => {
    assert.ok(CORRECTABLE_ESTIMATE_STATUSES.includes("accepted"));
    for (const status of CORRECTABLE_ESTIMATE_STATUSES) {
      assert.ok(ESTIMATE_STATUS_LABELS[status], `${status} has no label`);
    }
  });

  it("the derived shades stay out of the office's hands", () => {
    for (const derived of ["scheduled", "accepted_scheduled"]) {
      assert.ok(
        !(CORRECTABLE_ESTIMATE_STATUSES as readonly string[]).includes(derived),
        `${derived} is derived from a fact and must not be typed`,
      );
    }
  });

  it("only Accepted demands a reason", () => {
    assert.equal(correctionRequiresReason("accepted"), true);
    for (const status of CORRECTABLE_ESTIMATE_STATUSES.filter((s) => s !== "accepted")) {
      assert.equal(correctionRequiresReason(status), false, status);
    }
  });

  it("the client and the server agree on how long a reason must be", () => {
    assert.equal(CORRECTION_REASON_MIN_LENGTH, VERBAL_NOTE_MIN_LENGTH);
  });
});
