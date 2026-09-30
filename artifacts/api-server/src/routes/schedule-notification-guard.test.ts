// Kyle 2026-09-24 #4: "Nothing should be sent automatically simply because a job
// was scheduled, dragged, moved, or edited." The only way a job schedule
// notification may be queued is somebody answering the prompt, so this reads the
// sources and fails if any other path starts enqueuing one again.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const SOURCES: Array<[string, string]> = [
  ["jobs.ts", "./jobs.ts"],
  ["recurring_plans.ts", "./recurring_plans.ts"],
  ["customer-initial-job-db-adapter.ts", "../lib/customer-initial-job-db-adapter.ts"],
  ["recurring-plan-engine.ts", "../lib/recurring-plan-engine.ts"],
];

/** Every enqueue of an appointment event, with the code around it. */
function appointmentEnqueues(code: string): string[] {
  const found: string[] = [];
  const pattern = /enqueueCommunicationEvent\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    const block = code.slice(match.index, match.index + 320);
    if (/eventType:\s*(scheduledEvent|event|"appointment\.)/.test(block)) found.push(block);
  }
  return found;
}

describe("no job schedule notification is queued without an answer", () => {
  for (const [label, path] of SOURCES) {
    it(`${label} does not enqueue one on its own`, () => {
      const code = strip(read(path));
      const enqueues = appointmentEnqueues(code);
      const unconfirmed = enqueues.filter((block) => !block.includes("schedule_notification_confirmed"));
      assert.deepEqual(unconfirmed, [],
        `${label} queues an appointment notification outside the confirmed path`);
    });
  }

  it("the one confirmed path is the schedule-notification endpoint", () => {
    const jobs = read("./jobs.ts");
    assert.match(jobs, /router\.post\("\/jobs\/:id\/schedule-notification"/);
    assert.match(jobs, /source: "jobs\.schedule_notification_confirmed"/);
  });

  it("the reschedule reports what to ask rather than acting on it", () => {
    const jobs = read("./jobs.ts");
    assert.match(jobs, /decideSchedulePrompt\(\{/);
    assert.match(jobs, /scheduleNotification: result\.decision/);
  });

  it("answering takes the authority that moving the job took", () => {
    const authorization = read("../lib/authorization.ts");
    assert.match(authorization, /schedule-notification\$\/\.test\(path\)\) \{\s*\n\s*return "schedule\.manage";/);
  });

  it("the send is refused if the business turned it off in between", () => {
    assert.match(read("./jobs.ts"), /code: "notifications_disabled"/);
  });

  it("both answers are written to the history, not only yes", () => {
    const jobs = read("./jobs.ts");
    assert.match(jobs, /"schedule_notification_sent"/);
    assert.match(jobs, /"schedule_notification_declined"/);
  });
});
