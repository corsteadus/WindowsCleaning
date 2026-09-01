/**
 * Server-side Customer Factor data import.
 * Reads SQL dump + optional CSV supplement from attached_assets/ and loads
 * all customers + jobs into PostgreSQL.  Called at startup when the DB has
 * only demo seed data (≤ 13 customers).
 */

import path from "path";
import fs from "fs";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.ts";

// ─── helpers ─────────────────────────────────────────────────────────────────

function parseMysqlValues(str: string): (string | null)[][] {
  const rows: (string | null)[][] = [];
  let i = 0; const n = str.length;
  while (i < n) {
    while (i < n && str[i] !== "(" && str[i] !== ";") i++;
    if (i >= n || str[i] === ";") break;
    i++;
    const row: (string | null)[] = [];
    while (i < n) {
      while (i < n && (str[i] === " " || str[i] === "\n" || str[i] === "\r")) i++;
      if (str[i] === ")") { i++; break; }
      if (str.substring(i, i + 4) === "NULL") { row.push(null); i += 4; }
      else if (str[i] === "'") {
        i++; let val = "";
        while (i < n) {
          if (str[i] === "\\") { i++; const c = str[i++]; val += c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c; }
          else if (str[i] === "'") { i++; break; }
          else val += str[i++];
        }
        row.push(val);
      } else {
        let val = ""; while (i < n && str[i] !== "," && str[i] !== ")") val += str[i++];
        row.push(val.trim() === "" ? null : val.trim());
      }
      while (i < n && (str[i] === " " || str[i] === "\n" || str[i] === "\r")) i++;
      if (i < n && str[i] === ",") i++;
    }
    rows.push(row);
    while (i < n && (str[i] === " " || str[i] === "\n" || str[i] === "\r" || str[i] === ",")) i++;
  }
  return rows;
}

function extractSQLTable(sqlText: string, tableName: string): (string | null)[][] {
  const marker = `Dumping data for table \`${tableName}\``;
  const start = sqlText.indexOf(marker);
  if (start === -1) return [];
  const next = sqlText.indexOf("Dumping data for table `", start + marker.length);
  const section = sqlText.substring(start, next === -1 ? sqlText.length : next);
  const pat = `INSERT INTO \`${tableName}\` VALUES `;
  const all: (string | null)[][] = [];
  let pos = 0;
  while (true) {
    const ins = section.indexOf(pat, pos);
    if (ins === -1) break;
    let end = ins + pat.length; let inStr = false;
    while (end < section.length) {
      if (inStr) { if (section[end] === "\\") { end += 2; continue; } if (section[end] === "'") inStr = false; }
      else { if (section[end] === "'") inStr = true; else if (section[end] === ";") break; }
      end++;
    }
    all.push(...parseMysqlValues(section.substring(ins + pat.length, end)));
    pos = end + 1;
  }
  return all;
}

function getSQLColMap(sqlText: string, tableName: string): Record<string, number> {
  const marker = `CREATE TABLE \`${tableName}\``;
  const start = sqlText.indexOf(marker);
  if (start === -1) return {};
  const bodyStart = sqlText.indexOf("(", start) + 1;
  const engineIdx = sqlText.indexOf(") ENGINE=", bodyStart);
  const map: Record<string, number> = {};
  let idx = 0;
  for (const line of sqlText.substring(bodyStart, engineIdx).split("\n")) {
    const t = line.trim(), m = t.match(/^`(\w+)`/);
    if (m && !t.startsWith("PRIMARY") && !t.startsWith("KEY") && !t.startsWith("UNIQUE")) map[m[1]] = idx++;
  }
  return map;
}

function safeInt(val: string | null | undefined): number | null {
  if (!val) return null;
  const n = parseInt(val.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function safeFloat(val: string | null | undefined): number {
  if (!val) return 0;
  const n = parseFloat(val.trim());
  return Number.isFinite(n) ? n : 0;
}

// ─── CSV window count supplement ─────────────────────────────────────────────

function parseCSVWindowCounts(csvText: string): Map<string, number> {
  const map = new Map<string, number>();
  const lines = csvText.split("\n");
  if (lines.length < 2) return map;

  // Parse header
  const headers: string[] = [];
  let buf = "", inQ = false;
  for (const ch of lines[0]) {
    if (inQ) { if (ch === '"') inQ = false; else buf += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ",") { headers.push(buf.trim()); buf = ""; }
    else buf += ch;
  }
  headers.push(buf.trim());

  const idIdx  = headers.indexOf("Id");
  const winIdx = headers.indexOf("Window Count");
  if (idIdx === -1 || winIdx === -1) return map;

  for (let li = 1; li < lines.length; li++) {
    const cols: string[] = [];
    buf = ""; inQ = false;
    for (const ch of lines[li]) {
      if (inQ) { if (ch === '"') inQ = false; else buf += ch; }
      else if (ch === '"') inQ = true;
      else if (ch === ",") { cols.push(buf.trim()); buf = ""; }
      else buf += ch;
    }
    cols.push(buf.trim());
    const id  = cols[idIdx]?.trim();
    const win = safeInt(cols[winIdx]);
    if (id && win !== null) map.set(id, win);
  }
  return map;
}

// ─── find attached files ──────────────────────────────────────────────────────

function findAttachedAssets(): { sqlFile: string | null; csvFile: string | null } {
  // __dirname is set by esbuild banner to the dist/ folder
  // Go up 3 levels: dist/ → api-server/ → artifacts/ → workspace root
  const candidates = [
    path.resolve(__dirname, "../../../attached_assets"),
    path.resolve(process.cwd(), "../../attached_assets"),
    path.resolve(process.cwd(), "attached_assets"),
  ];

  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);
    const sqlFile = files.find(f => f.startsWith("superior-") && f.endsWith(".sql"));
    const csvFile = files.find(f => f.startsWith("customers-") && f.endsWith(".csv"));
    if (sqlFile) {
      return {
        sqlFile: path.join(dir, sqlFile),
        csvFile: csvFile ? path.join(dir, csvFile) : null,
      };
    }
  }
  return { sqlFile: null, csvFile: null };
}

// ─── main import function ─────────────────────────────────────────────────────

export async function importCFDataFromFiles(): Promise<{
  customersCreated: number; jobsCreated: number; skipped: number;
}> {
  const { sqlFile, csvFile } = findAttachedAssets();

  if (!sqlFile) {
    logger.info("No Customer Factor SQL file found in attached_assets — skipping auto-import");
    return { customersCreated: 0, jobsCreated: 0, skipped: 0 };
  }

  logger.info({ sqlFile, csvFile }, "Auto-importing Customer Factor data from files…");

  const sqlText = fs.readFileSync(sqlFile, "utf8");

  // Optional CSV supplement for window counts
  const windowCounts = csvFile
    ? parseCSVWindowCounts(fs.readFileSync(csvFile, "utf8"))
    : new Map<string, number>();

  const cc = getSQLColMap(sqlText, "superior_customers");
  const cj = getSQLColMap(sqlText, "superior_customer_jobs");
  const g  = (row: (string | null)[], col: Record<string, number>, name: string) =>
    (col[name] !== undefined ? row[col[name]] : null) ?? null;

  const customerRows = extractSQLTable(sqlText, "superior_customers");
  const jobRows      = extractSQLTable(sqlText, "superior_customer_jobs");

  logger.info({ customers: customerRows.length, jobs: jobRows.length }, "Parsed SQL dump");

  let customersCreated = 0, jobsCreated = 0, skipped = 0;
  const cfIdToDbId = new Map<string, number>();

  // ── Insert customers ──────────────────────────────────────────────────────
  for (const row of customerRows) {
    const cfId       = g(row, cc, "c_id") ?? "";
    const firstName  = (g(row, cc, "first_name")   ?? "").trim();
    const lastName   = (g(row, cc, "last_name")    ?? "").trim();
    const companyName = (g(row, cc, "company_name") ?? "").trim() || null;
    const email      = (g(row, cc, "email") ?? "").toLowerCase().trim() || null;
    const homePhone  = (g(row, cc, "phone") ?? "").trim() || null;
    const workPhone  = (g(row, cc, "phone2") ?? "").trim() || null;
    const cellPhone  = (g(row, cc, "phone3") ?? "").trim() || null;

    if (!firstName && !lastName && !companyName) { skipped++; continue; }

    try {
      // Dedup by email
      let existingId: number | null = null;
      if (email) {
        const r = await db.execute(sql`SELECT id FROM customers WHERE email = ${email} LIMIT 1`);
        if ((r.rows as any[]).length) existingId = (r.rows[0] as any).id;
      }
      // Dedup by name + phone
      if (!existingId && firstName && lastName && homePhone) {
        const r = await db.execute(sql`
          SELECT id FROM customers
          WHERE first_name=${firstName} AND last_name=${lastName} AND home_phone=${homePhone}
          LIMIT 1`);
        if ((r.rows as any[]).length) existingId = (r.rows[0] as any).id;
      }

      if (existingId) {
        cfIdToDbId.set(cfId, existingId);
        skipped++;
        continue;
      }

      const addr1      = (g(row, cc, "address")  ?? "").trim();
      const addr2      = (g(row, cc, "address2") ?? "").trim();
      const starRaw    = g(row, cc, "star_rating");
      const catVal     = g(row, cc, "cat") ?? "";
      const csvWin     = windowCounts.get(cfId) ?? null;
      const winRaw     = g(row, cc, "window_count");
      const windowCount = csvWin ?? safeInt(winRaw);
      const starRating  = safeInt(starRaw);
      const status      = catVal === "lead" ? "lead" : "active";
      const tags        = catVal === "commercial" ? "commercial" : null;
      const dateAdded   = (g(row, cc, "date_added") ?? "").trim() || null;
      const notes       = (g(row, cc, "notes") ?? "").trim() || null;
      const howHeard    = (g(row, cc, "hearus") ?? "").trim() || null;
      const altContact  = (g(row, cc, "contact_person") ?? "").trim() || null;
      const billingAddress = addr2 ? `${addr1} ${addr2}`.trim() : addr1 || null;

      const r = await db.execute(sql`
        INSERT INTO customers (
          first_name, last_name, company_name, email,
          home_phone, work_phone, cell_phone,
          billing_address, billing_city, billing_state, billing_zip,
          notes, how_heard, star_rating, window_count,
          alt_contact, customer_date, status, tags, created_at, updated_at
        ) VALUES (
          ${firstName}, ${lastName}, ${companyName}, ${email},
          ${homePhone}, ${workPhone}, ${cellPhone},
          ${billingAddress},
          ${(g(row, cc, "city") ?? "").trim() || null},
          ${(g(row, cc, "state") ?? "").trim() || null},
          ${(g(row, cc, "zip") ?? "").trim() || null},
          ${notes}, ${howHeard}, ${starRating}, ${windowCount},
          ${altContact}, ${dateAdded}, ${status}, ${tags}, NOW(), NOW()
        ) RETURNING id`);
      const newId = (r.rows[0] as any).id;
      cfIdToDbId.set(cfId, newId);
      customersCreated++;
    } catch (err) {
      logger.warn({ cfId, err: (err as Error).message }, "Customer import error");
      skipped++;
    }
  }

  // ── Insert jobs ───────────────────────────────────────────────────────────
  for (const row of jobRows) {
    const cfCustomerId = g(row, cj, "c_id") ?? "";
    const dbCustomerId = cfIdToDbId.get(cfCustomerId);
    if (!dbCustomerId) { skipped++; continue; }

    const cjId      = g(row, cj, "cj_id") ?? "";
    const jobNumber = `J-${cjId}`;
    const dateNum   = parseInt(g(row, cj, "date") ?? "0", 10);
    const scheduledDate = dateNum > 0
      ? new Date(dateNum * 1000).toISOString().slice(0, 10)
      : null;
    const amount = safeFloat(g(row, cj, "est"));
    const notes  = (g(row, cj, "invoice_comments") ?? "").trim() || null;

    try {
      const exists = await db.execute(sql`SELECT id FROM jobs WHERE job_number=${jobNumber} LIMIT 1`);
      if ((exists.rows as any[]).length) { skipped++; continue; }

      await db.execute(sql`
        INSERT INTO jobs (
          customer_id, job_number, status, service_type,
          scheduled_date, total_amount, notes, created_at, updated_at
        ) VALUES (
          ${dbCustomerId}, ${jobNumber}, 'completed',
          ${(g(row, cj, "job_type") ?? "").trim() || null},
          ${scheduledDate}, ${amount}, ${notes}, NOW(), NOW()
        )`);
      jobsCreated++;
    } catch (err) {
      logger.warn({ jobNumber, err: (err as Error).message }, "Job import error");
      skipped++;
    }
  }

  logger.info({ customersCreated, jobsCreated, skipped }, "Auto-import from Customer Factor files complete");
  return { customersCreated, jobsCreated, skipped };
}
