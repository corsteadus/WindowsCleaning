import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./emails.ts", import.meta.url), "utf8");
const automationSource = readFileSync(
  new URL("../routes/automations.ts", import.meta.url),
  "utf8",
);

test("email send routes require communication sending capability", () => {
  assert.match(
    source,
    /router\.post\("\/emails\/send",\s*sendCommunication,/,
  );
  assert.match(
    source,
    /router\.post\("\/emails\/send-one",\s*sendCommunication,/,
  );
});


test("bulk sends resolve canonical records and default to marketing classification", () => {
  assert.match(source, /resolveEmailEntityRecipient/);
  assert.match(
    source,
    /req\.body\.classification === undefined \? "marketing" : req\.body\.classification/,
  );
  assert.match(source, /classification,/);
});

test("one-off sends require idempotency and reject quiet-hour deferrals as non-sends", () => {
  assert.match(source, /getIdempotencyContext\(req, "emails\.send-one"/);
  assert.match(source, /claimIdempotencyKey\(tx, idempotency\)/);
  assert.match(source, /completeIdempotencyKey\(tx, claim\.record\.id/);
  assert.match(source, /res\.status\(409\)\.json\(\{[\s\S]*no message was queued/);
});

test("legacy non-provider message logs are never marked sent or persisted with raw bodies", () => {
  assert.match(
    automationSource,
    /status = data\.recipient \? "not_dispatched" : "skipped"/,
  );
  assert.match(automationSource, /body: "\[redacted\]"/);
  assert.match(source, /bodyHtml: renderedBodyHtml/);
});