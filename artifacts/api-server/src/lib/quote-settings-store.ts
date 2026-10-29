import { eq } from "drizzle-orm";
import { db, quoteSettingsTable } from "@workspace/db";
import {
  DEFAULT_QUOTE_SETTINGS,
  normaliseQuoteTerms,
  normaliseValidityDays,
  type QuoteSettingsValues,
} from "./quote-settings.js";
import type { AcceptanceSettings } from "./estimate-acceptance-content.ts";

const NO_ACCEPTANCE_SETTINGS: AcceptanceSettings = {
  acceptanceMessage: null, acceptanceEmailEnabled: true, acceptanceEmailSubject: null, acceptanceEmailBody: null,
};

/** The one row. Single-tenant, like the communication settings beside it. */
export const QUOTE_SETTINGS_KEY = "default";

export interface StoredQuoteSettings extends QuoteSettingsValues, AcceptanceSettings {
  /** A2, Video 7: email the office when a customer opens an estimate. */
  openNotificationEnabled: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

type Reader = Pick<typeof db, "select">;

/**
 * What the company decided, or Corstead's fallback when it has decided nothing.
 *
 * There is deliberately no row until somebody saves: a company that has never
 * opened Settings gets thirty days and **no terms at all** (Kyle #13), and
 * nothing has to be seeded for a fresh database to work.
 */
export async function readQuoteSettings(reader: Reader = db): Promise<StoredQuoteSettings> {
  const [row] = await reader
    .select()
    .from(quoteSettingsTable)
    .where(eq(quoteSettingsTable.organizationKey, QUOTE_SETTINGS_KEY))
    .limit(1);
  if (!row) {
    return { ...DEFAULT_QUOTE_SETTINGS, ...NO_ACCEPTANCE_SETTINGS, openNotificationEnabled: true, updatedBy: null, updatedAt: null };
  }
  return {
    validityDays: normaliseValidityDays(row.validityDays) ?? DEFAULT_QUOTE_SETTINGS.validityDays,
    terms: normaliseQuoteTerms(row.terms),
    acceptanceMessage: row.acceptanceMessage ?? null,
    acceptanceEmailEnabled: row.acceptanceEmailEnabled ?? true,
    acceptanceEmailSubject: row.acceptanceEmailSubject ?? null,
    acceptanceEmailBody: row.acceptanceEmailBody ?? null,
    openNotificationEnabled: row.openNotificationEnabled ?? true,
    updatedBy: row.updatedBy ?? null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export async function writeQuoteSettings(
  values: { validityDays: number; terms: string | null },
  updatedBy: string | null,
): Promise<StoredQuoteSettings> {
  await db
    .insert(quoteSettingsTable)
    .values({
      organizationKey: QUOTE_SETTINGS_KEY,
      validityDays: values.validityDays,
      terms: values.terms,
      updatedBy,
    })
    .onConflictDoUpdate({
      target: quoteSettingsTable.organizationKey,
      set: {
        validityDays: values.validityDays,
        terms: values.terms,
        updatedBy,
        updatedAt: new Date(),
      },
    });
  return readQuoteSettings();
}

/** The thank-you after an online acceptance (Videos 7 and 9); the rest of the settings are untouched. */
export async function writeAcceptanceSettings(
  values: AcceptanceSettings & { openNotificationEnabled?: boolean }, updatedBy: string | null,
): Promise<StoredQuoteSettings> {
  await db
    .insert(quoteSettingsTable)
    .values({ organizationKey: QUOTE_SETTINGS_KEY, ...values, updatedBy })
    .onConflictDoUpdate({
      target: quoteSettingsTable.organizationKey,
      set: { ...values, updatedBy, updatedAt: new Date() },
    });
  return readQuoteSettings();
}
