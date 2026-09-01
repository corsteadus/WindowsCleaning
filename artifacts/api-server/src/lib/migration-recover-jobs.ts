import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  buildRecoveryActivityLogPayload,
  RECOVERY_ACTIVITY_LOG_FLAG as FLAG,
} from "./migration-recover-jobs-payload.js";

function parseDateVal(s: string): string {
  if (!s) return "";
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (!m) return s;
  const [, mo, da, yr] = m;
  let year = parseInt(yr, 10);
  if (yr.length === 2) year = year >= 50 ? 1900 + year : 2000 + year;
  return `${year}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
}

export async function recoverDeletedImportedJobs() {
  const already = await db.execute(sql`
    SELECT 1 FROM activity_logs WHERE action = ${FLAG} LIMIT 1
  `);
  if ((already.rows as any[]).length > 0) {
    console.log(`[recover-jobs] Already ran (${FLAG}), skipping.`);
    return;
  }

  const v1Flag = "recover_deleted_imported_jobs_v1_ran";
  const v1Ran = await db.execute(sql`
    SELECT 1 FROM activity_logs WHERE action = ${v1Flag} LIMIT 1
  `);
  if ((v1Ran.rows as any[]).length > 0) {
    console.log(`[recover-jobs] v1 already ran, skipping v2.`);
    return;
  }

  console.log("[recover-jobs] Starting recovery from import_change_log...");

  const currentCount = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM jobs WHERE is_imported = true
  `);
  const beforeCount = (currentCount.rows[0] as any).n;
  console.log(`[recover-jobs] Current imported jobs: ${beforeCount}`);

  const PAGE_SIZE = 5000;
  let offset = 0;
  let totalFetched = 0;
  const seen = new Set<string>();
  const uniqueJobs: any[] = [];

  while (true) {
    const batch = await db.execute(sql`
      SELECT entity_id, after_json
      FROM import_change_log
      WHERE entity_type = 'job' AND operation = 'insert'
      ORDER BY id ASC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `);
    const rows = batch.rows as any[];
    if (rows.length === 0) break;

    for (const row of rows) {
      let j: any;
      try {
        j = typeof row.after_json === "string" ? JSON.parse(row.after_json) : row.after_json;
      } catch { continue; }

      if (!j || !j.customerId) continue;

      const key = `${j.customerId}|${j.scheduledDate || ""}|${j.serviceType || ""}|${j.totalAmount || "0"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueJobs.push(j);
    }

    totalFetched += rows.length;
    offset += PAGE_SIZE;
    if (rows.length < PAGE_SIZE) break;
  }

  console.log(`[recover-jobs] Scanned ${totalFetched} change log rows → ${uniqueJobs.length} unique jobs`);

  let restored = 0;
  let skipped = 0;
  let errors = 0;

  for (const j of uniqueJobs) {
    try {
      const customerId = typeof j.customerId === "number" ? j.customerId : parseInt(j.customerId, 10);
      if (!customerId || isNaN(customerId)) { skipped++; continue; }

      const scheduledDate = parseDateVal(j.scheduledDate || "") || null;
      const amount = parseFloat(String(j.totalAmount || "0").replace(/[^0-9.-]/g, "")) || 0;
      const jobNum = j.jobNumber
        ? j.jobNumber
        : `REC-${customerId}-${(scheduledDate || "nodate").replace(/-/g, "")}-${Math.random().toString(36).slice(2, 5)}`;

      const existing = await db.execute(sql`
        SELECT 1 FROM jobs
        WHERE customer_id = ${customerId}
          AND scheduled_date = ${scheduledDate}
          AND COALESCE(service_type, '') = ${j.serviceType || ""}
          AND total_amount = ${amount}
        LIMIT 1
      `);
      if ((existing.rows as any[]).length > 0) { skipped++; continue; }

      const combinedNotes = [j.notes, j.techNotes].filter(Boolean).join("\n").trim() || null;

      await db.execute(sql`
        INSERT INTO jobs (
          customer_id, job_number, status, service_type,
          scheduled_date, total_amount, notes, is_imported,
          import_source, import_external_id, import_batch_id,
          created_at, updated_at
        ) VALUES (
          ${customerId}, ${jobNum}, ${j.status || "completed"},
          ${j.serviceType || null}, ${scheduledDate},
          ${amount}, ${combinedNotes},
          true, 'customer_factor', ${j.cfCustomerId || null}, 0,
          NOW(), NOW()
        )
      `);
      restored++;
    } catch (err: any) {
      errors++;
      if (errors <= 10) console.error(`[recover-jobs] Insert error: ${err.message}`);
    }
  }

  console.log(`[recover-jobs] Complete: restored=${restored} skipped=${skipped} errors=${errors}`);

  const activityLog = buildRecoveryActivityLogPayload({
    restored,
    skipped,
    errors,
    uniqueJobs: uniqueJobs.length,
    totalScanned: totalFetched,
    beforeCount,
  });
  await db.execute(sql`
    INSERT INTO activity_logs (entity_type, entity_id, action, performed_by, note)
    VALUES (
      ${activityLog.entityType},
      ${activityLog.entityId},
      ${activityLog.action},
      ${activityLog.performedBy},
      ${activityLog.note}
    )
  `);

  console.log(`[recover-jobs] Done. ${restored} jobs recovered.`);
}
