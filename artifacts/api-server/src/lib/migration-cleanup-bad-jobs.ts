import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const FLAG = "cleanup_bad_imported_jobs_v1_ran";

export async function cleanupBadImportedJobs() {
  const already = await db.execute(sql`
    SELECT 1 FROM activity_logs WHERE action = ${FLAG} LIMIT 1
  `);
  if ((already.rows as any[]).length > 0) {
    console.log(`[cleanup-bad-jobs] Already ran (${FLAG}), skipping.`);
    return;
  }

  console.log("[cleanup-bad-jobs] Starting cleanup of pre-grouping imported jobs...");

  const countBefore = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM jobs WHERE is_imported = true
  `);
  const totalBefore = (countBefore.rows[0] as any).n;
  console.log(`[cleanup-bad-jobs] Total imported jobs before cleanup: ${totalBefore}`);

  const toDelete = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM jobs
    WHERE is_imported = true
      AND import_source = 'customer_factor'
      AND line_items IS NULL
  `);
  const deleteTarget = (toDelete.rows[0] as any).n;
  console.log(`[cleanup-bad-jobs] Jobs targeted for deletion (pre-grouping, no line_items): ${deleteTarget}`);

  if (deleteTarget === 0) {
    console.log("[cleanup-bad-jobs] Nothing to delete.");
  } else {
    await db.execute(sql`
      DELETE FROM jobs
      WHERE is_imported = true
        AND import_source = 'customer_factor'
        AND line_items IS NULL
    `);
    console.log(`[cleanup-bad-jobs] Deleted ${deleteTarget} bad imported jobs`);
  }

  const countAfter = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM jobs WHERE is_imported = true
  `);
  const remaining = (countAfter.rows[0] as any).n;
  console.log(`[cleanup-bad-jobs] Remaining imported jobs: ${remaining}`);

  await db.execute(sql`
    INSERT INTO activity_logs (entity_type, entity_id, action, performed_by, details)
    VALUES ('system', 0, ${FLAG}, 'migration',
      ${JSON.stringify({
        totalBefore,
        deleted: deleteTarget,
        remaining,
        reason: "Deleted pre-grouping imported jobs that created one job per service row instead of one per invoice"
      })}::jsonb
    )
  `);

  console.log(`[cleanup-bad-jobs] Done. Deleted ${deleteTarget} jobs, ${remaining} imported jobs remain.`);
}
