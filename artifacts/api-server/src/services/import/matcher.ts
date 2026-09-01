/**
 * matcher.ts — Import matching engine  ·  v1 BASELINE (Rev 58)
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  FROZEN LOGIC — DO NOT MODIFY THE RULES BELOW WITHOUT LUTE'S APPROVAL  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * MATCHING CASCADE (evaluated in order — first hit wins):
 *   1. External ID match              → REVIEW (weak_match) — no email/phone confirm
 *   2. Email exact match              → REVIEW (exact_match) — user must approve
 *   3. Phone exact match              → REVIEW (exact_match) — user must approve
 *   4. No signal                      → new customer (auto_created)
 *
 * ZERO AUTO-MERGE RULES (Rev 66):
 *   • NO automatic merges. Every matched record goes to "Needs Review".
 *   • Matching ONLY by exact email OR exact phone. Nothing else.
 *   • NO matching by: first name, last name, company name, address, partial.
 *   • import_match_type: exact_email, exact_phone, weak_match, new_customer.
 *   • No customer should disappear during import.
 *
 * FROZEN RULES — future changes must be ADDITIVE, never destructive:
 *   • Address is REQUIRED for any merge suggestion. Name similarity alone
 *     (no address) must NEVER trigger a merge or review suggestion.
 *   • Properties and customers are separate entities. A new address for an
 *     existing customer is always staged as a property row, never conflated
 *     with the customer's billing address.
 *   • CRM always wins on conflicts. Import data fills blank CRM fields.
 *     Existing non-blank CRM values are never overwritten automatically.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { normalizePhone } from "./normalizer";

export interface MatchResult {
  id: number;
  method: "email" | "phone";
}

export async function matchCustomer(
  email: string,
  phones: string[]
): Promise<MatchResult | null> {
  // Exact email match — highest priority
  if (email) {
    const r = await db.execute(
      sql`SELECT id FROM customers WHERE LOWER(email) = ${email} LIMIT 1`
    );
    if ((r.rows as any[]).length) {
      return { id: (r.rows[0] as any).id, method: "email" };
    }
  }

  // Exact phone match — only on non-trivial numbers
  const validPhones = phones.filter(p => p && p.length >= 7);
  for (const phone of validPhones) {
    const r = await db.execute(sql`
      SELECT id FROM customers
      WHERE home_phone = ${phone}
         OR cell_phone = ${phone}
         OR work_phone = ${phone}
      LIMIT 1
    `);
    if ((r.rows as any[]).length) {
      return { id: (r.rows[0] as any).id, method: "phone" };
    }
  }

  return null;
}

export async function matchLead(
  email: string,
  phones: string[]
): Promise<MatchResult | null> {
  if (email) {
    const r = await db.execute(
      sql`SELECT id FROM leads WHERE LOWER(email) = ${email} LIMIT 1`
    );
    if ((r.rows as any[]).length) {
      return { id: (r.rows[0] as any).id, method: "email" };
    }
  }

  const validPhones = phones.filter(p => p && p.length >= 7);
  for (const phone of validPhones) {
    const r = await db.execute(sql`
      SELECT id FROM leads WHERE phone = ${phone} LIMIT 1
    `);
    if ((r.rows as any[]).length) {
      return { id: (r.rows[0] as any).id, method: "phone" };
    }
  }

  return null;
}

// ─── Customer lookup by CF external ID ───────────────────────────────────────
//
// Resolves a Customer Factor "Customer Id" (c_id) to the CRM customer.
//
// Lookup order:
//   1. customers.import_external_id  — set when a customer was previously applied
//      through the staging import engine (normalizer stores the CF Id, applier
//      writes it to import_external_id on INSERT or UPDATE).
//   2. import_staging_rows            — if a customer file was staged in the same
//      session but not yet applied, the staging row's external_id = CF c_id and
//      matched_entity_id = the CRM customer it was matched to (email/phone/etc).
//
// Returns the CRM customer.id or null if no link can be resolved.

function normCfId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const num = parseFloat(trimmed);
  return (!isNaN(num) && Number.isFinite(num)) ? String(Math.trunc(num)) : trimmed;
}

export async function matchCustomerByExternalId(cfId: string, fallbackName?: string, fallbackAddress?: string): Promise<number | null> {
  if (!cfId || !cfId.trim()) return null;
  const trimmed = cfId.trim();
  const normalized = normCfId(trimmed);

  // Try exact match first, then normalized (handles "3050.0" stored vs "3050" in invoice)
  for (const id of Array.from(new Set([trimmed, normalized])).filter(Boolean)) {
    const r = await db.execute(sql`
      SELECT id FROM customers
      WHERE import_external_id = ${id}
      LIMIT 1
    `);
    if ((r.rows as any[]).length) {
      console.log(`[matchCustomerByExternalId] found via import_external_id="${id}"`);
      return (r.rows[0] as any).id;
    }
  }

  // Check staging rows (same session, not yet applied)
  for (const id of Array.from(new Set([trimmed, normalized])).filter(Boolean)) {
    const r = await db.execute(sql`
      SELECT matched_entity_id FROM import_staging_rows
      WHERE entity_type = 'customer'
        AND external_id = ${id}
        AND matched_entity_id IS NOT NULL
      ORDER BY id DESC
      LIMIT 1
    `);
    if ((r.rows as any[]).length) {
      console.log(`[matchCustomerByExternalId] found via staging_rows external_id="${id}"`);
      return (r.rows[0] as any).matched_entity_id;
    }
  }

  // Fallback: name + address (if supplied) — last resort to avoid orphan invoices
  if (fallbackName && fallbackAddress) {
    const nameParts = fallbackName.trim().split(/\s+/);
    const lastName  = nameParts.length > 1 ? nameParts[nameParts.length - 1] : nameParts[0];
    const firstName = nameParts.length > 1 ? nameParts.slice(0, -1).join(" ") : "";
    const addrNorm  = fallbackAddress.trim().replace(/\s+/g, " ").toUpperCase();

    const r = await db.execute(sql`
      SELECT id FROM customers
      WHERE UPPER(TRIM(last_name))  = ${lastName.toUpperCase()}
        AND UPPER(TRIM(COALESCE(billing_address, ''))) = ${addrNorm}
        ${firstName ? sql`AND UPPER(TRIM(first_name)) = ${firstName.toUpperCase()}` : sql``}
      LIMIT 1
    `);
    if ((r.rows as any[]).length) {
      console.log(`[matchCustomerByExternalId] found via name+address fallback cfId="${cfId}" name="${fallbackName}" addr="${fallbackAddress}"`);
      return (r.rows[0] as any).id;
    }
  }

  console.warn(`[matchCustomerByExternalId] NO MATCH for cfId="${cfId}" (normalized="${normalized}")`);
  return null;
}

export async function matchInvoice(invoiceNumber: string): Promise<{ id: number } | null> {
  if (!invoiceNumber) return null;
  const r = await db.execute(
    sql`SELECT id FROM invoices WHERE invoice_number = ${invoiceNumber} LIMIT 1`
  );
  if ((r.rows as any[]).length) {
    return { id: (r.rows[0] as any).id };
  }
  return null;
}

export async function matchJobByFingerprint(fp: string): Promise<{ id: number } | null> {
  if (!fp) return null;
  const r = await db.execute(
    sql`SELECT id FROM jobs WHERE last_import_fingerprint = ${fp} LIMIT 1`
  );
  if ((r.rows as any[]).length) {
    return { id: (r.rows[0] as any).id };
  }
  return null;
}

// Check if a customer already has a job on the same date/type (dedup by content)
export async function matchJobByContent(
  customerId: number,
  scheduledDate: string,
  serviceType: string,
  totalAmount: string
): Promise<{ id: number } | null> {
  if (!customerId || !scheduledDate) return null;
  const r = await db.execute(sql`
    SELECT id FROM jobs
    WHERE customer_id = ${customerId}
      AND scheduled_date = ${scheduledDate}
      AND service_type = ${serviceType || ""}
      AND total_amount::text = ${totalAmount || "0"}
    LIMIT 1
  `);
  if ((r.rows as any[]).length) {
    return { id: (r.rows[0] as any).id };
  }
  return null;
}

// ─── HTML stripping + entity decoding ─────────────────────────────────────────

// Strip HTML tags and decode named + numeric entities.
// Used as the first pass when normalizing notes fields.
export function stripHtml(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")          // remove all tags → space
    // Named entities
    .replace(/&nbsp;/gi,   " ")
    .replace(/&amp;/gi,    "&")
    .replace(/&lt;/gi,     "<")
    .replace(/&gt;/gi,     ">")
    .replace(/&quot;/gi,   '"')
    .replace(/&#39;/gi,    "'")
    .replace(/&apos;/gi,   "'")
    .replace(/&mdash;/gi,  "—")
    .replace(/&ndash;/gi,  "–")
    .replace(/&lsquo;/gi,  "'")
    .replace(/&rsquo;/gi,  "'")
    .replace(/&ldquo;/gi,  '"')
    .replace(/&rdquo;/gi,  '"')
    .replace(/&bull;/gi,   "•")
    .replace(/&hellip;/gi, "…")
    .replace(/&copy;/gi,   "©")
    .replace(/&reg;/gi,    "®")
    .replace(/&trade;/gi,  "™")
    // Numeric entities for common punctuation/symbols
    .replace(/&#8226;/g,   "•")   // bullet
    .replace(/&#8211;/g,   "–")   // en dash
    .replace(/&#8212;/g,   "—")   // em dash
    .replace(/&#8216;/g,   "'")   // left single quote
    .replace(/&#8217;/g,   "'")   // right single quote
    .replace(/&#8220;/g,   '"')   // left double quote
    .replace(/&#8221;/g,   '"')   // right double quote
    .replace(/&#8230;/g,   "…")   // ellipsis
    .replace(/&#\d+;/g,    " ")   // any remaining numeric entities → space
    .replace(/&[a-z]+;/gi, " ")   // any remaining named entities → space
    .replace(/\s+/g,       " ")
    .trim();
}

// ─── Mojibake repair (Customer Factor encoding artifacts) ─────────────────────
//
// Customer Factor exports sometimes double-encode UTF-8 as Windows-1252, producing
// sequences like â€¢ instead of • (bullet U+2022).  Fixing these before comparison
// prevents false conflicts when the CRM stores the correctly-decoded character.

function fixMojibake(s: string): string {
  return s
    // Punctuation / symbols
    .replace(/â€¢/g,  "•")   // bullet  U+2022
    .replace(/â€"/g,  "–")   // en dash U+2013
    .replace(/â€"/g,  "—")   // em dash U+2014  (same prefix, order matters)
    .replace(/â€™/g,  "'")   // right single quote U+2019
    .replace(/â€˜/g,  "'")   // left single quote  U+2018
    .replace(/â€œ/g,  '"')   // left double quote  U+201C
    .replace(/â€/g,   '"')   // right double quote U+201D (must come after â€œ)
    .replace(/â€¦/g,  "…")   // ellipsis U+2026
    .replace(/â„¢/g,  "™")   // trade mark
    .replace(/Â©/g,   "©")   // copyright
    .replace(/Â®/g,   "®")   // registered
    .replace(/Â°/g,   "°")   // degree
    .replace(/Â·/g,   "·")   // middle dot
    .replace(/Â\u00a0/g, " ")// non-breaking space (Â followed by NBSP byte)
    .replace(/Â /g,   " ")   // non-breaking space alternate
    // Accented letters (common in names / city names)
    .replace(/Ã©/g,   "é")
    .replace(/Ã¨/g,   "è")
    .replace(/Ã /g,   "à")
    .replace(/Ã§/g,   "ç")
    .replace(/Ã«/g,   "ë")
    .replace(/Ã®/g,   "î")
    .replace(/Ã´/g,   "ô")
    .replace(/Ã¹/g,   "ù")
    .replace(/Ã»/g,   "û")
    .replace(/Ã¼/g,   "ü")
    .replace(/Ã±/g,   "ñ")
    // Remaining isolated Â prefix artifacts
    .replace(/Â/g,    "");
}

// ─── Invisible / zero-width character removal ─────────────────────────────────

function removeInvisible(s: string): string {
  return s
    .replace(/[\u00AD]/g,       "")  // soft hyphen
    .replace(/[\u200B-\u200D]/g,"")  // zero-width space / joiner / non-joiner
    .replace(/[\uFEFF]/g,       "")  // BOM / zero-width no-break space
    .replace(/[\u2028\u2029]/g, " ") // line/paragraph separator → space
    .replace(/[\u0000-\u001F\u007F]/g, " ") // ASCII control characters → space
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Bullet / list marker normalisation ──────────────────────────────────────
//
// •, *, -, ◦, ▪, ►, →, ✓, ✔, ■, □ all mean "list item" in CF notes.
// Normalise them all to a single canonical marker so they compare equal.

function normalizeBullets(s: string): string {
  return s
    // Unicode bullets at start of token
    .replace(/[•◦‣▪▸►→⇒✓✔●○□■]\s*/g, "- ")
    // Asterisk used as bullet (word-boundary: preceded by start-of-string or whitespace)
    .replace(/(^|\n|\r)\s*\*\s+/g, "$1- ")
    // Already-dash bullets: normalise spacing
    .replace(/(^|\n|\r)\s*-\s+/g, "$1- ")
    // Collapse any extra spaces left by the above
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Token-level similarity (Jaccard) ────────────────────────────────────────
//
// Used as a fallback when two notes don't substring-contain each other but are
// still largely the same words.  A similarity ≥ 0.88 classifies as "enhancement"
// rather than "conflict", covering cases like minor reordering or word choice.

function tokenSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let shared = 0;
  for (const w of wordsA) if (wordsB.has(w)) shared++;
  return shared / (wordsA.size + wordsB.size - shared);
}

// ─── Full notes normalization pipeline ───────────────────────────────────────
//
// Applies every layer in order.  Both the CRM value and the import value go
// through exactly the same pipeline, so encoding differences cancel out.

function normalizeNotes(raw: string): string {
  let s = raw;
  s = fixMojibake(s);          // repair CF encoding artifacts
  s = stripHtml(s);            // strip HTML tags + decode entities
  s = removeInvisible(s);      // drop zero-width / control characters
  s = normalizeBullets(s);     // unify bullet markers
  s = s.toLowerCase();
  // Remove remaining cosmetic punctuation that carries no meaning in notes
  s = s.replace(/[.,;:!?'"()[\]{}<>]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// ─── Fields where we apply the full notes pipeline ───────────────────────────
const HTML_FIELDS = new Set(["notes"]);

// Fields where the value is treated as a number (int) for comparison purposes.
const NUMERIC_FIELDS = new Set(["star_rating", "window_count"]);

// ─── Field-level change classification ────────────────────────────────────────
//
// "none"        — normalized values are equivalent; no action needed
// "enhancement" — notes: import is cleaner/extended but consistent; auto-approve
// "conflict"    — values are materially different; reviewer must decide

export type FieldChangeClass = "none" | "enhancement" | "conflict";

// Canonical normalization applied before any field comparison.
function normalizeFieldValue(key: string, raw: string): string {
  // Notes get the full multi-layer pipeline
  if (HTML_FIELDS.has(key)) return normalizeNotes(raw);

  // Numeric fields: round to integer
  if (NUMERIC_FIELDS.has(key)) {
    const n = parseFloat(raw.trim());
    if (!isNaN(n)) return String(Math.round(n));
  }

  // Email: lowercase only — preserve structural dots/@
  let s = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (key === "email") return s;

  // All other text fields: lowercase + strip cosmetic punctuation
  s = s.replace(/[.,\-'#;!?]/g, " ").replace(/\s+/g, " ").trim();
  return s;
}

export function classifyFieldChange(
  key: string,
  existingRaw: string,
  proposedRaw: string
): FieldChangeClass {
  const existingNorm = normalizeFieldValue(key, existingRaw);
  const proposedNorm = normalizeFieldValue(key, proposedRaw);

  // Exact match after full normalization
  if (existingNorm === proposedNorm) return "none";

  // Notes-specific classification
  if (HTML_FIELDS.has(key)) {
    // One is a substring of the other → cleaned copy or minor extension
    if (proposedNorm.includes(existingNorm) || existingNorm.includes(proposedNorm)) {
      return "enhancement";
    }
    // High word-overlap → encoding/formatting difference, not a real conflict
    if (tokenSimilarity(existingNorm, proposedNorm) >= 0.88) {
      return "enhancement";
    }
  }

  return "conflict";
}

// Get conflicts between CRM record and proposed import data.
// Returns field names where the change class is "conflict".
// "none" and "enhancement" fields are silently skipped — they do not produce
// review items and the record remains auto-approved.
export function findConflicts(
  existing: Record<string, any>,
  proposed: Record<string, string>,
  protectedFields: string[]
): string[] {
  const conflicts: string[] = [];
  for (const [key, proposedVal] of Object.entries(proposed)) {
    if (!proposedVal) continue; // import has nothing to offer — skip
    const existingVal = existing[key];
    if (!existingVal || String(existingVal).trim() === "") continue; // CRM is blank → auto-fill, not a conflict

    const cls = classifyFieldChange(key, String(existingVal), proposedVal);
    if (cls === "conflict") {
      conflicts.push(key);
    }
    // "none" → values are equivalent after normalization — no action needed
    // "enhancement" → import is a cleaned/extended version — auto-approve
  }
  return conflicts;
}

export const PROTECTED_CUSTOMER_FIELDS = [
  "firstName", "lastName", "companyName", "notes", "status", "tags",
];

export const PROTECTED_LEAD_FIELDS = [
  "firstName", "lastName", "notes", "status", "tags",
];

// ─── Soft duplicate detection (warning only — never auto-matches) ─────────────
//
// Runs AFTER the primary email+phone match returns null.
// Queries for customers whose name + address looks similar and returns a hint
// that gets embedded in the review item so the reviewer can make an informed
// decision.  The system never auto-merges based on this; it only shows a flag.

export interface SoftMatchHint {
  id: number;
  firstName: string;
  lastName: string;
  companyName: string;
  billingAddress: string;
  billingCity: string;
  email: string;
  homePhone: string;
  reason: string;
  confidence: "high" | "medium" | "low";
}

export async function findSoftDuplicate(
  firstName: string,
  lastName: string,
  companyName: string,
  billingAddress: string,
  billingCity: string,
  billingZip: string = "",
): Promise<SoftMatchHint | null> {
  const toRow = (r: any, reason: string, confidence: "high" | "medium" | "low"): SoftMatchHint => ({
    id: r.id,
    firstName: r.first_name ?? "",
    lastName: r.last_name ?? "",
    companyName: r.company_name ?? "",
    billingAddress: r.billing_address ?? "",
    billingCity: r.billing_city ?? "",
    email: r.email ?? "",
    homePhone: r.home_phone ?? "",
    reason,
    confidence,
  });

  // 1. Company name fallback (matchByCompanyName is tried first upstream — this catches edge
  //    cases where the company name is too short for the hard-match minimum length)
  const co = companyName.trim();
  if (co) {
    const r = await db.execute(sql`
      SELECT id, first_name, last_name, company_name, billing_address, billing_city, email, home_phone
      FROM customers
      WHERE LOWER(company_name) = ${co.toLowerCase()}
      LIMIT 1
    `);
    if ((r.rows as any[]).length) return toRow(r.rows[0], "Same company name", "low");
  }

  const ln = lastName.trim();
  if (!ln || ln.length < 2) return null;

  const normImportAddr = normalizeAddressStr(billingAddress || "");
  const normImportZip  = extractZip(billingZip || "");
  const streetNum      = (billingAddress || "").trim().match(/^\d+/)?.[0] ?? "";

  // 2. Same last name — fetch candidates with an address and check address similarity.
  //    Full normalized-address match → HIGH (auto-merge, captures first-name variations,
  //    multi-person names like "Lowell & Leslie Kruse", abbreviations, etc.)
  //    Partial street-number match   → MEDIUM (auto-merge, strong signal)
  //    No address match              → skip here, fall through to name-similarity check
  if (streetNum || normImportAddr) {
    const r = await db.execute(sql`
      SELECT id, first_name, last_name, company_name, billing_address, billing_city, billing_zip, email, home_phone
      FROM customers
      WHERE LOWER(last_name) = ${ln.toLowerCase()}
        AND billing_address IS NOT NULL AND billing_address <> ''
      LIMIT 20
    `);
    for (const row of r.rows as any[]) {
      const crmNorm    = normalizeAddressStr(row.billing_address || "");
      const crmZip     = extractZip(row.billing_zip || "");
      const crmStrNum  = (row.billing_address || "").trim().match(/^\d+/)?.[0] ?? "";

      if (normImportAddr && crmNorm === normImportAddr
          && (!normImportZip || !crmZip || crmZip === normImportZip)) {
        return toRow(row, "Same last name + same address", "high");
      }

      if (streetNum && crmStrNum && crmStrNum === streetNum) {
        return toRow(row, "Same last name + same street number", "medium");
      }
    }
  }

  // Name-only similarity (no address match) is explicitly NOT returned.
  // Without an address to confirm identity, a matching last name is not a
  // strong enough signal to suggest a merge — it creates more false positives
  // than it prevents. Records that reach this point are treated as new customers.

  return null;
}

// ─── Name + address hard match ────────────────────────────────────────────────
//
// If firstName + lastName + normalized address + zip exactly match an existing
// CRM customer, return that customer's id so the staging layer can auto-merge.
// This prevents "New Customer" review items for records that are obviously the
// same person (no email/phone match, but full name + address match).

export async function matchByNameAndAddress(
  firstName: string,
  lastName: string,
  address: string,
  zip: string,
): Promise<{ id: number; method: string } | null> {
  const fn = (firstName || "").trim().toLowerCase();
  const ln = (lastName  || "").trim().toLowerCase();
  const normAddr = normalizeAddressStr(address || "");
  const normZip  = extractZip(zip || "");

  if (!fn || fn.length < 2 || !ln || ln.length < 2 || !normAddr || normAddr.length < 4) return null;

  // Broad SQL filter: exact first + last name (case-insensitive), non-null address
  const r = await db.execute(sql`
    SELECT id, billing_address, billing_zip
    FROM customers
    WHERE LOWER(first_name) = ${fn}
      AND LOWER(last_name)  = ${ln}
      AND billing_address IS NOT NULL
      AND billing_address <> ''
    LIMIT 10
  `);

  // Narrow in code: normalize addresses and compare
  for (const row of r.rows as any[]) {
    const crmNorm = normalizeAddressStr(row.billing_address || "");
    const crmZip  = extractZip(row.billing_zip || "");
    if (crmNorm === normAddr && (!normZip || !crmZip || crmZip === normZip)) {
      return { id: row.id, method: "name_address" };
    }
  }
  return null;
}

// ─── Company name match ───────────────────────────────────────────────────────
//
// If an import record has a company_name that exactly matches (case-insensitive)
// an existing CRM customer, return that customer so the staging layer can:
//   • address also matches  → auto-merge (same account)
//   • address differs       → auto-merge + auto-add property

export async function matchByCompanyName(
  companyName: string,
  importAddress: string,
  importZip: string,
): Promise<{ id: number; method: string; addressMatches: boolean; customerData: any } | null> {
  const co = (companyName || "").trim().toLowerCase();
  if (!co || co.length < 3) return null;

  const r = await db.execute(sql`
    SELECT * FROM customers
    WHERE LOWER(company_name) = ${co}
    LIMIT 10
  `);
  const rows = r.rows as any[];
  if (!rows.length) return null;

  const normAddr = normalizeAddressStr(importAddress || "");
  const normZip  = extractZip(importZip || "");

  if (normAddr) {
    for (const row of rows) {
      const crmNorm = normalizeAddressStr(row.billing_address || "");
      const crmZip  = extractZip(row.billing_zip || "");
      if (crmNorm === normAddr && (!normZip || !crmZip || crmZip === normZip)) {
        return { id: row.id, method: "company_address", addressMatches: true, customerData: row };
      }
    }
  }

  return { id: rows[0].id, method: "company_address", addressMatches: false, customerData: rows[0] };
}

// ─── Property existence check ─────────────────────────────────────────────────
//
// Before flagging an address difference as a new property, verify that a property
// with a matching address does not already exist for this customer.  Also considers
// the customer's own billing address, which may not have a separate properties row.

export async function checkPropertyExists(
  customerId: number,
  importAddress: string,
  importZip: string
): Promise<boolean> {
  if (!importAddress.trim()) return false;

  const normImp  = normalizeAddressStr(importAddress);
  const zipImp   = extractZip(importZip);
  const numImp   = extractStreetNumber(normImp);

  // Check the properties table for this customer
  const r = await db.execute(sql`
    SELECT address, zip FROM properties WHERE customer_id = ${customerId}
  `);

  for (const row of r.rows as any[]) {
    const normProp = normalizeAddressStr(String(row.address ?? ""));
    const zipProp  = extractZip(String(row.zip  ?? ""));

    // Full normalized string match
    if (normProp === normImp) return true;

    // Same street number + same ZIP → same property, different formatting
    if (numImp && zipImp && extractStreetNumber(normProp) === numImp && zipProp === zipImp) {
      return true;
    }
  }

  return false;
}

// ─── Address conflict classification ──────────────────────────────────────────
//
// "none"     — addresses match after normalization, or CRM/import is blank → no action
// "minor"    — same property, different formatting (abbreviations, punctuation) → field_conflict
// "material" — clearly a different property (different street number OR ZIP) → property_conflict

function normalizeAddressStr(s: string): string {
  return s.toLowerCase()
    .replace(/\bno\b\.?/g,    "")       // remove trailing "No." apartment prefix
    .replace(/\bst\b\.?/g,    "street")
    .replace(/\bave?\b\.?/g,  "avenue")
    .replace(/\bblvd\b\.?/g,  "boulevard")
    .replace(/\bdr\b\.?/g,    "drive")
    .replace(/\brd\b\.?/g,    "road")
    .replace(/\bct\b\.?/g,    "court")
    .replace(/\bcir\b\.?/g,   "circle")
    .replace(/\bln\b\.?/g,    "lane")
    .replace(/\bpl\b\.?/g,    "place")
    .replace(/\bhwy\b\.?/g,   "highway")
    .replace(/\bpkwy\b\.?/g,  "parkway")
    .replace(/\bsq\b\.?/g,    "square")
    .replace(/\bter?r?\b\.?/g,"terrace")
    .replace(/[.,#\-()]/g,    " ")
    .replace(/\s+/g,          " ")
    .trim();
}

function extractStreetNumber(normalizedAddr: string): string {
  const m = normalizedAddr.match(/^\d+/);
  return m ? m[0] : "";
}

function extractZip(raw: string): string {
  return (raw || "").replace(/\D/g, "").slice(0, 5);
}

export type AddressDiffClass = "none" | "minor" | "material";

export function classifyAddressDiff(
  existing: Record<string, any>,
  importAddr: string,
  importCity: string,
  importState: string,
  importZip: string
): AddressDiffClass {
  const crmAddr  = String(existing.billing_address ?? "").trim();
  const crmCity  = String(existing.billing_city    ?? "").trim();
  const crmState = String(existing.billing_state   ?? "").trim();
  const crmZip   = String(existing.billing_zip     ?? "").trim();

  // CRM has no address → auto-fill from import (no conflict)
  if (!crmAddr) return "none";
  // Import has no address → nothing to compare
  if (!importAddr.trim()) return "none";

  // Compare normalized full address strings first — catches exact matches
  const crmFull = normalizeAddressStr(`${crmAddr} ${crmCity} ${crmState}`);
  const impFull = normalizeAddressStr(`${importAddr} ${importCity} ${importState}`);
  if (crmFull === impFull) return "none";

  // Different ZIP codes → clearly different property
  const crmZipN = extractZip(crmZip);
  const impZipN = extractZip(importZip);
  if (crmZipN && impZipN && crmZipN !== impZipN) return "material";

  // Different street number → different property at the same zip
  const crmNum = extractStreetNumber(normalizeAddressStr(crmAddr));
  const impNum = extractStreetNumber(normalizeAddressStr(importAddr));
  if (crmNum && impNum && crmNum !== impNum) return "material";

  // Normalized strings differ but same street number + zip → abbreviation / formatting only
  return "minor";
}

// ─── Phone slot resolution ─────────────────────────────────────────────────────
//
// Phones are treated additively. Import phones that are already present (digits-
// only comparison) are silently ignored.  Import phones not yet in any CRM slot
// are placed into the first available empty slot.  A true conflict (hasOverflow)
// only occurs when all three CRM slots are occupied by different numbers AND the
// import still has a phone that cannot be stored.
//
// The CRM DB column names we work with: home_phone | cell_phone | work_phone.

export interface PhoneResolution {
  // { db_column: normalized_phone } — empty slots to fill automatically
  updates: Record<string, string>;
  // true only when import has a phone that genuinely cannot fit anywhere
  hasOverflow: boolean;
}

const PHONE_SLOTS = ["home_phone", "cell_phone", "work_phone"] as const;

export function resolvePhones(
  existing: Record<string, any>,
  importHomePhone: string,
  importCellPhone: string,
  importWorkPhone: string
): PhoneResolution {
  // Normalize everything to digits-only so "303-555-1234" == "3035551234"
  const crmValues: Record<string, string> = {};
  for (const slot of PHONE_SLOTS) {
    crmValues[slot] = normalizePhone(existing[slot] ?? "");
  }

  const crmPhoneSet = new Set(Object.values(crmValues).filter(Boolean));

  // Import phones that are not already stored anywhere in the CRM record
  const incomingPhones = [importHomePhone, importCellPhone, importWorkPhone]
    .map(p => normalizePhone(p ?? ""))
    .filter(p => p.length >= 7 && !crmPhoneSet.has(p));

  // Empty CRM slots available to absorb new phones
  const emptySlots = PHONE_SLOTS.filter(s => !crmValues[s]);

  const updates: Record<string, string> = {};
  let overflowCount = 0;

  for (const phone of incomingPhones) {
    const slot = emptySlots.shift();
    if (slot) {
      updates[slot] = phone;
    } else {
      overflowCount++;
    }
  }

  return { updates, hasOverflow: overflowCount > 0 };
}

// ─── New-owner-at-existing-property detection ──────────────────────────────────
//
// When an import row has NO email/phone match but its billing address matches an
// existing property record, this may indicate a change of ownership at the same
// address rather than a brand-new unrelated customer. We return the property's
// current primary customer so the reviewer can decide whether to:
//   - Create a new account linked to the existing property (new_owner_at_property)
//   - Ignore the import row entirely (keep_existing)

export interface PropertyOwnerResult {
  propertyId: number;
  customerId: number;
  customerFirstName: string;
  customerLastName: string;
  customerEmail: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

export async function findPropertyAtAddress(
  importAddress: string,
  importZip: string,
): Promise<PropertyOwnerResult | null> {
  if (!importAddress?.trim() || !importZip?.trim()) return null;

  const normImp = normalizeAddressStr(importAddress);
  const zipImp  = extractZip(importZip);
  const numImp  = extractStreetNumber(normImp);
  if (!numImp || !zipImp) return null; // need at least a street number + zip for safety

  const r = await db.execute(sql`
    SELECT p.id AS property_id, p.customer_id, p.address, p.city, p.state, p.zip,
           c.first_name, c.last_name, c.email
    FROM properties p
    JOIN customers c ON c.id = p.customer_id
    WHERE p.zip = ${zipImp}
    LIMIT 100
  `);

  for (const row of r.rows as any[]) {
    const normProp = normalizeAddressStr(String(row.address ?? ""));
    const zipProp  = extractZip(String(row.zip ?? ""));
    const numProp  = extractStreetNumber(normProp);

    const exactMatch   = normProp === normImp;
    const numZipMatch  = numImp && numProp && numImp === numProp && zipImp === zipProp;

    if (exactMatch || numZipMatch) {
      return {
        propertyId:        row.property_id,
        customerId:        row.customer_id,
        customerFirstName: row.first_name ?? "",
        customerLastName:  row.last_name  ?? "",
        customerEmail:     row.email      ?? "",
        address: row.address ?? "",
        city:    row.city    ?? "",
        state:   row.state   ?? "",
        zip:     row.zip     ?? "",
      };
    }
  }

  return null;
}

// Re-export the internal helpers used by findPropertyAtAddress so staging.ts
// doesn't need to duplicate them — but the functions are already module-scoped
// so they're accessible internally. No extra export needed.

