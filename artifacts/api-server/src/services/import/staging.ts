/**
 * staging.ts — Import staging service  ·  Rev 66 ZERO AUTO-MERGE
 *
 * Takes raw parsed rows for a file group, normalizes them, runs the
 * matcher cascade, and populates import_staging_rows + import_review_queue.
 * Does NOT touch live CRM tables — all writes are in the staging schema.
 *
 * ZERO AUTO-MERGE RULES (Rev 66):
 *   • NO automatic merges — every matched record goes to "Needs Review".
 *   • Matching is ONLY by exact email OR exact phone. Nothing else.
 *   • NO matching by: first name, last name, company name, address, or partial matches.
 *   • import_match_type is set on every row: exact_email, exact_phone, weak_match, new_customer.
 *   • weak_match = externalId matched but no email/phone confirmation → review.
 *   • new_customer = no match at all → auto_created (only auto-approved path).
 *   • Every decision is logged for debugging.
 *   • No customer should disappear during import.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  normalizeLeadRow,
  normalizeJobRow,
  normalizeInvoiceRow,
  normalizeCfId,
  jobFingerprint,
  fingerprint,
  mergeJobGroupRows,
} from "./normalizer";
import {
  type MatchResult,
  matchCustomer,
  matchLead,
  matchInvoice,
  matchCustomerByExternalId,
  matchJobByContent,
  findConflicts,
  resolvePhones,
  classifyAddressDiff,
  checkPropertyExists,
  findPropertyAtAddress,
  PROTECTED_CUSTOMER_FIELDS,
  PROTECTED_LEAD_FIELDS,
} from "./matcher";
import { normalizeCustomerRow } from "./normalizer";
import { previewCustomerImportRows } from "./customer-import-safety";

export type FileGroup =
  | "active_customers"
  | "master_customers"
  | "active_prospects"
  | "master_prospects"
  | "invoices"
  | "sql_backup"
  | "unknown";

export interface StagingResult {
  rawRows: number;             // total lines parsed from the file before any deduplication
  totalRows: number;           // unique entities staged (after dedup — what gets written to DB)
  skippedRows: number;         // rows collapsed by deduplication (CF repeats customer per job)
  autoApproved: number;
  autoMergedHousehold: number; // DEPRECATED — household patterns now always go to review
  autoMergedExact: number;     // exact email/phone match — auto-merged with CRM-wins semantics
  autoCreatedCustomer: number; // brand-new customer, no match, no soft-match warning
  autoAddedProperty: number;   // new service address for an existing matched customer
  forcedStaging: number;       // rows forced into staging despite missing names (had externalId)
  needsReview: number;
  errors: number;
  jobsFound: number;
}

async function insertStagingRow(params: {
  batchId: number;
  fileId: number;
  rowIndex: number;
  entityType: string;
  externalId?: string;
  fingerprint?: string;
  rawData: Record<string, unknown>;
  normalizedData: Record<string, unknown>;
  matchedEntityId?: number;
  matchMethod?: string;
  duplicateCandidateIds?: number[];
  duplicateMatchTypes?: Record<string, number[]>;
  status: string;
  errorMessage?: string;
}): Promise<number> {
  const r = await db.execute(sql`
    INSERT INTO import_staging_rows
      (batch_id, file_id, row_index, entity_type, external_id, fingerprint,
       raw_data, normalized_data, matched_entity_id, match_method,
       duplicate_candidate_ids, duplicate_match_types, status, error_message)
    VALUES
      (${params.batchId}, ${params.fileId}, ${params.rowIndex},
       ${params.entityType}, ${params.externalId ?? null}, ${params.fingerprint ?? null},
        ${JSON.stringify(params.rawData)}, ${JSON.stringify(params.normalizedData)},
        ${params.matchedEntityId ?? null}, ${params.matchMethod ?? null},
        ${params.duplicateCandidateIds ? JSON.stringify(params.duplicateCandidateIds) : null},
        ${params.duplicateMatchTypes ? JSON.stringify(params.duplicateMatchTypes) : null},
       ${params.status}, ${params.errorMessage ?? null})
    RETURNING id
  `);
  return (r.rows[0] as any).id;
}

async function insertReviewItem(params: {
  batchId: number;
  stagingRowId: number;
  entityType: string;
  issueType: string;
  currentData?: Record<string, unknown> | null;
  proposedData: Record<string, unknown>;
  conflictFields?: string[];
  initialAction?: string; // defaults to 'pending'; pass 'merge' to auto-resolve
}) {
  const action = params.initialAction ?? "pending";
  await db.execute(sql`
    INSERT INTO import_review_queue
      (batch_id, staging_row_id, entity_type, issue_type,
       current_data, proposed_data, conflict_fields, action)
    VALUES
      (${params.batchId}, ${params.stagingRowId}, ${params.entityType},
       ${params.issueType},
       ${params.currentData ? JSON.stringify(params.currentData) : null},
       ${JSON.stringify(params.proposedData)},
       ${params.conflictFields ? JSON.stringify(params.conflictFields) : null},
       ${action})
    ON CONFLICT (staging_row_id, issue_type) DO NOTHING
  `);
}

async function getCustomerById(id: number): Promise<Record<string, any> | null> {
  const r = await db.execute(sql`SELECT * FROM customers WHERE id = ${id} LIMIT 1`);
  return (r.rows[0] as any) ?? null;
}

async function getLeadById(id: number): Promise<Record<string, any> | null> {
  const r = await db.execute(sql`SELECT * FROM leads WHERE id = ${id} LIMIT 1`);
  return (r.rows[0] as any) ?? null;
}

async function getInvoiceById(id: number): Promise<Record<string, any> | null> {
  const r = await db.execute(sql`SELECT * FROM invoices WHERE id = ${id} LIMIT 1`);
  return (r.rows[0] as any) ?? null;
}

// ─── Process customer rows ─────────────────────────────────────────────────────

async function processCustomerRows(
  batchId: number,
  fileId: number,
  rows: Record<string, string>[],
  isLead: boolean
): Promise<StagingResult> {
  const result: StagingResult = { rawRows: rows.length, totalRows: 0, skippedRows: 0, autoApproved: 0, autoMergedHousehold: 0, autoMergedExact: 0, autoCreatedCustomer: 0, autoAddedProperty: 0, forcedStaging: 0, needsReview: 0, errors: 0, jobsFound: 0 };
  const entityType = isLead ? "lead" : "customer";
  const batchInfo = isLead
    ? null
    : (await db.execute(sql`
        SELECT source_system, safety_version
        FROM import_batches
        WHERE id = ${batchId}
        LIMIT 1
      `)).rows[0] as any;
  const futureCustomerSafety = !isLead && Number(batchInfo?.safety_version ?? 0) >= 1;
  const sourceSystem = String(batchInfo?.source_system ?? "customer_factor").trim() || "customer_factor";

  // Group by externalId to deduplicate repeated rows (CF history pattern)
  // Maps extId → first row index where this customer was processed
  const seenIds = new Map<string, number>();
  // Track job rows collected from repeated customer rows
  const jobRowsByExternalId = new Map<string, Record<string, string>[]>();

  // ── Debug: count externalIds in this file ────────────────────────────────
  const withExtId = rows.filter(r => normalizeCfId(r["Id"] || r["id"] || r["c_id"] || "")).length;
  const samples = rows.slice(0, 3).map(r => normalizeCfId(r["Id"] || r["id"] || r["c_id"] || "") || "(empty)");
  console.log(`[Customer Staging] batch=${batchId} total_rows=${rows.length} rows_with_externalId=${withExtId} sample_ids=[${samples.join(", ")}]`);

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const extId = normalizeCfId(raw["Id"] || raw["id"] || raw["c_id"] || "");

    // Collect job data from the row (CF stores job history as repeated customer rows)
    const jobDate = raw["Job Date"] || raw["job_date"] || "";
    const jobType = raw["Job Type"]  || raw["job_type"]  || "";
    if ((jobDate || jobType) && extId) {
      const jobRows = jobRowsByExternalId.get(extId) ?? [];
      jobRows.push(raw);
      jobRowsByExternalId.set(extId, jobRows);
    }

    // Skip duplicate customer rows (first occurrence only)
    // Store the duplicate as a staging row so it's searchable & traceable.
    if (extId && seenIds.has(extId)) {
      const firstRowIdx = seenIds.get(extId)!;
      if (extId === "3050") console.log(`[DEBUG CF#3050] row[${i}] CLASSIFIED: skipped_duplicate (first occurrence at row[${firstRowIdx}])`);
      if (result.skippedRows < 20) {
        console.log(`[Row Trace] row[${i}] extId="${extId}" → skipped_duplicate (collapsed into row[${firstRowIdx}])`);
      } else if (result.skippedRows === 20) {
        console.log(`[Row Trace] ... suppressing further duplicate logs (will show total in summary)`);
      }
      const normalized = isLead ? normalizeLeadRow(raw) : normalizeCustomerRow(raw);
      await insertStagingRow({
        batchId, fileId, rowIndex: i, entityType,
        externalId: extId,
        rawData: raw,
        normalizedData: {
          ...normalized,
          _duplicateOfRowIndex: firstRowIdx,
          _duplicateReason: "same_external_id",
        },
        status: "skipped_duplicate",
        matchMethod: "duplicate",
        errorMessage: `Duplicate of row[${firstRowIdx}] — same externalId "${extId}". First occurrence was staged; this row's job data was collected separately.`,
      });
      result.skippedRows++;
      continue;
    }
    if (extId) seenIds.set(extId, i);

    result.totalRows++;
    const isDebugRow = extId === "3050";

    try {
      const normalized = isLead ? normalizeLeadRow(raw) : normalizeCustomerRow(raw);

      if (isDebugRow) {
        console.log(
          `[DEBUG CF#3050] row[${i}] NORMALIZED: firstName="${normalized.firstName}" lastName="${normalized.lastName}" ` +
          `companyName="${normalized.companyName}" email="${normalized.email}" extId="${extId}" ` +
          `rawKeys=[${Object.keys(raw).join(", ")}]`
        );
      }

      const hasName = !!(normalized.firstName || normalized.lastName || normalized.companyName);
      const isRowEmpty = Object.values(raw).every(v => !v || !v.trim());

      if (isRowEmpty) {
        const reason = `Row is completely empty — all CSV fields are blank.`;
        if (isDebugRow) console.log(`[DEBUG CF#3050] row[${i}] CLASSIFIED: skipped_empty`);
        console.log(`[Row Trace] row[${i}] extId="${extId || "(none)"}" → skipped_empty: ${reason}`);
        result.errors++;
        await insertStagingRow({
          batchId, fileId, rowIndex: i, entityType,
          externalId: extId || undefined,
          rawData: raw, normalizedData: normalized,
          status: "error", errorMessage: reason,
        });
        continue;
      }

      if (!extId && !hasName) {
        const reason = `No externalId AND no name (first/last/company). ` +
          `Raw First Name="${raw["First Name"] || raw["first_name"] || ""}" ` +
          `Raw Last Name="${raw["Last Name"] || raw["last_name"] || ""}" ` +
          `Raw Company="${raw["Company Name"] || raw["company_name"] || ""}"`;
        if (isDebugRow) console.log(`[DEBUG CF#3050] row[${i}] CLASSIFIED: skipped_invalid (no extId, no name)`);
        console.log(`[Row Trace] row[${i}] extId="(none)" → skipped_invalid: ${reason}`);
        result.errors++;
        await insertStagingRow({
          batchId, fileId, rowIndex: i, entityType,
          rawData: raw, normalizedData: normalized,
          status: "error", errorMessage: reason,
        });
        continue;
      }

      if (extId && !hasName) {
        console.log(
          `[Row Trace] row[${i}] extId="${extId}" → forced_staging (no name but externalId present). ` +
          `Raw First="${raw["First Name"] || raw["first_name"] || ""}" ` +
          `Raw Last="${raw["Last Name"] || raw["last_name"] || ""}" ` +
          `Raw Company="${raw["Company Name"] || raw["company_name"] || ""}"`
        );
        if (isDebugRow) console.log(`[DEBUG CF#3050] row[${i}] CLASSIFIED: forced_staging (has extId, missing name)`);
        result.forcedStaging++;
      }

      const fp = fingerprint({
        email: normalized.email,
        firstName: normalized.firstName,
        lastName: normalized.lastName,
        billingAddress: normalized.billingAddress,
        billingZip: normalized.billingZip,
      });

      const phones = [normalized.homePhone, normalized.cellPhone, normalized.workPhone].filter(Boolean);

      let status: string;
      let matchedEntityId: number | undefined;
      let matchMethod: string | undefined;
      let issueType: string | undefined;
      let conflictFields: string[] = [];
      let currentData: Record<string, unknown> | null = null;
      let hasNewProperty = false;
      let newPropertyData: Record<string, string> | null = null;

      // ── GATE 1: externalId lookup (assists matching, CANNOT force merge) ────
      let match: MatchResult | null = null;
      const importExtId = (normalized as any).externalId || extId || "";
      let importMatchType: "exact_email" | "exact_phone" | "weak_match" | "new_customer" = "new_customer";

      // Future-safe customer batches use the shared contact matcher and durable
      // source identity before the legacy cascade. Existing batches retain their
      // historical staging behavior and are never rewritten by this gate.
      if (futureCustomerSafety && !isLead) {
        const safetyPreview = (await previewCustomerImportRows(
          db,
          sourceSystem,
          [{ ...normalized, externalId: importExtId }],
        ))[0];

        if (safetyPreview?.decision === "idempotent_skip" && safetyPreview.existingCustomerId) {
          const stagingRowId = await insertStagingRow({
            batchId, fileId, rowIndex: i, entityType,
            externalId: importExtId || undefined,
            fingerprint: fp,
            rawData: raw,
            normalizedData: {
              ...normalized,
              _import_match_type: "idempotent_skip",
              _idempotencyAvailable: safetyPreview.idempotencyAvailable,
            },
            matchedEntityId: safetyPreview.existingCustomerId,
            matchMethod: "provenance",
            status: "auto_approved",
          });
          result.autoApproved++;
          console.log(`[Import Safety] row[${i}] source identity already linked to CRM #${safetyPreview.existingCustomerId} → idempotent skip`);
          continue;
        }

        if (safetyPreview && safetyPreview.candidates.length > 0) {
          const candidateIds = safetyPreview.candidates.map((candidate) => candidate.id);
          const matchTypes = Object.fromEntries(
            ["email", "phone"].map((type) => [
              type,
              safetyPreview.candidates
                .filter((candidate) => candidate.matchTypes.includes(type as "email" | "phone"))
                .map((candidate) => candidate.id),
            ]),
          );
          const stagingRowId = await insertStagingRow({
            batchId, fileId, rowIndex: i, entityType,
            externalId: importExtId || undefined,
            fingerprint: fp,
            rawData: raw,
            normalizedData: {
              ...normalized,
              _import_match_type: "contact_duplicate",
              _idempotencyAvailable: safetyPreview.idempotencyAvailable,
              _idempotencyWarning: safetyPreview.idempotencyWarning,
              _duplicateCandidates: safetyPreview.candidates.map((candidate) => ({
                id: candidate.id,
                firstName: candidate.firstName,
                lastName: candidate.lastName,
                companyName: candidate.companyName,
                lifecycleStatus: candidate.lifecycleStatus,
                accountType: candidate.accountType,
                matchTypes: candidate.matchTypes,
                canLink: candidate.canLink,
              })),
            },
            matchedEntityId: candidateIds[0],
            matchMethod: "contact_duplicate",
            duplicateCandidateIds: candidateIds,
            duplicateMatchTypes: matchTypes,
            status: "review",
          });
          result.needsReview++;
          await insertReviewItem({
            batchId,
            stagingRowId,
            entityType,
            issueType: "contact_duplicate",
            currentData: { candidates: safetyPreview.candidates.map((candidate) => ({
              id: candidate.id,
              firstName: candidate.firstName,
              lastName: candidate.lastName,
              companyName: candidate.companyName,
              lifecycleStatus: candidate.lifecycleStatus,
              accountType: candidate.accountType,
              matchTypes: candidate.matchTypes,
              canLink: candidate.canLink,
            })) },
            proposedData: {
              ...normalized,
              _import_match_type: "contact_duplicate",
              _idempotencyAvailable: safetyPreview.idempotencyAvailable,
              _idempotencyWarning: safetyPreview.idempotencyWarning,
            },
          });
          console.log(`[Import Safety] row[${i}] ${candidateIds.length} strong contact candidate(s) → explicit review`);
          continue;
        }
      }

      if (isDebugRow) {
        console.log(
          `[DEBUG CF#3050] row[${i}] ENTERING MATCH GATES: importExtId="${importExtId}" email="${normalized.email}" ` +
          `phones=[${phones.join(", ")}] isLead=${isLead}`
        );
      }

      if (importExtId && !isLead) {
        const extMatch = await matchCustomerByExternalId(importExtId);
        if (isDebugRow) console.log(`[DEBUG CF#3050] row[${i}] GATE 1 (externalId lookup): extMatch=${extMatch ?? "null"}`);
        if (extMatch) {
          const extCust = await getCustomerById(extMatch);
          if (extCust) {
            match = { id: extMatch, method: "email" as const };
            matchMethod = "external_id";
            importMatchType = "weak_match";
            console.log(
              `[Import Decision] row[${i}] extId="${importExtId}" → CRM #${extMatch} via externalId → REVIEW (weak_match, no email/phone confirmation)`
            );
          }
        }
      }

      // ── GATE 2: exact email / exact phone (ONLY matching allowed) ──────────
      if (!match) {
        const matchFn = isLead ? matchLead : matchCustomer;
        match = await matchFn(normalized.email, phones);
        if (isDebugRow) console.log(`[DEBUG CF#3050] row[${i}] GATE 2 (email/phone): match=${match ? `#${match.id} via ${match.method}` : "null"}`);
        if (match) {
          importMatchType = match.method === "email" ? "exact_email" : "exact_phone";
          matchMethod = match.method === "email" ? "email_match" : "phone_match";
          console.log(
            `[Import Decision] row[${i}] EXACT MATCH (${importMatchType}) → CRM #${match.id} ` +
            `for "${normalized.firstName} ${normalized.lastName}" email="${normalized.email}" → REVIEW (no auto-merge)`
          );
        }
      }

      // ── GATE 3: identity conflict guard ────────────────────────────────────
      if (match && importExtId && !isLead && matchMethod !== "external_id") {
        const existingCust = await getCustomerById(match.id);
        const existingExtId = existingCust ? String(existingCust.import_external_id ?? "").trim() : "";
        if (existingExtId && existingExtId !== importExtId) {
          console.warn(
            `[Import Decision] IDENTITY CONFLICT row[${i}]: ` +
            `import extId="${importExtId}" vs CRM #${match.id} extId="${existingExtId}" — ` +
            `shared ${match.method} but different CF IDs → REVIEW (identity_conflict)`
          );
          status = "review";
          issueType = "identity_conflict";
          matchedEntityId = match.id;
          importMatchType = "weak_match";
          currentData = existingCust;

          const stagingRowId = await insertStagingRow({
            batchId, fileId, rowIndex: i, entityType,
            externalId: importExtId || undefined,
            fingerprint: fp,
            rawData: raw,
            normalizedData: { ...normalized, _import_match_type: importMatchType },
            matchedEntityId, matchMethod, status,
          });
          result.needsReview++;
          await insertReviewItem({
            batchId, stagingRowId, entityType,
            issueType: "identity_conflict",
            currentData,
            proposedData: {
              ...normalized,
              _import_match_type: importMatchType,
              _identityConflict: {
                importExtId, existingExtId,
                sharedField: match.method,
                note: `Same ${match.method} but different Customer Factor IDs. These are separate customers — do NOT merge.`,
              },
            },
          });
          continue;
        }
      }

      if (match) {
        // ── MATCHED: ALL matches go to review — ZERO auto-merges ─────────────
        matchedEntityId = match.id;
        if (!matchMethod) matchMethod = match.method;

        currentData = isLead
          ? await getLeadById(match.id)
          : await getCustomerById(match.id);

        if (currentData) {
          const phoneRes = resolvePhones(
            currentData,
            normalized.homePhone,
            normalized.cellPhone,
            normalized.workPhone
          );

          if (Object.keys(phoneRes.updates).length > 0) {
            for (const [slot, val] of Object.entries(phoneRes.updates)) {
              (normalized as any)[slot.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = val;
            }
          }

          const addrDiff = classifyAddressDiff(
            currentData,
            normalized.billingAddress,
            normalized.billingCity,
            normalized.billingState,
            normalized.billingZip
          );
          if (addrDiff === "material" && !isLead) {
            const alreadyKnown = await checkPropertyExists(
              match.id,
              normalized.billingAddress,
              normalized.billingZip
            );
            if (!alreadyKnown) {
              hasNewProperty = true;
              newPropertyData = {
                address:                normalized.billingAddress  || "",
                city:                   normalized.billingCity     || "",
                state:                  normalized.billingState    || "",
                zip:                    normalized.billingZip      || "",
                customerId:             String(match.id),
                customerName:           `${String(currentData.first_name ?? "")} ${String(currentData.last_name ?? "")}`.trim(),
                existingBillingAddress: String(currentData.billing_address ?? ""),
                existingBillingCity:    String(currentData.billing_city    ?? ""),
                existingBillingState:   String(currentData.billing_state   ?? ""),
                existingBillingZip:     String(currentData.billing_zip     ?? ""),
              };
            }
          }

          const proposed: Record<string, string> = {
            first_name: normalized.firstName,
            last_name: normalized.lastName,
            company_name: normalized.companyName,
            email: normalized.email,
            notes: normalized.notes,
            star_rating: normalized.starRating,
            window_count: normalized.windowCount,
          };

          const protectedFields = isLead ? PROTECTED_LEAD_FIELDS : PROTECTED_CUSTOMER_FIELDS;
          conflictFields = [...conflictFields, ...findConflicts(currentData, proposed, protectedFields)];

          if (phoneRes.hasOverflow) {
            conflictFields.push("phone_overflow");
          }
        }

        // ── Determine review issue type ──────────────────────────────────────
        const importFirstNorm = (normalized.firstName || "").trim().toLowerCase();
        const importLastNorm  = (normalized.lastName  || "").trim().toLowerCase();
        const crmFirstForCheck = String(currentData?.first_name ?? "").trim().toLowerCase();
        const crmLastForCheck  = String(currentData?.last_name  ?? "").trim().toLowerCase();

        const hasNameMismatch =
          (importFirstNorm && crmFirstForCheck && importFirstNorm !== crmFirstForCheck) ||
          (importLastNorm  && crmLastForCheck  && importLastNorm  !== crmLastForCheck);

        // ALL matches go to review — no auto-approved merges
        status = "review";

        if (hasNameMismatch) {
          issueType = "name_mismatch";
          if (!conflictFields.includes("first_name") && importFirstNorm !== crmFirstForCheck && importFirstNorm && crmFirstForCheck) {
            conflictFields.push("first_name");
          }
          if (!conflictFields.includes("last_name") && importLastNorm !== crmLastForCheck && importLastNorm && crmLastForCheck) {
            conflictFields.push("last_name");
          }
          console.log(
            `[Import Decision] row[${i}] NAME MISMATCH via ${matchMethod} → ` +
            `CRM "${currentData?.first_name} ${currentData?.last_name}" vs import "${normalized.firstName} ${normalized.lastName}" ` +
            `match_type=${importMatchType} → REVIEW`
          );
        } else if (importMatchType === "weak_match") {
          issueType = "weak_match";
          console.log(
            `[Import Decision] row[${i}] WEAK MATCH (externalId only, no email/phone) → CRM #${matchedEntityId} ` +
            `match_type=${importMatchType} → REVIEW`
          );
        } else if (conflictFields.length > 0) {
          issueType = "field_conflict";
          console.log(
            `[Import Decision] row[${i}] EXACT MATCH with conflicts [${conflictFields.join(",")}] → CRM #${matchedEntityId} ` +
            `match_type=${importMatchType} → REVIEW`
          );
        } else {
          issueType = "exact_match";
          console.log(
            `[Import Decision] row[${i}] EXACT MATCH (${importMatchType}) → CRM #${matchedEntityId} ` +
            `"${normalized.firstName} ${normalized.lastName}" — names OK, no conflicts → REVIEW (user must approve)`
          );
        }
      } else {
        // ── NO MATCH: check property ownership, otherwise create new ─────────
        const existingPropOwner = !isLead
          ? await findPropertyAtAddress(normalized.billingAddress, normalized.billingZip)
          : null;

        if (existingPropOwner) {
          status = "review";
          issueType = "new_owner_at_property";
          matchedEntityId = existingPropOwner.propertyId;
          matchMethod = "address";
          importMatchType = "new_customer";
          currentData = {
            propertyId:        existingPropOwner.propertyId,
            customerId:        existingPropOwner.customerId,
            customerFirstName: existingPropOwner.customerFirstName,
            customerLastName:  existingPropOwner.customerLastName,
            customerEmail:     existingPropOwner.customerEmail,
            address:           existingPropOwner.address,
            city:              existingPropOwner.city,
            state:             existingPropOwner.state,
            zip:               existingPropOwner.zip,
          };
          console.log(
            `[Import Decision] row[${i}] NEW OWNER AT PROPERTY → property #${existingPropOwner.propertyId} ` +
            `(current owner: "${existingPropOwner.customerFirstName} ${existingPropOwner.customerLastName}") → REVIEW`
          );
        } else if (!hasName) {
          status = "review";
          issueType = "missing_identity";
          matchMethod = "auto_created";
          importMatchType = "new_customer";
          console.log(
            `[Import Decision] row[${i}] NO MATCH + MISSING NAME → review (missing_identity): ` +
            `extId="${importExtId}" email="${normalized.email}"`
          );
        } else {
          status = "auto_approved";
          matchMethod = "auto_created";
          importMatchType = "new_customer";
          result.autoCreatedCustomer++;
          console.log(
            `[Import Decision] row[${i}] NO MATCH → auto_created (new_customer): ` +
            `"${normalized.firstName} ${normalized.lastName}" extId="${importExtId}" email="${normalized.email}"`
          );
        }
      }

      if (isDebugRow) {
        console.log(
          `[DEBUG CF#3050] row[${i}] FINAL DECISION: status="${status}" issueType="${issueType ?? "none"}" ` +
          `matchMethod="${matchMethod ?? "none"}" matchedEntityId=${matchedEntityId ?? "none"} ` +
          `importMatchType="${importMatchType}" conflicts=[${conflictFields.join(",")}]`
        );
      }

      const stagingRowId = await insertStagingRow({
        batchId,
        fileId,
        rowIndex: i,
        entityType,
        externalId: extId || undefined,
        fingerprint: fp,
        rawData: raw,
        normalizedData: { ...normalized, _import_match_type: importMatchType },
        matchedEntityId,
        matchMethod,
        status,
      });

      if (status === "review") {
        result.needsReview++;

        let proposedData: Record<string, unknown> = { ...normalized, _import_match_type: importMatchType };

        if (issueType === "name_mismatch" && currentData) {
          proposedData._nameMismatch = {
            matchField: matchMethod || match?.method || "unknown",
            importName: `${normalized.firstName} ${normalized.lastName}`.trim(),
            crmName: `${String(currentData.first_name ?? "")} ${String(currentData.last_name ?? "")}`.trim(),
            note: "Names do not match — requires manual review before any merge.",
          };
        }
        if (issueType === "weak_match" && currentData) {
          proposedData._weakMatch = {
            matchField: matchMethod || "unknown",
            importName: `${normalized.firstName} ${normalized.lastName}`.trim(),
            crmName: `${String(currentData.first_name ?? "")} ${String(currentData.last_name ?? "")}`.trim(),
            note: `Matched by ${matchMethod} only — no email or phone match. Requires manual review.`,
          };
        }
        if (issueType === "exact_match" && currentData) {
          proposedData._exactMatch = {
            matchField: importMatchType,
            importName: `${normalized.firstName} ${normalized.lastName}`.trim(),
            crmName: `${String(currentData.first_name ?? "")} ${String(currentData.last_name ?? "")}`.trim(),
            note: `Exact ${importMatchType === "exact_email" ? "email" : "phone"} match. Names verified. Safe to merge — but requires your approval.`,
          };
        }
        await insertReviewItem({
          batchId,
          stagingRowId,
          entityType,
          issueType: issueType!,
          currentData,
          proposedData,
          conflictFields: conflictFields.length > 0 ? conflictFields : undefined,
          initialAction: issueType === "new_owner_at_property" ? "accept_import" : "pending",
        });
      } else {
        result.autoApproved++;
      }

      // ── New property detection ──────────────────────────────────────────────
      // New properties also go to review — no auto-approved property adds.
      if (!isLead && hasNewProperty && newPropertyData && matchedEntityId) {
        const propStagingRowId = await insertStagingRow({
          batchId,
          fileId,
          rowIndex: i,
          entityType: "property",
          rawData: raw,
          normalizedData: newPropertyData,
          matchedEntityId,
          matchMethod: "auto_added_property",
          status: "review",
        });
        result.autoAddedProperty++;
        result.needsReview++;
        await insertReviewItem({
          batchId,
          stagingRowId: propStagingRowId,
          entityType: "property",
          issueType: "new_property_detected",
          currentData: {
            customerId: matchedEntityId,
            existingAddress: newPropertyData.existingBillingAddress,
            existingCity: newPropertyData.existingBillingCity,
            existingState: newPropertyData.existingBillingState,
            existingZip: newPropertyData.existingBillingZip,
          },
          proposedData: newPropertyData,
        });
      }
    } catch (err) {
      result.errors++;
      await insertStagingRow({
        batchId,
        fileId,
        rowIndex: i,
        entityType,
        rawData: raw,
        normalizedData: {},
        status: "error",
        errorMessage: (err as Error).message.slice(0, 500),
      });
    }
  }

  // ── Row accounting (mutually exclusive buckets) ──────────────────────────
  // Every raw row ends in exactly ONE of these buckets:
  //   skipped_duplicate  → deduplicated (repeated CF row for same externalId)
  //   auto_approved      → staged & auto-approved (customer-level only)
  //   sent_to_review     → staged & needs human review (customer-level only)
  //   error              → staged as error (empty/invalid)
  // Property & job rows are extras created from deduplicated rows — NOT part of
  // customer-level accounting.
  const customerReview = result.needsReview - result.autoAddedProperty;
  const customerStaged = result.autoApproved + customerReview + result.errors;
  const totalAccountedForRaw = customerStaged + result.skippedRows;
  const drift = result.rawRows - totalAccountedForRaw;
  console.log(
    `[Customer Staging Summary] batch=${batchId} file=${fileId}\n` +
    `  RAW INPUT:        ${result.rawRows} rows read from CSV\n` +
    `  MUTUALLY EXCLUSIVE BUCKETS:\n` +
    `    skipped_duplicate: ${result.skippedRows} (collapsed repeated CF rows)\n` +
    `    auto_approved:     ${result.autoApproved} (${result.autoCreatedCustomer} new customers)\n` +
    `    sent_to_review:    ${customerReview} (customer/lead review items)\n` +
    `    error:             ${result.errors} (empty/invalid rows)\n` +
    `  EXTRAS (not in accounting):\n` +
    `    property_review:   ${result.autoAddedProperty}\n` +
    `    forced_staging:    ${result.forcedStaging} (no name but had extId)\n` +
    `    jobs_found:        ${result.jobsFound}\n` +
    `  ACCOUNTING:       staged(${customerStaged}) + skipped(${result.skippedRows}) = ${totalAccountedForRaw} vs rawRows(${result.rawRows}) ` +
    `${drift === 0 ? "✓ EXACT MATCH" : `⚠️ DRIFT ${drift}`}`
  );
  if (drift !== 0) {
    console.error(`[Customer Staging] ⚠️ Row accounting drift: ${drift} row(s) unaccounted for! staged(${customerStaged}) + skipped(${result.skippedRows}) ≠ rawRows(${result.rawRows})`);
  }

  // Now process jobs that came out of repeated customer rows.
  // GROUP BY INVOICE NUMBER: multiple CSV rows with the same customer + invoice
  // number represent service lines on the same visit — they become ONE job.
  if (!isLead) {
    for (const [extId, jobRows] of jobRowsByExternalId.entries()) {
      const firstRow = jobRows[0];
      const normalized = normalizeCustomerRow(firstRow);
      const phones = [normalized.homePhone, normalized.cellPhone].filter(Boolean);
      const custMatch = await matchCustomer(normalized.email, phones);
      const custId = custMatch?.id ?? null;

      // Group rows by invoice number (column AK). Rows without an invoice
      // number are each treated as their own job.
      const invoiceGroups = new Map<string, Record<string, string>[]>();
      let ungroupedIdx = 0;
      for (const jRaw of jobRows) {
        const invNum = (jRaw["Invoice Number"] || jRaw["invoice_number"] || "").trim();
        const key = invNum || `__no_invoice_${ungroupedIdx++}`;
        const group = invoiceGroups.get(key) ?? [];
        group.push(jRaw);
        invoiceGroups.set(key, group);
      }

      let jobIdx = 0;
      for (const [invoiceKey, groupRows] of invoiceGroups.entries()) {
        result.jobsFound++;
        try {
          const merged = mergeJobGroupRows(groupRows);

          const fp = custId
            ? jobFingerprint(custId, merged.scheduledDate, merged.serviceType, merged.totalAmount)
            : jobFingerprint(0, merged.scheduledDate, merged.serviceType, merged.totalAmount);

          const dupJob = custId
            ? await matchJobByContent(custId, merged.scheduledDate, merged.serviceType, merged.totalAmount)
            : null;

          let jobStatus: string;
          let jobIssueType: string | undefined;

          if (dupJob) {
            jobStatus = "review";
            jobIssueType = "duplicate_job";
          } else {
            jobStatus = "auto_approved";
          }

          const jRowData = { ...merged, customerId: custId };
          const stagingRowId = await insertStagingRow({
            batchId,
            fileId,
            rowIndex: 100000 + jobIdx,
            entityType: "job",
            externalId: extId,
            fingerprint: fp,
            rawData: groupRows[0],
            normalizedData: jRowData,
            matchedEntityId: dupJob?.id,
            matchMethod: dupJob ? "content" : undefined,
            status: jobStatus,
          });

          if (groupRows.length > 1) {
            console.log(`[Job Staging] Grouped ${groupRows.length} service rows under invoice "${invoiceKey}" for CF#${extId}`);
          }

          if (jobStatus === "review") {
            result.needsReview++;
            await insertReviewItem({
              batchId,
              stagingRowId,
              entityType: "job",
              issueType: jobIssueType!,
              currentData: dupJob ? { id: dupJob.id } : null,
              proposedData: jRowData,
            });
          } else {
            result.autoApproved++;
          }
          jobIdx++;
        } catch (_err) {
          result.errors++;
        }
      }
    }
  }

  return result;
}

// ─── Process invoice rows ──────────────────────────────────────────────────────
//
// Matching cascade for invoices:
//   1. Duplicate check: if invoice_number already exists in invoices table → review/field_conflict
//   2. Customer resolution (new invoices only):
//        a. CF customerId → import_external_id match (matchCustomerByExternalId)
//        b. Email/phone fallback (matchCustomer) if row carries those fields
//   3. If customer resolved   → auto_approved, crmCustomerId stored in normalized data
//   4. If no customer match   → review/unmatched_invoice (NOT dropped, NOT applied without a link)
//
// Debug log at the end: total / matched-to-customer / unmatched count.

async function processInvoiceRows(
  batchId: number,
  fileId: number,
  rows: Record<string, string>[]
): Promise<StagingResult> {
  const result: StagingResult = { rawRows: rows.length, totalRows: 0, skippedRows: 0, autoApproved: 0, autoMergedHousehold: 0, autoMergedExact: 0, autoCreatedCustomer: 0, autoAddedProperty: 0, forcedStaging: 0, needsReview: 0, errors: 0, jobsFound: 0 };

  let debugMatched = 0;
  let debugUnmatched = 0;

  // ── Debug: dump headers and first 5 rows' customer ID mapping ────────────
  if (rows.length > 0) {
    const headers = Object.keys(rows[0]);
    console.log(`[Invoice Staging] batch=${batchId} CSV headers (${headers.length}): ${headers.join(", ")}`);
    const sample = rows.slice(0, 5);
    for (let si = 0; si < sample.length; si++) {
      const sNorm = normalizeInvoiceRow(sample[si]);
      const rawCustIdKeys = headers.filter(h =>
        /customer.?id|^id$|^c_id$|^cid$/i.test(h)
      );
      const rawVals = rawCustIdKeys.map(k => `${k}="${sample[si][k] ?? ""}"`).join(", ");
      console.log(
        `[Invoice Staging]   row[${si}] rawKeys=[${rawVals || "NO MATCH"}] → ` +
        `customerId="${sNorm.customerId || "(empty)"}" invoiceNumber="${sNorm.invoiceNumber || "(empty)"}"`
      );
      if (!sNorm.customerId) {
        console.warn(`[Invoice Staging]   ⚠ row[${si}] cfCustomerId is EMPTY — no customer match possible`);
      }
    }
  } else {
    console.warn(`[Invoice Staging] batch=${batchId} — 0 rows received!`);
  }

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    try {
      result.totalRows++;
      const normalized = normalizeInvoiceRow(raw);

      // Skip rows with no identifiable invoice number
      if (!normalized.invoiceNumber) {
        result.errors++;
        result.totalRows--;
        continue;
      }

      // ── Step 1: duplicate invoice check ──────────────────────────────────────
      const existingInvoice = await matchInvoice(normalized.invoiceNumber);

      if (existingInvoice) {
        // Invoice already in CRM — flag for human review
        const currentData = await getInvoiceById(existingInvoice.id);
        const stagingRowId = await insertStagingRow({
          batchId, fileId, rowIndex: i,
          entityType: "invoice",
          externalId: normalized.invoiceNumber,
          rawData: raw,
          normalizedData: normalized,
          matchedEntityId: existingInvoice.id,
          matchMethod: "invoice_number",
          status: "review",
        });
        result.needsReview++;
        await insertReviewItem({
          batchId, stagingRowId,
          entityType: "invoice",
          issueType: "field_conflict",
          currentData,
          proposedData: normalized,
        });
        continue;
      }

      // ── Step 2: resolve CRM customer for this new invoice ─────────────────────
      // Primary: CF Customer Id → customers.import_external_id (+ staging rows)
      // Fallback: customerName + address (last resort, never name-only)
      let crmCustomerId: number | null = null;
      if (normalized.customerId) {
        crmCustomerId = await matchCustomerByExternalId(
          normalized.customerId,
          normalized.customerName || undefined,
          normalized.address     || undefined,
        );
      }

      // ── Step 3: stage with or without customer link ───────────────────────────
      const normalizedWithCustomer = { ...normalized, crmCustomerId: crmCustomerId ?? null };

      if (crmCustomerId) {
        // Happy path — invoice can be attached to a known customer
        await insertStagingRow({
          batchId, fileId, rowIndex: i,
          entityType: "invoice",
          externalId: normalized.invoiceNumber,
          rawData: raw,
          normalizedData: normalizedWithCustomer,
          matchedEntityId: undefined,  // no existing invoice row to merge into
          matchMethod: "customer_resolved",
          status: "auto_approved",
        });
        result.autoApproved++;
        debugMatched++;
      } else {
        // Could not link to any customer — flag for review so it never disappears
        const stagingRowId = await insertStagingRow({
          batchId, fileId, rowIndex: i,
          entityType: "invoice",
          externalId: normalized.invoiceNumber,
          rawData: raw,
          normalizedData: normalizedWithCustomer,
          matchedEntityId: undefined,
          matchMethod: "unmatched",
          status: "review",
        });
        result.needsReview++;
        debugUnmatched++;
        await insertReviewItem({
          batchId, stagingRowId,
          entityType: "invoice",
          issueType: "unmatched_invoice",
          currentData: null,
          proposedData: {
            ...normalizedWithCustomer,
            _unmatchedNote: `CF Customer Id "${normalized.customerId || "(none)"}" was not found in the CRM. ` +
              "This invoice has no email/phone match either. Assign manually or skip.",
          },
        });
      }
    } catch (err) {
      result.errors++;
      await insertStagingRow({
        batchId, fileId, rowIndex: i, entityType: "invoice",
        rawData: raw, normalizedData: {}, status: "error",
        errorMessage: (err as Error).message.slice(0, 200),
      });
    }
  }

  const rowsWithCustId = rows.filter(r => {
    const norm = normalizeInvoiceRow(r);
    return !!norm.customerId;
  }).length;
  console.log(
    `[Invoice Staging] batch=${batchId} SUMMARY:\n` +
    `  total_rows_parsed=${result.totalRows}\n` +
    `  rows_with_customer_id=${rowsWithCustId}/${rows.length}\n` +
    `  matched_to_customer=${debugMatched}\n` +
    `  unmatched=${debugUnmatched}\n` +
    `  duplicate_conflict=${result.needsReview - debugUnmatched}\n` +
    `  auto_approved=${result.autoApproved}\n` +
    `  errors=${result.errors}`
  );

  return result;
}

// ─── Main entry point ──────────────────────────────────────────────────────────

export async function stageFileRows(
  batchId: number,
  fileId: number,
  fileGroup: FileGroup,
  rows: Record<string, string>[]
): Promise<StagingResult> {
  switch (fileGroup) {
    case "active_customers":
    case "master_customers":
      return processCustomerRows(batchId, fileId, rows, false);

    case "active_prospects":
    case "master_prospects":
      return processCustomerRows(batchId, fileId, rows, true);

    case "invoices":
      return processInvoiceRows(batchId, fileId, rows);

    case "sql_backup":
      // SQL backups are handled differently — the frontend sends pre-parsed customers+jobs
      // Fall through to customer processing
      return processCustomerRows(batchId, fileId, rows, false);

    default:
      return { rawRows: rows.length, totalRows: rows.length, skippedRows: 0, autoApproved: 0, autoMergedHousehold: 0, autoMergedExact: 0, autoCreatedCustomer: 0, autoAddedProperty: 0, forcedStaging: 0, needsReview: 0, errors: rows.length, jobsFound: 0 };
  }
}

// Update batch counters after staging a file
export async function refreshBatchCounters(batchId: number) {
  await db.execute(sql`
    UPDATE import_batches SET
      staged_rows      = (SELECT COUNT(*) FROM import_staging_rows WHERE batch_id = ${batchId}),
      review_count     = (SELECT COUNT(*) FROM import_review_queue  WHERE batch_id = ${batchId} AND action = 'pending'),
      auto_approved_count = (SELECT COUNT(*) FROM import_staging_rows WHERE batch_id = ${batchId} AND status = 'auto_approved'),
      status           = CASE
                           WHEN (SELECT COUNT(*) FROM import_review_queue WHERE batch_id = ${batchId}) > 0 THEN 'review'
                           ELSE 'staged'
                         END,
      updated_at       = NOW()
    WHERE id = ${batchId}
  `);
}
