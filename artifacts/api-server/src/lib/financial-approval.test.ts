import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approvalPayloadHash,
  approvalRequired,
  parseApprovalAmountCents,
} from "./financial-approval-pure.ts";
import {
  runFinancialApprovalDecision,
  type ApprovalDecisionRequest,
  type ApprovalDecisionTx,
} from "./financial-approval-decision-core.ts";
import {
  FINANCIAL_CAPABILITIES,
  getFinancialCapabilities,
  hasFinancialCapability,
  requireFinancialCapability,
} from "./financial-permissions.ts";

const policy = {
  policyId: 11,
  actionType: "invoices.void" as const,
  enabled: true,
  thresholdCents: "10000",
  distinctApprover: true,
};

function request(overrides: Partial<ApprovalDecisionRequest> = {}): ApprovalDecisionRequest {
  return {
    id: 42,
    status: "pending",
    actionType: "invoices.void",
    requesterId: "requester",
    amountCents: "10000",
    // Keep the default fixture valid independently of the calendar date. The
    // three restored failures were caused by this fixed date becoming stale,
    // which made expiry return before authorization/idempotency was tested.
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    policySnapshot: policy,
    ...overrides,
  };
}

class DecisionHarness {
  state = request();
  executionCount = 0;
  completed: Array<{ id: number; completion: unknown }> = [];
  private lockTail = Promise.resolve();
  private releaseLock: (() => void) | null = null;
  private idempotency = new Map<string, { status: "in_progress" | "completed"; resourceId: number | null; requestHash: string }>();
  failExecution = false;
  failAudit = false;

  seedIdempotency(key: string, status: "in_progress" | "completed"): void {
    this.idempotency.set(key, { status, resourceId: status === "completed" ? this.state.id : null, requestHash: "seed" });
  }

  readonly tx: ApprovalDecisionTx = {
    claimIdempotency: async ({ clientKey, requestHash }) => {
      const existing = this.idempotency.get(clientKey);
      if (existing?.status === "completed") {
        return existing.requestHash === requestHash
          ? { kind: "replay", record: existing }
          : { kind: "conflict" };
      }
      if (existing) return { kind: "inProgress" };
      this.idempotency.set(clientKey, { status: "in_progress", resourceId: null, requestHash });
      return { kind: "claimed", record: { id: this.idempotency.size } };
    },
    getRequestForUpdate: async () => {
      const previous = this.lockTail;
      let release!: () => void;
      this.lockTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      this.releaseLock = release;
      return { ...this.state };
    },
    getCurrentPolicy: async () => policy,
    markExpired: async () => {
      this.state.status = "expired";
      this.releaseLock?.();
      this.releaseLock = null;
    },
    markCancelled: async () => {
      this.state.status = "cancelled";
      this.releaseLock?.();
      this.releaseLock = null;
    },
    markRejected: async () => {
      this.state.status = "rejected";
      this.releaseLock?.();
      this.releaseLock = null;
    },
    executeApproved: async () => {
      if (this.failExecution) throw new Error("execution failed");
      this.executionCount += 1;
      return { resourceType: "invoice", resourceId: 99, metadata: null };
    },
    markExecuted: async () => {
      if (this.failAudit) throw new Error("audit failed");
      this.state.status = "executed";
      this.releaseLock?.();
      this.releaseLock = null;
    },
    completeIdempotency: async (id, completion) => {
      this.completed.push({ id, completion });
      const key = [...this.idempotency.entries()].find(([, record]) => record.status === "in_progress")?.[0];
      if (key) {
        this.idempotency.set(key, {
          status: "completed",
          resourceId: (completion as { resourceId: number }).resourceId,
          requestHash: this.idempotency.get(key)!.requestHash,
        });
      }
    },
  };
}

test("role capability matrix has no approval access expansion", () => {
  const approvals = ["approvals.view", "approvals.decide", "approvals.manage", "automation_events.view", "automation_events.manage"];
  assert.deepEqual(getFinancialCapabilities("super_admin").filter((cap) => approvals.includes(cap)), approvals);
  assert.deepEqual(getFinancialCapabilities("owner").filter((cap) => approvals.includes(cap)), approvals);
  assert.deepEqual(
    getFinancialCapabilities("admin").filter((cap) => approvals.includes(cap)),
    ["approvals.view", "approvals.decide", "automation_events.view"],
  );
  assert.deepEqual(
    getFinancialCapabilities("employee").filter((cap) => approvals.includes(cap)),
    [],
  );
  assert.deepEqual(getFinancialCapabilities("unknown"), []);
  assert.equal(hasFinancialCapability("employee", "approvals.view"), false);
  assert.equal(hasFinancialCapability("admin", "approvals.manage"), false);
});

test("office admin financial permissions include its authenticated compatibility role", () => {
  assert.deepEqual(getFinancialCapabilities("team_office"), getFinancialCapabilities("office_admin"));
  for (const role of ["team_office", "office_admin", "super_admin"]) {
    assert.equal(hasFinancialCapability(role, "payments.record"), true, `${role} may record payments`);
    assert.equal(hasFinancialCapability(role, "invoices.view"), true, `${role} may view invoices`);
    assert.equal(hasFinancialCapability(role, "invoices.manage"), true, `${role} may manage invoices`);
  }
  assert.equal(hasFinancialCapability("field_tech", "payments.record"), false);
  assert.equal(hasFinancialCapability("field_tech", "invoices.view"), false);
  assert.equal(hasFinancialCapability("field_tech", "invoices.manage"), false);
  for (const role of ["owner", "admin"]) {
    assert.equal(hasFinancialCapability(role, "invoices.view"), true);
    assert.equal(hasFinancialCapability(role, "invoices.manage"), true);
  }
  assert.equal(hasFinancialCapability("employee", "invoices.view"), false);
  assert.equal(hasFinancialCapability("employee", "invoices.manage"), false);
  assert.deepEqual(getFinancialCapabilities("employee"), []);
});

test("financial capability middleware returns 401/403 and allows only mapped roles", () => {
  const denied: Array<{ status: number; body: unknown }> = [];
  let code = 0;
  const res = {
    status(status: number) { code = status; return { json(body: unknown) { denied.push({ status: code, body }); } }; },
  } as any;
  const manage = requireFinancialCapability("approvals.manage");
  manage({ user: undefined } as any, res, () => assert.fail("anonymous user advanced"));
  manage({ user: { role: "admin" } } as any, res, () => assert.fail("admin advanced to policy management"));
  let advanced = false;
  manage({ user: { role: "owner" } } as any, {} as any, () => { advanced = true; });
  assert.equal(advanced, true);
  assert.equal(denied.length, 2);
  assert.deepEqual(denied.map((entry) => entry.status), [401, 403]);
});

test("payment financial middleware allows office admins and never advances field techs", () => {
  const record = requireFinancialCapability("payments.record");
  for (const role of ["team_office", "office_admin", "super_admin"]) {
    let advanced = 0;
    record({ user: { role } } as any, {} as any, () => { advanced += 1; });
    assert.equal(advanced, 1, `${role} should advance exactly once`);
  }
  let fieldTechAdvanced = 0;
  let status = 0;
  let body: any;
  const res = {
    status(value: number) {
      status = value;
      return { json(valueBody: unknown) { body = valueBody; } };
    },
  } as any;
  record({ user: { role: "field_tech" } } as any, res, () => { fieldTechAdvanced += 1; });
  assert.equal(status, 403);
  assert.equal(body.capability, "payments.record");
  assert.equal(fieldTechAdvanced, 0);
});

test("exact-cent threshold semantics and canonical hashes are stable", () => {
  assert.equal(parseApprovalAmountCents("99.99"), 9999n);
  assert.equal(parseApprovalAmountCents("100.00"), 10000n);
  assert.equal(approvalRequired(policy, 9999n), false);
  assert.equal(approvalRequired(policy, 10000n), true);
  assert.equal(approvalRequired(policy, 10001n), true);
  assert.equal(approvalPayloadHash({ b: 2, a: { y: 1, x: 0 } }), approvalPayloadHash({ a: { x: 0, y: 1 }, b: 2 }));
});

test("distinct approver, cancellation ownership, stale policy, and rejection prevent execution", async () => {
  const self = new DecisionHarness();
  await assert.rejects(
    runFinancialApprovalDecision({
      tx: self.tx,
      requestId: 42,
      action: "approve",
      actorId: "requester",
      actorName: "Requester",
      canManageCancellation: false,
      note: null,
      clientKey: "self",
      now: new Date("2026-08-15T00:00:00.000Z"),
    }),
    (error: any) => error.code === "approval_self_decision",
  );
  assert.equal(self.executionCount, 0);

  const unauthorizedCancel = new DecisionHarness();
  await assert.rejects(
    runFinancialApprovalDecision({
      tx: unauthorizedCancel.tx,
      requestId: 42,
      action: "cancel",
      actorId: "other",
      actorName: "Other",
      canManageCancellation: false,
      note: null,
      clientKey: "cancel",
    }),
    (error: any) => error.code === "approval_unauthorized",
  );
  assert.equal(unauthorizedCancel.executionCount, 0);

  const stale = new DecisionHarness();
  stale.tx.getCurrentPolicy = async () => ({ ...policy, policyId: 12 });
  await assert.rejects(
    runFinancialApprovalDecision({
      tx: stale.tx,
      requestId: 42,
      action: "approve",
      actorId: "approver",
      actorName: "Approver",
      canManageCancellation: false,
      note: null,
      clientKey: "stale",
    }),
    (error: any) => error.code === "approval_policy_stale",
  );
  assert.equal(stale.executionCount, 0);

  const rejected = new DecisionHarness();
  const rejection = await runFinancialApprovalDecision({
    tx: rejected.tx,
    requestId: 42,
    action: "reject",
    actorId: "approver",
    actorName: "Approver",
    canManageCancellation: false,
    note: "No",
    clientKey: "reject",
  });
  assert.deepEqual(rejection, { kind: "completed", requestId: 42 });
  assert.equal(rejected.state.status, "rejected");
  assert.equal(rejected.executionCount, 0);
});

test("expiry, manager cancellation, idempotency states, and transaction failures never execute", async () => {
  const expired = new DecisionHarness();
  const expiry = await runFinancialApprovalDecision({
    tx: expired.tx,
    requestId: 42,
    action: "approve",
    actorId: "approver",
    actorName: "Approver",
    canManageCancellation: false,
    note: null,
    clientKey: "expired",
    now: new Date("2099-01-02T00:00:00.000Z"),
  });
  assert.deepEqual(expiry, { kind: "expired", requestId: 42 });
  assert.equal(expired.state.status, "expired");
  assert.equal(expired.executionCount, 0);

  const managerCancel = new DecisionHarness();
  const cancellation = await runFinancialApprovalDecision({
    tx: managerCancel.tx,
    requestId: 42,
    action: "cancel",
    actorId: "manager",
    actorName: "Manager",
    canManageCancellation: true,
    note: "Withdrawn",
    clientKey: "manager-cancel",
  });
  assert.deepEqual(cancellation, { kind: "completed", requestId: 42 });
  assert.equal(managerCancel.state.status, "cancelled");

  const inProgress = new DecisionHarness();
  inProgress.seedIdempotency("busy", "in_progress");
  assert.deepEqual(
    await runFinancialApprovalDecision({
      tx: inProgress.tx,
      requestId: 42,
      action: "approve",
      actorId: "approver",
      actorName: "Approver",
      canManageCancellation: false,
      note: null,
      clientKey: "busy",
    }),
    { kind: "inProgress" },
  );

  const conflict = new DecisionHarness();
  conflict.seedIdempotency("used", "completed");
  assert.deepEqual(
    await runFinancialApprovalDecision({
      tx: conflict.tx,
      requestId: 42,
      action: "approve",
      actorId: "approver",
      actorName: "Approver",
      canManageCancellation: false,
      note: "different payload",
      clientKey: "used",
    }),
    { kind: "conflict" },
  );

  const executionFailure = new DecisionHarness();
  executionFailure.failExecution = true;
  await assert.rejects(runFinancialApprovalDecision({
    tx: executionFailure.tx,
    requestId: 42,
    action: "approve",
    actorId: "approver",
    actorName: "Approver",
    canManageCancellation: false,
    note: null,
    clientKey: "execution-failure",
  }));
  assert.equal(executionFailure.state.status, "pending");
  assert.equal(executionFailure.executionCount, 0);

  const auditFailure = new DecisionHarness();
  auditFailure.failAudit = true;
  await assert.rejects(runFinancialApprovalDecision({
    tx: auditFailure.tx,
    requestId: 42,
    action: "approve",
    actorId: "approver",
    actorName: "Approver",
    canManageCancellation: false,
    note: null,
    clientKey: "audit-failure",
  }));
  assert.equal(auditFailure.state.status, "pending");
  assert.equal(auditFailure.executionCount, 1);
});

test("concurrent decisions execute once; replay points to the approval request", async () => {
  const harness = new DecisionHarness();
  const results = await Promise.allSettled([
    runFinancialApprovalDecision({
      tx: harness.tx,
      requestId: 42,
      action: "approve",
      actorId: "approver-a",
      actorName: "Approver A",
      canManageCancellation: false,
      note: null,
      clientKey: "a",
    }),
    runFinancialApprovalDecision({
      tx: harness.tx,
      requestId: 42,
      action: "approve",
      actorId: "approver-b",
      actorName: "Approver B",
      canManageCancellation: false,
      note: null,
      clientKey: "b",
    }),
  ]);
  assert.equal(harness.executionCount, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled" && result.value.kind === "completed").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && (result.reason as { code?: string }).code === "approval_executed").length, 1);

  const replay = await runFinancialApprovalDecision({
    tx: harness.tx,
    requestId: 42,
    action: "approve",
    actorId: "approver-a",
    actorName: "Approver A",
    canManageCancellation: false,
    note: null,
    clientKey: "a",
  });
  assert.equal(replay.kind, "replay");
  assert.equal((replay as any).record.resourceId, 42);
});