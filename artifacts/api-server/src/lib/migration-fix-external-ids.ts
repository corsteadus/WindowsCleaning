import { pool } from "@workspace/db";
import { logger } from "./logger";

interface Fix {
  action: string;
  extId: string;
  fromCrmId?: number;
  toCrmId?: number | null;
  fromName?: string;
  toName?: string;
  reason: string;
}

export async function fixExternalIdAssignments(): Promise<void> {
  const client = await pool.connect();
  try {
    const alreadyRan = await client.query(`
      SELECT 1 FROM import_change_log 
      WHERE operation = 'update' AND entity_type = 'external_id_fix'
      LIMIT 1
    `);
    if (alreadyRan.rows.length > 0) {
      logger.info("[fix-extid] Already ran — skipping.");
      return;
    }

    logger.info("[fix-extid] Starting external ID assignment fixes...");
    await client.query("BEGIN");

    const fixes: Fix[] = [];

    const trueConflicts: { extId: string; wrongCrmId: number; reason: string }[] = [
      { extId: "2089", wrongCrmId: 56, reason: "CRM 'Anita Speaks' but CF says 'Jeri Burke' — different people sharing email" },
      { extId: "952", wrongCrmId: 509, reason: "CRM 'Brentwood Town Homes' but CF says 'JoAnne Hickman' — wrong match" },
      { extId: "1172", wrongCrmId: 1012, reason: "CRM 'Shane Brewer' but CF says 'Patty Brewer' — different person, same last name" },
      { extId: "911", wrongCrmId: 2443, reason: "CRM 'Kathy Barnett' but CF says 'Steven Craig' — known identity conflict" },
    ];

    for (const tc of trueConflicts) {
      await client.query(
        `UPDATE customers SET import_external_id = NULL, updated_at = NOW() WHERE id = $1 AND import_external_id = $2`,
        [tc.wrongCrmId, tc.extId]
      );
      fixes.push({
        action: "null_wrong_assignment",
        extId: tc.extId,
        fromCrmId: tc.wrongCrmId,
        reason: tc.reason,
      });
      logger.info(`[fix-extid] CF #${tc.extId}: Nulled from CRM #${tc.wrongCrmId} — ${tc.reason}`);
    }

    const typoFixes: { extId: string; crmId: number; reason: string }[] = [
      { extId: "1952", crmId: 1731, reason: "'Aaron Fraizer' vs 'Aaron Frazier' — same person, spelling variant. Keeping." },
      { extId: "2326", crmId: 2977, reason: "'Ron Moutray Jr.' vs 'Ron Moutray' — same person, Jr suffix. Keeping." },
    ];

    for (const tf of typoFixes) {
      fixes.push({
        action: "keep_acceptable_variant",
        extId: tf.extId,
        fromCrmId: tf.crmId,
        reason: tf.reason,
      });
      logger.info(`[fix-extid] CF #${tf.extId}: Kept on CRM #${tf.crmId} — ${tf.reason}`);
    }

    for (const fix of fixes) {
      await client.query(`
        INSERT INTO import_change_log (batch_id, operation, entity_type, entity_id, before_json, after_json)
        VALUES (0, 'update', 'external_id_fix', $1, $2, $3)
      `, [
        fix.fromCrmId || 0,
        JSON.stringify({ extId: fix.extId, action: fix.action }),
        JSON.stringify(fix),
      ]);
    }

    await client.query("COMMIT");

    logger.info({
      totalFixes: fixes.length,
      nulled: fixes.filter(f => f.action === "null_wrong_assignment").length,
      kept: fixes.filter(f => f.action === "keep_acceptable_variant").length,
    }, "[fix-extid] External ID assignment fixes complete");

  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err }, "[fix-extid] Failed — rolled back");
    throw err;
  } finally {
    client.release();
  }
}
