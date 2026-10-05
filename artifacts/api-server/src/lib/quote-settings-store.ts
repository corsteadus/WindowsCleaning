import { eq } from "drizzle-orm";
import { db, quoteSettingsTable } from "@workspace/db";
import {
  DEFAULT_QUOTE_SETTINGS,
  normaliseQuoteTerms,
  normaliseValidityDays,
  type QuoteSettingsValues,
} from "./quote-settings.js";

/** The one row. Single-tenant, like the communication settings beside it. */
export const QUOTE_SETTINGS_KEY = "default";

export interface StoredQuoteSettings extends QuoteSettingsValues {
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
    return { ...DEFAULT_QUOTE_SETTINGS, updatedBy: null, updatedAt: null };
  }
  return {
    validityDays: normaliseValidityDays(row.validityDays) ?? DEFAULT_QUOTE_SETTINGS.validityDays,
    terms: normaliseQuoteTerms(row.terms),
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
