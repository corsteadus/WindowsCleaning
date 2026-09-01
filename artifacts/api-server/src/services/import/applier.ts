/**
 * applier.ts — Import applier service  ·  v1 BASELINE (Rev 58)
 *
 * Writes auto-approved + user-accepted staging rows to live CRM tables.
 * Logs every change to import_change_log for rollback support.
 *
 * FROZEN RULES (see matcher.ts for the full baseline contract):
 *   • Apply order: customer → lead → job → invoice → property.
 *     This order must be preserved — child rows depend on parent ids.
 *   • Merge semantics: fill blank CRM fields only (CRM wins).
 *     No field in the CRM is ever silently overwritten.
 *   • new_owner_at_property: creates a NEW customer, links to existing property,
 *     and ends the prior owner's primary relationship. Do not merge the two customers.
 *   • Every write must produce a import_change_log entry with before/after JSON.
 *   • Rollback support (import_change_log) must remain intact for all apply paths.
 */

import { db, customersTable, importStagingRowsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  findStrongDuplicateCandidatesForCustomer,
  sanitizeConversionReason,
} from "../../lib/lead-duplicate-candidates.ts";
import {
  findCustomerImportProvenance,
  lockCustomerImportIdentity,
  reserveCustomerImportProvenance,
} from "./customer-import-safety";
import { validateImportJobTemporalValues } from "../../lib/import-job-temporal";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function logChange(params: {
  batchId: number;
  operation: "insert" | "update" | "hide" | "skip_duplicate";
  entityType: string;
  entityId: number;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown>;
  executor?: any;
}) {
  const executor = params.executor ?? db;
  await executor.execute(sql`
    INSERT INTO import_change_log (batch_id, operation, entity_type, entity_id, before_json, after_json)
    VALUES (${params.batchId}, ${params.operation}, ${params.entityType}, ${params.entityId},
            ${params.beforeJson ? JSON.stringify(params.beforeJson) : null},
            ${JSON.stringify(params.afterJson)})
  `);
}

function parseAmount(v: unknown): number {
  const n = parseFloat(String(v ?? "0").replace(/[^0-9.-]/g, ""));
  return isNaN(n) ? 0 : n;
}

function safeInt(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = parseInt(String(v), 10);
  return isNaN(n) ? null : n;
}

// ─── Apply a customer staging row ─────────────────────────────────────────────

type ApplyOutcome = "created" | "updated" | "skipped";

async function applyFutureSafeCustomerRow(
  batchId: number,
  staging: any,
  reviewAction: string | undefined,
  sourceSystem: string,
): Promise<ApplyOutcome> {
  const n = JSON.parse(staging.normalized_data);
  const externalRecordId = String(staging.external_id ?? n.externalId ?? "").trim();
  const reviewNotes = typeof staging.review_notes === "string" ? staging.review_notes : "";
  const separateReason = sanitizeConversionReason(
    (() => {
      try {
        return JSON.parse(reviewNotes || "{}").reason;
      } catch {
        return "";
      }
    })(),
  );
  if (reviewAction === "create_separate" && !separateReason) {
    throw new Error("create_separate requires a non-blank reason");
  }

  return db.transaction(async (tx) => {
    if (externalRecordId) {
      await lockCustomerImportIdentity(tx, sourceSystem, externalRecordId);
      const existingIdentity = await findCustomerImportProvenance(tx, sourceSystem, externalRecordId);
      if (existingIdentity) {
        await tx.update(importStagingRowsTable)
          .set({ matchedEntityId: existingIdentity.customerId, status: "applied" })
          .where(eq(importStagingRowsTable.id, staging.id));
        return "skipped";
      }
    }

    const candidates = await findStrongDuplicateCandidatesForCustomer(
      tx,
      {
        email: n.email ?? null,
        phone: n.phone ?? null,
        homePhone: n.homePhone ?? null,
        workPhone: n.workPhone ?? null,
        cellPhone: n.cellPhone ?? null,
        altPhone: n.altPhone ?? null,
        alternatePhone: n.alternatePhone ?? null,
      },
    );

    if (reviewAction === "link_existing" && candidates.length === 0) {
      throw new Error("The selected duplicate candidate is no longer present; review the row again");
    }

    if (candidates.length > 0) {
      if (reviewAction === "ignore" || reviewAction === "skip" || reviewAction === "keep_existing") {
        return "skipped";
      }

      if (reviewAction === "link_existing") {
        let selectedCustomerId: number | null = null;
        try {
          const parsed = JSON.parse(reviewNotes || "{}");
          selectedCustomerId = Number(parsed.selectedCustomerId);
        } catch {
          selectedCustomerId = null;
        }
        if (!selectedCustomerId || !candidates.some((candidate) => candidate.id === selectedCustomerId)) {
          throw new Error("A selected eligible duplicate candidate is required");
        }

        await tx.execute(sql`SELECT id FROM customers WHERE id = ${selectedCustomerId} FOR UPDATE`);
        const [target] = await tx.select({
          id: customersTable.id,
          lifecycleStatus: customersTable.lifecycleStatus,
          status: customersTable.status,
        }).from(customersTable).where(eq(customersTable.id, selectedCustomerId));
        if (!target) throw new Error("Selected customer not found");
        if (["inactive", "archived"].includes(String(target.lifecycleStatus ?? ""))) {
          throw new Error("Inactive or archived customers cannot receive an import identity");
        }
        if (externalRecordId) {
          const reservation = await reserveCustomerImportProvenance(
            tx,
            sourceSystem,
            externalRecordId,
            selectedCustomerId,
            batchId,
          );
          await tx.update(importStagingRowsTable)
            .set({ matchedEntityId: reservation.customerId, status: "applied" })
            .where(eq(importStagingRowsTable.id, staging.id));
        }
        return "skipped";
      }

      if (reviewAction !== "create_separate") {
        throw new Error("Strong contact candidates require link_existing, skip, or create_separate");
      }
    } else if (reviewAction === "ignore" || reviewAction === "skip" || reviewAction === "keep_existing") {
      return "skipped";
    }

    const starRating = safeInt(n.starRating);
    const windowCount = safeInt(n.windowCount);
    const inserted = await tx.execute(sql`
      INSERT INTO customers (
        first_name, last_name, company_name, salutation, email,
        home_phone, work_phone, cell_phone, fax, alt_phone, alt_contact,
        billing_address, billing_city, billing_state, billing_zip,
        notes, how_heard, star_rating, window_count, window_type,
        house_size, ladders_needed, sending_preferences,
        customer_date, status, client_type,
        import_source, import_external_id, import_batch_id, is_imported,
        last_seen_import_at, created_at, updated_at
      ) VALUES (
        ${n.firstName || null}, ${n.lastName || null}, ${n.companyName || null},
        ${n.salutation || null}, ${n.email || null},
        ${n.homePhone || null}, ${n.workPhone || null}, ${n.cellPhone || null},
        ${n.fax || null}, ${n.altPhone || null}, ${n.altContact || null},
        ${n.billingAddress || null}, ${n.billingCity || null}, ${n.billingState || null}, ${n.billingZip || null},
        ${n.notes || null}, ${n.howHeard || null}, ${starRating}, ${windowCount},
        ${n.windowType || null}, ${n.houseSize || null}, ${n.laddersNeeded || null},
        ${n.sendingPreferences || null}, ${n.customerDate || null}, 'active',
        ${n.clientType || "residential"},
        ${sourceSystem}, ${externalRecordId || null}, ${batchId}, true,
        NOW(), NOW(), NOW()
      ) RETURNING id
    `);
    const newId = Number((inserted.rows[0] as any)?.id);
    if (!newId) throw new Error("Future-safe customer import did not create an account");

    if (externalRecordId) {
      const reservation = await reserveCustomerImportProvenance(
        tx,
        sourceSystem,
        externalRecordId,
        newId,
        batchId,
      );
      if (reservation.reused && reservation.customerId !== newId) {
        throw new Error("Import identity was claimed by another customer");
      }
    }
    await tx.update(importStagingRowsTable)
      .set({ matchedEntityId: newId, status: "applied" })
      .where(eq(importStagingRowsTable.id, staging.id));
    await logChange({
      batchId,
      operation: "insert",
      entityType: "customer",
      entityId: newId,
      beforeJson: null,
      afterJson: { ...n, id: newId },
      executor: tx,
    });
    return "created";
  });
}

async function applyCustomerRow(
  batchId: number,
  staging: any,
  reviewAction?: string,
  issueType?: string,
  futureCustomerSafety = false,
  sourceSystem = "customer_factor",
): Promise<ApplyOutcome> {
  if (futureCustomerSafety) {
    return applyFutureSafeCustomerRow(batchId, staging, reviewAction, sourceSystem);
  }
  const n = JSON.parse(staging.normalized_data);
  const batchIdVal = batchId;

  // ── New owner at existing property ────────────────────────────────────────
  // matched_entity_id = propertyId (not a customer id). Create the new customer
  // account and link it to the existing property via property_account_relationships.
  if (issueType === "new_owner_at_property" && reviewAction === "accept_import") {
    const propertyId = staging.matched_entity_id;
    const starRating  = safeInt(n.starRating);
    const windowCount = safeInt(n.windowCount);

    const r = await db.execute(sql`
      INSERT INTO customers (
        first_name, last_name, company_name, salutation, email,
        home_phone, work_phone, cell_phone, fax, alt_phone, alt_contact,
        billing_address, billing_city, billing_state, billing_zip,
        notes, how_heard, star_rating, window_count, window_type,
        house_size, ladders_needed, sending_preferences,
        customer_date, status,
        import_source, import_external_id, import_batch_id, is_imported,
        last_seen_import_at, created_at, updated_at
      ) VALUES (
        ${n.firstName || null}, ${n.lastName || null}, ${n.companyName || null},
        ${n.salutation || null}, ${n.email || null},
        ${n.homePhone || null}, ${n.workPhone || null}, ${n.cellPhone || null},
        ${n.fax || null}, ${n.altPhone || null}, ${n.altContact || null},
        ${n.billingAddress || null}, ${n.billingCity || null}, ${n.billingState || null}, ${n.billingZip || null},
        ${n.notes || null}, ${n.howHeard || null}, ${starRating}, ${windowCount},
        ${n.windowType || null}, ${n.houseSize || null}, ${n.laddersNeeded || null},
        ${n.sendingPreferences || null}, ${n.customerDate || null}, 'active',
        'customer_factor', ${n.externalId || null}, ${batchIdVal}, true,
        NOW(), NOW(), NOW()
      ) RETURNING id
    `);
    const newCustomerId = (r.rows[0] as any).id;

    await logChange({
      batchId,
      operation: "insert",
      entityType: "customer",
      entityId: newCustomerId,
      beforeJson: null,
      afterJson: { ...n, id: newCustomerId },
    });

    // Update staging row so job rows can find the new customer id
    await db.execute(sql`
      UPDATE import_staging_rows SET matched_entity_id = ${newCustomerId}
      WHERE id = ${staging.id}
    `);

    if (propertyId) {
      // End prior owner's primary status at this property
      const today = new Date().toISOString().slice(0, 10);
      await db.execute(sql`
        UPDATE property_account_relationships
        SET is_primary = false, end_date = ${today}, updated_at = NOW()
        WHERE property_id = ${propertyId} AND is_primary = true AND end_date IS NULL
      `);

      // Link new customer as primary owner
      await db.execute(sql`
        INSERT INTO property_account_relationships
          (property_id, customer_id, relationship_type, is_primary, start_date, import_batch_id)
        VALUES (${propertyId}, ${newCustomerId}, 'owner', true, ${today}, ${batchIdVal})
      `);

      await logChange({
        batchId,
        operation: "insert",
        entityType: "property_account_relationship",
        entityId: newCustomerId,
        beforeJson: null,
        afterJson: { propertyId, customerId: newCustomerId, relationshipType: "owner", isPrimary: true, startDate: today },
      });
    }
    return "created";
  }

  if (staging.matched_entity_id && reviewAction !== "accept_import") {
    // Auto-approved update: fill blank CRM fields only
    const existing: any = (await db.execute(
      sql`SELECT * FROM customers WHERE id = ${staging.matched_entity_id} LIMIT 1`
    )).rows[0];
    if (!existing) return "skipped";

    const updates: string[] = [];
    const fill = (col: string, val: string) => {
      if (!val) return;
      if (!existing[col] || String(existing[col]).trim() === "") {
        updates.push(`${col} = '${val.replace(/'/g, "''")}'`);
      }
    };
    fill("first_name",      n.firstName);
    fill("last_name",       n.lastName);
    fill("client_type",     n.clientType || "residential");
    fill("email",           n.email);
    fill("home_phone",      n.homePhone);
    fill("work_phone",      n.workPhone);
    fill("cell_phone",      n.cellPhone);
    fill("billing_address", n.billingAddress);
    fill("billing_city",    n.billingCity);
    fill("billing_state",   n.billingState);
    fill("billing_zip",     n.billingZip);
    fill("how_heard",       n.howHeard);
    fill("window_count",    n.windowCount);
    fill("window_type",     n.windowType);
    fill("house_size",      n.houseSize);
    fill("ladders_needed",  n.laddersNeeded);
    fill("customer_date",   n.customerDate);
    fill("sending_preferences", n.sendingPreferences);

    if (updates.length === 0) return "updated";

    updates.push(
      `import_source = 'customer_factor'`,
      `import_external_id = COALESCE(import_external_id, '${(n.externalId || "").replace(/'/g, "''")}')`,
      `import_batch_id = ${batchIdVal}`,
      `is_imported = true`,
      `last_seen_import_at = NOW()`
    );

    await db.execute(sql.raw(
      `UPDATE customers SET ${updates.join(", ")}, updated_at = NOW() WHERE id = ${staging.matched_entity_id}`
    ));

    await logChange({
      batchId,
      operation: "update",
      entityType: "customer",
      entityId: staging.matched_entity_id,
      beforeJson: existing,
      afterJson: { ...existing, ...Object.fromEntries(updates.map(u => u.split(" = "))) },
    });
    return "updated";
  }

  if (staging.matched_entity_id && reviewAction === "merge") {
    // Merge: fill blank CRM fields only (same as auto-approved) + intelligently append notes
    const existing: any = (await db.execute(
      sql`SELECT * FROM customers WHERE id = ${staging.matched_entity_id} LIMIT 1`
    )).rows[0];
    if (!existing) return "skipped";

    const updates: string[] = [];
    const fill = (col: string, val: string) => {
      if (!val) return;
      if (!existing[col] || String(existing[col]).trim() === "") {
        updates.push(`${col} = '${val.replace(/'/g, "''")}'`);
      }
    };
    fill("first_name",      n.firstName);
    fill("last_name",       n.lastName);
    fill("client_type",     n.clientType || "residential");
    fill("email",           n.email);
    fill("home_phone",      n.homePhone);
    fill("work_phone",      n.workPhone);
    fill("cell_phone",      n.cellPhone);
    fill("billing_address", n.billingAddress);
    fill("billing_city",    n.billingCity);
    fill("billing_state",   n.billingState);
    fill("billing_zip",     n.billingZip);
    fill("how_heard",       n.howHeard);
    fill("window_count",    n.windowCount);
    fill("window_type",     n.windowType);
    fill("house_size",      n.houseSize);
    fill("ladders_needed",  n.laddersNeeded);
    fill("customer_date",   n.customerDate);
    fill("sending_preferences", n.sendingPreferences);

    if (n.notes && n.notes.trim()) {
      const existingNotes = String(existing.notes || "").trim();
      const importNotes   = n.notes.trim();
      if (!existingNotes) {
        updates.push(`notes = '${importNotes.replace(/'/g, "''")}'`);
      } else if (!existingNotes.includes(importNotes.slice(0, 40))) {
        const combined = `${existingNotes}\n\n--- Imported ---\n${importNotes}`;
        updates.push(`notes = '${combined.replace(/'/g, "''")}'`);
      }
    }

    if (updates.length > 0) {
      updates.push(
        `import_source = 'customer_factor'`,
        `import_external_id = COALESCE(import_external_id, '${(n.externalId || "").replace(/'/g, "''")}')`,
        `import_batch_id = ${batchId}`,
        `is_imported = true`,
        `last_seen_import_at = NOW()`
      );
      await db.execute(sql.raw(
        `UPDATE customers SET ${updates.join(", ")}, updated_at = NOW() WHERE id = ${staging.matched_entity_id}`
      ));
    }

    await logChange({
      batchId,
      operation: "update",
      entityType: "customer",
      entityId: staging.matched_entity_id,
      beforeJson: existing,
      afterJson: { ...existing, ...Object.fromEntries(updates.map(u => { const [k, ...v] = u.split(" = "); return [k, v.join(" = ")]; })) },
    });
    return "updated";
  }

  if (staging.matched_entity_id && reviewAction === "accept_import"
      && issueType !== "new_record"
      && issueType !== "weak_match"
      && issueType !== "identity_conflict"
      && issueType !== "name_mismatch"
      && issueType !== "exact_match") {
    // User chose to replace — apply proposed data over existing (COALESCE = non-empty import wins)
    const existing: any = (await db.execute(
      sql`SELECT * FROM customers WHERE id = ${staging.matched_entity_id} LIMIT 1`
    )).rows[0];
    if (!existing) return "skipped";

    const starRating = safeInt(n.starRating);
    const windowCount = safeInt(n.windowCount);

    await db.execute(sql`
      UPDATE customers SET
        first_name = COALESCE(NULLIF(${n.firstName}, ''), first_name),
        last_name  = COALESCE(NULLIF(${n.lastName},  ''), last_name),
        email      = COALESCE(NULLIF(${n.email || null}, ''), email),
        home_phone = COALESCE(NULLIF(${n.homePhone || null}, ''), home_phone),
        work_phone = COALESCE(NULLIF(${n.workPhone || null}, ''), work_phone),
        cell_phone = COALESCE(NULLIF(${n.cellPhone || null}, ''), cell_phone),
        billing_address = COALESCE(NULLIF(${n.billingAddress || null}, ''), billing_address),
        billing_city    = COALESCE(NULLIF(${n.billingCity    || null}, ''), billing_city),
        billing_state   = COALESCE(NULLIF(${n.billingState   || null}, ''), billing_state),
        billing_zip     = COALESCE(NULLIF(${n.billingZip     || null}, ''), billing_zip),
        import_source = 'customer_factor',
        import_external_id = COALESCE(import_external_id, ${n.externalId || null}),
        import_batch_id = ${batchIdVal},
        is_imported = true,
        last_seen_import_at = NOW(),
        updated_at = NOW()
      WHERE id = ${staging.matched_entity_id}
    `);

    await logChange({
      batchId,
      operation: "update",
      entityType: "customer",
      entityId: staging.matched_entity_id,
      beforeJson: existing,
      afterJson: n,
    });
    return "updated";
  }

  // New customer — insert
  const starRating  = safeInt(n.starRating);
  const windowCount = safeInt(n.windowCount);

  const r = await db.execute(sql`
    INSERT INTO customers (
      first_name, last_name, company_name, salutation, email,
      home_phone, work_phone, cell_phone, fax, alt_phone, alt_contact,
      billing_address, billing_city, billing_state, billing_zip,
      notes, how_heard, star_rating, window_count, window_type,
      house_size, ladders_needed, sending_preferences,
      customer_date, status, client_type,
      import_source, import_external_id, import_batch_id, is_imported,
      last_seen_import_at, created_at, updated_at
    ) VALUES (
      ${n.firstName || null}, ${n.lastName || null}, ${n.companyName || null},
      ${n.salutation || null}, ${n.email || null},
      ${n.homePhone || null}, ${n.workPhone || null}, ${n.cellPhone || null},
      ${n.fax || null}, ${n.altPhone || null}, ${n.altContact || null},
      ${n.billingAddress || null}, ${n.billingCity || null}, ${n.billingState || null}, ${n.billingZip || null},
      ${n.notes || null}, ${n.howHeard || null}, ${starRating}, ${windowCount},
      ${n.windowType || null}, ${n.houseSize || null}, ${n.laddersNeeded || null},
      ${n.sendingPreferences || null}, ${n.customerDate || null}, 'active',
      ${n.clientType || "residential"},
      'customer_factor', ${n.externalId || null}, ${batchIdVal}, true,
      NOW(), NOW(), NOW()
    ) RETURNING id
  `);
  const newId = (r.rows[0] as any).id;

  await logChange({
    batchId,
    operation: "insert",
    entityType: "customer",
    entityId: newId,
    beforeJson: null,
    afterJson: { ...n, id: newId },
  });

  await db.execute(sql`
    UPDATE import_staging_rows SET matched_entity_id = ${newId}
    WHERE id = ${staging.id}
  `);
  return "created";
}

// ─── Apply a lead staging row ──────────────────────────────────────────────────

async function applyLeadRow(batchId: number, staging: any, reviewAction?: string) {
  const n = JSON.parse(staging.normalized_data);

  if (!staging.matched_entity_id || reviewAction === "new_record") {
    // New lead
    const r = await db.execute(sql`
      INSERT INTO leads (
        first_name, last_name, email, phone, source, status, notes,
        address, city, state, zip,
        client_type,
        import_source, import_external_id, import_batch_id, is_imported,
        last_seen_import_at, created_at, updated_at
      ) VALUES (
        ${n.firstName || null}, ${n.lastName || null}, ${n.email || null},
        ${n.homePhone || null}, ${n.howHeard || null}, 'new', ${n.notes || null},
        ${n.billingAddress || null}, ${n.billingCity || null},
        ${n.billingState || null}, ${n.billingZip || null},
        'residential',
        'customer_factor', ${n.externalId || null}, ${batchId}, true,
        NOW(), NOW(), NOW()
      ) RETURNING id
    `);
    const newId = (r.rows[0] as any).id;
    await logChange({ batchId, operation: "insert", entityType: "lead", entityId: newId, beforeJson: null, afterJson: n });
  }
  // If matched lead: fill blanks only (same pattern as customer)
}

// ─── Apply a job staging row ───────────────────────────────────────────────────

async function applyJobRow(batchId: number, staging: any, reviewAction?: string) {
  const n = JSON.parse(staging.normalized_data);
  const temporal = validateImportJobTemporalValues(n);
  n.scheduledDate = temporal.scheduledDate;

  // Resolve customerId — look up by externalId if needed
  let customerId: number = n.customerId;
  if (!customerId && staging.external_id) {
    // The staging row's matched_entity_id for the customer row
    const cr = await db.execute(sql`
      SELECT matched_entity_id FROM import_staging_rows
      WHERE batch_id = ${batchId} AND entity_type = 'customer' AND external_id = ${staging.external_id}
        AND matched_entity_id IS NOT NULL
      LIMIT 1
    `);
    if ((cr.rows as any[]).length) {
      customerId = (cr.rows[0] as any).matched_entity_id;
    }
  }
  if (!customerId) return; // Cannot associate job without customer

  if (staging.matched_entity_id && reviewAction !== "accept_import") {
    // Duplicate job — mark as hidden + suspected duplicate
    const existing: any = (await db.execute(
      sql`SELECT * FROM jobs WHERE id = ${staging.matched_entity_id} LIMIT 1`
    )).rows[0];
    await db.execute(sql`
      UPDATE jobs SET
        is_hidden = true, is_suspected_duplicate = true, is_imported = true,
        import_source = 'customer_factor', import_batch_id = ${batchId},
        last_import_fingerprint = ${staging.fingerprint || null},
        updated_at = NOW()
      WHERE id = ${staging.matched_entity_id}
    `);
    await logChange({ batchId, operation: "hide", entityType: "job", entityId: staging.matched_entity_id, beforeJson: existing, afterJson: { is_hidden: true } });
    return;
  }

  const amount = parseAmount(n.totalAmount);
  const jobNum = n.jobNumber
    ? n.jobNumber
    : `IMP-${batchId}-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;

  const combinedNotes = [n.notes, n.techNotes].filter(Boolean).join("\n").trim() || null;
  const lineItems = n.lineItems || null;

  const r = await db.execute(sql`
    INSERT INTO jobs (
      customer_id, job_number, status, service_type,
      scheduled_date, total_amount, notes, line_items, is_imported,
      import_source, import_external_id, import_batch_id,
      last_import_fingerprint, created_at, updated_at
    ) VALUES (
      ${customerId}, ${jobNum}, ${n.status || 'completed'},
      ${n.serviceType || null}, ${n.scheduledDate || null},
      ${amount}, ${combinedNotes}, ${lineItems},
      true, 'customer_factor', ${staging.external_id || null}, ${batchId},
      ${staging.fingerprint || null}, NOW(), NOW()
    ) RETURNING id
  `);
  const newId = (r.rows[0] as any).id;
  await logChange({ batchId, operation: "insert", entityType: "job", entityId: newId, beforeJson: null, afterJson: { ...n, id: newId } });
}

// ─── Apply an invoice staging row ─────────────────────────────────────────────
//
// matched_entity_id is set only when a duplicate invoice was found (field_conflict).
// crmCustomerId in normalizedData is the resolved CRM customer id (may be null for
// unmatched_invoice rows that the reviewer chose to accept anyway).

async function applyInvoiceRow(batchId: number, staging: any, reviewAction?: string, issueType?: string) {
  const n = JSON.parse(staging.normalized_data);
  if (!n.invoiceNumber) return;

  // ── Duplicate invoice (field_conflict) ────────────────────────────────────
  const existing = staging.matched_entity_id
    ? (await db.execute(sql`SELECT * FROM invoices WHERE id = ${staging.matched_entity_id} LIMIT 1`)).rows[0] as any
    : null;

  if (existing && reviewAction !== "accept_import") return; // keep existing unless reviewer explicitly accepts

  const total   = parseAmount(n.totalAmount || n.amount);
  const paid    = parseAmount(n.amountPaid);
  const tax     = parseAmount(n.taxAmount);
  const discount = parseAmount(n.discount);
  const lateFee  = parseAmount(n.lateFee);
  const balance  = n.balanceDue ? parseAmount(n.balanceDue) : (total - paid);
  const invoiceStatus = balance <= 0 && paid > 0 ? "paid" : (n.status && n.status !== "draft" ? n.status : "sent");

  if (existing) {
    await db.execute(sql`
      UPDATE invoices SET
        status       = ${invoiceStatus},
        total_amount = ${total},
        amount_paid  = ${paid},
        balance_due  = ${balance},
        is_imported  = true,
        import_source     = 'customer_factor',
        import_batch_id   = ${batchId},
        last_import_fingerprint = ${n.invoiceNumber},
        updated_at   = NOW()
      WHERE id = ${existing.id}
    `);
    await logChange({ batchId, operation: "update", entityType: "invoice", entityId: existing.id, beforeJson: existing, afterJson: n });
    return;
  }

  // ── New invoice ────────────────────────────────────────────────────────────
  // For unmatched_invoice rows: if reviewer skips/rejects, do not apply.
  // If reviewer accepts (or it is auto_approved), insert with whatever customer we have.
  if (issueType === "unmatched_invoice" && reviewAction !== "accept_import") return;

  // Resolve customer_id: prefer explicit crmCustomerId set during staging.
  // If it was null during staging (customer hadn't been imported yet), try again
  // now — customers are always applied before invoices, so import_external_id
  // should be populated by this point.
  let customerId: number | null = n.crmCustomerId ?? staging.matched_entity_id ?? null;

  if (!customerId && n.customerId) {
    const cr = await db.execute(sql`
      SELECT id FROM customers
      WHERE import_external_id = ${String(n.customerId).trim()}
      LIMIT 1
    `);
    if ((cr.rows as any[]).length) customerId = (cr.rows[0] as any).id;
    if (!customerId) {
      const sr = await db.execute(sql`
        SELECT matched_entity_id FROM import_staging_rows
        WHERE entity_type = 'customer' AND external_id = ${String(n.customerId).trim()}
          AND matched_entity_id IS NOT NULL
        ORDER BY id DESC LIMIT 1
      `);
      if ((sr.rows as any[]).length) customerId = (sr.rows[0] as any).matched_entity_id;
    }
  }

  const r = await db.execute(sql`
    INSERT INTO invoices (
      customer_id, invoice_number, status, subtotal, tax_amount,
      total_amount, amount_paid, balance_due, due_date, notes,
      is_imported, import_source, import_external_id, import_batch_id,
      last_import_fingerprint, created_at, updated_at
    ) VALUES (
      ${customerId}, ${n.invoiceNumber}, ${invoiceStatus},
      ${total}, ${tax}, ${total}, ${paid}, ${balance},
      ${n.dueDate || n.invoiceDate || null}, ${n.notes || null},
      true, 'customer_factor', ${n.invoiceNumber}, ${batchId},
      ${n.invoiceNumber}, NOW(), NOW()
    ) RETURNING id
  `);
  const newId = (r.rows[0] as any).id;
  await logChange({ batchId, operation: "insert", entityType: "invoice", entityId: newId, beforeJson: null, afterJson: { ...n, customer_id: customerId } });
}

// ─── Apply a property staging row ─────────────────────────────────────────────
//
// reviewAction "accept_import"   → INSERT a new property record for the customer.
// reviewAction "replace_billing" → UPDATE the customer's billing address fields.

async function applyPropertyRow(batchId: number, staging: any, reviewAction: string) {
  const n = typeof staging.normalized_data === "string"
    ? JSON.parse(staging.normalized_data)
    : staging.normalized_data;

  const customerId = Number(n.customerId ?? staging.matched_entity_id);
  if (!customerId) return;

  if (reviewAction === "accept_import") {
    const normAddr = (n.address || "").trim().toLowerCase();
    const normCity = (n.city || "").trim().toLowerCase();
    const normZip  = (n.zip || "").trim();
    const existing = normAddr ? (await db.execute(sql`
      SELECT id FROM properties
      WHERE customer_id = ${customerId}
        AND LOWER(TRIM(address)) = ${normAddr}
        AND LOWER(TRIM(city)) = ${normCity}
        AND TRIM(zip) = ${normZip}
      LIMIT 1
    `)).rows : [];

    if ((existing as any[]).length > 0) {
      const existingId = (existing[0] as any).id;
      await db.execute(sql`
        UPDATE properties SET last_seen_import_at = NOW(), updated_at = NOW()
        WHERE id = ${existingId}
      `);
      await logChange({
        batchId,
        operation: "skip_duplicate",
        entityType: "property",
        entityId: existingId,
        beforeJson: null,
        afterJson: { ...n, reason: "duplicate_address" },
      });
    } else {
      const r = await db.execute(sql`
        INSERT INTO properties
          (customer_id, address, city, state, zip, property_type,
           is_primary, is_billing_address,
           import_source, import_batch_id, is_imported, last_seen_import_at,
           created_at, updated_at)
        VALUES
          (${customerId}, ${n.address || ""}, ${n.city || ""}, ${n.state || ""}, ${n.zip || ""},
           'residential', false, false,
           'customer_factor', ${batchId}, true, NOW(),
           NOW(), NOW())
        RETURNING id
      `);
      const newId = (r.rows[0] as any).id;
      await logChange({
        batchId,
        operation: "insert",
        entityType: "property",
        entityId: newId,
        beforeJson: null,
        afterJson: n,
      });
    }

  } else if (reviewAction === "replace_billing") {
    // Overwrite the customer's billing address
    const existing: any = (await db.execute(
      sql`SELECT * FROM customers WHERE id = ${customerId} LIMIT 1`
    )).rows[0];
    if (!existing) return;

    await db.execute(sql`
      UPDATE customers SET
        billing_address = ${n.address   || null},
        billing_city    = ${n.city      || null},
        billing_state   = ${n.state     || null},
        billing_zip     = ${n.zip       || null},
        updated_at      = NOW()
      WHERE id = ${customerId}
    `);

    await logChange({
      batchId,
      operation: "update",
      entityType: "customer",
      entityId: customerId,
      beforeJson: existing,
      afterJson: {
        billing_address: n.address,
        billing_city:    n.city,
        billing_state:   n.state,
        billing_zip:     n.zip,
      },
    });
  }
}

// ─── Main apply entry point ────────────────────────────────────────────────────

export async function applyBatch(batchId: number): Promise<{
  applied: number;
  customersCreated: number;
  customersUpdated: number;
  jobsCreated: number;
  skippedDuplicateCustomers: number;
  errors: string[];
}> {
  let applied = 0;
  let customersCreated = 0;
  let customersUpdated = 0;
  let jobsCreated = 0;
  let skippedDuplicateCustomers = 0;
  const errors: string[] = [];
  const batchMeta = (await db.execute(sql`
    SELECT source_system, safety_version
    FROM import_batches
    WHERE id = ${batchId}
    LIMIT 1
  `)).rows[0] as any;
  const futureCustomerSafety = Number(batchMeta?.safety_version ?? 0) >= 1;
  const sourceSystem = String(batchMeta?.source_system ?? "customer_factor").trim() || "customer_factor";

  // ── SAFETY GUARD: count unique customers + jobs before writing ─────────
  const preCheck = await db.execute(sql`
    SELECT
      COUNT(DISTINCT COALESCE(NULLIF(external_id, ''), 'row:' || id::text)) FILTER (
        WHERE entity_type IN ('customer','lead')
          AND (status = 'auto_approved' OR id IN (
            SELECT staging_row_id FROM import_review_queue
            WHERE batch_id = ${batchId} AND action IN ('accept_import','merge')
          ))
      )::int AS unique_customers,
      COUNT(*) FILTER (
        WHERE entity_type = 'job'
          AND (status = 'auto_approved' OR id IN (
            SELECT staging_row_id FROM import_review_queue
            WHERE batch_id = ${batchId} AND action = 'accept_import'
          ))
      )::int AS total_jobs,
      COUNT(*) FILTER (
        WHERE status = 'auto_approved' OR id IN (
          SELECT staging_row_id FROM import_review_queue
          WHERE batch_id = ${batchId} AND action IN ('accept_import','merge','replace_billing')
        )
      )::int AS total_writes
    FROM import_staging_rows
    WHERE batch_id = ${batchId}
  `);

  const pre = preCheck.rows[0] as any;
  const uniqueCustomers = Number(pre.unique_customers ?? 0);
  const totalJobs = Number(pre.total_jobs ?? 0);
  const totalWrites = Number(pre.total_writes ?? 0);

  console.log(`[Apply] batch=${batchId} pre-check: ${uniqueCustomers} unique customers, ${totalJobs} jobs, ${totalWrites} total writes`);

  if (totalWrites > Math.max(uniqueCustomers * 5, 10000)) {
    throw new Error(
      `Abnormal record count detected. Apply halted. ` +
      `Expected ~${uniqueCustomers} customers + ${totalJobs} jobs but found ${totalWrites} total write candidates. ` +
      `This suggests duplicate staging rows. Please reset staging and re-upload.`
    );
  }

  // Mark batch as applying
  await db.execute(sql`UPDATE import_batches SET status = 'applying', updated_at = NOW() WHERE id = ${batchId}`);

  // Track which external_ids have already been applied (dedup guard)
  const appliedExternalIds = new Set<string>();

  try {
    // 1. Get auto-approved staging rows
    const autoRows = await db.execute(sql`
      SELECT * FROM import_staging_rows
      WHERE batch_id = ${batchId} AND status = 'auto_approved'
      ORDER BY entity_type, id
    `);

    // Process in order: customers first, then leads, then jobs, then invoices, then properties
    const ordered = (autoRows.rows as any[]).sort((a, b) => {
      const order: Record<string, number> = { customer: 0, lead: 1, job: 2, invoice: 3, property: 4 };
      return (order[a.entity_type] ?? 9) - (order[b.entity_type] ?? 9);
    });

    for (const row of ordered) {
      try {
        // Dedup: skip customer rows with an already-applied external_id
        if ((row.entity_type === "customer" || row.entity_type === "lead") && row.external_id) {
          if (appliedExternalIds.has(row.external_id)) {
            await db.execute(sql`
              UPDATE import_staging_rows SET status = 'applied', error_message = 'dedup: already applied in this batch'
              WHERE id = ${row.id}
            `);
            skippedDuplicateCustomers++;
            continue;
          }
          appliedExternalIds.add(row.external_id);
        }

        switch (row.entity_type) {
          case "customer": {
            const outcome = await applyCustomerRow(batchId, row, undefined, undefined, futureCustomerSafety, sourceSystem);
            if (outcome === "created") customersCreated++; else if (outcome === "updated") customersUpdated++;
            break;
          }
          case "lead":     await applyLeadRow(batchId, row);     customersCreated++; break;
          case "job":      await applyJobRow(batchId, row);      jobsCreated++;      break;
          case "invoice":  await applyInvoiceRow(batchId, row);                      break;
          case "property": await applyPropertyRow(batchId, row, "accept_import");    break;
        }
        await db.execute(sql`UPDATE import_staging_rows SET status = 'applied' WHERE id = ${row.id}`);
        applied++;
      } catch (err) {
        const errMsg = (err as Error).message || String(err);
        const shortErr = errMsg.length > 300 ? errMsg.slice(0, 150) + " ... " + errMsg.slice(-150) : errMsg;
        errors.push(`[auto] ${row.entity_type} stagingRow#${row.id}: ${shortErr.slice(0, 200)}`);
        await db.execute(sql`
          UPDATE import_staging_rows SET status = 'error', error_message = ${shortErr.slice(0, 500)}
          WHERE id = ${row.id}
        `);
      }
    }

    // 2. Get review queue items where user chose accept_import
    const accepted = await db.execute(sql`
      SELECT rq.*, sr.normalized_data, sr.entity_type AS sr_entity_type,
             sr.matched_entity_id, sr.external_id, sr.fingerprint, sr.id AS staging_row_id_val
      FROM import_review_queue rq
      JOIN import_staging_rows sr ON sr.id = rq.staging_row_id
      WHERE rq.batch_id = ${batchId} AND rq.action = 'accept_import'
      ORDER BY rq.entity_type, rq.id
    `);

    for (const item of (accepted.rows as any[])) {
      try {
        const entityType = item.entity_type || item.sr_entity_type;
        // Dedup customer writes by external_id
        if ((entityType === "customer" || entityType === "lead") && item.external_id) {
          if (appliedExternalIds.has(item.external_id)) {
            await db.execute(sql`
              UPDATE import_staging_rows SET status = 'applied', error_message = 'dedup: already applied in this batch'
              WHERE id = ${item.staging_row_id_val}
            `);
            skippedDuplicateCustomers++;
            continue;
          }
          appliedExternalIds.add(item.external_id);
        }

        const staging = {
          id: item.staging_row_id_val,
          entity_type: entityType,
          normalized_data: item.normalized_data,
          matched_entity_id: item.matched_entity_id,
          external_id: item.external_id,
          fingerprint: item.fingerprint,
        review_notes: item.notes,
        };
        switch (entityType) {
          case "customer": {
            const outcome = await applyCustomerRow(batchId, staging, "accept_import", item.issue_type, futureCustomerSafety, sourceSystem);
            if (outcome === "created") customersCreated++; else if (outcome === "updated") customersUpdated++;
            break;
          }
          case "lead":     await applyLeadRow(batchId, staging, "accept_import");                      customersCreated++; break;
          case "job":      await applyJobRow(batchId, staging, "accept_import");                       jobsCreated++;      break;
          case "invoice":  await applyInvoiceRow(batchId, staging, "accept_import", item.issue_type);                      break;
          case "property": await applyPropertyRow(batchId, staging, "accept_import");                                      break;
        }
        await db.execute(sql`UPDATE import_staging_rows SET status = 'applied' WHERE id = ${staging.id}`);
        applied++;
      } catch (err) {
        errors.push(`[review] ${item.entity_type} reviewItem#${item.id}: ${(err as Error).message.slice(0, 100)}`);
      }
    }

    // 2b. Handle merge decisions — fill blank fields + append notes, no overwrites
    const merged = await db.execute(sql`
      SELECT rq.*, sr.normalized_data, sr.entity_type AS sr_entity_type,
             sr.matched_entity_id, sr.external_id, sr.fingerprint, sr.id AS staging_row_id_val
      FROM import_review_queue rq
      JOIN import_staging_rows sr ON sr.id = rq.staging_row_id
      WHERE rq.batch_id = ${batchId} AND rq.action = 'merge'
      ORDER BY rq.entity_type, rq.id
    `);

    for (const item of (merged.rows as any[])) {
      try {
        const entityType = item.entity_type || item.sr_entity_type;
        // Dedup customer merges by external_id
        if ((entityType === "customer" || entityType === "lead") && item.external_id) {
          if (appliedExternalIds.has(item.external_id)) {
            await db.execute(sql`
              UPDATE import_staging_rows SET status = 'applied', error_message = 'dedup: already applied in this batch'
              WHERE id = ${item.staging_row_id_val}
            `);
            skippedDuplicateCustomers++;
            continue;
          }
          appliedExternalIds.add(item.external_id);
        }

        const staging = {
          id: item.staging_row_id_val,
          entity_type: entityType,
          normalized_data: item.normalized_data,
          matched_entity_id: item.matched_entity_id,
          external_id: item.external_id,
          fingerprint: item.fingerprint,
        review_notes: item.notes,
        };
        const outcome = await applyCustomerRow(
          batchId,
          staging,
          entityType === "customer" ? "merge" : "accept_import",
          undefined,
          futureCustomerSafety,
          sourceSystem,
        );
        if (outcome === "created") customersCreated++; else if (outcome === "updated") customersUpdated++;
        await db.execute(sql`UPDATE import_staging_rows SET status = 'applied' WHERE id = ${staging.id}`);
        applied++;
      } catch (err) {
        errors.push(`[merge] ${item.entity_type} reviewItem#${item.id}: ${(err as Error).message.slice(0, 100)}`);
      }
    }

    // 2c. Future-safe contact decisions: link provenance only or create
    // separately with a sanitized reason. Both paths recheck candidates inside
    // their final transaction; client candidate counts are never trusted.
    const futureDecisions = await db.execute(sql`
      SELECT rq.*, sr.normalized_data, sr.entity_type AS sr_entity_type,
             sr.matched_entity_id, sr.external_id, sr.fingerprint, sr.id AS staging_row_id_val
      FROM import_review_queue rq
      JOIN import_staging_rows sr ON sr.id = rq.staging_row_id
      WHERE rq.batch_id = ${batchId}
        AND rq.action IN ('link_existing', 'create_separate')
        AND rq.issue_type = 'contact_duplicate'
      ORDER BY rq.id
    `);

    for (const item of (futureDecisions.rows as any[])) {
      try {
        const staging = {
          id: item.staging_row_id_val,
          entity_type: item.entity_type || item.sr_entity_type,
          normalized_data: item.normalized_data,
          matched_entity_id: item.matched_entity_id,
          external_id: item.external_id,
          fingerprint: item.fingerprint,
          review_notes: item.notes,
        };
        const outcome = await applyCustomerRow(
          batchId,
          staging,
          item.action,
          "contact_duplicate",
          futureCustomerSafety,
          sourceSystem,
        );
        if (outcome === "created") customersCreated++;
        else if (outcome === "updated") customersUpdated++;
        else skippedDuplicateCustomers++;
        await db.execute(sql`UPDATE import_staging_rows SET status = 'applied' WHERE id = ${staging.id}`);
        applied++;
      } catch (err) {
        errors.push(`[contact-duplicate] reviewItem#${item.id}: ${(err as Error).message.slice(0, 100)}`);
      }
    }

    // 2d. Handle replace_billing decisions (new property → replace customer billing address)
    const replaceBilling = await db.execute(sql`
      SELECT rq.*, sr.normalized_data, sr.matched_entity_id, sr.id AS staging_row_id_val
      FROM import_review_queue rq
      JOIN import_staging_rows sr ON sr.id = rq.staging_row_id
      WHERE rq.batch_id = ${batchId} AND rq.action = 'replace_billing'
    `);

    for (const item of (replaceBilling.rows as any[])) {
      try {
        const staging = {
          id: item.staging_row_id_val,
          normalized_data: item.normalized_data,
          matched_entity_id: item.matched_entity_id,
        };
        await applyPropertyRow(batchId, staging, "replace_billing");
        await db.execute(sql`UPDATE import_staging_rows SET status = 'applied' WHERE id = ${staging.id}`);
        applied++;
      } catch (err) {
        errors.push(`[replace_billing] reviewItem#${item.id}: ${(err as Error).message.slice(0, 100)}`);
      }
    }

    // 3. Mark ignored review items
    await db.execute(sql`
      UPDATE import_staging_rows SET status = 'ignored'
      WHERE batch_id = ${batchId}
        AND id IN (
          SELECT staging_row_id FROM import_review_queue
          WHERE batch_id = ${batchId} AND action = 'ignore'
        )
    `);

    // 4. Mark batch applied
    await db.execute(sql`
      UPDATE import_batches SET
        status = 'applied',
        applied_count = ${applied},
        applied_at = NOW(),
        updated_at = NOW()
      WHERE id = ${batchId}
    `);

    console.log(
      `[Apply] batch=${batchId} COMPLETE: ` +
      `${customersCreated} customers created, ${customersUpdated} customers updated, ` +
      `${jobsCreated} jobs created, ${skippedDuplicateCustomers} dedup-skipped, ` +
      `${applied} total applied, ${errors.length} errors`
    );

    await db.execute(sql`
      INSERT INTO activity_logs (entity_type, entity_id, action, to_value, performed_by)
      VALUES ('import_batch', ${batchId}, 'batch_applied',
              ${JSON.stringify({ applied, customersCreated, customersUpdated, jobsCreated, skippedDuplicateCustomers })},
              'system')
    `);

  } catch (err) {
    await db.execute(sql`UPDATE import_batches SET status = 'error', updated_at = NOW() WHERE id = ${batchId}`);
    throw err;
  }

  return { applied, customersCreated, customersUpdated, jobsCreated, skippedDuplicateCustomers, errors };
}
