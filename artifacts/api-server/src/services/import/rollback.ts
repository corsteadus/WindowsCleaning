/**
 * Rollback service — undoes every change made by a batch using import_change_log.
 * Inserts → deleted, Updates → restored to before_json, Hides → un-hidden.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const TABLE_MAP: Record<string, string> = {
  customer: "customers",
  lead:     "leads",
  job:      "jobs",
  invoice:  "invoices",
  property: "properties",
};

async function rollbackInsert(entityType: string, entityId: number) {
  const table = TABLE_MAP[entityType];
  if (!table) return;
  await db.execute(sql.raw(`DELETE FROM ${table} WHERE id = ${entityId}`));
}

async function rollbackUpdate(entityType: string, entityId: number, beforeJson: Record<string, unknown>) {
  const table = TABLE_MAP[entityType];
  if (!table) return;

  // Build SET clause from beforeJson, excluding id and timestamps we don't want to touch
  const skip = new Set(["id", "created_at"]);
  const setClauses = Object.entries(beforeJson)
    .filter(([k]) => !skip.has(k))
    .map(([k, v]) => {
      if (v === null) return `${k} = NULL`;
      const escaped = String(v).replace(/'/g, "''");
      return `${k} = '${escaped}'`;
    });

  if (setClauses.length === 0) return;
  await db.execute(sql.raw(
    `UPDATE ${table} SET ${setClauses.join(", ")}, updated_at = NOW() WHERE id = ${entityId}`
  ));
}

async function rollbackHide(entityType: string, entityId: number) {
  const table = TABLE_MAP[entityType];
  if (!table) return;
  // Restore the row to visible and remove suspected_duplicate flag
  if (entityType === "job") {
    await db.execute(sql.raw(
      `UPDATE ${table} SET is_hidden = false, is_suspected_duplicate = false, updated_at = NOW() WHERE id = ${entityId}`
    ));
  }
}

export async function rollbackBatch(batchId: number): Promise<{ reverted: number; errors: string[] }> {
  let reverted = 0;
  const errors: string[] = [];

  await db.execute(sql`UPDATE import_batches SET status = 'rolling_back', updated_at = NOW() WHERE id = ${batchId}`);

  try {
    // Get change log entries in reverse order (most recent first)
    const entries = await db.execute(sql`
      SELECT * FROM import_change_log
      WHERE batch_id = ${batchId} AND rolled_back = false
      ORDER BY id DESC
    `);

    for (const entry of (entries.rows as any[])) {
      try {
        switch (entry.operation) {
          case "insert":
            await rollbackInsert(entry.entity_type, entry.entity_id);
            break;
          case "update":
            if (entry.before_json) {
              await rollbackUpdate(
                entry.entity_type,
                entry.entity_id,
                JSON.parse(entry.before_json)
              );
            }
            break;
          case "hide":
            await rollbackHide(entry.entity_type, entry.entity_id);
            break;
        }

        // Mark this change log entry as rolled back
        await db.execute(sql`
          UPDATE import_change_log SET rolled_back = true WHERE id = ${entry.id}
        `);
        reverted++;
      } catch (err) {
        errors.push(`ChangeLog#${entry.id} (${entry.operation} ${entry.entity_type}#${entry.entity_id}): ${(err as Error).message.slice(0, 100)}`);
      }
    }

    // Reset staging rows back to pending/auto_approved so the batch can be re-applied
    await db.execute(sql`
      UPDATE import_staging_rows SET status = 'review'
      WHERE batch_id = ${batchId} AND status = 'applied'
        AND id IN (SELECT staging_row_id FROM import_review_queue WHERE batch_id = ${batchId})
    `);
    await db.execute(sql`
      UPDATE import_staging_rows SET status = 'auto_approved'
      WHERE batch_id = ${batchId} AND status = 'applied'
        AND id NOT IN (SELECT staging_row_id FROM import_review_queue WHERE batch_id = ${batchId})
    `);

    // Reset review queue actions
    await db.execute(sql`
      UPDATE import_review_queue SET action = 'pending', reviewed_at = NULL, reviewed_by = NULL
      WHERE batch_id = ${batchId}
    `);

    // Mark batch as rolled back
    await db.execute(sql`
      UPDATE import_batches SET
        status = 'rolled_back',
        rolled_back_at = NOW(),
        applied_at = NULL,
        applied_count = 0,
        updated_at = NOW()
      WHERE id = ${batchId}
    `);

    // Log the rollback event
    await db.execute(sql`
      INSERT INTO activity_logs (entity_type, entity_id, action, to_value, performed_by)
      VALUES ('import_batch', ${batchId}, 'batch_rolled_back', ${String(reverted)}, 'system')
    `);

  } catch (err) {
    await db.execute(sql`UPDATE import_batches SET status = 'error', updated_at = NOW() WHERE id = ${batchId}`);
    throw err;
  }

  return { reverted, errors };
}
