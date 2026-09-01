/**
 * Phase 3 Historical Data Import
 *
 * Imports from the same SQL dump used for customers/jobs:
 *   superior_invoices        → invoices table
 *   superior_estimates       → quotes table
 *   superior_estimate_details → quote_line_items table
 *   superior_prospects       → leads table
 *
 * Challenge: customer ids in the dump (c_id) no longer map directly to DB ids.
 * Solution: Rebuild c_id→db_id mapping by parsing dump customers and matching
 *           against our DB using email (primary) then name+city (fallback).
 */

import { readFileSync } from 'fs';
import pg from '/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ─── MySQL parser (copied from import-from-sql.mjs) ──────────────────────────

function parseMysqlValues(str) {
  const rows = [];
  let i = 0;
  const n = str.length;
  while (i < n) {
    while (i < n && str[i] !== '(' && str[i] !== ';') i++;
    if (i >= n || str[i] === ';') break;
    i++;
    const row = [];
    while (i < n) {
      while (i < n && (str[i] === ' ' || str[i] === '\n' || str[i] === '\r')) i++;
      if (str[i] === ')') { i++; break; }
      if (str.substring(i, i + 4) === 'NULL') { row.push(null); i += 4; }
      else if (str[i] === "'") {
        i++;
        let val = '';
        while (i < n) {
          if (str[i] === '\\') { i++; const c = str[i++]; if (c === 'n') val += '\n'; else if (c === 'r') val += '\r'; else if (c === 't') val += '\t'; else val += c; }
          else if (str[i] === "'") { i++; break; }
          else { val += str[i++]; }
        }
        row.push(val);
      } else {
        let val = '';
        while (i < n && str[i] !== ',' && str[i] !== ')') val += str[i++];
        const trimmed = val.trim();
        row.push(trimmed === '' ? null : trimmed);
      }
      while (i < n && (str[i] === ' ' || str[i] === '\n' || str[i] === '\r')) i++;
      if (i < n && str[i] === ',') i++;
    }
    rows.push(row);
    while (i < n && (str[i] === ' ' || str[i] === '\n' || str[i] === '\r' || str[i] === ',')) i++;
  }
  return rows;
}

function extractTableSection(sql, tableName) {
  const marker = `Dumping data for table \`${tableName}\``;
  const sectionStart = sql.indexOf(marker);
  if (sectionStart === -1) throw new Error(`Table ${tableName} not found`);
  const nextDump = sql.indexOf('Dumping data for table `', sectionStart + marker.length);
  const sectionEnd = nextDump === -1 ? sql.length : nextDump;
  const section = sql.substring(sectionStart, sectionEnd);
  const insertPattern = `INSERT INTO \`${tableName}\` VALUES `;
  const allRows = [];
  let pos = 0;
  while (true) {
    const ins = section.indexOf(insertPattern, pos);
    if (ins === -1) break;
    const valStart = ins + insertPattern.length;
    let end = valStart;
    let inStr = false;
    while (end < section.length) {
      if (inStr) { if (section[end] === '\\') { end += 2; continue; } if (section[end] === "'") inStr = false; }
      else { if (section[end] === "'") inStr = true; else if (section[end] === ';') break; }
      end++;
    }
    allRows.push(...parseMysqlValues(section.substring(valStart, end)));
    pos = end + 1;
  }
  return allRows;
}

function getColIndices(sql, tableName) {
  const createMarker = `CREATE TABLE \`${tableName}\``;
  const start = sql.indexOf(createMarker);
  if (start === -1) throw new Error(`CREATE TABLE for ${tableName} not found`);
  const bodyStart = sql.indexOf('(', start) + 1;
  const engineIdx = sql.indexOf(') ENGINE=', bodyStart);
  const body = sql.substring(bodyStart, engineIdx);
  const lines = body.split('\n').filter(l => {
    const t = l.trim();
    return t.match(/^`\w+`/) && !t.startsWith('PRIMARY') && !t.startsWith('KEY') && !t.startsWith('UNIQUE');
  });
  const map = {};
  lines.forEach((l, i) => { map[l.trim().match(/^`(\w+)`/)[1]] = i; });
  return map;
}

function clean(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '' || s === '--' || s === 'N/A' || s === 'n/a') return null;
  return s;
}

function unixToDate(v) {
  if (!v || v === '0' || v === 0) return null;
  const ts = typeof v === 'number' ? v : parseInt(v, 10);
  if (isNaN(ts) || ts <= 0) return null;
  return new Date(ts * 1000).toISOString().split('T')[0];
}

function unixToTs(v) {
  if (!v || v === '0' || v === 0) return null;
  const ts = typeof v === 'number' ? v : parseInt(v, 10);
  if (isNaN(ts) || ts <= 0) return null;
  return new Date(ts * 1000).toISOString();
}

function toNum(v, def = 0) {
  if (v === null || v === undefined) return def;
  const n = parseFloat(String(v));
  return isNaN(n) ? def : n;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Reading SQL dump…');
  const sql = readFileSync('attached_assets/superior-2026-03-30-13-16-12_1774911409675.sql', 'latin1');

  // ── Column indices ───────────────────────────────────────────────────────────
  const CC  = getColIndices(sql, 'superior_customers');
  const CI  = getColIndices(sql, 'superior_invoices');
  const CE  = getColIndices(sql, 'superior_estimates');
  const CED = getColIndices(sql, 'superior_estimate_details');
  const CP  = getColIndices(sql, 'superior_prospects');

  // ── Parse rows from dump ─────────────────────────────────────────────────────
  console.log('Parsing tables from dump…');
  const custRows     = extractTableSection(sql, 'superior_customers');
  const invoiceRows  = extractTableSection(sql, 'superior_invoices');
  const estimateRows = extractTableSection(sql, 'superior_estimates');
  const estDetRows   = extractTableSection(sql, 'superior_estimate_details');
  const prospRows    = extractTableSection(sql, 'superior_prospects');

  console.log(`  superior_customers:        ${custRows.length}`);
  console.log(`  superior_invoices:         ${invoiceRows.length}`);
  console.log(`  superior_estimates:        ${estimateRows.length}`);
  console.log(`  superior_estimate_details: ${estDetRows.length}`);
  console.log(`  superior_prospects:        ${prospRows.length}`);

  // ── Rebuild c_id → db_id mapping ────────────────────────────────────────────
  console.log('\nRebuilding customer ID mapping…');

  // Build lookup from dump
  const dumpCustById = new Map(); // c_id → {email, firstName, lastName, city, zip}
  for (const row of custRows) {
    const cId    = parseInt(row[CC.c_id], 10);
    const email  = clean(row[CC.email])?.toLowerCase();
    const first  = (clean(row[CC.first_name]) || '').toLowerCase();
    const last   = (clean(row[CC.last_name])  || '').toLowerCase();
    const city   = (clean(row[CC.city])       || '').toLowerCase();
    const zip    = (clean(row[CC.zip])        || '');
    dumpCustById.set(cId, { email, first, last, city, zip });
  }

  // Fetch all DB customers
  const dbCusts = await pool.query(
    `SELECT id, LOWER(COALESCE(email,'')) as email, LOWER(first_name) as first, LOWER(last_name) as last, LOWER(COALESCE(billing_city,'')) as city, COALESCE(billing_zip,'') as zip FROM customers`
  );

  // Build email → db_id and name+city → db_id maps (take first match)
  const emailToId    = new Map();
  const nameToId     = new Map();
  for (const r of dbCusts.rows) {
    if (r.email) emailToId.set(r.email, r.id);
    const key = `${r.first}|${r.last}|${r.city}`;
    if (!nameToId.has(key)) nameToId.set(key, r.id);
  }

  // Build c_id → db_id
  const cIdToDbId = new Map();
  let matched = 0, unmatched = 0;
  for (const [cId, c] of dumpCustById) {
    let dbId = c.email ? emailToId.get(c.email) : null;
    if (!dbId) {
      const key = `${c.first}|${c.last}|${c.city}`;
      dbId = nameToId.get(key);
    }
    if (dbId) { cIdToDbId.set(cId, dbId); matched++; }
    else unmatched++;
  }
  console.log(`  Matched: ${matched}, Unmatched: ${unmatched}`);

  // ── Import invoices ───────────────────────────────────────────────────────────
  console.log('\nImporting invoices…');

  // Check existing
  const existingInv = await pool.query('SELECT COUNT(*) FROM invoices');
  if (parseInt(existingInv.rows[0].count) > 0) {
    console.log(`  Invoices already imported (${existingInv.rows[0].count} rows) — skipping.`);
    console.log('  To re-import, run: DELETE FROM invoices;');
  } else {
    let invInserted = 0, invSkipped = 0;
    const BATCH = 200;

    for (let b = 0; b < invoiceRows.length; b += BATCH) {
      const batch = invoiceRows.slice(b, b + BATCH);
      const values = [];
      const params = [];
      let pi = 1;

      for (const row of batch) {
        const cId    = parseInt(row[CI.c_id] ?? '0', 10);
        const dbId   = cIdToDbId.get(cId);
        if (!dbId) { invSkipped++; continue; }

        const invNum     = clean(row[CI.invoice_num]) || String(b + invInserted);
        const totalEst   = toNum(row[CI.totalest]);
        const totalAmt   = toNum(row[CI.totalamt]);
        const totalPaid  = toNum(row[CI.totalpaid]);
        const taxAmt     = toNum(row[CI.tax_amount]);
        const discount   = toNum(row[CI.discount_amount]);
        const badDebt    = row[CI.bad_debt] === 'Y';
        const balanceDue = Math.max(0, totalAmt - totalPaid);
        const invoiceTs  = unixToDate(row[CI.invoice_timestamp]);
        const minJobDate = unixToDate(row[CI.min_jobdate]);

        // Status
        let status = 'pending';
        if (badDebt) status = 'bad_debt';
        else if (totalAmt > 0 && totalPaid >= totalAmt) status = 'paid';
        else if (totalPaid > 0) status = 'partial';

        const paidAt = (status === 'paid' && invoiceTs) ? invoiceTs : null;
        const notes  = [
          minJobDate ? `Job date: ${minJobDate}` : null,
          discount > 0 ? `Discount: $${discount.toFixed(2)}` : null,
        ].filter(Boolean).join(' | ') || null;

        values.push(`($${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},$${pi++},NOW(),NOW())`);
        params.push(
          dbId,
          `INV-${invNum}`,
          status,
          totalEst.toFixed(2),
          taxAmt.toFixed(2),
          totalAmt.toFixed(2),
          totalPaid.toFixed(2),
          balanceDue.toFixed(2),
          invoiceTs,
          paidAt,
          notes,
        );
        invInserted++;
      }

      if (values.length > 0) {
        await pool.query(
          `INSERT INTO invoices (customer_id, invoice_number, status, subtotal, tax_amount, total_amount, amount_paid, balance_due, due_date, paid_at, notes, created_at, updated_at) VALUES ${values.join(',')}`,
          params
        );
      }

      if ((b + BATCH) % 2000 === 0 || b + BATCH >= invoiceRows.length) {
        process.stdout.write(`  invoices: ${invInserted} inserted, ${invSkipped} skipped\r`);
      }
    }
    console.log(`\n  Done: ${invInserted} invoices, ${invSkipped} skipped`);
  }

  // ── Import estimates as quotes + line items ───────────────────────────────────
  console.log('\nImporting estimates as quotes…');

  const existingQuotes = await pool.query('SELECT COUNT(*) FROM quotes');
  if (parseInt(existingQuotes.rows[0].count) > 0) {
    console.log(`  Quotes already imported (${existingQuotes.rows[0].count} rows) — skipping.`);
    console.log('  To re-import, run: DELETE FROM quote_line_items; DELETE FROM quotes;');
  } else {
    // Build estimate_details lookup: e_id → [line items]
    const estDetails = new Map();
    for (const row of estDetRows) {
      const eId  = parseInt(row[CED.e_id] ?? '0', 10);
      const slno = parseInt(row[CED.slno] ?? '0', 10);
      const desc = clean(row[CED.job_type]) || 'Service';
      const qty  = parseFloat(clean(row[CED.quantity]) || '1') || 1;
      const unitPrice = toNum(row[CED.est_per_quantity]);
      const total     = toNum(row[CED.est]);
      if (!estDetails.has(eId)) estDetails.set(eId, []);
      estDetails.get(eId).push({ slno, desc, qty, unitPrice, total });
    }

    let qInserted = 0, qSkipped = 0;

    for (const row of estimateRows) {
      const eId      = parseInt(row[CE.e_id] ?? '0', 10);
      const custType = clean(row[CE.custtype]) || 'c';
      const legacyId = parseInt(row[CE.id] ?? '0', 10);

      // Only import customer-linked estimates for now
      if (custType !== 'c') { qSkipped++; continue; }

      const dbId = cIdToDbId.get(legacyId);
      if (!dbId) { qSkipped++; continue; }

      const dateUnix   = parseInt(row[CE.date] ?? '0', 10);
      const dateAdded  = unixToTs(row[CE.date_added]);
      const accepted   = clean(row[CE.accepted]);
      const invoiceNum = parseInt(row[CE.invoice_num] ?? '0', 10);
      const status     = clean(row[CE.status]);
      const discount   = toNum(row[CE.discount_amount]);
      const taxPct     = toNum(row[CE.tax_percent]);
      const notes      = clean(row[CE.addl_notes]);

      // Determine quote status
      let quoteStatus = 'sent'; // default — it was sent to the customer at some point
      if (accepted === 'Y' || invoiceNum > 0) quoteStatus = 'approved';
      else if (status === 'D') quoteStatus = 'declined';

      // Calculate totals from line items
      const lineItems = estDetails.get(eId) || [];
      const subtotal  = lineItems.reduce((s, li) => s + li.total, 0);
      const taxTotal  = subtotal * (taxPct / 100);
      const total     = subtotal + taxTotal - discount;

      // Insert quote
      const qRes = await pool.query(
        `INSERT INTO quotes (customer_id, quote_number, status, subtotal, tax_total, discount_total, total_amount, notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING id`,
        [
          dbId,
          `E-${eId}`,
          quoteStatus,
          subtotal.toFixed(2),
          taxTotal.toFixed(2),
          discount.toFixed(2),
          Math.max(0, total).toFixed(2),
          notes,
          dateAdded || new Date().toISOString(),
        ]
      );
      const quoteDbId = qRes.rows[0].id;

      // Insert line items
      for (let idx = 0; idx < lineItems.length; idx++) {
        const li = lineItems[idx];
        await pool.query(
          `INSERT INTO quote_line_items (quote_id, description, quantity, unit_price, total_price, sort_order, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
          [quoteDbId, li.desc, li.qty.toString(), li.unitPrice.toFixed(2), li.total.toFixed(2), li.slno]
        );
      }

      qInserted++;
      if (qInserted % 500 === 0) process.stdout.write(`  quotes: ${qInserted} inserted\r`);
    }
    console.log(`\n  Done: ${qInserted} quotes, ${qSkipped} skipped (prospect-linked or unmatched)`);
  }

  // ── Import prospects as leads ─────────────────────────────────────────────────
  console.log('\nImporting prospects as leads…');

  const existingLeads = await pool.query('SELECT COUNT(*) FROM leads');
  if (parseInt(existingLeads.rows[0].count) > 0) {
    console.log(`  Leads already imported (${existingLeads.rows[0].count} rows) — skipping.`);
    console.log('  To re-import, run: DELETE FROM leads;');
  } else {
    let leadInserted = 0, leadSkipped = 0;

    for (const row of prospRows) {
      const first   = clean(row[CP.first_name]);
      const last    = clean(row[CP.last_name]);
      const company = clean(row[CP.company_name]);

      if (!first && !last && !company) { leadSkipped++; continue; }

      const email    = clean(row[CP.email]);
      const phone    = clean(row[CP.phone1]) || clean(row[CP.phone2]) || clean(row[CP.cell_phone1]);
      const address  = clean(row[CP.address]);
      const city     = clean(row[CP.city]);
      const state    = clean(row[CP.state]);
      const zip      = clean(row[CP.zip]);
      const notes    = [
        clean(row[CP.notes]),
        company ? `Company: ${company}` : null,
        clean(row[CP.contact_person]) ? `Contact: ${clean(row[CP.contact_person])}` : null,
      ].filter(Boolean).join('\n') || null;

      const cat = (clean(row[CP.cat]) || '').toLowerCase();
      const clientType = cat.includes('comm') ? 'commercial' : 'residential';

      // Sum estimate values from the 4 estimate slots
      let estTotal = 0;
      for (let n = 1; n <= 4; n++) {
        const estVal = parseFloat(clean(row[CP[`est${n}`]]) || '0');
        if (!isNaN(estVal)) estTotal += estVal;
      }

      // Callback date
      const callbackLatest = clean(row[CP.call_back_latest]);
      const followUpDate   = callbackLatest || null;

      // Status: if they have history → contacted, else new
      const jobHistory = clean(row[CP.job_history]);
      const status     = jobHistory ? 'contacted' : 'new';

      await pool.query(
        `INSERT INTO leads (first_name, last_name, email, phone, source, status, notes, address, city, state, zip, estimated_value, follow_up_date, client_type, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())`,
        [
          first || '', last || '', email, phone,
          'import', status, notes, address, city, state, zip,
          estTotal > 0 ? estTotal.toFixed(2) : null,
          followUpDate, clientType,
        ]
      );
      leadInserted++;
      if (leadInserted % 500 === 0) process.stdout.write(`  leads: ${leadInserted} inserted\r`);
    }
    console.log(`\n  Done: ${leadInserted} leads, ${leadSkipped} skipped`);
  }

  // ── Final counts ─────────────────────────────────────────────────────────────
  console.log('\n=== IMPORT COMPLETE ===');
  const counts = await pool.query(`
    SELECT 'customers' as t, COUNT(*)::int as n FROM customers
    UNION ALL SELECT 'jobs', COUNT(*)::int FROM jobs
    UNION ALL SELECT 'invoices', COUNT(*)::int FROM invoices
    UNION ALL SELECT 'quotes', COUNT(*)::int FROM quotes
    UNION ALL SELECT 'quote_line_items', COUNT(*)::int FROM quote_line_items
    UNION ALL SELECT 'leads', COUNT(*)::int FROM leads
    ORDER BY t
  `);
  for (const r of counts.rows) {
    console.log(`  ${r.t.padEnd(20)} ${String(r.n).padStart(6)}`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
