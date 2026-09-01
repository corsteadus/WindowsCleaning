import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

function parseDateToISO(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const slashMatch = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (slashMatch) {
    const [, mStr, dStr, yStr] = slashMatch;
    let year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10);
    const day = parseInt(dStr, 10);
    if (yStr.length === 2) {
      year = year >= 50 ? 1900 + year : 2000 + year;
    }
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

export async function deduplicateJobs() {
  const flagRes = await db.execute(sql`
    SELECT 1 FROM activity_logs WHERE action = 'dedup_jobs_v3_ran' LIMIT 1
  `);
  if ((flagRes.rows as any[]).length > 0) {
    console.log("[dedup-jobs] Already ran — skipping.");
    return;
  }

  const idxRes = await db.execute(sql`
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_jobs_customer_job_number_unique'
  `);
  if ((idxRes.rows as any[]).length > 0) {
    await db.execute(sql`DROP INDEX idx_jobs_customer_job_number_unique`);
    console.log("[dedup-jobs] Dropped unique index idx_jobs_customer_job_number_unique.");
  }

  const unparsedRes = await db.execute(sql`
    SELECT id, scheduled_date FROM jobs
    WHERE scheduled_date IS NOT NULL
      AND scheduled_date != ''
      AND scheduled_date !~ '^\d{4}-\d{2}-\d{2}$'
  `);
  const unparsed = unparsedRes.rows as any[];
  let fixed = 0;
  let nullified = 0;

  for (const row of unparsed) {
    const parsed = parseDateToISO(row.scheduled_date);
    if (parsed) {
      await db.execute(sql`UPDATE jobs SET scheduled_date = ${parsed}, updated_at = NOW() WHERE id = ${row.id}`);
      fixed++;
    } else {
      await db.execute(sql`UPDATE jobs SET scheduled_date = NULL, updated_at = NOW() WHERE id = ${row.id}`);
      nullified++;
    }
  }

  console.log(`[dedup-jobs] Cleanup summary:`);
  console.log(`[dedup-jobs]   Dates converted to YYYY-MM-DD: ${fixed}`);
  if (nullified > 0) {
    console.log(`[dedup-jobs]   Unparseable dates nullified: ${nullified}`);
  }

  await db.execute(sql`
    INSERT INTO activity_logs (entity_type, entity_id, action, to_value, performed_by)
    VALUES ('system', 0, 'dedup_jobs_v3_ran', ${JSON.stringify({ datesFixed: fixed, datesNullified: nullified })}, 'system')
  `);
}
