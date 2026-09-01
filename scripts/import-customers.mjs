/**
 * Import real customer + job data from The Customer Factor TSV export.
 * Handles quoted fields with embedded newlines correctly.
 */

import fs from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pg = require("/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg");

const { Pool } = pg;

const FILE = path.resolve("attached_assets/customers-2026-03-30_1774908257712.xls");

// ── Proper TSV parser (handles quoted fields with embedded newlines) ──────────
function parseTSV(raw) {
  const rows = [];
  let cols = [];
  let col = "";
  let inQuote = false;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];

    if (inQuote) {
      if (ch === '"') {
        // Check for escaped quote ""
        if (raw[i + 1] === '"') {
          col += '"';
          i += 2;
          continue;
        }
        inQuote = false;
        i++;
        continue;
      }
      col += ch;
      i++;
      continue;
    }

    // Not in quote
    if (ch === '"') {
      inQuote = true;
      i++;
      continue;
    }

    if (ch === "\t") {
      cols.push(col);
      col = "";
      i++;
      continue;
    }

    if (ch === "\n" || (ch === "\r" && raw[i + 1] === "\n")) {
      cols.push(col);
      col = "";
      rows.push(cols);
      cols = [];
      if (ch === "\r") i++;
      i++;
      continue;
    }

    if (ch === "\r") {
      cols.push(col);
      col = "";
      rows.push(cols);
      cols = [];
      i++;
      continue;
    }

    col += ch;
    i++;
  }

  // Last row
  if (col || cols.length) {
    cols.push(col);
    rows.push(cols);
  }

  return rows;
}

// ── helpers ───────────────────────────────────────────────────────────────────
function clean(s) {
  if (s === undefined || s === null) return null;
  s = s.trim();
  if (s === "" || s === " " || s.toLowerCase() === "n/a") return null;
  return s;
}

function parseDate(s) {
  const v = clean(s);
  if (!v) return null;
  // MM/DD/YY or MM/DD/YYYY
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return v;
  const yr = m[3].length === 2 ? (parseInt(m[3]) < 50 ? "20" : "19") + m[3] : m[3];
  return `${yr}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function parseMoney(s) {
  const v = clean(s);
  if (!v) return null;
  const n = parseFloat(v.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? null : n.toFixed(2);
}

function inferJobStatus(assignedTo, jobDateStr) {
  if (!jobDateStr) return "scheduled";
  const a = (assignedTo ?? "").toLowerCase();
  if (a.startsWith("waiting")) return "scheduled";
  const d = new Date(jobDateStr);
  const now = new Date();
  return d > now ? "scheduled" : "completed";
}

// ── parse file ────────────────────────────────────────────────────────────────
console.log("Reading file…");
const raw = fs.readFileSync(FILE, "utf8");
console.log("Parsing TSV…");
const rows = parseTSV(raw);
console.log(`Total rows parsed: ${rows.length} (including header)`);

// Column indices (0-based)
const C = {
  id: 0, customerName: 1, companyName: 2, salutation: 3, firstName: 4, lastName: 5,
  street: 6, addr2: 7, city: 8, state: 9, zip: 10,
  homePhone: 11, workPhone: 12, cellPhone: 13, fax: 14, altPhone: 15, altContact: 16,
  email: 17, notes: 18, marketing: 19, dateAdded: 20, starRating: 21, customerType: 22,
  windowCount: 23, windowType: 24, houseSize: 25, ladders: 26,
  sendEmail: 27, sendText: 28,
  jobDate: 29, jobType: 30, jobDetails: 31, price: 32, assignedTo: 33,
  duration: 34, jobLocation: 35, invoiceNumber: 36, estimateInfo: 37, status: 38,
};

const customerMap = new Map();
let jobCounter = 0;

// Skip header row (index 0)
for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  if (row.length < 6) continue;

  const origId = clean(row[C.id]);
  if (!origId || origId === "Id") continue; // skip blank/header repeats

  const firstName = clean(row[C.firstName]);
  const lastName  = clean(row[C.lastName]);

  // Skip rows where firstName/lastName look like address data (bad parse)
  if (!firstName && !lastName) continue;
  if (firstName && firstName.match(/^\d{4,}/)) continue; // starts with 4+ digits → bad row

  if (!customerMap.has(origId)) {
    const sendEmail = clean(row[C.sendEmail]) === "X";
    const sendText  = clean(row[C.sendText])  === "X";
    const prefs = [sendEmail && "email", sendText && "sms"].filter(Boolean).join(",") || null;

    const wcRaw   = clean(row[C.windowCount]);
    const wc      = wcRaw ? parseInt(wcRaw) : null;
    const starRaw = clean(row[C.starRating]);
    const star    = starRaw && !isNaN(parseInt(starRaw)) ? parseInt(starRaw) : null;

    // Pick address from first data row for this customer
    const addrStreet = clean(row[C.street]);
    const addrCity   = clean(row[C.city]);
    const addrState  = clean(row[C.state]);
    const addrZip    = clean(row[C.zip]);

    customerMap.set(origId, {
      customer: {
        firstName:   firstName ?? "Unknown",
        lastName:    lastName  ?? "Unknown",
        companyName: clean(row[C.companyName]),
        salutation:  clean(row[C.salutation]),
        email:       clean(row[C.email]),
        homePhone:   clean(row[C.homePhone]),
        workPhone:   clean(row[C.workPhone]),
        cellPhone:   clean(row[C.cellPhone]),
        fax:         clean(row[C.fax]),
        altPhone:    clean(row[C.altPhone]),
        altContact:  clean(row[C.altContact]),
        billingAddress: addrStreet,
        billingCity:    addrCity,
        billingState:   addrState,
        billingZip:     addrZip,
        notes:           clean(row[C.notes]),
        howHeard:        clean(row[C.marketing]),
        customerDate:    parseDate(row[C.dateAdded]),
        starRating:      star,
        windowCount:     wc,
        windowType:      clean(row[C.windowType]),
        houseSize:       clean(row[C.houseSize]),
        laddersNeeded:   clean(row[C.ladders]),
        sendingPreferences: prefs,
        status: "active",
      },
      jobs: [],
    });
  }

  // ── job row ────────────────────────────────────────────────────────────────
  const jobType    = clean(row[C.jobType]);
  const jobDate    = parseDate(row[C.jobDate]);
  const jobDetails = clean(row[C.jobDetails]);
  const price      = parseMoney(row[C.price]);
  const assignedTo = clean(row[C.assignedTo]);
  const jobLoc     = clean(row[C.jobLocation]);
  const invoiceNum = clean(row[C.invoiceNumber]);

  // Only import rows that have a job type and a date (skip estimate-only rows)
  if (jobType && jobDate) {
    jobCounter++;
    customerMap.get(origId).jobs.push({
      jobDate,
      jobType,
      jobDetails,
      price,
      assignedTo,
      jobLocation: jobLoc,
      invoiceNumber: invoiceNum,
      status: inferJobStatus(assignedTo, jobDate),
    });
  }
}

console.log(`Unique customers parsed: ${customerMap.size}`);
console.log(`Total jobs to import: ${jobCounter}`);

// Sanity check — show first 5
let shown = 0;
for (const [origId, { customer }] of customerMap) {
  if (shown++ >= 5) break;
  console.log(`  [${origId}] ${customer.firstName} ${customer.lastName} | ${customer.homePhone ?? "—"} | ${customer.email ?? "—"}`);
}

// ── database ──────────────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Delete all demo/existing data
    console.log("\nDeleting existing data…");
    await client.query("DELETE FROM jobs");
    await client.query("DELETE FROM quotes");
    await client.query("DELETE FROM invoices");
    await client.query("DELETE FROM properties");
    await client.query("DELETE FROM contacts");
    await client.query("DELETE FROM recurring_plans");
    await client.query("DELETE FROM leads");
    await client.query("DELETE FROM customers");
    console.log("  Done.");

    // 2. Insert customers
    console.log("Inserting customers…");
    const origToNewId = new Map();
    let custCount = 0;

    for (const [origId, { customer }] of customerMap) {
      const { rows } = await client.query(
        `INSERT INTO customers
          (first_name, last_name, company_name, salutation, email,
           home_phone, work_phone, cell_phone, fax, alt_phone, alt_contact,
           billing_address, billing_city, billing_state, billing_zip,
           notes, how_heard, customer_date, star_rating,
           window_count, window_type, house_size, ladders_needed,
           sending_preferences, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
         RETURNING id`,
        [
          customer.firstName, customer.lastName, customer.companyName, customer.salutation, customer.email,
          customer.homePhone, customer.workPhone, customer.cellPhone, customer.fax, customer.altPhone, customer.altContact,
          customer.billingAddress, customer.billingCity, customer.billingState, customer.billingZip,
          customer.notes, customer.howHeard, customer.customerDate, customer.starRating,
          customer.windowCount, customer.windowType, customer.houseSize, customer.laddersNeeded,
          customer.sendingPreferences, customer.status,
        ]
      );
      origToNewId.set(origId, rows[0].id);
      custCount++;
      if (custCount % 100 === 0) process.stdout.write(`  ${custCount}/${customerMap.size} customers…\r`);
    }
    console.log(`\n  Done: ${custCount} customers inserted.`);

    // 3. Insert jobs
    console.log("Inserting jobs…");
    let jobCount = 0;
    let jobNumSeq = 1;

    for (const [origId, { jobs }] of customerMap) {
      const custId = origToNewId.get(origId);
      for (const job of jobs) {
        const jobNumber = `J-${String(jobNumSeq++).padStart(5, "0")}`;
        const noteParts = [];
        if (job.assignedTo) noteParts.push(`Assigned to: ${job.assignedTo}`);
        if (job.jobLocation) noteParts.push(`Location: ${job.jobLocation}`);
        if (job.invoiceNumber) noteParts.push(`Invoice: ${job.invoiceNumber}`);

        await client.query(
          `INSERT INTO jobs
            (customer_id, job_number, status, service_type, scheduled_date,
             total_amount, notes, tech_notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            custId,
            jobNumber,
            job.status,
            job.jobType,
            job.jobDate,
            job.price ?? "0.00",
            noteParts.length ? noteParts.join("\n") : null,
            job.jobDetails,
          ]
        );
        jobCount++;
        if (jobCount % 500 === 0) process.stdout.write(`  ${jobCount} jobs…\r`);
      }
    }
    console.log(`\n  Done: ${jobCount} jobs inserted.`);

    await client.query("COMMIT");
    console.log("\n✅ Import complete!");

    // Verify
    const { rows: [{ count: custTotal }] } = await client.query("SELECT COUNT(*) FROM customers");
    const { rows: [{ count: jobTotal }] }  = await client.query("SELECT COUNT(*) FROM jobs");
    console.log(`   DB now has: ${custTotal} customers, ${jobTotal} jobs`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error — rolled back:", err.message, err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
