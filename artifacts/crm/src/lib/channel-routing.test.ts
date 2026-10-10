import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CHANNEL_PURPOSES, ROUTING_CHOICES, purposesForChoice, purposesOf,
  routingChoiceFor, routingLabel,
} from "./channel-routing.ts";

describe("the eight routing choices — Kyle #7", () => {
  it("offers exactly the eight he named, in his order", () => {
    assert.deepEqual(ROUTING_CHOICES.map((choice) => choice.label), [
      "All Emails",
      "General Emails",
      "Billing",
      "Estimates",
      "General and Estimates",
      "Billing and Estimates",
      "General and Billing",
      "None",
    ]);
  });

  it("the eight are every combination of the three purposes, once each", () => {
    // Three purposes have eight subsets. If the list is right, it is complete
    // by arithmetic rather than by hope.
    assert.equal(ROUTING_CHOICES.length, 2 ** CHANNEL_PURPOSES.length);
    const signatures = ROUTING_CHOICES.map((choice) => [...choice.purposes].sort().join("+"));
    assert.equal(new Set(signatures).size, signatures.length, "two choices mean the same thing");
  });

  it("None is the empty set, and nothing else is", () => {
    const none = ROUTING_CHOICES.find((choice) => choice.label === "None");
    assert.deepEqual(none?.purposes, []);
    assert.equal(ROUTING_CHOICES.filter((choice) => choice.purposes.length === 0).length, 1);
  });

  it("All Emails means all three", () => {
    const all = ROUTING_CHOICES.find((choice) => choice.label === "All Emails");
    assert.deepEqual([...(all?.purposes ?? [])].sort(), [...CHANNEL_PURPOSES].sort());
  });
});

describe("reading stored purposes back as a choice", () => {
  it("round-trips every choice through its key", () => {
    for (const choice of ROUTING_CHOICES) {
      assert.equal(routingChoiceFor(purposesForChoice(choice.key)).key, choice.key, choice.label);
    }
  });

  it("does not care about order or repeats", () => {
    assert.equal(routingLabel(["estimates", "general"]), "General and Estimates");
    assert.equal(routingLabel(["general", "estimates"]), "General and Estimates");
    assert.equal(routingLabel(["billing", "billing"]), "Billing");
  });

  // The whole point of #7: an empty list must read as None, not fall through
  // to "general" the way the old screen did.
  it("an empty list is None, and so is nothing at all", () => {
    assert.equal(routingLabel([]), "None");
    assert.equal(routingLabel(null), "None");
    assert.equal(routingLabel(undefined), "None");
  });

  it("an unrecognised purpose is dropped rather than inventing a ninth choice", () => {
    assert.equal(routingLabel(["general", "marketing"]), "General Emails");
    assert.equal(routingLabel(["marketing"]), "None");
  });

  it("an unknown key selects nothing rather than guessing", () => {
    assert.deepEqual(purposesForChoice("whatever"), []);
  });
});

describe("what the screen reads off a channel", () => {
  it("prefers the list, and treats an empty one as None", () => {
    assert.deepEqual(purposesOf({ purposes: [] }), []);
    assert.deepEqual(purposesOf({ purposes: ["billing"] }), ["billing"]);
    // An empty list must beat the older single field, not be overruled by it.
    assert.deepEqual(purposesOf({ purposes: [], purpose: "general" }), []);
  });

  it("falls back to the older single field only when there is no list", () => {
    assert.deepEqual(purposesOf({ purpose: "estimates" }), ["estimates"]);
    assert.deepEqual(purposesOf({ purpose: null }), []);
    assert.deepEqual(purposesOf({}), []);
  });

  it("drops a value it does not know", () => {
    assert.deepEqual(purposesOf({ purposes: ["billing", "nonsense"] }), ["billing"]);
    assert.deepEqual(purposesOf({ purpose: "nonsense" }), []);
  });
});

describe("the screen uses the list rather than its own copy", () => {
  const tab = readFileSync(
    fileURLToPath(new URL("../components/ProfileDetailsTab.tsx", import.meta.url)),
    "utf8",
  );

  it("renders the named choices", () => {
    assert.match(tab, /ROUTING_CHOICES\.map\(choice =>/);
    assert.match(tab, /onChange\(purposesForChoice\(event\.target\.value\)\)/);
  });

  it("no longer swallows the click that clears the last purpose", () => {
    assert.doesNotMatch(tab, /if \(next\.length\) onChange\(next\)/);
    assert.doesNotMatch(tab, /type="checkbox"[^>]*checked=\{value\.includes/);
  });

  it("no longer invents general for a channel that was saved as None", () => {
    assert.doesNotMatch(tab, /channel\.purposes\?\.length \? channel\.purposes/);
    assert.match(tab, /purposes: purposesOf\(channel\)/);
  });
});
