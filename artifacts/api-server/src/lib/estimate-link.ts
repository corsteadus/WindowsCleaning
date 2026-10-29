/**
 * Giving a customer their estimate: a secure link to the finalized revision, the
 * delivery recorded, the estimate marked sent and its validity started. Used by
 * the old "deliver" action and by the estimate email (phase 7), so both make the
 * link the same way. The raw token exists only in what this returns.
 */
import { createHash, randomBytes } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import {
  db, estimateActivitiesTable, estimateDeliveryRequestsTable, estimatePublicLinksTable, estimateRevisionsTable, quotesTable,
} from "@workspace/db";
import { isTerminalEstimateStatus } from "./estimate-lifecycle.ts";
import { quoteExpiryFor } from "./quote-settings.ts";
import { newOpenKey } from "./estimate-opens.ts";

type DrizzleTX = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const estimateTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export class EstimateLinkError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

export async function createEstimateLinkTx(tx: DrizzleTX, input: {
  quoteId: number;
  validityDays: number;
  deliveries: Array<{ channel: "email" | "sms"; recipient: string; status: string; lastError?: string | null }>;
  actorId: string | null;
  /** What the activity says about how it went out. */
  detail?: Record<string, unknown>;
}) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${input.quoteId})`);
  const [quote] = await tx.select().from(quotesTable).where(eq(quotesTable.id, input.quoteId)).limit(1);
  if (!quote) throw new EstimateLinkError("Estimate not found", 404);
  if (isTerminalEstimateStatus(quote.status)) {
    throw new EstimateLinkError("Accepted estimate terms are locked; create a revision before delivering again", 409);
  }
  const [revision] = await tx.select().from(estimateRevisionsTable)
    .where(eq(estimateRevisionsTable.quoteId, input.quoteId))
    .orderBy(desc(estimateRevisionsTable.revisionNumber)).limit(1);
  if (!revision) throw new EstimateLinkError("Finalize the estimate before sending", 400);
  // Kyle #11/#12: the validity is the company's, and starts when the customer is given it.
  const expiry = quoteExpiryFor(new Date(), input.validityDays);
  const token = randomBytes(32).toString("base64url");
  const channels = [...new Set(input.deliveries.map((d) => d.channel))];
  const [link] = await tx.insert(estimatePublicLinksTable).values({
    quoteId: input.quoteId, revisionId: revision.id, tokenHash: estimateTokenHash(token), expiresAt: expiry.expiresAt, sendMethods: channels.join(","),
  }).returning();
  // A2: each recipient's copy of the link carries its own key, so an open says whose it was.
  const keys = input.deliveries.map(() => newOpenKey());
  const inserted = input.deliveries.length
    ? await tx.insert(estimateDeliveryRequestsTable).values(input.deliveries.map((d, i) => ({
      quoteId: input.quoteId, publicLinkId: link.id, channel: d.channel, recipient: d.recipient,
      status: d.status, lastError: d.lastError ?? null, requestedBy: input.actorId, openKeyHash: keys[i].hash,
    }))).returning()
    : [];
  const deliveries = inserted.map(({ openKeyHash: _hash, ...d }) => ({ ...d, openKey: keys.find((k) => k.hash === _hash)!.key }));
  await tx.update(quotesTable).set({ status: "sent", validUntil: expiry.validUntil }).where(eq(quotesTable.id, input.quoteId));
  await tx.insert(estimateActivitiesTable).values({
    quoteId: input.quoteId, publicLinkId: link.id, activityType: "estimate_sent", actorId: input.actorId,
    detail: { channels, expiresAt: expiry.expiresAt.toISOString(), ...input.detail },
  });
  return { token, link, deliveries, quote, revision, validUntil: expiry.validUntil };
}
