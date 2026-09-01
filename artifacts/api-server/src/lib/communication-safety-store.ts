import { and, desc, eq, sql } from "drizzle-orm";
import {
  communicationEligibilityDecisionsTable,
  communicationPreferenceHistoryTable,
  communicationPreferencesTable,
  communicationQuietHoursTable,
  communicationSuppressionsTable,
  contactsTable,
  customersTable,
  db,
} from "@workspace/db";
import {
  decideCommunicationEligibility,
  hashCommunicationDestination,
  normalizeCommunicationDestination,
  type CommunicationChannel,
  type EligibilityInput,
  type PreferenceState,
  type QuietHoursState,
  type SuppressionState,
} from "./communication-safety-core.ts";
import type { Request } from "express";

export type SafetyTransaction = Pick<
  typeof db,
  "select" | "insert" | "update" | "execute"
>;

export function safetyActor(req: Request): string {
  if (!req.user) return "unknown";
  return (
    [req.user.firstName, req.user.lastName].filter(Boolean).join(" ").trim() ||
    req.user.email ||
    String(req.user.id)
  );
}

export function maskCommunicationDestination(
  channel: CommunicationChannel,
  normalized: string,
): string {
  if (channel === "email") {
    const [local, domain] = normalized.split("@");
    return `${local.slice(0, 1)}***@${domain}`;
  }
  return `••••${normalized.slice(-4)}`;
}

export async function advisoryLockDestination(
  tx: SafetyTransaction,
  channel: CommunicationChannel,
  destinationHash: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`${channel}:${destinationHash}`}))`,
  );
}

export async function resolveCustomerDestination(
  tx: SafetyTransaction,
  customerId: number,
  contactId: number | null,
  channel: CommunicationChannel,
  suppliedDestination?: string,
) {
  const [customer] = await tx
    .select({ id: customersTable.id })
    .from(customersTable)
    .where(eq(customersTable.id, customerId));
  if (!customer) throw new Error("Customer not found");

  if (contactId) {
    const [contact] = await tx
      .select({ id: contactsTable.id })
      .from(contactsTable)
      .where(
        and(
          eq(contactsTable.id, contactId),
          eq(contactsTable.customerId, customerId),
        ),
      );
    if (!contact) throw new Error("Contact not found for customer");
  }

  let raw = suppliedDestination?.trim() || "";
  if (!raw && contactId) {
    const [contact] = await tx
      .select()
      .from(contactsTable)
      .where(
        and(
          eq(contactsTable.id, contactId),
          eq(contactsTable.customerId, customerId),
        ),
      );
    raw = channel === "email" ? (contact?.email ?? "") : (contact?.phone ?? "");
  }
  if (!raw) {
    const [customer] = await tx
      .select()
      .from(customersTable)
      .where(eq(customersTable.id, customerId));
    raw =
      channel === "email"
        ? (customer?.email ?? "")
        : (customer?.cellPhone ?? customer?.homePhone ?? customer?.phone ?? "");
  }
  if (!raw)
    throw new Error(`No ${channel} destination is available for this customer`);
  return normalizeCommunicationDestination(channel, raw);
}

export async function readPreference(
  tx: SafetyTransaction,
  channel: CommunicationChannel,
  destinationHash: string,
) {
  const [preference] = await tx
    .select()
    .from(communicationPreferencesTable)
    .where(
      and(
        eq(communicationPreferencesTable.channel, channel),
        eq(communicationPreferencesTable.destinationHash, destinationHash),
      ),
    );
  return preference ?? null;
}

export async function readActiveSuppressions(
  tx: SafetyTransaction,
  channel: CommunicationChannel,
  destinationHash: string,
): Promise<SuppressionState[]> {
  const rows = await tx
    .select()
    .from(communicationSuppressionsTable)
    .where(
      and(
        eq(communicationSuppressionsTable.channel, channel),
        eq(communicationSuppressionsTable.destinationHash, destinationHash),
        eq(communicationSuppressionsTable.active, true),
      ),
    );
  return rows.map((row) => ({
    channel: row.channel as CommunicationChannel,
    destinationHash: row.destinationHash,
    reason: row.reason as SuppressionState["reason"],
    scope: row.scope as SuppressionState["scope"],
    active: row.active,
  }));
}

export async function readQuietHours(
  tx: SafetyTransaction,
): Promise<QuietHoursState | null> {
  const [row] = await tx
    .select()
    .from(communicationQuietHoursTable)
    .where(eq(communicationQuietHoursTable.organizationKey, "default"))
    .limit(1);
  if (!row) return null;
  return {
    timezone: row.timezone,
    email:
      row.emailStart && row.emailEnd
        ? { start: row.emailStart, end: row.emailEnd }
        : null,
    sms:
      row.smsStart && row.smsEnd
        ? { start: row.smsStart, end: row.smsEnd }
        : null,
  };
}

export async function evaluateAndRecordEligibility(
  tx: SafetyTransaction,
  input: EligibilityInput & {
    customerId?: number | null;
    contactId?: number | null;
  },
  state?: {
    preference?: PreferenceState | null;
    suppressions?: readonly SuppressionState[];
    quietHours?: QuietHoursState | null;
  },
) {
  const decision = decideCommunicationEligibility(input, state);
  await tx.insert(communicationEligibilityDecisionsTable).values({
    customerId: input.customerId ?? null,
    contactId: input.contactId ?? null,
    channel: input.channel,
    destinationHash: decision.destinationHash,
    classification: input.classification,
    outcome: decision.outcome,
    reasonCode: decision.reasonCode,
    requestedAt: input.requestedAt,
    allowedAt: decision.allowedAt,
    source: input.source,
    sourceEvent: input.sourceEvent ?? null,
  });
  return decision;
}

export async function evaluateRecipientEligibility(
  tx: SafetyTransaction,
  input: {
    customerId?: number | null;
    contactId?: number | null;
    channel: CommunicationChannel;
    rawDestination: string | null | undefined;
    classification: EligibilityInput["classification"];
    requestedAt: Date;
    source: string;
    sourceEvent?: string | null;
  },
) {
  let normalizedDestination = "";
  try {
    normalizedDestination = input.rawDestination
      ? normalizeCommunicationDestination(input.channel, input.rawDestination)
          .normalized
      : "";
  } catch {
    normalizedDestination = "";
  }
  const destinationHash = hashCommunicationDestination(normalizedDestination);
  const preference = normalizedDestination
    ? await readPreference(tx, input.channel, destinationHash)
    : null;
  const suppressions = normalizedDestination
    ? await readActiveSuppressions(tx, input.channel, destinationHash)
    : [];
  const quietHours = await readQuietHours(tx);
  const preferenceState: PreferenceState | null = preference
    ? {
        emailMarketingStatus:
          preference.emailMarketingStatus as PreferenceState["emailMarketingStatus"],
        smsConsentStatus:
          preference.smsConsentStatus as PreferenceState["smsConsentStatus"],
      }
    : null;
  return evaluateAndRecordEligibility(
    tx,
    {
      customerId: input.customerId,
      contactId: input.contactId,
      channel: input.channel,
      normalizedDestination,
      classification: input.classification,
      requestedAt: input.requestedAt,
      source: input.source,
      sourceEvent: input.sourceEvent,
    },
    { preference: preferenceState, suppressions, quietHours },
  );
}

export async function changePreference(
  tx: SafetyTransaction,
  input: {
    customerId: number;
    contactId?: number | null;
    channel: CommunicationChannel;
    destination: string;
    action: "consent_recorded" | "opted_out" | "reconsented";
    source: string;
    actor: string;
    reason?: string | null;
    disclosureSnapshot?: string | null;
    consentAt?: Date | null;
  },
) {
  const destination = normalizeCommunicationDestination(
    input.channel,
    input.destination,
  );
  await advisoryLockDestination(tx, input.channel, destination.hash);
  const existing = await readPreference(tx, input.channel, destination.hash);
  const emailMarketingStatus =
    input.channel === "email"
      ? input.action === "opted_out"
        ? "unsubscribed"
        : "subscribed"
      : (existing?.emailMarketingStatus ?? null);
  const smsConsentStatus =
    input.channel === "sms"
      ? input.action === "opted_out"
        ? "opted_out"
        : "opted_in"
      : (existing?.smsConsentStatus ?? null);
  const values = {
    customerId: input.customerId,
    contactId: input.contactId ?? existing?.contactId ?? null,
    channel: input.channel,
    normalizedDestination: destination.normalized,
    destinationHash: destination.hash,
    emailMarketingStatus,
    smsConsentStatus,
    smsConsentAt:
      input.channel === "sms" && input.action !== "opted_out"
        ? (input.consentAt ?? new Date())
        : (existing?.smsConsentAt ?? null),
    smsDisclosureSnapshot:
      input.channel === "sms" && input.action !== "opted_out"
        ? (input.disclosureSnapshot ?? null)
        : (existing?.smsDisclosureSnapshot ?? null),
    smsConsentSource:
      input.channel === "sms" && input.action !== "opted_out"
        ? input.source
        : (existing?.smsConsentSource ?? null),
    smsConsentActor:
      input.channel === "sms" && input.action !== "opted_out"
        ? input.actor
        : (existing?.smsConsentActor ?? null),
    lastReason: input.reason ?? null,
    lastSource: input.source,
  } as const;
  const [preference] = existing
    ? await tx
        .update(communicationPreferencesTable)
        .set(values)
        .where(eq(communicationPreferencesTable.id, existing.id))
        .returning()
    : await tx.insert(communicationPreferencesTable).values(values).returning();
  await tx.insert(communicationPreferenceHistoryTable).values({
    preferenceId: preference.id,
    customerId: input.customerId,
    contactId: input.contactId ?? null,
    channel: input.channel,
    destinationHash: destination.hash,
    action: input.action,
    classification: input.channel === "email" ? "marketing" : "transactional",
    emailMarketingStatus,
    smsConsentStatus,
    consentAt:
      input.channel === "sms" && input.action !== "opted_out"
        ? (input.consentAt ?? new Date())
        : null,
    disclosureSnapshot: input.disclosureSnapshot ?? null,
    source: input.source,
    actor: input.actor,
    reason: input.reason ?? null,
  });
  return { preference, destination };
}

export async function upsertSuppression(
  tx: SafetyTransaction,
  input: {
    channel: CommunicationChannel;
    destination: string;
    reason:
      | "complaint"
      | "invalid"
      | "provider_permanent_failure"
      | "manual"
      | "marketing_unsubscribe";
    scope: "global" | "marketing" | "transactional";
    source: string;
    actor: string;
  },
) {
  const destination = normalizeCommunicationDestination(
    input.channel,
    input.destination,
  );
  await advisoryLockDestination(tx, input.channel, destination.hash);
  const [row] = await tx
    .insert(communicationSuppressionsTable)
    .values({
      channel: input.channel,
      normalizedDestination: destination.normalized,
      destinationHash: destination.hash,
      reason: input.reason,
      scope: input.scope,
      active: true,
      source: input.source,
      actor: input.actor,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const [existing] = await tx
    .select()
    .from(communicationSuppressionsTable)
    .where(
      and(
        eq(communicationSuppressionsTable.channel, input.channel),
        eq(communicationSuppressionsTable.destinationHash, destination.hash),
        eq(communicationSuppressionsTable.scope, input.scope),
        eq(communicationSuppressionsTable.active, true),
      ),
    );
  return existing;
}

export async function retireOptOutSuppressions(
  tx: SafetyTransaction,
  channel: CommunicationChannel,
  destinationHash: string,
  actor: string,
): Promise<number> {
  const now = new Date();
  const rows = await tx
    .update(communicationSuppressionsTable)
    .set({
      active: false,
      deactivatedAt: now,
      deactivatedBy: actor,
    })
    .where(
      and(
        eq(communicationSuppressionsTable.channel, channel),
        eq(communicationSuppressionsTable.destinationHash, destinationHash),
        eq(communicationSuppressionsTable.active, true),
        eq(communicationSuppressionsTable.source, "crm.customer_opt_out"),
        eq(
          communicationSuppressionsTable.reason,
          channel === "email" ? "marketing_unsubscribe" : "manual",
        ),
      ),
    )
    .returning();
  for (const row of rows) {
    await tx.insert(communicationPreferenceHistoryTable).values({
      customerId: null,
      contactId: null,
      preferenceId: null,
      channel,
      destinationHash,
      action: "suppression_removed",
      classification: row.scope === "marketing" ? "marketing" : "transactional",
      source: "crm.manual",
      actor,
      reason: "New documented consent recorded",
    });
  }
  return rows.length;
}

export async function deactivateSuppression(
  tx: SafetyTransaction,
  id: number,
  actor: string,
) {
  const [row] = await tx
    .update(communicationSuppressionsTable)
    .set({
      active: false,
      deactivatedAt: new Date(),
      deactivatedBy: actor,
    })
    .where(
      and(
        eq(communicationSuppressionsTable.id, id),
        eq(communicationSuppressionsTable.active, true),
      ),
    )
    .returning();
  if (row) {
    await tx.insert(communicationPreferenceHistoryTable).values({
      customerId: null,
      contactId: null,
      preferenceId: null,
      channel: row.channel,
      destinationHash: row.destinationHash,
      action: "suppression_removed",
      source: "crm.settings",
      actor,
      reason: `Administrative suppression removal (${row.reason}/${row.scope})`,
    });
  }
  return row ?? null;
}

export async function customerSafetySummary(
  tx: SafetyTransaction,
  customerId: number,
) {
  const [customer] = await tx
    .select()
    .from(customersTable)
    .where(eq(customersTable.id, customerId));
  if (!customer) return null;
  const channels = [];
  for (const channel of ["email", "sms"] as const) {
    const raw =
      channel === "email"
        ? customer.email
        : (customer.cellPhone ?? customer.homePhone ?? customer.phone);
    if (!raw) {
      channels.push({
        channel,
        available: false,
        destinationHash: null,
        maskedDestination: null,
        status: channel === "email" ? "not_recorded" : "unknown",
      });
      continue;
    }
    let destination;
    try {
      destination = normalizeCommunicationDestination(channel, raw);
    } catch {
      channels.push({
        channel,
        available: false,
        destinationHash: null,
        maskedDestination: null,
        status: "invalid",
      });
      continue;
    }
    const preference = await readPreference(tx, channel, destination.hash);
    const suppressions = await readActiveSuppressions(
      tx,
      channel,
      destination.hash,
    );
    channels.push({
      channel,
      available: true,
      destinationHash: destination.hash,
      maskedDestination: maskCommunicationDestination(
        channel,
        destination.normalized,
      ),
      status:
        channel === "email"
          ? (preference?.emailMarketingStatus ?? "not_recorded")
          : (preference?.smsConsentStatus ?? "unknown"),
      source:
        channel === "sms"
          ? (preference?.smsConsentSource ?? null)
          : (preference?.lastSource ?? null),
      consentAt: preference?.smsConsentAt?.toISOString() ?? null,
      reason: preference?.lastReason ?? null,
      hardSuppressed: suppressions.some((item) => item.scope === "global"),
    });
  }
  return { customerId, channels };
}

export async function customerSafetyHistory(
  tx: SafetyTransaction,
  customerId: number,
  limit = 100,
) {
  return tx
    .select({
      id: communicationPreferenceHistoryTable.id,
      channel: communicationPreferenceHistoryTable.channel,
      destinationHash: communicationPreferenceHistoryTable.destinationHash,
      action: communicationPreferenceHistoryTable.action,
      classification: communicationPreferenceHistoryTable.classification,
      emailMarketingStatus:
        communicationPreferenceHistoryTable.emailMarketingStatus,
      smsConsentStatus: communicationPreferenceHistoryTable.smsConsentStatus,
      consentAt: communicationPreferenceHistoryTable.consentAt,
      source: communicationPreferenceHistoryTable.source,
      actor: communicationPreferenceHistoryTable.actor,
      reason: communicationPreferenceHistoryTable.reason,
      createdAt: communicationPreferenceHistoryTable.createdAt,
    })
    .from(communicationPreferenceHistoryTable)
    .where(eq(communicationPreferenceHistoryTable.customerId, customerId))
    .orderBy(
      desc(communicationPreferenceHistoryTable.createdAt),
      desc(communicationPreferenceHistoryTable.id),
    )
    .limit(Math.max(1, Math.min(limit, 200)));
}

export async function contactSafetySummary(
  tx: SafetyTransaction,
  contactId: number,
) {
  const [contact] = await tx
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.id, contactId));
  if (!contact) return null;
  const channels = [];
  for (const channel of ["email", "sms"] as const) {
    const raw = channel === "email" ? contact.email : contact.phone;
    if (!raw) {
      channels.push({
        channel,
        available: false,
        destinationHash: null,
        maskedDestination: null,
        status: channel === "email" ? "not_recorded" : "unknown",
      });
      continue;
    }
    let destination;
    try {
      destination = normalizeCommunicationDestination(channel, raw);
    } catch {
      channels.push({
        channel,
        available: false,
        destinationHash: null,
        maskedDestination: null,
        status: "invalid",
      });
      continue;
    }
    const preference = await readPreference(tx, channel, destination.hash);
    const suppressions = await readActiveSuppressions(
      tx,
      channel,
      destination.hash,
    );
    channels.push({
      channel,
      available: true,
      destinationHash: destination.hash,
      maskedDestination: maskCommunicationDestination(
        channel,
        destination.normalized,
      ),
      status:
        channel === "email"
          ? (preference?.emailMarketingStatus ?? "not_recorded")
          : (preference?.smsConsentStatus ?? "unknown"),
      source:
        channel === "sms"
          ? (preference?.smsConsentSource ?? null)
          : (preference?.lastSource ?? null),
      consentAt: preference?.smsConsentAt?.toISOString() ?? null,
      reason: preference?.lastReason ?? null,
      hardSuppressed: suppressions.some((item) => item.scope === "global"),
    });
  }
  return { contactId, customerId: contact.customerId, channels };
}

export async function contactSafetyHistory(
  tx: SafetyTransaction,
  contactId: number,
  limit = 100,
) {
  return tx
    .select({
      id: communicationPreferenceHistoryTable.id,
      channel: communicationPreferenceHistoryTable.channel,
      destinationHash: communicationPreferenceHistoryTable.destinationHash,
      action: communicationPreferenceHistoryTable.action,
      classification: communicationPreferenceHistoryTable.classification,
      emailMarketingStatus:
        communicationPreferenceHistoryTable.emailMarketingStatus,
      smsConsentStatus: communicationPreferenceHistoryTable.smsConsentStatus,
      consentAt: communicationPreferenceHistoryTable.consentAt,
      source: communicationPreferenceHistoryTable.source,
      actor: communicationPreferenceHistoryTable.actor,
      reason: communicationPreferenceHistoryTable.reason,
      createdAt: communicationPreferenceHistoryTable.createdAt,
    })
    .from(communicationPreferenceHistoryTable)
    .where(eq(communicationPreferenceHistoryTable.contactId, contactId))
    .orderBy(
      desc(communicationPreferenceHistoryTable.createdAt),
      desc(communicationPreferenceHistoryTable.id),
    )
    .limit(Math.max(1, Math.min(limit, 200)));
}

export { hashCommunicationDestination };
