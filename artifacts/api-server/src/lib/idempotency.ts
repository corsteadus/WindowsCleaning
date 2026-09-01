import { and, eq } from "drizzle-orm";
import { apiIdempotencyKeysTable, db } from "@workspace/db";
import type { Request, Response } from "express";
export { hashIdempotencyRequest, stableStringify } from "./idempotency-core.ts";
import { hashIdempotencyRequest } from "./idempotency-core.ts";

export type IdempotencyTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type IdempotencyClaim =
  | { kind: "claimed"; record: typeof apiIdempotencyKeysTable.$inferSelect }
  | { kind: "replay"; record: typeof apiIdempotencyKeysTable.$inferSelect }
  | { kind: "conflict"; record: typeof apiIdempotencyKeysTable.$inferSelect }
  | { kind: "inProgress"; record: typeof apiIdempotencyKeysTable.$inferSelect };

export type IdempotencyCompletion = {
  resourceType: string;
  resourceId: number;
  responseStatus: number;
};

export function getIdempotencyKey(req: Request): string | null {
  const value = req.get("Idempotency-Key");
  if (!value) return null;
  const key = value.trim();
  if (!key) return null;
  return key;
}

/**
 * There is no account/organization tenant in this application yet. User
 * scope prevents one authenticated user from replaying another user's key
 * while preserving the legacy anonymous behavior for unauthenticated routes.
 */
export function getIdempotencyScope(req: Request): string {
  return req.user?.id ? `user:${req.user.id}` : "anonymous";
}

export function validateIdempotencyKey(key: string | null): string | null {
  if (key === null) return null;
  if (key.length > 255) {
    throw new Error("Idempotency-Key must be 255 characters or fewer");
  }
  return key;
}

export function getIdempotencyContext(
  req: Request,
  operation: string,
  normalizedRequest: unknown,
): { scope: string; operation: string; clientKey: string; requestHash: string } | null {
  const clientKey = validateIdempotencyKey(getIdempotencyKey(req));
  if (!clientKey) return null;
  return {
    scope: getIdempotencyScope(req),
    operation,
    clientKey,
    requestHash: hashIdempotencyRequest(normalizedRequest),
  };
}

export function markIdempotencyReplay(res: Response): void {
  res.setHeader("Idempotency-Replayed", "true");
}

export async function claimIdempotencyKey(
  tx: IdempotencyTransaction,
  input: {
    scope: string;
    operation: string;
    clientKey: string;
    requestHash: string;
  },
): Promise<IdempotencyClaim> {
  const [inserted] = await tx
    .insert(apiIdempotencyKeysTable)
    .values({
      scope: input.scope,
      operation: input.operation,
      clientKey: input.clientKey,
      requestHash: input.requestHash,
      status: "in_progress",
    })
    .onConflictDoNothing({
      target: [
        apiIdempotencyKeysTable.scope,
        apiIdempotencyKeysTable.operation,
        apiIdempotencyKeysTable.clientKey,
      ],
    })
    .returning();

  if (inserted) return { kind: "claimed", record: inserted };

  const [existing] = await tx
    .select()
    .from(apiIdempotencyKeysTable)
    .where(
      and(
        eq(apiIdempotencyKeysTable.scope, input.scope),
        eq(apiIdempotencyKeysTable.operation, input.operation),
        eq(apiIdempotencyKeysTable.clientKey, input.clientKey),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new Error("Idempotency record disappeared after conflict");
  }
  if (existing.requestHash !== input.requestHash) return { kind: "conflict", record: existing };
  if (existing.status === "completed") return { kind: "replay", record: existing };
  return { kind: "inProgress", record: existing };
}

export async function completeIdempotencyKey(
  tx: IdempotencyTransaction,
  id: number,
  completion: IdempotencyCompletion,
): Promise<void> {
  await tx
    .update(apiIdempotencyKeysTable)
    .set({
      status: "completed",
      resourceType: completion.resourceType,
      resourceId: completion.resourceId,
      responseStatus: completion.responseStatus,
      completedAt: new Date(),
    })
    .where(eq(apiIdempotencyKeysTable.id, id));
}

export async function releaseIdempotencyKey(
  tx: IdempotencyTransaction,
  id: number,
): Promise<void> {
  await tx.delete(apiIdempotencyKeysTable).where(eq(apiIdempotencyKeysTable.id, id));
}

export function idempotencyConflictMessage(): string {
  return "This Idempotency-Key was already used with a different request";
}

export function idempotencyInProgressMessage(): string {
  return "An identical request is already in progress";
}