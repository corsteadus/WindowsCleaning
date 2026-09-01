/**
 * Full re-import from authoritative MySQL SQL dump + CSV supplement for window counts.
 * - Parses superior_customers (3,061 rows) + superior_customer_jobs (21,051 rows)
 * - Supplements window_count from CSV (where available)
 * - Clears existing customer/job data and replaces with full import
 */

import { readFileSync } from 'fs';
import pg from '/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ────────────────────────────────────────────
// MySQL INSERT VALUES parser
// ────────────────────────────────────────────
function parseMysqlValues(str) {
  const rows = [];
  let i = 0;
  const n = str.length;

  while (i < n) {
    // Advance to next row start '('
    while (i < n && str[i] !== '(' && str[i] !== ';') i++;
    if (i >= n || str[i] === ';') break;
    i++; // skip '('

    const row = [];

    while (i < n) {
      // Skip whitespace between values
      while (i < n && (str[i] === ' ' || str[i] === '\n' || str[i] === '\r')) i++;

      if (str[i] === ')') { i++; break; } // end of row

      // NULL
      if (str.substring(i, i + 4) === 'NULL') {
        row.push(null);
        i += 4;
      }
      // Quoted string
      else if (str[i] === "'") {
        i++; // skip opening '
        let val = '';
        while (i < n) {
          if (str[i] === '\\') {
            i++;
            const c = str[i++];
            if (c === 'n') val += '\n';
            else if (c === 'r') val += '\r';
            else if (c === 't') val += '\t';
            else val += c;
          } else if (str[i] === "'") {
            i++; break; // closing '
          } else {
            val += str[i++];
          }
        }
        row.push(val);
      }
      // Unquoted value (numbers, etc.)
      else {
        let val = '';
        while (i < n && str[i] !== ',' && str[i] !== ')') val += str[i++];
        const trimmed = val.trim();
        row.push(trimmed === '' ? null : trimmed);
      }

      // Skip separator
      while (i < n && (str[i] === ' ' || str[i] === '\n' || str[i] === '\r')) i++;
      if (i < n && str[i] === ',') i++;
    }

    rows.push(row);

    // Skip whitespace/comma between rows
    while (i < n && (str[i] === ' ' || str[i] === '\n' || str[i] === '\r' || str[i] === ',')) i++;
  }

  return rows;
}

function extractTableSection(sql, tableName) {
  const marker = `Dumping data for table \`${tableName}\``;
  const sectionStart = sql.indexOf(marker);
  if (sectionStart === -1) throw new Error(`Table ${tableName} not found`);

  // Find the end of this table's section (next "Dumping data" or end of file)
  const nextDump = sql.indexOf('Dumping data for table `', sectionStart + marker.length);
  const sectionEnd = nextDump === -1 ? sql.length : nextDump;
  const section = sql.substring(sectionStart, sectionEnd);

  // Collect ALL INSERT INTO rows for this table (dump splits into multiple batches)
  const insertPattern = `INSERT INTO \`${tableName}\` VALUES `;
  const allRows = [];
  let pos = 0;
  while (true) {
    const ins = section.indexOf(insertPattern, pos);
    if (ins === -1) break;
    const valStart = ins + insertPattern.length;
    // Find end of this INSERT (the ';' that closes it, at top level)
    // Extract the VALUES string up to the terminating ';'
    let end = valStart;
    let inStr = false;
    while (end < section.length) {
      if (inStr) {
        if (section[end] === '\\') { end += 2; continue; }
        if (section[end] === "'") { inStr = false; }
      } else {
        if (section[end] === "'") { inStr = true; }
        else if (section[end] === ';') break;
      }
      end++;
    }
    const valuesStr = section.substring(valStart, end);
    const rows = parseMysqlValues(valuesStr);
    allRows.push(...rows);
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
  lines.forEach((l, i) => {
    const name = l.trim().match(/^`(\w+)`/)[1];
    map[name] = i;
  });
  return map;
}

// ────────────────────────────────────────────
// CSV parser (handles quoted fields with embedded newlines)
// ────────────────────────────────────────────
function parseCsvToWindowCounts(csvText) {
  const windowCounts = new Map(); // c_id → windowCount (integer)
  let i = 0;
  const n = csvText.length;

  // Skip header line
  while (i < n && csvText[i] !== '\n') i++;
  i++; // past '\n'

  while (i < n) {
    // Parse one row, extract col 0 (Id) and col 23 (Window Count)
    const cols = [];
    let col = '';
    let inQ = false;

    while (i < n) {
      const ch = csvText[i];
      if (inQ) {
        if (ch === '"') {
          if (csvText[i + 1] === '"') { col += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        col += ch; i++;
      } else {
        if (ch === '"') { inQ = true; i++; continue; }
        if (ch === ',') { cols.push(col); col = ''; i++; continue; }
        if (ch === '\n') { cols.push(col); col = ''; i++; break; }
        if (ch === '\r') { i++; continue; }
        col += ch; i++;
      }
    }

    const rawId = (cols[0] || '').trim();
    const rawWc = (cols[23] || '').trim();
    const id = parseInt(rawId, 10);
    const wc = parseInt(rawWc, 10);

    if (!isNaN(id) && !isNaN(wc) && wc > 0 && !windowCounts.has(id)) {
      windowCounts.set(id, wc);
    }
  }

  return windowCounts;
}

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────
function clean(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === '' || s === '--' || s === 'N/A' || s === 'n/a') return null;
  return s;
}

function unixToDate(v) {
  if (!v || v === '0' || v === 0) return null;
  const ts = typeof v === 'number' ? v : parseInt(v, 10);
  if (isNaN(ts) || ts === 0) return null;
  return new Date(ts * 1000).toISOString().split('T')[0];
}

const SALUTATION_MAP = { 0: '', 1: 'Mr.', 2: 'Mrs.', 3: 'Ms.', 4: 'Dr.', 5: 'Rev.' };

// ────────────────────────────────────────────
// Main
// ────────────────────────────────────────────
async function main() {
  console.log('Reading SQL dump…');
  const sql = readFileSync('attached_assets/superior-2026-03-30-13-16-12_1774911409675.sql', 'latin1');

  console.log('Reading CSV for window counts…');
  const csv = readFileSync('attached_assets/customers-2026-03-30_1774911409681.csv', 'utf8');

  const windowCounts = parseCsvToWindowCounts(csv);
  console.log(`Window count entries from CSV: ${windowCounts.size}`);

  // ── Column index maps ──
  const CC = getColIndices(sql, 'superior_customers');
  const CJ = getColIndices(sql, 'superior_customer_jobs');

  // ── Parse customer rows ──
  console.log('Parsing customer rows…');
  const custRows = extractTableSection(sql, 'superior_customers');
  console.log(`Parsed ${custRows.length} customer rows`);

  // ── Parse job rows ──
  console.log('Parsing job rows…');
  const jobRows = extractTableSection(sql, 'superior_customer_jobs');
  console.log(`Parsed ${jobRows.length} job rows`);

  // ── Clear existing data ──
  console.log('Clearing existing customers and jobs…');
  await pool.query('DELETE FROM jobs');
  await pool.query('DELETE FROM customers');

  // ── Insert customers ──
  console.log('Inserting customers…');
  const cIdToDbId = new Map(); // sql c_id → our DB id
  let custInserted = 0;

  const BATCH = 100;
  for (let b = 0; b < custRows.length; b += BATCH) {
    const batch = custRows.slice(b, b + BATCH);
    for (const row of batch) {
      const cId    = parseInt(row[CC.c_id], 10);
      const active = parseInt(row[CC.active] ?? '1', 10);

      const firstName = clean(row[CC.first_name]);
      const lastName  = clean(row[CC.last_name]);
      const company   = clean(row[CC.company_name]);

      // Skip rows with no identifying info
      if (!firstName && !lastName && !company) continue;

      const salutationRaw = parseInt(row[CC.salutation] ?? '0', 10);
      const salutation = SALUTATION_MAP[salutationRaw] || '';

      const starRaw = clean(row[CC.star_rating]);
      const starRating = starRaw && /^[1-5]$/.test(starRaw) ? parseInt(starRaw, 10) : null;

      const category = clean(row[CC.cat]) || 'residential';
      const tags = category === 'commercial' ? 'commercial' : '';

      const statusMap = { 1: 'active', 0: 'inactive', 3: 'inactive' };
      const status = statusMap[active] || 'active';

      const homePhone = clean(row[CC.phone1]);
      const workPhone = clean(row[CC.phone2]);
      const cellPhone = clean(row[CC.cell_phone1]);
      const altPhone  = clean(row[CC.phone3]);
      const altPhoneType = clean(row[CC.alt_type]);
      const fax       = clean(row[CC.fax]);

      const email     = clean(row[CC.email]);
      const notes     = clean(row[CC.notes]);
      const directions= clean(row[CC.directions]);

      const billingAddress = clean(row[CC.address]);
      const billingCity    = clean(row[CC.city]);
      const billingState   = clean(row[CC.state]);
      const billingZip     = clean(row[CC.zip]);

      const howHeard    = clean(row[CC.hearus]);
      const subdivision = clean(row[CC.development]);

      const customerDate= unixToDate(row[CC.date_cadded]);
      const birthdayRaw = row[CC.birth_date];
      const birthday    = unixToDate(birthdayRaw);

      const isNonProfit  = row[CC.nonprofit_customer] === 'Y';
      const ccFeeExempt  = row[CC.exempt_cc_fee] === 'Y' || row[CC.exempt_cc_fee] === '1';
      const allowText    = row[CC.allow_text_messaging] === '1' || row[CC.allow_text_messaging] === 'Y';
      const altContact   = clean(row[CC.contact_person]);

      const windowCount = windowCounts.get(cId) || null;

      // preferred contact: email by default, check if text allowed
      const sendingPrefs = allowText ? 'email,sms' : 'email';

      const res = await pool.query(
        `INSERT INTO customers (
          first_name, last_name, company_name, salutation, email,
          home_phone, work_phone, cell_phone, alt_phone, alt_phone_type, fax, alt_contact,
          billing_address, billing_city, billing_state, billing_zip,
          subdivision, how_heard, notes, directions,
          status, tags, is_non_profit, cc_fee_exempt, sending_preferences,
          window_count, star_rating, customer_date, birthday, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,$8,$9,$10,$11,$12,
          $13,$14,$15,$16,
          $17,$18,$19,$20,
          $21,$22,$23,$24,$25,
          $26,$27,$28,$29,NOW(),NOW()
        ) RETURNING id`,
        [
          firstName || '', lastName || '', company, salutation, email,
          homePhone, workPhone, cellPhone, altPhone, altPhoneType, fax, altContact,
          billingAddress, billingCity, billingState, billingZip,
          subdivision, howHeard, notes, directions,
          status, tags, isNonProfit, ccFeeExempt, sendingPrefs,
          windowCount, starRating, customerDate, birthday,
        ]
      );

      const dbId = res.rows[0].id;
      cIdToDbId.set(cId, dbId);
      custInserted++;
    }

    if ((b + BATCH) % 500 === 0 || b + BATCH >= custRows.length) {
      process.stdout.write(`  customers: ${custInserted} / ${custRows.length}\r`);
    }
  }
  console.log(`\nInserted ${custInserted} customers`);

  // ── Insert jobs ──
  console.log('Inserting jobs…');
  let jobInserted = 0;
  let jobSkipped  = 0;
  const NOW = new Date().toISOString().split('T')[0];

  for (let b = 0; b < jobRows.length; b += BATCH) {
    const batch = jobRows.slice(b, b + BATCH);
    for (const row of batch) {
      const cId = parseInt(row[CJ.c_id] ?? '0', 10);
      const dbCustId = cIdToDbId.get(cId);
      if (!dbCustId) { jobSkipped++; continue; }

      const dateUnix   = parseInt(row[CJ.date] ?? '0', 10);
      const scheduledDate = unixToDate(dateUnix);
      if (!scheduledDate) { jobSkipped++; continue; }

      const jobType = clean(row[CJ.job_type]) || 'General';
      const estRaw  = clean(row[CJ.est]);
      const amount  = estRaw ? parseFloat(estRaw) : null;
      const validAmount = (!isNaN(amount) && amount != null) ? amount : 0;

      const historyStatus  = parseInt(row[CJ.history_status] ?? '0', 10);
      const paymentStatus  = parseInt(row[CJ.payment_status] ?? '0', 10);
      const completedFlag  = row[CJ.completed] === 'Y';
      const onholdFlag     = row[CJ.onhold] === 'Y';
      const duration       = clean(row[CJ.duration]);
      const techNotes      = clean(row[CJ.job_addl_notes]);
      const crewIds        = clean(row[CJ.crewids]);

      // Determine status
      let status;
      if (onholdFlag) {
        status = 'scheduled'; // on hold treated as upcoming
      } else if (completedFlag || historyStatus === 1) {
        status = 'completed';
      } else if (scheduledDate > NOW) {
        status = 'scheduled';
      } else {
        status = 'completed'; // historical unflagged job
      }

      // Determine payment status note
      const payNote = paymentStatus === 1 ? 'paid' : paymentStatus === 2 ? 'partial' : null;
      const combinedNotes = [techNotes, payNote ? `Payment: ${payNote}` : null].filter(Boolean).join('\n');

      const cjId = row[CJ.cj_id];
      const jobNumber = `J-${cjId}`;

      await pool.query(
        `INSERT INTO jobs (
          customer_id, job_number, service_type, scheduled_date, status,
          total_amount, tech_notes, notes, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,
        [
          dbCustId,
          jobNumber,
          jobType,
          scheduledDate,
          status,
          validAmount,
          techNotes || null,
          combinedNotes || null,
        ]
      );

      jobInserted++;
    }

    if ((b + BATCH) % 2000 === 0 || b + BATCH >= jobRows.length) {
      process.stdout.write(`  jobs: ${jobInserted} inserted, ${jobSkipped} skipped\r`);
    }
  }

  console.log(`\nInserted ${jobInserted} jobs, skipped ${jobSkipped}`);

  // ── Summary ──
  const cCount = await pool.query('SELECT COUNT(*) FROM customers');
  const jCount = await pool.query('SELECT COUNT(*) FROM jobs');
  const wcCount = await pool.query('SELECT COUNT(*) FROM customers WHERE window_count IS NOT NULL');

  console.log('\n=== IMPORT COMPLETE ===');
  console.log(`Customers in DB:          ${cCount.rows[0].count}`);
  console.log(`Jobs in DB:               ${jCount.rows[0].count}`);
  console.log(`Customers with window count: ${wcCount.rows[0].count}`);

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
