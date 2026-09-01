import { pool } from "@workspace/db";
import { logger } from "./logger";

export async function deduplicateExternalIds(): Promise<void> {
  const client = await pool.connect();
  try {
    const dupes = await client.query(`
      SELECT import_external_id
      FROM customers
      WHERE import_external_id IS NOT NULL AND import_external_id != ''
      GROUP BY import_external_id
      HAVING COUNT(*) > 1
    `);

    if (dupes.rows.length === 0) {
      logger.info("[dedup-migration] No duplicate import_external_id values found.");
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_import_external_id
        ON customers (import_external_id)
        WHERE import_external_id IS NOT NULL AND import_external_id != ''
      `);
      logger.info("[dedup-migration] Unique partial index ensured on import_external_id.");
      return;
    }

    logger.info({ groups: dupes.rows.length }, "[dedup-migration] Found duplicate groups — starting cleanup");

    await client.query("BEGIN");

    const changelog: any[] = [];

    for (const { import_external_id: extId } of dupes.rows) {
      const members = await client.query(`
        SELECT c.id, c.first_name, c.last_name, c.email, c.import_external_id,
               c.updated_at,
               (SELECT COUNT(*) FROM jobs WHERE customer_id = c.id)::int AS job_count,
               (SELECT COUNT(*) FROM invoices WHERE customer_id = c.id)::int AS inv_count,
               (SELECT COUNT(*) FROM properties WHERE customer_id = c.id)::int AS prop_count
        FROM customers c
        WHERE c.import_external_id = $1
        ORDER BY c.id
      `, [extId]);

      const rows = members.rows.map((r: any) => ({
        ...r,
        linked_total: r.job_count + r.inv_count + r.prop_count,
        has_email: !!(r.email && r.email.trim()),
      }));

      rows.sort((a: any, b: any) => {
        if (b.job_count !== a.job_count) return b.job_count - a.job_count;
        if (a.has_email !== b.has_email) return a.has_email ? -1 : 1;
        const dateA = new Date(a.updated_at || 0).getTime();
        const dateB = new Date(b.updated_at || 0).getTime();
        if (dateB !== dateA) return dateB - dateA;
        return a.id - b.id;
      });

      const keeper = rows[0];
      const losers = rows.slice(1);

      for (const loser of losers) {
        const entry: any = {
          externalId: extId,
          keeperId: keeper.id,
          keeperName: `${keeper.first_name ?? ""} ${keeper.last_name ?? ""}`.trim(),
          keeperJobs: keeper.job_count,
          loserId: loser.id,
          loserName: `${loser.first_name ?? ""} ${loser.last_name ?? ""}`.trim(),
          loserJobs: loser.job_count,
          jobsMoved: 0,
          invoicesMoved: 0,
          propertiesMoved: 0,
        };

        if (loser.job_count > 0) {
          const r = await client.query(
            `UPDATE jobs SET customer_id = $1 WHERE customer_id = $2`,
            [keeper.id, loser.id]
          );
          entry.jobsMoved = r.rowCount ?? 0;
        }

        if (loser.inv_count > 0) {
          const r = await client.query(
            `UPDATE invoices SET customer_id = $1 WHERE customer_id = $2`,
            [keeper.id, loser.id]
          );
          entry.invoicesMoved = r.rowCount ?? 0;
        }

        if (loser.prop_count > 0) {
          const r = await client.query(
            `UPDATE properties SET customer_id = $1 WHERE customer_id = $2`,
            [keeper.id, loser.id]
          );
          entry.propertiesMoved = r.rowCount ?? 0;
        }

        await client.query(
          `UPDATE customers SET import_external_id = NULL, updated_at = NOW() WHERE id = $1`,
          [loser.id]
        );

        changelog.push(entry);
        logger.info(entry, `[dedup-migration] CF #${extId}: Keep #${keeper.id} (${entry.keeperName}, ${keeper.job_count}j), NULL #${loser.id} (${entry.loserName}, ${loser.job_count}j → moved ${entry.jobsMoved}j ${entry.invoicesMoved}i ${entry.propertiesMoved}p)`);
      }
    }

    await client.query("COMMIT");

    logger.info({
      totalActions: changelog.length,
      changelog,
    }, "[dedup-migration] Cleanup complete — all duplicate import_external_id values resolved");

    const verify = await client.query(`
      SELECT import_external_id, COUNT(*) AS cnt
      FROM customers
      WHERE import_external_id IS NOT NULL AND import_external_id != ''
      GROUP BY import_external_id
      HAVING COUNT(*) > 1
    `);

    if (verify.rows.length === 0) {
      logger.info("[dedup-migration] Verified: zero duplicates remain. Creating unique index...");
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_import_external_id
        ON customers (import_external_id)
        WHERE import_external_id IS NOT NULL AND import_external_id != ''
      `);
      logger.info("[dedup-migration] Unique partial index created on import_external_id");
    } else {
      logger.warn({ remaining: verify.rows }, "[dedup-migration] WARNING: duplicates still remain after cleanup!");
    }

  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err }, "[dedup-migration] Failed — rolled back all changes");
    throw err;
  } finally {
    client.release();
  }
}
