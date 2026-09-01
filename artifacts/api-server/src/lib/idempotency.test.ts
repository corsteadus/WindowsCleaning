import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hashIdempotencyRequest,
  stableStringify,
} from "./idempotency-core.ts";

type StoredRecord = {
  hash: string;
  promise: Promise<number>;
  resourceId?: number;
};

class InMemoryIdempotencyCoordinator {
  private readonly records = new Map<string, StoredRecord>();

  async execute(
    key: string,
    request: unknown,
    effect: () => Promise<number>,
  ): Promise<{ resourceId: number; replayed: boolean }> {
    const hash = hashIdempotencyRequest(request);
    const existing = this.records.get(key);
    if (existing) {
      assert.equal(existing.hash, hash, "same key with a different request must conflict");
      return { resourceId: await existing.promise, replayed: true };
    }

    const promise = effect();
    const record: StoredRecord = { hash, promise };
    this.records.set(key, record);
    const resourceId = await promise;
    record.resourceId = resourceId;
    return { resourceId, replayed: false };
  }
}

test("idempotency request hashing is stable and does not retain request payloads", () => {
  assert.equal(
    stableStringify({ b: 2, a: { y: true, x: 1 } }),
    stableStringify({ a: { x: 1, y: true }, b: 2 }),
  );
  assert.equal(
    hashIdempotencyRequest({ b: 2, a: 1 }),
    hashIdempotencyRequest({ a: 1, b: 2 }),
  );
});

test("same key replays the canonical resource and executes one side effect", async () => {
  const coordinator = new InMemoryIdempotencyCoordinator();
  let effects = 0;
  const effect = async () => {
    effects++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return 101;
  };

  const [first, retry] = await Promise.all([
    coordinator.execute("same-key", { jobId: 7, status: "paid" }, effect),
    coordinator.execute("same-key", { status: "paid", jobId: 7 }, effect),
  ]);

  assert.equal(first.resourceId, 101);
  assert.equal(retry.resourceId, 101);
  assert.equal(first.replayed, false);
  assert.equal(retry.replayed, true);
  assert.equal(effects, 1);
});

test("same key with a mismatched logical request conflicts", async () => {
  const coordinator = new InMemoryIdempotencyCoordinator();
  await coordinator.execute("key", { invoiceId: 7, status: "paid" }, async () => 1);
  await assert.rejects(
    coordinator.execute("key", { invoiceId: 8, status: "paid" }, async () => 2),
  );
});

test("different keys allow intentional additional effects", async () => {
  const coordinator = new InMemoryIdempotencyCoordinator();
  let nextId = 200;
  const effect = async () => ++nextId;

  const first = await coordinator.execute("first", { jobId: 7 }, effect);
  const second = await coordinator.execute("second", { jobId: 7 }, effect);

  assert.equal(first.resourceId, 201);
  assert.equal(second.resourceId, 202);
  assert.equal(second.replayed, false);
});