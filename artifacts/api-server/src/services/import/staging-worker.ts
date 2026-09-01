/**
 * staging-worker.ts
 *
 * Background processing for import file staging.
 *
 * Flow:
 *   1. Route stores raw rows as JSON in import_files.raw_json_data and sets status='queued'
 *   2. Route calls runFileStaging() without awaiting — returns 202 to the browser immediately
 *   3. This module sets status='processing', runs the full staging pipeline, then clears
 *      raw_json_data and sets status='parsed' (or 'error').
 *   4. On server start, resumeInterruptedFiles() finds any queued/processing files left over
 *      from a previous crash or restart and re-runs them.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { stageFileRows, refreshBatchCounters, type FileGroup } from "./staging";

// ─── Run staging for a single file in the background ─────────────────────────

export async function runFileStaging(
  fileId: number,
  batchId: number,
  fileGroup: string
): Promise<void> {
  try {
    // Mark as actively processing
    await db.execute(sql`
      UPDATE import_files
      SET status = 'processing', processing_started_at = NOW(), updated_at = NOW()
      WHERE id = ${fileId}
    `);

    // Read the rows that were saved during the upload request
    const fileRes = await db.execute(sql`
      SELECT raw_json_data FROM import_files WHERE id = ${fileId} LIMIT 1
    `);
    const rawJson = (fileRes.rows[0] as any)?.raw_json_data;
    if (!rawJson) throw new Error("No raw row data found for file — cannot stage");

    const rows = JSON.parse(rawJson) as Record<string, string>[];

    // Full staging pipeline (normalize → match → write staging rows → review items)
    const stagingResult = await stageFileRows(batchId, fileId, fileGroup as FileGroup, rows);

    // Build the human-readable message (same logic as the old sync route)
    const dedupNote = stagingResult.skippedRows > 0
      ? ` (${stagingResult.rawRows.toLocaleString()} file rows → ${stagingResult.skippedRows.toLocaleString()} collapsed job-history duplicates)`
      : "";
    const autoDetails: string[] = [];
    if (stagingResult.autoCreatedCustomer > 0) autoDetails.push(`${stagingResult.autoCreatedCustomer} new customers`);
    if (stagingResult.autoAddedProperty   > 0) autoDetails.push(`${stagingResult.autoAddedProperty} new properties`);
    const mergedTotal = stagingResult.autoMergedExact + stagingResult.autoMergedHousehold;
    if (mergedTotal > 0)                       autoDetails.push(`${mergedTotal} merged`);
    const autoNote = autoDetails.length > 0 ? ` (${autoDetails.join(", ")})` : "";
    const forcedNote = stagingResult.forcedStaging > 0 ? `, ${stagingResult.forcedStaging} forced (no name but had ID)` : "";
    const message =
      `Staged ${stagingResult.totalRows.toLocaleString()} unique records${dedupNote}: ` +
      `${stagingResult.autoApproved} auto-approved${autoNote}, ${stagingResult.needsReview} need review, ` +
      `${stagingResult.errors} errors${forcedNote}` +
      (stagingResult.jobsFound > 0 ? `, ${stagingResult.jobsFound} jobs` : "");

    // Update file record with final counts; clear raw_json_data to reclaim space
    await db.execute(sql`
      UPDATE import_files
      SET raw_row_count  = ${stagingResult.rawRows},
          row_count      = ${stagingResult.totalRows},
          skipped_rows   = ${stagingResult.skippedRows},
          error_count    = ${stagingResult.errors},
          status         = 'parsed',
          parse_errors   = ${message},
          raw_json_data  = NULL,
          updated_at     = NOW()
      WHERE id = ${fileId}
    `);

    // Update batch totals and staging counters
    await db.execute(sql`
      UPDATE import_batches
      SET file_count = (SELECT COUNT(*) FROM import_files WHERE batch_id = ${batchId}),
          total_rows = total_rows + ${stagingResult.totalRows},
          updated_at = NOW()
      WHERE id = ${batchId}
    `);

    await refreshBatchCounters(batchId);

  } catch (err) {
    const errMsg = (err as Error).message.slice(0, 500);
    try {
      await db.execute(sql`
        UPDATE import_files
        SET status        = 'error',
            parse_errors  = ${JSON.stringify([{ message: errMsg }])},
            raw_json_data = NULL,
            updated_at    = NOW()
        WHERE id = ${fileId}
      `);
    } catch (_) {
      // Ignore secondary DB error — primary error is already logged below
    }
    console.error(`[staging-worker] File ${fileId} failed:`, errMsg);
  }
}

// ─── Resume any files left in-flight from a previous server run ───────────────

export async function resumeInterruptedFiles(): Promise<void> {
  try {
    const stuck = await db.execute(sql`
      SELECT id, batch_id, file_group
      FROM import_files
      WHERE status IN ('queued', 'processing')
      ORDER BY created_at
    `);

    const files = stuck.rows as any[];
    if (files.length === 0) return;

    console.log(`[staging-worker] Resuming ${files.length} interrupted file(s) from previous run`);

    for (const file of files) {
      // Reset to queued so the worker starts fresh (avoids partial staging state)
      await db.execute(sql`
        UPDATE import_files SET status = 'queued', updated_at = NOW()
        WHERE id = ${file.id}
      `);
      // Fire without awaiting — each file is processed independently
      runFileStaging(file.id, file.batch_id, file.file_group).catch((err) =>
        console.error(`[staging-worker] Resume of file ${file.id} failed:`, err)
      );
    }
  } catch (err) {
    console.error("[staging-worker] resumeInterruptedFiles failed:", (err as Error).message);
  }
}
