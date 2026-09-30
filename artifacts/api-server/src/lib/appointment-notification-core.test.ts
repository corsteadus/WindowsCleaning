import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  decideSchedulePrompt, enabledChannels, promptSummary, scheduleChangeKind, scheduleEventFor,
} from "./appointment-notification-core.ts";

const at = (date: string | null, start: string | null = null, end: string | null = null) =>
  ({ scheduledDate: date, scheduledStartTime: start, scheduledEndTime: end });
const BOTH = { emailEnabled: true, smsEnabled: true };
const EMAIL = { emailEnabled: true, smsEnabled: false };
const OFF = { emailEnabled: false, smsEnabled: false };

describe("scheduleChangeKind", () => {
  it("is 'scheduled' the first time a job gets a date", () => {
    assert.equal(scheduleChangeKind(at(null), at("2026-10-01", "09:00")), "scheduled");
  });

  it("is 'rescheduled' when the date moves", () => {
    assert.equal(scheduleChangeKind(at("2026-10-01"), at("2026-10-02")), "rescheduled");
  });

  it("is 'rescheduled' when only the time moves", () => {
    assert.equal(scheduleChangeKind(at("2026-10-01", "09:00"), at("2026-10-01", "14:00")), "rescheduled");
  });

  it("is 'rescheduled' when only the end time moves", () => {
    assert.equal(
      scheduleChangeKind(at("2026-10-01", "09:00", "11:00"), at("2026-10-01", "09:00", "13:00")),
      "rescheduled",
    );
  });

  it("is 'unscheduled' when the job comes off the calendar", () => {
    assert.equal(scheduleChangeKind(at("2026-10-01", "09:00"), at(null)), "unscheduled");
  });

  it("is 'none' when nothing about the schedule moved", () => {
    assert.equal(scheduleChangeKind(at("2026-10-01", "09:00"), at("2026-10-01", "09:00")), "none");
  });

  it("treats a missing value and a null the same, so a resent form is not a move", () => {
    assert.equal(
      scheduleChangeKind({ scheduledDate: "2026-10-01", scheduledStartTime: null, scheduledEndTime: undefined },
        { scheduledDate: "2026-10-01", scheduledStartTime: undefined, scheduledEndTime: null }),
      "none",
    );
  });
});

describe("decideSchedulePrompt", () => {
  it("asks when a job is first booked", () => {
    const decision = decideSchedulePrompt({ before: at(null), after: at("2026-10-01", "09:00"), settings: EMAIL });
    assert.equal(decision.prompt, true);
    assert.equal(decision.kind, "scheduled");
    assert.equal(decision.reason, "asked");
  });

  it("asks again when it moves", () => {
    const decision = decideSchedulePrompt({ before: at("2026-10-01"), after: at("2026-10-03"), settings: EMAIL });
    assert.equal(decision.prompt, true);
    assert.equal(decision.kind, "rescheduled");
  });

  it("says nothing for a crew-only change — Kyle asked us not to interrupt", () => {
    const decision = decideSchedulePrompt({
      before: at("2026-10-01", "09:00"), after: at("2026-10-01", "09:00"), settings: BOTH,
    });
    assert.equal(decision.prompt, false);
    assert.equal(decision.reason, "nothing_changed");
  });

  it("says nothing when the business has not turned it on", () => {
    const decision = decideSchedulePrompt({ before: at(null), after: at("2026-10-01"), settings: OFF });
    assert.equal(decision.prompt, false);
    assert.equal(decision.reason, "no_channel_enabled");
  });

  it("says nothing when the setting has never been saved", () => {
    for (const settings of [null, undefined]) {
      const decision = decideSchedulePrompt({ before: at(null), after: at("2026-10-01"), settings });
      assert.equal(decision.prompt, false);
      assert.equal(decision.reason, "notifications_disabled");
    }
  });

  it("offers only the channels that are switched on, in a fixed order", () => {
    assert.deepEqual(
      decideSchedulePrompt({ before: at(null), after: at("2026-10-01"), settings: BOTH }).channels,
      ["email", "sms"],
    );
    assert.deepEqual(
      decideSchedulePrompt({ before: at(null), after: at("2026-10-01"), settings: EMAIL }).channels,
      ["email"],
    );
  });

  it("asks when a job comes off the calendar too", () => {
    const decision = decideSchedulePrompt({ before: at("2026-10-01"), after: at(null), settings: EMAIL });
    assert.equal(decision.prompt, true);
    assert.equal(decision.kind, "unscheduled");
  });

  it("asks for a date with no time, rather than never asking at all", () => {
    const decision = decideSchedulePrompt({ before: at(null), after: at("2026-10-01", null), settings: EMAIL });
    assert.equal(decision.prompt, true);
  });

  it("never returns prompt without a reason of 'asked'", () => {
    const cases = [
      { before: at(null), after: at("2026-10-01"), settings: EMAIL },
      { before: at("2026-10-01"), after: at("2026-10-01"), settings: EMAIL },
      { before: at(null), after: at("2026-10-01"), settings: OFF },
    ];
    for (const input of cases) {
      const decision = decideSchedulePrompt(input);
      assert.equal(decision.prompt, decision.reason === "asked");
    }
  });
});

describe("enabledChannels", () => {
  it("is empty when nothing is on, or nothing is saved", () => {
    assert.deepEqual(enabledChannels(OFF), []);
    assert.deepEqual(enabledChannels(null), []);
  });
});

describe("promptSummary", () => {
  it("says what the office is agreeing to", () => {
    assert.equal(promptSummary("scheduled", at("2026-10-01", "09:00")), "This job is now booked for 2026-10-01 at 09:00.");
    assert.equal(promptSummary("rescheduled", at("2026-10-03", "14:00")), "This job has moved to 2026-10-03 at 14:00.");
    assert.equal(promptSummary("unscheduled", at(null)), "This job is no longer booked.");
    assert.equal(promptSummary("none", at("2026-10-01")), "");
  });

  it("reads sensibly when there is no time", () => {
    assert.equal(promptSummary("scheduled", at("2026-10-01")), "This job is now booked for 2026-10-01.");
  });
});

describe("scheduleEventFor", () => {
  it("maps each change onto the event the send path already knows", () => {
    assert.equal(scheduleEventFor("scheduled"), "appointment.scheduled");
    assert.equal(scheduleEventFor("rescheduled"), "appointment.changed");
    assert.equal(scheduleEventFor("unscheduled"), "appointment.changed");
    assert.equal(scheduleEventFor("none"), null, "nothing to send when nothing moved");
  });
});
