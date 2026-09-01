import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("customer operations route boundaries", () => {
  it("scopes customer communications by both related type and owned entity ids", async () => {
    const source = await readFile(new URL("./customers.ts", import.meta.url), "utf8");
    assert.match(source, /eq\(messageLogsTable\.relatedType, "customer"\), eq\(messageLogsTable\.relatedId, id\)/);
    assert.match(source, /eq\(messageLogsTable\.relatedType, "job"\), inArray\(messageLogsTable\.relatedId, jobs\.map/);
    assert.match(source, /eq\(messageLogsTable\.relatedType, "quote"\), inArray\(messageLogsTable\.relatedId, quotes\.map/);
    assert.match(source, /eq\(messageLogsTable\.relatedType, "invoice"\), inArray\(messageLogsTable\.relatedId, invoices\.map/);
    assert.doesNotMatch(source, /messageLogsTable\.relatedId, id\)\)\.orderBy/);
  });

  it("validates invoice ownership before safe sending and records invoice-related history", async () => {
    const source = await readFile(new URL("./emails.ts", import.meta.url), "utf8");
    assert.match(source, /relatedType === "invoice"/);
    assert.match(source, /invoice\.customerId !== recipient\.entityId/);
    assert.match(source, /relatedType: communicationRelation\.relatedType/);
    assert.match(source, /messageLogsTable/);
    assert.match(source, /recipient: maskCommunicationDestination\("email", recipient\.email\)/);
    assert.match(source, /body: "\[redacted\]"/);
  });

  it("recovers the exact initial job id from completed idempotency metadata", async () => {
    const source = await readFile(new URL("../lib/customer-initial-job-service.ts", import.meta.url), "utf8");
    assert.match(source, /initialJobIdFromResourceType/);
    assert.match(source, /findCustomerBundle\(customerId, replayInitialJobId\)/);
  });
});