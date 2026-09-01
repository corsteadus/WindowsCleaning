import { Router } from "express";
import { and, count, desc, eq } from "drizzle-orm";
import {
  communicationQuietHoursTable,
  communicationSuppressionsTable,
  db,
} from "@workspace/db";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  getIdempotencyContext,
  markIdempotencyReplay,
} from "../lib/idempotency.ts";
import { requireFinancialCapability } from "../lib/financial-permissions.ts";
import {
  changePreference,
  contactSafetyHistory,
  contactSafetySummary,
  customerSafetyHistory,
  customerSafetySummary,
  deactivateSuppression,
  readQuietHours,
  resolveCustomerDestination,
  retireOptOutSuppressions,
  safetyActor,
  upsertSuppression,
} from "../lib/communication-safety-store.ts";
import { normalizeCommunicationDestination } from "../lib/communication-safety-core.ts";

const router = Router();
const viewCommunication = requireFinancialCapability("communication.view");
const manageCommunication = requireFinancialCapability("communication.manage");
const manageCommunicationSettings = requireFinancialCapability(
  "communication.settings",
);

function parsePositiveId(value: string | string[]): number | null {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function bodyObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requireChannel(value: unknown): "email" | "sms" | null {
  return value === "email" || value === "sms" ? value : null;
}

function errorStatus(error: unknown): number {
  return error instanceof Error &&
    /Invalid (email|phone) destination|No (email|sms) destination|Customer not found|Contact not found|Quiet-hours|Invalid IANA timezone/.test(
      error.message,
    )
    ? 400
    : 500;
}

router.get(
  "/customers/:id/communication-safety",
  viewCommunication,
  async (req, res): Promise<void> => {
    const customerId = parsePositiveId(req.params.id);
    if (!customerId) {
      res.status(400).json({ error: "Customer id must be a positive integer" });
      return;
    }
    const summary = await customerSafetySummary(db, customerId);
    if (!summary) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    res.json(summary);
  },
);

router.get(
  "/customers/:id/communication-safety/history",
  viewCommunication,
  async (req, res): Promise<void> => {
    const customerId = parsePositiveId(req.params.id);
    if (!customerId) {
      res.status(400).json({ error: "Customer id must be a positive integer" });
      return;
    }
    const [history, summary] = await Promise.all([
      customerSafetyHistory(db, customerId, Number(req.query.limit) || 100),
      customerSafetySummary(db, customerId),
    ]);
    if (!summary) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }
    res.json({ customerId, data: history });
  },
);

router.get(
  "/contacts/:id/communication-safety",
  viewCommunication,
  async (req, res): Promise<void> => {
    const contactId = parsePositiveId(req.params.id);
    if (!contactId) {
      res.status(400).json({ error: "Contact id must be a positive integer" });
      return;
    }
    const summary = await contactSafetySummary(db, contactId);
    if (!summary) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }
    res.json(summary);
  },
);

router.get(
  "/contacts/:id/communication-safety/history",
  viewCommunication,
  async (req, res): Promise<void> => {
    const contactId = parsePositiveId(req.params.id);
    if (!contactId) {
      res.status(400).json({ error: "Contact id must be a positive integer" });
      return;
    }
    const [history, summary] = await Promise.all([
      contactSafetyHistory(db, contactId, Number(req.query.limit) || 100),
      contactSafetySummary(db, contactId),
    ]);
    if (!summary) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }
    res.json({ contactId, customerId: summary.customerId, data: history });
  },
);

async function recordPreferenceChange(
  req: Parameters<typeof viewCommunication>[0],
  res: Parameters<typeof viewCommunication>[1],
  action: "consent_recorded" | "opted_out" | "reconsented",
): Promise<void> {
  const customerId = parsePositiveId(req.params.id);
  if (!customerId) {
    res.status(400).json({ error: "Customer id must be a positive integer" });
    return;
  }
  const body = bodyObject(req.body);
  const channel = requireChannel(body.channel);
  if (!channel) {
    res.status(400).json({ error: "channel must be email or sms" });
    return;
  }
  if (
    channel === "sms" &&
    action !== "opted_out" &&
    (typeof body.disclosureSnapshot !== "string" ||
      !body.disclosureSnapshot.trim())
  ) {
    res.status(400).json({
      error: "SMS consent requires the exact disclosure/terms snapshot",
    });
    return;
  }
  const destination =
    typeof body.destination === "string" ? body.destination : undefined;
  const contactId = body.contactId == null ? null : Number(body.contactId);
  if (contactId !== null && (!Number.isInteger(contactId) || contactId <= 0)) {
    res.status(400).json({ error: "contactId must be a positive integer" });
    return;
  }
  const normalizedRequest = {
    customerId,
    contactId,
    channel,
    destination: destination?.trim() ?? null,
    action,
    disclosureSnapshot: body.disclosureSnapshot ?? null,
    reason: body.reason ?? null,
  };
  const idempotency = getIdempotencyContext(
    req,
    `communication_safety.${action}`,
    normalizedRequest,
  );
  if (!idempotency) {
    res.status(400).json({ error: "Idempotency-Key is required" });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      const claim = await claimIdempotencyKey(tx, idempotency);
      if (claim.kind === "conflict") return { kind: "conflict" as const };
      if (claim.kind === "replay") return { kind: "replay" as const };
      if (claim.kind === "inProgress") return { kind: "inProgress" as const };
      const resolved = await resolveCustomerDestination(
        tx,
        customerId,
        contactId,
        channel,
        destination,
      );
      const changed = await changePreference(tx, {
        customerId,
        contactId,
        channel,
        destination: resolved.normalized,
        action,
        source:
          typeof body.source === "string" && body.source.trim()
            ? body.source.trim()
            : "crm.manual",
        actor: safetyActor(req),
        reason:
          typeof body.reason === "string" ? body.reason.trim() || null : null,
        disclosureSnapshot:
          typeof body.disclosureSnapshot === "string"
            ? body.disclosureSnapshot
            : null,
        consentAt: new Date(),
      });
      if (action === "opted_out") {
        await upsertSuppression(tx, {
          channel,
          destination: resolved.normalized,
          reason: channel === "email" ? "marketing_unsubscribe" : "manual",
          scope: channel === "email" ? "marketing" : "global",
          source: "crm.customer_opt_out",
          actor: safetyActor(req),
        });
      } else if (action === "reconsented") {
        await retireOptOutSuppressions(
          tx,
          channel,
          changed.destination.hash,
          safetyActor(req),
        );
      }
      await completeIdempotencyKey(tx, claim.record.id, {
        resourceType: "communication_preference",
        resourceId: changed.preference.id,
        responseStatus: 200,
      });
      return {
        kind: "completed" as const,
        destinationHash: changed.destination.hash,
      };
    });
    if (result.kind === "conflict") {
      res.status(409).json({
        error: "This Idempotency-Key was already used with a different request",
        code: "idempotency_conflict",
      });
      return;
    }
    if (result.kind === "inProgress") {
      res.status(409).json({
        error: "A request with this Idempotency-Key is already in progress",
        code: "idempotency_in_progress",
      });
      return;
    }
    if (result.kind === "replay") {
      markIdempotencyReplay(res);
      res.json({ status: "already_recorded", customerId, action });
      return;
    }
    res.json({
      status: "recorded",
      customerId,
      action,
      destinationHash: result.destinationHash,
    });
  } catch (error) {
    res.status(errorStatus(error)).json({
      error:
        error instanceof Error
          ? error.message
          : "Communication preference update failed",
    });
  }
}

router.post(
  "/customers/:id/communication-safety/consent",
  manageCommunication,
  async (req, res): Promise<void> => {
    await recordPreferenceChange(req, res, "consent_recorded");
  },
);

router.post(
  "/customers/:id/communication-safety/re-consent",
  manageCommunication,
  async (req, res): Promise<void> => {
    await recordPreferenceChange(req, res, "reconsented");
  },
);

router.post(
  "/customers/:id/communication-safety/opt-out",
  manageCommunication,
  async (req, res): Promise<void> => {
    await recordPreferenceChange(req, res, "opted_out");
  },
);

router.get(
  "/communication-safety/suppressions",
  manageCommunicationSettings,
  async (req, res): Promise<void> => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(req.query.pageSize) || 50),
    );
    const [data, [{ total }]] = await Promise.all([
      db
        .select({
          id: communicationSuppressionsTable.id,
          channel: communicationSuppressionsTable.channel,
          destinationHash: communicationSuppressionsTable.destinationHash,
          reason: communicationSuppressionsTable.reason,
          scope: communicationSuppressionsTable.scope,
          active: communicationSuppressionsTable.active,
          source: communicationSuppressionsTable.source,
          actor: communicationSuppressionsTable.actor,
          createdAt: communicationSuppressionsTable.createdAt,
          deactivatedAt: communicationSuppressionsTable.deactivatedAt,
        })
        .from(communicationSuppressionsTable)
        .orderBy(
          desc(communicationSuppressionsTable.createdAt),
          desc(communicationSuppressionsTable.id),
        )
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: count() }).from(communicationSuppressionsTable),
    ]);
    res.json({ data, page, pageSize, total: Number(total) });
  },
);

router.post(
  "/communication-safety/suppressions",
  manageCommunicationSettings,
  async (req, res): Promise<void> => {
    const body = bodyObject(req.body);
    const channel = requireChannel(body.channel);
    const destination =
      typeof body.destination === "string" ? body.destination.trim() : "";
    const reason = [
      "complaint",
      "invalid",
      "provider_permanent_failure",
      "manual",
      "marketing_unsubscribe",
    ].includes(String(body.reason))
      ? (String(body.reason) as
          | "complaint"
          | "invalid"
          | "provider_permanent_failure"
          | "manual"
          | "marketing_unsubscribe")
      : null;
    const scope = ["global", "marketing", "transactional"].includes(
      String(body.scope),
    )
      ? (String(body.scope) as "global" | "marketing" | "transactional")
      : null;
    if (!channel || !destination || !reason || !scope) {
      res.status(400).json({
        error: "channel, destination, reason, and scope are required",
      });
      return;
    }
    try {
      const normalized = normalizeCommunicationDestination(
        channel,
        destination,
      );
      const idempotency = getIdempotencyContext(
        req,
        "communication_safety.suppression_create",
        { channel, destinationHash: normalized.hash, reason, scope },
      );
      if (!idempotency) {
        res.status(400).json({ error: "Idempotency-Key is required" });
        return;
      }
      const result = await db.transaction(async (tx) => {
        const claim = await claimIdempotencyKey(tx, idempotency);
        if (claim.kind !== "claimed") return claim;
        const row = await upsertSuppression(tx, {
          channel,
          destination,
          reason,
          scope,
          source:
            typeof body.source === "string" ? body.source : "crm.settings",
          actor: safetyActor(req),
        });
        if (!row) throw new Error("Suppression could not be created");
        await completeIdempotencyKey(tx, claim.record.id, {
          resourceType: "communication_suppression",
          resourceId: row.id,
          responseStatus: 201,
        });
        return { kind: "completed" as const, row };
      });
      if (result.kind === "conflict") {
        res.status(409).json({
          error: "Idempotency-Key payload mismatch",
          code: "idempotency_conflict",
        });
        return;
      }
      if (result.kind === "inProgress") {
        res.status(409).json({
          error: "Request already in progress",
          code: "idempotency_in_progress",
        });
        return;
      }
      if (result.kind === "replay") {
        markIdempotencyReplay(res);
        res.json({ status: "already_recorded" });
        return;
      }
      res.status(201).json({
        id: result.row.id,
        channel: result.row.channel,
        destinationHash: result.row.destinationHash,
        reason: result.row.reason,
        scope: result.row.scope,
        active: result.row.active,
      });
    } catch (error) {
      res.status(errorStatus(error)).json({
        error:
          error instanceof Error ? error.message : "Suppression update failed",
      });
    }
  },
);

router.get(
  "/communication-safety/quiet-hours",
  manageCommunicationSettings,
  async (_req, res): Promise<void> => {
    res.json(await readQuietHours(db));
  },
);

router.patch(
  "/communication-safety/suppressions/:id",
  manageCommunicationSettings,
  async (req, res): Promise<void> => {
    const suppressionId = parsePositiveId(req.params.id);
    if (!suppressionId) {
      res
        .status(400)
        .json({ error: "Suppression id must be a positive integer" });
      return;
    }
    const body = bodyObject(req.body);
    if (body.active !== false) {
      res.status(400).json({
        error:
          "Only deactivation is supported; create a new suppression to re-activate",
      });
      return;
    }
    const idempotency = getIdempotencyContext(
      req,
      "communication_safety.suppression_deactivate",
      { suppressionId, active: false },
    );
    if (!idempotency) {
      res.status(400).json({ error: "Idempotency-Key is required" });
      return;
    }
    try {
      const result = await db.transaction(async (tx) => {
        const claim = await claimIdempotencyKey(tx, idempotency);
        if (claim.kind !== "claimed") return claim;
        const row = await deactivateSuppression(
          tx,
          suppressionId,
          safetyActor(req),
        );
        if (!row) {
          await completeIdempotencyKey(tx, claim.record.id, {
            resourceType: "communication_suppression",
            resourceId: suppressionId,
            responseStatus: 404,
          });
          return { kind: "notFound" as const };
        }
        await completeIdempotencyKey(tx, claim.record.id, {
          resourceType: "communication_suppression",
          resourceId: row.id,
          responseStatus: 200,
        });
        return { kind: "completed" as const, row };
      });
      if (result.kind === "conflict") {
        res.status(409).json({
          error: "Idempotency-Key payload mismatch",
          code: "idempotency_conflict",
        });
        return;
      }
      if (result.kind === "inProgress") {
        res.status(409).json({
          error: "Request already in progress",
          code: "idempotency_in_progress",
        });
        return;
      }
      if (result.kind === "replay") {
        markIdempotencyReplay(res);
        res.json({ status: "already_recorded" });
        return;
      }
      if (result.kind === "notFound") {
        res.status(404).json({ error: "Active suppression not found" });
        return;
      }
      res.json({
        id: result.row.id,
        channel: result.row.channel,
        destinationHash: result.row.destinationHash,
        reason: result.row.reason,
        scope: result.row.scope,
        active: false,
        source: result.row.source,
        actor: result.row.actor,
        createdAt: result.row.createdAt,
        deactivatedAt: result.row.deactivatedAt,
      });
    } catch (error) {
      res.status(errorStatus(error)).json({
        error:
          error instanceof Error
            ? error.message
            : "Suppression deactivation failed",
      });
    }
  },
);

router.put(
  "/communication-safety/quiet-hours",
  manageCommunicationSettings,
  async (req, res): Promise<void> => {
    const body = bodyObject(req.body);
    const timezone =
      typeof body.timezone === "string" ? body.timezone.trim() : "";
    if (!timezone) {
      res.status(400).json({ error: "timezone is required" });
      return;
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    } catch {
      res.status(400).json({ error: "Invalid IANA timezone" });
      return;
    }
    const quietTimePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    for (const field of ["emailStart", "emailEnd", "smsStart", "smsEnd"]) {
      const value = body[field];
      if (
        value != null &&
        value !== "" &&
        (typeof value !== "string" || !quietTimePattern.test(value))
      ) {
        res.status(400).json({ error: `${field} must use HH:MM` });
        return;
      }
    }
    for (const [start, end, label] of [
      ["emailStart", "emailEnd", "email"],
      ["smsStart", "smsEnd", "sms"],
    ] as const) {
      const startValue = body[start];
      const endValue = body[end];
      if ((startValue == null) !== (endValue == null) || (startValue === "") !== (endValue === "")) {
        res.status(400).json({ error: `${label} quiet-hours start and end must be provided together` });
        return;
      }
    }
    const idempotency = getIdempotencyContext(
      req,
      "communication_safety.quiet_hours_update",
      {
        timezone,
        emailStart: body.emailStart ?? null,
        emailEnd: body.emailEnd ?? null,
        smsStart: body.smsStart ?? null,
        smsEnd: body.smsEnd ?? null,
      },
    );
    if (!idempotency) {
      res.status(400).json({ error: "Idempotency-Key is required" });
      return;
    }
    try {
      const result = await db.transaction(async (tx) => {
        const claim = await claimIdempotencyKey(tx, idempotency);
        if (claim.kind !== "claimed") return claim;
        const values = {
          timezone,
          emailStart:
            body.emailStart == null || body.emailStart === ""
              ? null
              : String(body.emailStart),
          emailEnd:
            body.emailEnd == null || body.emailEnd === ""
              ? null
              : String(body.emailEnd),
          smsStart:
            body.smsStart == null || body.smsStart === ""
              ? null
              : String(body.smsStart),
          smsEnd:
            body.smsEnd == null || body.smsEnd === ""
              ? null
              : String(body.smsEnd),
          updatedBy: safetyActor(req),
        };
        const [existing] = await tx
          .select()
          .from(communicationQuietHoursTable)
          .limit(1);
        const [row] = existing
          ? await tx
              .update(communicationQuietHoursTable)
              .set(values)
              .where(eq(communicationQuietHoursTable.id, existing.id))
              .returning()
          : await tx
              .insert(communicationQuietHoursTable)
              .values(values)
              .returning();
        await completeIdempotencyKey(tx, claim.record.id, {
          resourceType: "communication_quiet_hours",
          resourceId: row.id,
          responseStatus: 200,
        });
        return { kind: "completed" as const, row };
      });
      if (result.kind === "conflict") {
        res.status(409).json({
          error: "Idempotency-Key payload mismatch",
          code: "idempotency_conflict",
        });
        return;
      }
      if (result.kind === "inProgress") {
        res.status(409).json({
          error: "Request already in progress",
          code: "idempotency_in_progress",
        });
        return;
      }
      if (result.kind === "replay") {
        markIdempotencyReplay(res);
        res.json({ status: "already_recorded" });
        return;
      }
      res.json(result.row);
    } catch (error) {
      res.status(errorStatus(error)).json({
        error:
          error instanceof Error ? error.message : "Quiet-hours update failed",
      });
    }
  },
);

export default router;
