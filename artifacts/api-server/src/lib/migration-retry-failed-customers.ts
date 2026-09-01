import { pool } from "@workspace/db";
import { logger } from "./logger";

function safeInt(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = parseInt(String(v), 10);
  return isNaN(n) ? null : n;
}

export async function retryFailedCustomerInserts(): Promise<void> {
  const client = await pool.connect();
  try {
    const alreadyRan = await client.query(`
      SELECT after_json FROM import_change_log 
      WHERE operation = 'update' AND entity_type = 'retry_failed_customers'
      ORDER BY id DESC LIMIT 1
    `);
    if (alreadyRan.rows.length > 0) {
      const result = typeof alreadyRan.rows[0].after_json === "string"
        ? JSON.parse(alreadyRan.rows[0].after_json)
        : alreadyRan.rows[0].after_json;
      if (!result.errors || result.errors === 0) {
        logger.info("[retry-failed] Already ran — skipping.");
        return;
      }
      logger.info({ prevErrors: result.errors }, "[retry-failed] Previous run had errors — retrying with savepoints.");
      await client.query(`DELETE FROM import_change_log WHERE operation = 'update' AND entity_type = 'retry_failed_customers'`);
    }

    const failedRows = await client.query(`
      SELECT DISTINCT ON (external_id) id, batch_id, external_id, normalized_data
      FROM import_staging_rows
      WHERE entity_type = 'customer'
        AND status = 'error'
        AND match_method = 'auto_created'
        AND external_id IS NOT NULL AND external_id != ''
      ORDER BY external_id, id DESC
    `);

    if (failedRows.rows.length === 0) {
      logger.info("[retry-failed] No failed auto_created customer rows found.");
      await client.query(`
        INSERT INTO import_change_log (batch_id, operation, entity_type, entity_id, before_json, after_json)
        VALUES (0, 'update', 'retry_failed_customers', 0, '{}', '{"count": 0}')
      `);
      return;
    }

    logger.info({ count: failedRows.rows.length }, "[retry-failed] Retrying failed auto_created customer inserts...");
    await client.query("BEGIN");

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of failedRows.rows) {
      const extId = row.external_id;
      const n = typeof row.normalized_data === "string" ? JSON.parse(row.normalized_data) : row.normalized_data;

      const alreadyExists = await client.query(
        `SELECT id FROM customers WHERE import_external_id = $1 LIMIT 1`,
        [extId]
      );
      if (alreadyExists.rows.length > 0) {
        skipped++;
        await client.query(
          `UPDATE import_staging_rows SET status = 'applied', matched_entity_id = $1, error_message = NULL WHERE id = $2`,
          [alreadyExists.rows[0].id, row.id]
        );
        continue;
      }

      try {
        await client.query(`SAVEPOINT retry_${row.id}`);

        const firstName = n.firstName || null;
        const lastName = n.lastName || n.companyName || "Unknown";
        const starRating = safeInt(n.starRating);
        const windowCount = safeInt(n.windowCount);

        const result = await client.query(`
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
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10, $11,
            $12, $13, $14, $15,
            $16, $17, $18, $19, $20,
            $21, $22, $23,
            $24, 'active', $25,
            'customer_factor', $26, $27, true,
            NOW(), NOW(), NOW()
          ) RETURNING id
        `, [
          firstName, lastName, n.companyName || null,
          n.salutation || null, n.email || null,
          n.homePhone || null, n.workPhone || null, n.cellPhone || null,
          n.fax || null, n.altPhone || null, n.altContact || null,
          n.billingAddress || null, n.billingCity || null, n.billingState || null, n.billingZip || null,
          n.notes || null, n.howHeard || null, starRating, windowCount,
          n.windowType || null, n.houseSize || null, n.laddersNeeded || null,
          n.sendingPreferences || null, n.customerDate || null,
          n.clientType || "residential",
          n.externalId || extId || null, row.batch_id,
        ]);

        const newId = result.rows[0].id;
        created++;

        await client.query(
          `UPDATE import_staging_rows SET status = 'applied', matched_entity_id = $1, error_message = NULL WHERE id = $2`,
          [newId, row.id]
        );

        await client.query(`
          INSERT INTO import_change_log (batch_id, operation, entity_type, entity_id, before_json, after_json)
          VALUES ($1, 'insert', 'customer', $2, NULL, $3)
        `, [row.batch_id, newId, JSON.stringify({ ...n, id: newId, _source: "retry_failed_customers" })]);

        await client.query(`RELEASE SAVEPOINT retry_${row.id}`);
        logger.info(`[retry-failed] CF #${extId}: Created customer #${newId} — ${n.firstName} ${n.lastName}`);

      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT retry_${row.id}`).catch(() => {});
        errors++;
        const msg = (err as Error).message || String(err);
        logger.error(`[retry-failed] CF #${extId}: Still failing — ${msg.slice(0, 200)}`);
      }
    }

    await client.query(`
      INSERT INTO import_change_log (batch_id, operation, entity_type, entity_id, before_json, after_json)
      VALUES (0, 'update', 'retry_failed_customers', 0, '{}', $1)
    `, [JSON.stringify({ created, skipped, errors, total: failedRows.rows.length })]);

    await client.query("COMMIT");

    logger.info({
      total: failedRows.rows.length,
      created,
      skipped,
      errors,
    }, "[retry-failed] Retry complete");

  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err }, "[retry-failed] Failed — rolled back");
    throw err;
  } finally {
    client.release();
  }
}
