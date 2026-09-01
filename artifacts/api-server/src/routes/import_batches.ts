import { Router } from "express";
import express from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getSession, getSessionId } from "../lib/auth";
import { refreshBatchCounters, type FileGroup } from "../services/import/staging";
import { runFileStaging } from "../services/import/staging-worker";
import { applyBatch } from "../services/import/applier";
import { rollbackBatch } from "../services/import/rollback";
import { logger } from "../lib/logger";
import { normalizeCustomerRow } from "../services/import/normalizer";
import {
  normalizeImportIdentity,
  previewCustomerImportRows,
} from "../services/import/customer-import-safety";
import { sanitizeConversionReason } from "../lib/lead-duplicate-candidates.ts";

const router = Router();
const jsonBig = express.json({ limit: "100mb" });

// Wraps async route handlers so thrown errors are forwarded to the global JSON error handler
const wrap = (fn: (req: any, res: any, next: any) => Promise<any>) =>
  (req: any, res: any, next: any) => fn(req, res, next).catch(next);

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function requireSuperAdmin(req: any, res: any, next: any) {
  // Prefer req.user already populated by authMiddleware (avoids extra DB round-trip
  // and survives OIDC token refresh failures that previously cleared the session).
  let user = req.user;

  if (!user) {
    // Fallback: read session directly (handles cases where authMiddleware did not populate req.user)
    const sid = getSessionId(req);
    if (!sid) return res.status(401).json({ error: "Unauthorized" });
    const session = await getSession(sid);
    user = session?.user;
    if (!user) return res.status(401).json({ error: "Unauthorized — session expired mid-upload. Please sign in again." });
    req.user = user;
  }

  if (user.role !== "super_admin") return res.status(403).json({ error: "Forbidden: Super Admin only" });
  next();
}

// ─── List all batches ─────────────────────────────────────────────────────────

router.get("/admin/import/batches", requireSuperAdmin, wrap(async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT b.*,
      (SELECT COUNT(*) FROM import_files WHERE batch_id = b.id) AS file_count_actual
    FROM import_batches b
    ORDER BY b.created_at DESC
    LIMIT 50
  `);
  return res.json(rows.rows);
}));

// ─── Create a new batch ───────────────────────────────────────────────────────

router.post("/admin/import/batches", requireSuperAdmin, jsonBig, wrap(async (req: any, res) => {
  const { name, sourceSystem } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Batch name is required" });
  const normalizedSourceSystem = normalizeImportIdentity(sourceSystem || "customer_factor");
  if (!normalizedSourceSystem) return res.status(400).json({ error: "sourceSystem is required" });

  const r = await db.execute(sql`
    INSERT INTO import_batches (name, source_system, safety_version, status, created_by)
    VALUES (${name.trim()}, ${normalizedSourceSystem}, 1, 'uploading', ${req.user?.email ?? 'admin'})
    RETURNING *
  `);
  return res.json(r.rows[0]);
}));

// ─── Read-only future customer import preview ──────────────────────────────────
// This endpoint deliberately performs no staging, review-queue, or live writes.
router.post("/admin/import/customer-preview", requireSuperAdmin, jsonBig, wrap(async (req: any, res) => {
  const sourceSystem = normalizeImportIdentity(req.body?.sourceSystem || "customer_factor");
  const rows = req.body?.rows;
  if (!sourceSystem) return res.status(400).json({ error: "sourceSystem is required" });
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "rows must be a non-empty array" });
  }
  if (rows.length > 5000) {
    return res.status(400).json({ error: "Preview is limited to 5,000 customer rows" });
  }

  const normalizedRows = rows.map((row: Record<string, string>) => normalizeCustomerRow(row));
  const previews = await previewCustomerImportRows(db, sourceSystem, normalizedRows);
  return res.json({
    sourceSystem,
    dryRun: true,
    persisted: false,
    rows: previews,
  });
}));

// ─── Get batch detail ─────────────────────────────────────────────────────────

router.get("/admin/import/batches/:id", requireSuperAdmin, wrap(async (req, res) => {
  const { id } = req.params;

  const batchRes = await db.execute(sql`SELECT * FROM import_batches WHERE id = ${Number(id)} LIMIT 1`);
  const batch = batchRes.rows[0];
  if (!batch) return res.status(404).json({ error: "Batch not found" });

  const filesRes = await db.execute(sql`
    SELECT * FROM import_files WHERE batch_id = ${Number(id)} ORDER BY created_at
  `);

  const counts = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status != 'skipped_duplicate')                       AS total_staged,
      COUNT(*) FILTER (WHERE entity_type IN ('customer','lead')
                         AND status != 'skipped_duplicate')                    AS customer_staged,
      COUNT(*) FILTER (WHERE status = 'skipped_duplicate')                     AS skipped_duplicates,
      COUNT(*) FILTER (WHERE entity_type = 'job')                               AS job_staged,
      COUNT(*) FILTER (WHERE entity_type = 'property')                          AS property_staged,
      COUNT(*) FILTER (WHERE status = 'auto_approved')                          AS auto_approved,
      COUNT(*) FILTER (WHERE status = 'auto_approved'
                         AND entity_type IN ('customer','lead'))                AS customer_auto_approved,
      COUNT(*) FILTER (WHERE status = 'auto_approved'
                         AND match_method = 'email_household')                  AS auto_merged_household,
      COUNT(*) FILTER (WHERE status = 'auto_approved'
                         AND match_method IN ('email_match', 'phone_match',
                                              'name_address', 'company_address',
                                              'soft_name_address'))              AS auto_merged_exact,
      COUNT(*) FILTER (WHERE status = 'auto_approved'
                         AND match_method = 'auto_created')                     AS auto_created_customer,
      COUNT(*) FILTER (WHERE status = 'auto_approved'
                         AND match_method = 'auto_added_property')              AS auto_added_property,
      COUNT(*) FILTER (WHERE status = 'review')                                 AS needs_review,
      COUNT(*) FILTER (WHERE status = 'review'
                         AND entity_type IN ('customer','lead'))                AS customer_needs_review,
      COUNT(*) FILTER (WHERE status = 'applied')                                AS applied,
      COUNT(*) FILTER (WHERE status = 'error')                                  AS errors,
      COUNT(*) FILTER (WHERE status = 'error'
                         AND entity_type IN ('customer','lead'))                AS customer_errors,
      COUNT(*) FILTER (WHERE status = 'ignored')                                AS ignored
    FROM import_staging_rows
    WHERE batch_id = ${Number(id)}
  `);

  const reviewCounts = await db.execute(sql`
    SELECT
      COUNT(*)                                                          AS total,
      COUNT(*) FILTER (WHERE action = 'pending')                        AS pending,
      COUNT(*) FILTER (WHERE action = 'keep_existing')                  AS keep_existing,
      COUNT(*) FILTER (WHERE action = 'accept_import')                  AS accept_import,
      COUNT(*) FILTER (WHERE action = 'replace_billing')                AS replace_billing,
      COUNT(*) FILTER (WHERE action = 'merge')                          AS merge,
      COUNT(*) FILTER (WHERE action = 'ignore')                         AS ignored
    FROM import_review_queue
    WHERE batch_id = ${Number(id)}
  `);

  // Per-issue-type breakdown (total + pending counts) — used by grouped review view
  const issueCounts = await db.execute(sql`
    SELECT
      issue_type,
      COUNT(*)                                        AS total,
      COUNT(*) FILTER (WHERE action = 'pending')      AS pending
    FROM import_review_queue
    WHERE batch_id = ${Number(id)}
    GROUP BY issue_type
    ORDER BY issue_type
  `);

  // Derived flag: true while any file is still being staged in the background.
  // The client uses this to show a processing banner and disable review/apply tabs.
  const isProcessing = (filesRes.rows as any[]).some(
    (f) => f.status === "queued" || f.status === "processing"
  );

  // Customer-only raw/skipped totals — scoped to customer/lead file groups only
  // so both sides of the accounting equation use the same scope.
  const customerFileGroups = ["active_customers", "master_customers", "active_prospects", "master_prospects", "sql_backup", "unknown"];
  const customerFiles = (filesRes.rows as any[]).filter(
    f => customerFileGroups.includes(f.file_group) || customerFileGroups.includes(f.detected_group)
  );
  const customerRawRows = customerFiles.reduce((s: number, f: any) => s + (Number(f.raw_row_count) || 0), 0);

  const sc = counts.rows[0] as any;
  const customerSkippedDupes = Number(sc.skipped_duplicates ?? 0);
  const customerStaged = Number(sc.customer_auto_approved ?? 0) + Number(sc.customer_needs_review ?? 0) + Number(sc.customer_errors ?? 0);
  const accountingSum = customerStaged + customerSkippedDupes;

  const applyCounts = await db.execute(sql`
    SELECT
      COUNT(DISTINCT COALESCE(NULLIF(external_id, ''), 'row:' || id::text)) FILTER (
        WHERE entity_type IN ('customer','lead')
          AND (status = 'auto_approved' OR id IN (
            SELECT staging_row_id FROM import_review_queue
            WHERE batch_id = ${Number(id)} AND action IN ('accept_import','merge')
          ))
      )::int AS unique_customers_to_apply,
      COUNT(*) FILTER (
        WHERE entity_type = 'job'
          AND (status = 'auto_approved' OR id IN (
            SELECT staging_row_id FROM import_review_queue
            WHERE batch_id = ${Number(id)} AND action = 'accept_import'
          ))
      )::int AS jobs_to_apply
    FROM import_staging_rows
    WHERE batch_id = ${Number(id)}
  `);

  const applyPreview = applyCounts.rows[0] as any;

  return res.json({
    batch,
    files: filesRes.rows,
    stagingCounts: counts.rows[0],
    reviewCounts: reviewCounts.rows[0],
    issueCounts: issueCounts.rows,
    isProcessing,
    applyPreview: {
      uniqueCustomers: Number(applyPreview?.unique_customers_to_apply ?? 0),
      jobsToCreate: Number(applyPreview?.jobs_to_apply ?? 0),
    },
    rowAccounting: {
      customerRawRows,
      customerSkippedDupes,
      customerAutoApproved: Number(sc.customer_auto_approved ?? 0),
      customerNeedsReview: Number(sc.customer_needs_review ?? 0),
      customerErrors: Number(sc.customer_errors ?? 0),
      customerStaged,
      accountingSum,
      match: customerRawRows > 0 && accountingSum === customerRawRows,
      jobStaged: Number(sc.job_staged ?? 0),
      propertyStaged: Number(sc.property_staged ?? 0),
    },
  });
}));

// ─── Upload & stage file rows ─────────────────────────────────────────────────
// Body: { fileName, fileType, fileGroup, rows: Record<string,string>[] }

router.post("/admin/import/batches/:id/files", requireSuperAdmin, jsonBig, wrap(async (req, res) => {
  const batchId = Number(req.params.id);
  if (isNaN(batchId)) return res.status(400).json({ error: "Invalid batch ID" });

  const { fileName, fileType, fileGroup, rows } = req.body as {
    fileName: string;
    fileType: string;
    fileGroup: FileGroup;
    rows: Record<string, string>[];
  };

  if (!fileName) return res.status(400).json({ error: "fileName is required" });
  if (!Array.isArray(rows)) return res.status(400).json({ error: "rows must be an array" });
  if (rows.length === 0) return res.status(400).json({ error: "rows array is empty — no CSV data was parsed from this file" });

  // Verify batch exists and is in uploading/staged/review state
  const batchRes = await db.execute(sql`SELECT * FROM import_batches WHERE id = ${batchId} LIMIT 1`);
  const batch = batchRes.rows[0] as any;
  if (!batch) return res.status(404).json({ error: "Batch not found" });
  if (batch.status === "applied" || batch.status === "applying") {
    return res.status(409).json({ error: "Cannot add files to an applied batch" });
  }

  // Insert file record and persist the raw rows for background processing.
  // We store the JSON now so the worker can read it even if the user navigates away.
  const fileRes = await db.execute(sql`
    INSERT INTO import_files (batch_id, original_name, file_type, file_group, detected_group,
                              status, raw_json_data)
    VALUES (${batchId}, ${fileName}, ${fileType || 'csv'}, ${fileGroup || 'unknown'},
            ${fileGroup || 'unknown'}, 'queued', ${JSON.stringify(rows)})
    RETURNING id
  `);
  const fileId = (fileRes.rows[0] as any).id;

  // Update batch file count immediately so the UI sees the file right away
  await db.execute(sql`
    UPDATE import_batches
    SET file_count = (SELECT COUNT(*) FROM import_files WHERE batch_id = ${batchId}),
        updated_at = NOW()
    WHERE id = ${batchId}
  `);

  // Fire background staging — no await.  The HTTP response returns immediately
  // (202 Accepted) while the server processes the rows asynchronously.
  // The client polls GET /batches/:id every 5 s and sees progress via file.status.
  runFileStaging(fileId, batchId, fileGroup).catch((err) =>
    console.error(`[import] Background staging failed for file ${fileId}:`, (err as Error).message)
  );

  return res.status(202).json({
    fileId,
    status: "queued",
    message: `${rows.length.toLocaleString()} rows successfully queued for processing`,
  });
}));

// ─── Update file group classification ─────────────────────────────────────────

router.patch("/admin/import/files/:fileId", requireSuperAdmin, jsonBig, wrap(async (req, res) => {
  const { fileId } = req.params;
  const { fileGroup } = req.body;

  if (!fileGroup) return res.status(400).json({ error: "fileGroup required" });

  await db.execute(sql`
    UPDATE import_files SET file_group = ${fileGroup}, updated_at = NOW()
    WHERE id = ${Number(fileId)}
  `);

  return res.json({ success: true });
}));

// ─── Get review queue (paginated) ─────────────────────────────────────────────

router.get("/admin/import/batches/:id/review", requireSuperAdmin, wrap(async (req, res) => {
  const batchId = Number(req.params.id);
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(5, Number(req.query.pageSize) || 25));
  const entityType = req.query.entityType as string | undefined;
  const action = req.query.action as string | undefined;
  const issueType = req.query.issueType as string | undefined;
  const search = (req.query.search as string || "").trim().toLowerCase();
  const offset = (page - 1) * pageSize;

  const validEntityTypes = ["customer", "lead", "job", "invoice", "property"];
  const validActions = ["pending", "keep_existing", "accept_import", "merge", "replace_billing", "ignore", "link_existing", "create_separate"];
  const validIssueTypes = ["exact_match", "household_match", "field_conflict", "new_record", "new_property_detected", "new_owner_at_property", "duplicate_job", "weak_match", "missing_identity", "identity_conflict"];

  const safeEntityType = entityType && validEntityTypes.includes(entityType) ? entityType : null;
  const safeAction = action && validActions.includes(action) ? action : null;
  const safeIssueType = issueType && validIssueTypes.includes(issueType) ? issueType : null;
  const pattern = search ? `%${search}%` : null;

  const countRes = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM import_review_queue rq
    LEFT JOIN import_staging_rows sr ON sr.id = rq.staging_row_id
    WHERE rq.batch_id = ${batchId}
      AND (${safeEntityType}::text IS NULL OR rq.entity_type = ${safeEntityType})
      AND (${safeAction}::text IS NULL OR rq.action = ${safeAction})
      AND (${safeIssueType}::text IS NULL OR rq.issue_type = ${safeIssueType})
      AND (${pattern}::text IS NULL OR (
        LOWER(rq.proposed_data::text) LIKE ${pattern ?? ''}
        OR LOWER(COALESCE(rq.current_data::text, '')) LIKE ${pattern ?? ''}
        OR LOWER(COALESCE(sr.external_id, '')) LIKE ${pattern ?? ''}
      ))
  `);
  const total = (countRes.rows[0] as any).n;

  const items = await db.execute(sql`
    SELECT rq.*, sr.fingerprint, sr.match_method, sr.external_id,
           sr.matched_entity_id AS staging_matched_id
    FROM import_review_queue rq
    LEFT JOIN import_staging_rows sr ON sr.id = rq.staging_row_id
    WHERE rq.batch_id = ${batchId}
      AND (${safeEntityType}::text IS NULL OR rq.entity_type = ${safeEntityType})
      AND (${safeAction}::text IS NULL OR rq.action = ${safeAction})
      AND (${safeIssueType}::text IS NULL OR rq.issue_type = ${safeIssueType})
      AND (${pattern}::text IS NULL OR (
        LOWER(rq.proposed_data::text) LIKE ${pattern ?? ''}
        OR LOWER(COALESCE(rq.current_data::text, '')) LIKE ${pattern ?? ''}
        OR LOWER(COALESCE(sr.external_id, '')) LIKE ${pattern ?? ''}
      ))
    ORDER BY
      CASE rq.issue_type
        WHEN 'exact_match'          THEN 0
        WHEN 'household_match'      THEN 1
        WHEN 'field_conflict'       THEN 2
        WHEN 'new_record'           THEN 3
        WHEN 'new_property_detected'THEN 4
        WHEN 'duplicate_job'        THEN 5
        ELSE 6
      END,
      rq.entity_type, rq.id
    LIMIT ${pageSize} OFFSET ${offset}
  `);

  return res.json({
    data: items.rows,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}));

// ─── Search all staging rows (including skipped duplicates) ───────────────────

router.get("/admin/import/batches/:id/staging-search", requireSuperAdmin, wrap(async (req, res) => {
  const batchId = Number(req.params.id);
  const search = (req.query.search as string || "").trim().toLowerCase();
  const statusFilter = req.query.status as string | undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 25));
  const offset = (page - 1) * pageSize;

  const validStatuses = ["skipped_duplicate", "auto_approved", "review", "error", "applied", "ignored"];
  const safeStatus = statusFilter && validStatuses.includes(statusFilter) ? statusFilter : null;
  const pattern = search ? `%${search}%` : null;

  const countRes = await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM import_staging_rows sr
    WHERE sr.batch_id = ${batchId}
      AND sr.entity_type IN ('customer', 'lead')
      AND (${safeStatus}::text IS NULL OR sr.status = ${safeStatus})
      AND (${pattern}::text IS NULL OR (
        LOWER(COALESCE(sr.external_id, '')) LIKE ${pattern ?? ''}
        OR LOWER(sr.normalized_data::text) LIKE ${pattern ?? ''}
        OR LOWER(sr.raw_data::text) LIKE ${pattern ?? ''}
        OR LOWER(COALESCE(sr.error_message, '')) LIKE ${pattern ?? ''}
      ))
  `);
  const total = (countRes.rows[0] as any).n;

  const items = await db.execute(sql`
    SELECT sr.*,
           f.original_name AS file_name,
           rq.id AS review_id, rq.issue_type, rq.action AS review_action
    FROM import_staging_rows sr
    LEFT JOIN import_files f ON f.id = sr.file_id
    LEFT JOIN import_review_queue rq ON rq.staging_row_id = sr.id
    WHERE sr.batch_id = ${batchId}
      AND sr.entity_type IN ('customer', 'lead')
      AND (${safeStatus}::text IS NULL OR sr.status = ${safeStatus})
      AND (${pattern}::text IS NULL OR (
        LOWER(COALESCE(sr.external_id, '')) LIKE ${pattern ?? ''}
        OR LOWER(sr.normalized_data::text) LIKE ${pattern ?? ''}
        OR LOWER(sr.raw_data::text) LIKE ${pattern ?? ''}
        OR LOWER(COALESCE(sr.error_message, '')) LIKE ${pattern ?? ''}
      ))
    ORDER BY
      CASE sr.status
        WHEN 'skipped_duplicate' THEN 0
        WHEN 'error' THEN 1
        WHEN 'review' THEN 2
        WHEN 'auto_approved' THEN 3
        ELSE 4
      END,
      sr.row_index
    LIMIT ${pageSize} OFFSET ${offset}
  `);

  return res.json({
    data: items.rows,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}));

// ─── Bulk-action review items ─────────────────────────────────────────────────

router.patch("/admin/import/review/bulk", requireSuperAdmin, jsonBig, wrap(async (req, res) => {
  const { batchId, action, entityType, issueType, search } = req.body as {
    batchId: number;
    action: string;
    entityType?: string;
    issueType?: string;
    search?: string;
  };

  if (!batchId || !action) return res.status(400).json({ error: "batchId and action required" });
  if (!["keep_existing", "accept_import", "replace_billing", "merge", "ignore"].includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }

  const bid = Number(batchId);
  if (isNaN(bid)) return res.status(400).json({ error: "Invalid batchId" });

  const conditions = [sql`batch_id = ${bid}`, sql`action = 'pending'`];
  if (issueType) conditions.push(sql`issue_type = ${issueType}`);
  if (entityType) conditions.push(sql`entity_type = ${entityType}`);

  const searchTerm = (search ?? "").trim();
  if (searchTerm) {
    const pattern = `%${searchTerm}%`;
    conditions.push(sql`id IN (
      SELECT rq.id FROM import_review_queue rq
      LEFT JOIN import_staging_rows sr ON sr.id = rq.staging_row_id
      WHERE rq.batch_id = ${bid}
        AND (
          CAST(rq.proposed_data AS TEXT) ILIKE ${pattern}
          OR CAST(rq.current_data AS TEXT) ILIKE ${pattern}
          OR sr.external_id ILIKE ${pattern}
        )
    )`);
  }

  const where = conditions.reduce((a, b) => sql`${a} AND ${b}`);

  const countResult = await db.execute(sql`SELECT COUNT(*) AS cnt FROM import_review_queue WHERE ${where}`);
  const targetCount = Number((countResult.rows[0] as any)?.cnt ?? 0);
  logger.info({ batchId: bid, action, entityType, issueType, searchTerm, targetCount }, "[bulk-action] Starting");

  const query = sql`
    UPDATE import_review_queue
    SET action = ${action}, reviewed_at = NOW(), reviewed_by = ${(req as any).user?.email ?? null}
    WHERE ${where}
    RETURNING id
  `;

  const result = await db.execute(query);
  const affected = (result.rows as any[]).length;
  logger.info({ batchId: bid, action, targeted: targetCount, affected }, "[bulk-action] Complete");

  await refreshBatchCounters(bid);
  return res.json({ success: true, affected });
}));

// ─── Update a single review item ──────────────────────────────────────────────

router.patch("/admin/import/review/:itemId", requireSuperAdmin, jsonBig, wrap(async (req: any, res) => {
  const { itemId } = req.params;
  const { action, selectedCustomerId, reason } = req.body;

  if (!["keep_existing", "accept_import", "replace_billing", "merge", "ignore", "pending", "link_existing", "create_separate"].includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }

  const reviewItem = await db.execute(sql`
    SELECT rq.id, rq.issue_type, sr.duplicate_candidate_ids, sr.external_id
    FROM import_review_queue rq
    JOIN import_staging_rows sr ON sr.id = rq.staging_row_id
    WHERE rq.id = ${Number(itemId)}
    LIMIT 1
  `);
  const item = (reviewItem.rows[0] as any) ?? null;
  if (!item) return res.status(404).json({ error: "Review item not found" });

  let notes: string | null = null;
  if (action === "link_existing") {
    const selected = Number(selectedCustomerId);
    if (!Number.isInteger(selected) || selected <= 0) {
      return res.status(400).json({ error: "selectedCustomerId is required for link_existing" });
    }
    if (item.issue_type !== "contact_duplicate") {
      return res.status(400).json({ error: "link_existing is only available for contact duplicate rows" });
    }
    if (!String(item.external_id ?? "").trim()) {
      return res.status(400).json({ error: "link_existing requires a stable external record ID so provenance can be attached" });
    }
    let candidateIds: number[] = [];
    try {
      candidateIds = JSON.parse(item.duplicate_candidate_ids || "[]").map(Number);
    } catch {
      candidateIds = [];
    }
    if (!candidateIds.includes(selected)) {
      return res.status(400).json({ error: "Selected customer is not one of the server-recorded candidates" });
    }
    notes = JSON.stringify({ selectedCustomerId: selected });
  } else if (action === "create_separate") {
    if (item.issue_type !== "contact_duplicate") {
      return res.status(400).json({ error: "create_separate is only available for contact duplicate rows" });
    }
    const sanitizedReason = sanitizeConversionReason(typeof reason === "string" ? reason : "");
    if (!sanitizedReason) return res.status(400).json({ error: "A non-blank reason is required for create_separate" });
    notes = JSON.stringify({ reason: sanitizedReason });
  }

  const r = await db.execute(sql`
    UPDATE import_review_queue
    SET action = ${action},
        notes = ${notes},
        reviewed_at = NOW(),
        reviewed_by = ${req.user?.email ?? null}
    WHERE id = ${Number(itemId)}
    RETURNING batch_id
  `);

  if (!(r.rows as any[]).length) return res.status(404).json({ error: "Review item not found" });
  const batchId = (r.rows[0] as any).batch_id;
  await refreshBatchCounters(batchId);

  return res.json({ success: true });
}));

// ─── Apply batch ──────────────────────────────────────────────────────────────

router.post("/admin/import/batches/:id/apply", requireSuperAdmin, wrap(async (req, res) => {
  const batchId = Number(req.params.id);

  const batchRes = await db.execute(sql`SELECT status FROM import_batches WHERE id = ${batchId} LIMIT 1`);
  const batch = batchRes.rows[0] as any;
  if (!batch) return res.status(404).json({ error: "Batch not found" });
  if (batch.status === "applied") return res.status(409).json({ error: "Batch already applied" });

  // Check all review items have been actioned
  const pending = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM import_review_queue
    WHERE batch_id = ${batchId} AND action = 'pending'
  `);
  if ((pending.rows[0] as any).n > 0) {
    return res.status(409).json({
      error: `There are ${(pending.rows[0] as any).n} review items still pending. Please action all items before applying.`,
    });
  }

  const result = await applyBatch(batchId);
  return res.json(result);
}));

// ─── Rollback batch ───────────────────────────────────────────────────────────

router.post("/admin/import/batches/:id/rollback", requireSuperAdmin, wrap(async (req, res) => {
  const batchId = Number(req.params.id);

  const batchRes = await db.execute(sql`SELECT status FROM import_batches WHERE id = ${batchId} LIMIT 1`);
  const batch = batchRes.rows[0] as any;
  if (!batch) return res.status(404).json({ error: "Batch not found" });
  if (!["applied", "error"].includes(batch.status)) {
    return res.status(409).json({ error: "Only applied batches can be rolled back" });
  }

  const result = await rollbackBatch(batchId);
  return res.json(result);
}));

// ─── Reset staging (clear staging rows + review queue, keep files, re-stage) ──
// Allows reprocessing an existing batch with the current normalization rules
// without having to re-upload files.  The caller must re-send the file rows.

router.post("/admin/import/batches/:id/reset-staging", requireSuperAdmin, wrap(async (req, res) => {
  const batchId = Number(req.params.id);

  const batchRes = await db.execute(sql`SELECT status FROM import_batches WHERE id = ${batchId} LIMIT 1`);
  const batch = batchRes.rows[0] as any;
  if (!batch) return res.status(404).json({ error: "Batch not found" });
  if (batch.status === "applied" || batch.status === "applying") {
    return res.status(409).json({ error: "Applied batches cannot be reset. Roll back first." });
  }

  // Clear derived data — keep the file records so the UI knows what was uploaded
  await db.execute(sql`DELETE FROM import_review_queue WHERE batch_id = ${batchId}`);
  await db.execute(sql`DELETE FROM import_staging_rows WHERE batch_id = ${batchId}`);

  // Reset file parse state so the upload step shows files as "ready to stage"
  await db.execute(sql`
    UPDATE import_files
    SET status = 'uploaded', row_count = 0, raw_row_count = 0, skipped_rows = 0,
        error_count = 0, parse_errors = NULL, updated_at = NOW()
    WHERE batch_id = ${batchId}
  `);

  // Reset batch counters
  await db.execute(sql`
    UPDATE import_batches
    SET status = 'pending',
        total_rows = 0,
        staging_auto_approved = 0,
        staging_needs_review = 0,
        staging_errors = 0,
        staging_total = 0,
        updated_at = NOW()
    WHERE id = ${batchId}
  `);

  return res.json({ success: true, message: "Staging data cleared — re-upload files to re-stage." });
}));

// ─── Delete (purge) a non-applied batch ───────────────────────────────────────

router.delete("/admin/import/batches/:id", requireSuperAdmin, wrap(async (req, res) => {
  const batchId = Number(req.params.id);

  const batchRes = await db.execute(sql`SELECT status FROM import_batches WHERE id = ${batchId} LIMIT 1`);
  const batch = batchRes.rows[0] as any;
  if (!batch) return res.status(404).json({ error: "Batch not found" });
  if (batch.status === "applied" || batch.status === "applying") {
    return res.status(409).json({ error: "Cannot delete an applied batch. Roll it back first." });
  }

  await db.execute(sql`DELETE FROM import_review_queue WHERE batch_id = ${batchId}`);
  await db.execute(sql`DELETE FROM import_staging_rows WHERE batch_id = ${batchId}`);
  await db.execute(sql`DELETE FROM import_files WHERE batch_id = ${batchId}`);
  await db.execute(sql`DELETE FROM import_batches WHERE id = ${batchId}`);

  return res.json({ success: true });
}));

// ─── Backfill externalIds from a customer CSV ────────────────────────────────
// POST /admin/import/backfill-external-ids
// Body: { rows: [{ id: "3050", firstName: "John", lastName: "Doe", email: "j@d.com", ... }] }
// Matches by email → phone → first+last+address, then sets import_external_id.
router.post("/admin/import/backfill-external-ids", requireSuperAdmin, jsonBig, wrap(async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "rows array required" });
  }

  let matched = 0;
  let alreadySet = 0;
  let noMatch = 0;
  let conflicts = 0;
  const details: any[] = [];

  for (const row of rows) {
    const extId = String(row.Id || row.id || row["Customer ID"] || "").trim();
    if (!extId) continue;

    // Normalize float → int
    const num = parseFloat(extId);
    const normalizedId = (!isNaN(num) && Number.isFinite(num)) ? String(Math.trunc(num)) : extId;

    // Check if this externalId is already assigned
    const existing = await db.execute(sql`
      SELECT id, first_name, last_name FROM customers
      WHERE import_external_id = ${normalizedId}
      LIMIT 1
    `);
    if ((existing.rows as any[]).length) {
      alreadySet++;
      continue;
    }

    // Try to find the CRM customer: email → phone → name+address
    const email = (row.Email || row.email || "").trim().toLowerCase();
    const phone = (row["Home Phone"] || row["Cell Phone"] || row.phone || "").replace(/\D/g, "");
    const firstName = (row["First Name"] || row.firstName || "").trim();
    const lastName = (row["Last Name"] || row.lastName || "").trim();
    const address = (row.Address || row["Billing Address"] || row.address || "").trim().toUpperCase();

    let customerId: number | null = null;

    if (email) {
      const r = await db.execute(sql`SELECT id FROM customers WHERE LOWER(email) = ${email} LIMIT 1`);
      if ((r.rows as any[]).length) customerId = (r.rows[0] as any).id;
    }

    if (!customerId && phone && phone.length >= 7) {
      const r = await db.execute(sql`
        SELECT id FROM customers
        WHERE home_phone = ${phone} OR cell_phone = ${phone} OR work_phone = ${phone}
        LIMIT 1
      `);
      if ((r.rows as any[]).length) customerId = (r.rows[0] as any).id;
    }

    if (!customerId && lastName && address) {
      const r = await db.execute(sql`
        SELECT id FROM customers
        WHERE UPPER(TRIM(last_name)) = ${lastName.toUpperCase()}
          AND UPPER(TRIM(COALESCE(billing_address, ''))) = ${address}
        LIMIT 1
      `);
      if ((r.rows as any[]).length) customerId = (r.rows[0] as any).id;
    }

    if (customerId) {
      // Safety: check if CRM customer already has a different externalId
      const check = await db.execute(sql`
        SELECT import_external_id FROM customers WHERE id = ${customerId} LIMIT 1
      `);
      const currentExtId = (check.rows[0] as any)?.import_external_id;
      if (currentExtId && currentExtId !== normalizedId) {
        conflicts++;
        details.push({ extId: normalizedId, crmId: customerId, conflict: currentExtId });
        continue;
      }

      await db.execute(sql`
        UPDATE customers SET import_external_id = ${normalizedId}, updated_at = NOW()
        WHERE id = ${customerId}
      `);
      matched++;
    } else {
      noMatch++;
      details.push({ extId: normalizedId, name: `${firstName} ${lastName}`.trim(), email, noMatch: true });
    }
  }

  console.log(`[Backfill] total=${rows.length} matched=${matched} alreadySet=${alreadySet} noMatch=${noMatch} conflicts=${conflicts}`);
  return res.json({ total: rows.length, matched, alreadySet, noMatch, conflicts, details: details.slice(0, 50) });
}));

// ─── Debug: show externalId stats ────────────────────────────────────────────
router.get("/admin/import/external-id-stats", requireSuperAdmin, wrap(async (_req, res) => {
  const total = await db.execute(sql`SELECT COUNT(*) as count FROM customers`);
  const withId = await db.execute(sql`SELECT COUNT(*) as count FROM customers WHERE import_external_id IS NOT NULL AND import_external_id != ''`);
  const dupeEmails = await db.execute(sql`
    SELECT c1.email, COUNT(DISTINCT c1.import_external_id) as ext_id_count
    FROM customers c1
    WHERE c1.email IS NOT NULL AND c1.email != ''
      AND c1.import_external_id IS NOT NULL AND c1.import_external_id != ''
    GROUP BY c1.email
    HAVING COUNT(DISTINCT c1.import_external_id) > 1
    LIMIT 20
  `);

  return res.json({
    totalCustomers: Number((total.rows[0] as any).count),
    withExternalId: Number((withId.rows[0] as any).count),
    withoutExternalId: Number((total.rows[0] as any).count) - Number((withId.rows[0] as any).count),
    duplicateEmailDifferentExtId: dupeEmails.rows,
  });
}));

// ─── Scan duplicate external IDs ──────────────────────────────────────────────
router.get("/admin/import/duplicate-external-ids", requireSuperAdmin, wrap(async (_req, res) => {
  const dupes = await db.execute(sql`
    SELECT import_external_id, COUNT(*) as cnt
    FROM customers
    WHERE import_external_id IS NOT NULL AND import_external_id != ''
    GROUP BY import_external_id
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `);

  const groups: any[] = [];
  for (const d of dupes.rows as any[]) {
    const rows = await db.execute(sql`
      SELECT c.id, c.first_name, c.last_name, c.email, c.import_external_id,
             c.billing_address, c.billing_city, c.status,
             (SELECT COUNT(*) FROM invoices WHERE customer_id = c.id) as invoice_count,
             (SELECT COUNT(*) FROM jobs WHERE customer_id = c.id) as job_count,
             (SELECT COUNT(*) FROM properties WHERE customer_id = c.id) as property_count
      FROM customers c
      WHERE c.import_external_id = ${d.import_external_id}
      ORDER BY c.id
    `);

    const members = (rows.rows as any[]).map(r => ({
      ...r,
      invoice_count: Number(r.invoice_count),
      job_count: Number(r.job_count),
      property_count: Number(r.property_count),
      linked_total: Number(r.invoice_count) + Number(r.job_count) + Number(r.property_count),
    }));

    const nameA = `${members[0].first_name ?? ""} ${members[0].last_name ?? ""}`.trim().toLowerCase();
    const nameB = `${members[1].first_name ?? ""} ${members[1].last_name ?? ""}`.trim().toLowerCase();
    const isSamePerson = nameA === nameB;

    let keepId: number | null = null;
    let mergeIds: number[] = [];
    let recommendation: string;

    if (isSamePerson) {
      const sorted = [...members].sort((a, b) => b.linked_total - a.linked_total || a.id - b.id);
      keepId = sorted[0].id;
      mergeIds = sorted.slice(1).map(m => m.id);
      recommendation = "auto_merge";
    } else {
      recommendation = "identity_conflict";
    }

    groups.push({
      externalId: d.import_external_id,
      count: Number(d.cnt),
      isSamePerson,
      recommendation,
      keepId,
      mergeIds,
      members,
    });
  }

  return res.json({
    totalDuplicateGroups: groups.length,
    totalAffectedRows: groups.reduce((s, g) => s + g.count, 0),
    groups,
  });
}));

// ─── Clean up duplicate external IDs ─────────────────────────────────────────
// POST /admin/import/cleanup-duplicate-external-ids
// Body: { dryRun?: boolean }
// For same-person duplicates: reassign jobs/invoices/properties to keeper, null out loser's externalId.
// For identity conflicts: null out the externalId on the row with FEWER linked records (requires manual assignment later).
router.post("/admin/import/cleanup-duplicate-external-ids", requireSuperAdmin, wrap(async (req, res) => {
  const dryRun = req.body?.dryRun !== false;

  const dupes = await db.execute(sql`
    SELECT import_external_id
    FROM customers
    WHERE import_external_id IS NOT NULL AND import_external_id != ''
    GROUP BY import_external_id
    HAVING COUNT(*) > 1
  `);

  const actions: any[] = [];

  for (const d of dupes.rows as any[]) {
    const extId = (d as any).import_external_id;
    const rows = await db.execute(sql`
      SELECT c.id, c.first_name, c.last_name, c.email, c.import_external_id,
             c.billing_address, c.billing_city,
             (SELECT COUNT(*) FROM invoices WHERE customer_id = c.id) as invoice_count,
             (SELECT COUNT(*) FROM jobs WHERE customer_id = c.id) as job_count,
             (SELECT COUNT(*) FROM properties WHERE customer_id = c.id) as property_count
      FROM customers c
      WHERE c.import_external_id = ${extId}
      ORDER BY c.id
    `);

    const members = (rows.rows as any[]).map(r => ({
      ...r,
      invoice_count: Number(r.invoice_count),
      job_count: Number(r.job_count),
      property_count: Number(r.property_count),
      linked_total: Number(r.invoice_count) + Number(r.job_count) + Number(r.property_count),
    }));

    const nameA = `${members[0].first_name ?? ""} ${members[0].last_name ?? ""}`.trim().toLowerCase();
    const nameB = `${members[1].first_name ?? ""} ${members[1].last_name ?? ""}`.trim().toLowerCase();
    const isSamePerson = nameA === nameB;

    if (isSamePerson) {
      const sorted = [...members].sort((a, b) => b.linked_total - a.linked_total || a.id - b.id);
      const keeper = sorted[0];
      const losers = sorted.slice(1);

      for (const loser of losers) {
        const action: any = {
          externalId: extId,
          type: "merge_same_person",
          keeperId: keeper.id,
          keeperName: `${keeper.first_name ?? ""} ${keeper.last_name ?? ""}`.trim(),
          keeperLinked: keeper.linked_total,
          loserId: loser.id,
          loserName: `${loser.first_name ?? ""} ${loser.last_name ?? ""}`.trim(),
          loserLinked: loser.linked_total,
          jobsMoved: loser.job_count,
          invoicesMoved: loser.invoice_count,
          propertiesMoved: loser.property_count,
        };

        if (!dryRun) {
          if (loser.job_count > 0) {
            await db.execute(sql`UPDATE jobs SET customer_id = ${keeper.id} WHERE customer_id = ${loser.id}`);
          }
          if (loser.invoice_count > 0) {
            await db.execute(sql`UPDATE invoices SET customer_id = ${keeper.id} WHERE customer_id = ${loser.id}`);
          }
          if (loser.property_count > 0) {
            await db.execute(sql`UPDATE properties SET customer_id = ${keeper.id} WHERE customer_id = ${loser.id}`);
          }
          await db.execute(sql`
            UPDATE customers SET import_external_id = NULL, updated_at = NOW()
            WHERE id = ${loser.id}
          `);
          action.applied = true;
        }

        actions.push(action);
      }
    } else {
      const sorted = [...members].sort((a, b) => b.linked_total - a.linked_total || a.id - b.id);
      const keeper = sorted[0];
      const loser = sorted[1];

      const action: any = {
        externalId: extId,
        type: "identity_conflict",
        keeperId: keeper.id,
        keeperName: `${keeper.first_name ?? ""} ${keeper.last_name ?? ""}`.trim(),
        keeperLinked: keeper.linked_total,
        loserId: loser.id,
        loserName: `${loser.first_name ?? ""} ${loser.last_name ?? ""}`.trim(),
        loserLinked: loser.linked_total,
        note: "Different people share the same CF ID. Nulling the one with fewer linked records. Manual reassignment needed.",
      };

      if (!dryRun) {
        await db.execute(sql`
          UPDATE customers SET import_external_id = NULL, updated_at = NOW()
          WHERE id = ${loser.id}
        `);
        action.applied = true;
      }

      actions.push(action);
    }
  }

  const summary = {
    dryRun,
    totalActions: actions.length,
    merges: actions.filter(a => a.type === "merge_same_person").length,
    conflicts: actions.filter(a => a.type === "identity_conflict").length,
    actions,
  };

  console.log(`[Cleanup Duplicates] dryRun=${dryRun} merges=${summary.merges} conflicts=${summary.conflicts}`);
  return res.json(summary);
}));

// ─── Add unique index after cleanup ──────────────────────────────────────────
router.post("/admin/import/add-unique-external-id-index", requireSuperAdmin, wrap(async (_req, res) => {
  const dupes = await db.execute(sql`
    SELECT import_external_id, COUNT(*) as cnt
    FROM customers
    WHERE import_external_id IS NOT NULL AND import_external_id != ''
    GROUP BY import_external_id
    HAVING COUNT(*) > 1
  `);

  if ((dupes.rows as any[]).length > 0) {
    return res.status(409).json({
      error: "Cannot add unique index — duplicates still exist",
      duplicateCount: (dupes.rows as any[]).length,
      duplicates: (dupes.rows as any[]).map((r: any) => r.import_external_id),
    });
  }

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_import_external_id
    ON customers (import_external_id)
    WHERE import_external_id IS NOT NULL AND import_external_id != ''
  `);

  return res.json({ success: true, message: "Unique partial index created on import_external_id" });
}));

router.get("/admin/import/external-id-validation", requireSuperAdmin, wrap(async (_req, res) => {
  const customersRes = await db.execute(sql`
    SELECT id, first_name, last_name, email, import_external_id, billing_address, billing_city
    FROM customers
    WHERE import_external_id IS NOT NULL AND import_external_id != ''
    ORDER BY import_external_id::int
  `);

  const latestBatch = await db.execute(sql`
    SELECT id FROM import_batches WHERE status IN ('applied','review') ORDER BY id DESC LIMIT 1
  `);
  const batchId = (latestBatch.rows as any[])[0]?.id;

  let stagingMap = new Map<string, any>();
  if (batchId) {
    const stagingRes = await db.execute(sql`
      SELECT external_id,
             substring(normalized_data::text from '"firstName":"([^"]*)"') as fn,
             substring(normalized_data::text from '"lastName":"([^"]*)"') as ln,
             substring(normalized_data::text from '"billingAddress":"([^"]*)"') as addr,
             substring(normalized_data::text from '"email":"([^"]*)"') as email
      FROM import_staging_rows
      WHERE entity_type = 'customer'
        AND external_id IS NOT NULL AND external_id != ''
        AND batch_id = ${batchId}
      ORDER BY external_id
    `);
    for (const row of stagingRes.rows as any[]) {
      stagingMap.set(row.external_id, row);
    }
  }

  const mismatches: any[] = [];
  const unassigned: any[] = [];
  const matched: number[] = [];

  for (const cust of customersRes.rows as any[]) {
    const stg = stagingMap.get(cust.import_external_id);
    if (!stg) continue;
    matched.push(cust.id);

    const cf = (cust.first_name || "").trim().toLowerCase();
    const sf = (stg.fn || "").trim().toLowerCase();
    const cl = (cust.last_name || "").trim().toLowerCase();
    const sl = (stg.ln || "").trim().toLowerCase();

    const firstBad = cf && sf && cf !== sf;
    const lastBad = cl && sl && cl !== sl;

    if (firstBad || lastBad) {
      mismatches.push({
        extId: cust.import_external_id,
        crmId: cust.id,
        crmName: `${cust.first_name || ""} ${cust.last_name || ""}`.trim(),
        crmAddr: cust.billing_address,
        crmEmail: cust.email,
        importName: `${stg.fn || ""} ${stg.ln || ""}`.trim(),
        importAddr: stg.addr,
        importEmail: stg.email,
        issue: lastBad ? "last_name" : "first_name",
      });
    }
  }

  const custExtIds = new Set((customersRes.rows as any[]).map((c: any) => c.import_external_id));
  for (const [extId, stg] of stagingMap) {
    if (!custExtIds.has(extId)) {
      unassigned.push({
        extId,
        importName: `${stg.fn || ""} ${stg.ln || ""}`.trim(),
        importAddr: stg.addr,
        importEmail: stg.email,
      });
    }
  }

  const fixLog = await db.execute(sql`
    SELECT entity_id, after_json FROM import_change_log
    WHERE entity_type = 'external_id_fix' AND operation = 'update'
    ORDER BY id
  `);

  return res.json({
    totalCustomersWithExtId: (customersRes.rows as any[]).length,
    stagingBatchId: batchId || null,
    stagingCount: stagingMap.size,
    matchedCount: matched.length,
    mismatches,
    unassigned,
    fixesApplied: (fixLog.rows as any[]).map((r: any) => {
      try { return JSON.parse(r.after_json); } catch { return r.after_json; }
    }),
  });
}));

// ─── Debug Trace — trace a single customer through the entire import pipeline ─
router.get("/admin/import/debug-trace", requireSuperAdmin, wrap(async (req, res) => {
  const q = ((req.query.q as string) ?? "").trim();
  if (!q) return res.status(400).json({ error: "q parameter required (CF ID or customer name)" });

  const isNumeric = /^\d+$/.test(q);
  const pattern = `%${q}%`;

  const stagingRows = await db.execute(sql`
    SELECT sr.*, f.original_name AS file_name, f.file_group, b.name AS batch_name, b.status AS batch_status
    FROM import_staging_rows sr
    JOIN import_files f ON f.id = sr.file_id
    JOIN import_batches b ON b.id = sr.batch_id
    WHERE sr.entity_type = 'customer'
      AND (
        ${isNumeric ? sql`sr.external_id = ${q}` : sql`FALSE`}
        OR CAST(sr.normalized_data AS TEXT) ILIKE ${pattern}
        OR CAST(sr.raw_data AS TEXT) ILIKE ${pattern}
      )
    ORDER BY sr.batch_id DESC, sr.id
    LIMIT 50
  `);

  const reviewRows = await db.execute(sql`
    SELECT rq.*, sr.external_id, sr.match_method, sr.matched_entity_id AS staging_matched_id,
           f.original_name AS file_name, b.name AS batch_name
    FROM import_review_queue rq
    JOIN import_staging_rows sr ON sr.id = rq.staging_row_id
    JOIN import_files f ON f.id = sr.file_id
    JOIN import_batches b ON b.id = rq.batch_id
    WHERE sr.entity_type = 'customer'
      AND (
        ${isNumeric ? sql`sr.external_id = ${q}` : sql`FALSE`}
        OR CAST(rq.proposed_data AS TEXT) ILIKE ${pattern}
        OR CAST(rq.current_data AS TEXT) ILIKE ${pattern}
      )
    ORDER BY rq.batch_id DESC, rq.id
    LIMIT 50
  `);

  const changeLogs = await db.execute(sql`
    SELECT cl.*,  b.name AS batch_name
    FROM import_change_log cl
    JOIN import_batches b ON b.id = cl.batch_id
    WHERE cl.entity_type = 'customer'
      AND (
        CAST(cl.after_json AS TEXT) ILIKE ${pattern}
        OR CAST(COALESCE(cl.before_json, '') AS TEXT) ILIKE ${pattern}
        ${isNumeric ? sql`OR CAST(cl.entity_id AS TEXT) = ${q}` : sql``}
      )
    ORDER BY cl.id DESC
    LIMIT 50
  `);

  const crmCustomers = await db.execute(sql`
    SELECT id, first_name, last_name, email, phone, cell_phone, work_phone,
           import_external_id, import_source, import_batch_id, is_imported,
           billing_address, billing_city, billing_state, billing_zip,
           company_name, status, created_at
    FROM customers
    WHERE
      ${isNumeric ? sql`import_external_id = ${q}` : sql`FALSE`}
      OR (LOWER(first_name) || ' ' || LOWER(last_name)) ILIKE ${pattern}
      OR (LOWER(last_name) || ' ' || LOWER(first_name)) ILIKE ${pattern}
      ${isNumeric ? sql`OR id = ${Number(q)}` : sql``}
    ORDER BY id
    LIMIT 20
  `);

  const safeJson = (val: any) => {
    if (!val) return null;
    if (typeof val === "object") return val;
    try { return JSON.parse(val); } catch { return val; }
  };

  const timeline: any[] = [];

  for (const sr of stagingRows.rows as any[]) {
    timeline.push({
      phase: "staging",
      batchId: sr.batch_id,
      batchName: sr.batch_name,
      batchStatus: sr.batch_status,
      stagingRowId: sr.id,
      externalId: sr.external_id,
      fileName: sr.file_name,
      fileGroup: sr.file_group,
      entityType: sr.entity_type,
      status: sr.status,
      matchMethod: sr.match_method,
      matchedEntityId: sr.matched_entity_id,
      hasParseError: sr.has_parse_error,
      errorMessage: sr.error_message,
      normalizedData: safeJson(sr.normalized_data),
      rawData: safeJson(sr.raw_data),
      createdAt: sr.created_at,
    });
  }

  for (const rq of reviewRows.rows as any[]) {
    timeline.push({
      phase: "review",
      batchId: rq.batch_id,
      batchName: rq.batch_name,
      reviewId: rq.id,
      stagingRowId: rq.staging_row_id,
      externalId: rq.external_id,
      fileName: rq.file_name,
      entityType: rq.entity_type,
      issueType: rq.issue_type,
      action: rq.action,
      reviewedBy: rq.reviewed_by,
      reviewedAt: rq.reviewed_at,
      matchMethod: rq.match_method,
      stagingMatchedId: rq.staging_matched_id,
      proposedData: safeJson(rq.proposed_data),
      currentData: safeJson(rq.current_data),
      conflictFields: safeJson(rq.conflict_fields),
      notes: rq.notes,
      createdAt: rq.created_at,
    });
  }

  for (const cl of changeLogs.rows as any[]) {
    timeline.push({
      phase: "applied",
      batchId: cl.batch_id,
      batchName: cl.batch_name,
      changeLogId: cl.id,
      operation: cl.operation,
      entityType: cl.entity_type,
      entityId: cl.entity_id,
      rolledBack: cl.rolled_back,
      beforeJson: safeJson(cl.before_json),
      afterJson: safeJson(cl.after_json),
      createdAt: cl.created_at,
    });
  }

  const crmMatches = (crmCustomers.rows as any[]).map((c: any) => ({
    id: c.id,
    name: `${c.first_name} ${c.last_name}`,
    email: c.email,
    phone: c.phone,
    cellPhone: c.cell_phone,
    workPhone: c.work_phone,
    importExternalId: c.import_external_id,
    importSource: c.import_source,
    importBatchId: c.import_batch_id,
    isImported: c.is_imported,
    billingAddress: c.billing_address,
    billingCity: c.billing_city,
    status: c.status,
    companyName: c.company_name,
    createdAt: c.created_at,
  }));

  return res.json({
    query: q,
    summary: {
      parsedFromCSV: (stagingRows.rows as any[]).length > 0,
      stagedCount: (stagingRows.rows as any[]).length,
      sentToReview: (reviewRows.rows as any[]).length > 0,
      reviewCount: (reviewRows.rows as any[]).length,
      appliedCount: (changeLogs.rows as any[]).length,
      crmMatchCount: crmMatches.length,
      files: [...new Set((stagingRows.rows as any[]).map((r: any) => r.file_name))],
      batches: [...new Set((stagingRows.rows as any[]).map((r: any) => r.batch_name))],
      stagingStatuses: [...new Set((stagingRows.rows as any[]).map((r: any) => r.status))],
      reviewActions: [...new Set((reviewRows.rows as any[]).map((r: any) => r.action))],
      reviewIssueTypes: [...new Set((reviewRows.rows as any[]).map((r: any) => r.issue_type))],
    },
    crmMatches,
    timeline: timeline.sort((a, b) => {
      const ta = new Date(a.createdAt).getTime() || 0;
      const tb = new Date(b.createdAt).getTime() || 0;
      return ta - tb;
    }),
  });
}));

router.post("/admin/import/cleanup-jobs", requireSuperAdmin, jsonBig, wrap(async (req: any, res) => {
  const mode = req.body.mode as string;

  if (mode !== "preview" && mode !== "soft_delete" && mode !== "hard_delete") {
    return res.status(400).json({ error: 'mode must be "preview", "soft_delete", or "hard_delete"' });
  }

  const targetQuery = await db.execute(sql`
    SELECT j.id, j.job_number, j.customer_id, j.scheduled_date, j.service_type,
           j.total_amount, j.line_items IS NOT NULL as has_line_items,
           c.first_name, c.last_name
    FROM jobs j
    LEFT JOIN customers c ON c.id = j.customer_id
    WHERE j.is_imported = true
      AND j.import_source = 'customer_factor'
      AND j.line_items IS NULL
      AND j.is_hidden = false
  `);
  const targets = targetQuery.rows as any[];

  const summary = {
    mode,
    totalTargeted: targets.length,
    sampleJobs: targets.slice(0, 20).map((t: any) => ({
      id: t.id,
      jobNumber: t.job_number,
      customerId: t.customer_id,
      customerName: `${t.first_name || ""} ${t.last_name || ""}`.trim(),
      scheduledDate: t.scheduled_date,
      serviceType: t.service_type,
      totalAmount: Number(t.total_amount),
    })),
    customerBreakdown: {} as Record<string, number>,
  };

  const custCounts: Record<string, number> = {};
  for (const t of targets) {
    const name = `${t.first_name || ""} ${t.last_name || ""}`.trim() || `Customer #${t.customer_id}`;
    custCounts[name] = (custCounts[name] || 0) + 1;
  }
  summary.customerBreakdown = custCounts;

  if (mode === "preview") {
    return res.json({ ...summary, action: "preview_only", message: "No changes made. Review the targeted jobs above." });
  }

  if (mode === "soft_delete") {
    const ids = targets.map((t: any) => t.id);
    if (ids.length > 0) {
      const idList = ids.join(",");
      await db.execute(sql`
        UPDATE jobs SET is_hidden = true, is_ignored = true, updated_at = NOW()
        WHERE id = ANY(${sql.raw(`ARRAY[${idList}]`)})
      `);
    }
    return res.json({ ...summary, action: "soft_deleted", message: `${ids.length} jobs soft-deleted (hidden + ignored). No data lost.` });
  }

  if (mode === "hard_delete") {
    const ids = targets.map((t: any) => t.id);
    if (ids.length > 0) {
      const idList = ids.join(",");
      await db.execute(sql`
        DELETE FROM jobs WHERE id = ANY(${sql.raw(`ARRAY[${idList}]`)})
      `);
    }
    return res.json({ ...summary, action: "hard_deleted", message: `${ids.length} jobs permanently deleted.` });
  }
}));

export default router;
