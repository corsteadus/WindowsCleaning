import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { emailHistory, emailHistoryEntry, type EmailLogRow } from "./email-history.ts";
import { emailLogSenderV1Migration } from "../migrations/email-log-sender-v1.ts";
import { REQUIRED_MIGRATIONS } from "../migrations/application-migrations.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const log = (patch: Partial<EmailLogRow> = {}): EmailLogRow => ({
  id: 1, subject: "Your estimate", recipientEmail: "lute@corstead.us", recipientName: "Lute Atieh", status: "sent",
  sentAt: new Date("2026-10-20T15:00:00Z"), createdAt: new Date("2026-10-20T14:59:00Z"), errorMessage: null,
  templateName: null, sentBy: "Team Admin", campaignId: null, ...patch,
});

// Kyle, Video 4: date, time, what was sent, who sent it.
describe("a profile's email history", () => {
  it("says who sent a one-off email, when, and to whom", () => {
    const entry = emailHistoryEntry(log(), undefined);
    assert.deepEqual([entry.sender, entry.origin, entry.to, entry.at], ["Team Admin", "manual", "lute@corstead.us", "2026-10-20T15:00:00.000Z"]);
  });

  it("an automatic email says which automation sent it", () => {
    const entry = emailHistoryEntry(log({ sentBy: null, campaignId: 5 }), {
      id: 5, name: "[Auto] Estimate sent — 2026-10-10", createdBy: "automation-engine", automationRuleId: 1,
    });
    assert.deepEqual([entry.sender, entry.origin], ["Automatic: Estimate sent", "automation"]);
  });

  it("a campaign email says which campaign", () => {
    const entry = emailHistoryEntry(log({ sentBy: null, campaignId: 6 }), { id: 6, name: "Spring offer", createdBy: "Lute", automationRuleId: null });
    assert.deepEqual([entry.sender, entry.origin], ["Campaign: Spring offer", "campaign"]);
  });

  it("an email from before the sender was recorded says nobody, rather than guessing", () => {
    assert.equal(emailHistoryEntry(log({ sentBy: null }), undefined).sender, null);
  });

  it("newest first; an unsent one by when it was made", () => {
    const list = emailHistory([
      log({ id: 1 }), log({ id: 2, sentAt: new Date("2026-10-22T10:00:00Z") }), log({ id: 3, sentAt: null, createdAt: new Date("2026-10-21T10:00:00Z") }),
    ], []);
    assert.deepEqual(list.map((entry) => entry.id), [2, 3, 1]);
  });
});

describe("the wiring", () => {
  it("the one-off send records who sent it", () => {
    assert.match(read("../routes/emails.ts"), /sentBy:\s+senderName\(req\),/);
  });

  it("the history needs communication access, and is never a technician's", () => {
    const route = read("../routes/profile-emails.ts");
    assert.match(route, /isAssignmentScopedOperationalRole\(req\.user\?\.role\) \|\| !hasCapability\(req\.user\?\.role, "communication\.view"\)/);
  });

  it("one email is read only through its own profile", () => {
    assert.match(read("../routes/profile-emails.ts"), /where\(and\(ofProfile\(id\), eq\(emailLogsTable\.id, emailId\)\)\)/);
  });

  it("the migration only adds a column, and is registered", async () => {
    const calls: string[] = [];
    let exists = 0;
    const context: any = { environment: "sandbox", client: { query: async (text: string) => {
      calls.push(text);
      if (text.includes("information_schema.columns")) return { rows: [{ count: exists }] };
      if (text.startsWith("ALTER TABLE email_logs ADD COLUMN")) exists = 1;
      return { rows: [{ count: 0 }], rowCount: 0 };
    } } };
    const pre = await emailLogSenderV1Migration.preflight(context);
    await emailLogSenderV1Migration.apply(context, pre);
    await emailLogSenderV1Migration.verify(context);
    assert.ok(!calls.some((call) => /UPDATE email_logs|DELETE FROM email_logs/.test(call)));
    assert.ok(REQUIRED_MIGRATIONS.includes(emailLogSenderV1Migration as never));
  });
});
