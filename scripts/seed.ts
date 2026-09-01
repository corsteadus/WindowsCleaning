/**
 * ClearView CRM — Demo Seed Script
 * Run: cd /home/runner/workspace && npx tsx scripts/seed.ts
 *
 * Seeds ~100 realistic records across all entities and stages.
 * Safe to re-run — checks for existing data first.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

// ─── Helpers ────────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function price(min: number, max: number) {
  return (Math.random() * (max - min) + min).toFixed(2);
}
function futureDate(daysFromNow: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}
function pastDate(daysAgo: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

// ─── Data pools ──────────────────────────────────────────────────────────────

const firstNames = ["James","Maria","Robert","Linda","Michael","Patricia","David","Barbara","William","Jennifer","Richard","Susan","Thomas","Jessica","Charles","Sarah","Christopher","Karen","Daniel","Lisa","Matthew","Nancy","Anthony","Betty","Mark","Sandra","Donald","Ashley","Steven","Dorothy","Paul","Kimberly","Andrew","Emily","Kenneth","Donna","Joshua","Michelle","Kevin","Carol","Brian","Amanda","George","Melissa","Timothy","Deborah","Ronald","Stephanie","Edward","Rebecca"];
const lastNames = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez","Thompson","White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson","Walker","Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill","Flores","Green","Adams","Nelson","Baker","Hall","Rivera","Campbell","Mitchell","Carter","Roberts"];
const streets = ["Oak Street","Maple Avenue","Cedar Lane","Pine Road","Elm Drive","Sunset Blvd","Desert View","Cactus Way","Mountain Ridge","Valley Road","Copper Creek","Saguaro Trail","Ironwood Dr","Mesquite Ave","Palo Verde Ln"];
const cities = ["Phoenix","Scottsdale","Tempe","Mesa","Chandler","Gilbert","Glendale","Peoria","Surprise","Goodyear"];
const sources = ["referral","google","yelp","door_hanger","social_media","repeat"];
const tags = ["vip","recurring","commercial","new_construction","snowbird","large_property"];
const leadSources = ["google","referral","yelp","nextdoor","door_hanger","cold_call"];
const leadStatuses = ["new","contacted","qualified","proposal_sent","won","lost"];
const propertyTypes = ["residential","commercial","hoa","new_construction"];
const serviceTypes = ["exterior_windows","interior_exterior","pressure_washing","gutter_cleaning","solar_panels","screens"];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱  ClearView CRM — seeding demo data...\n");

  // Check if already seeded
  const existing = await pool.query("SELECT COUNT(*) FROM customers");
  if (parseInt(existing.rows[0].count) > 5) {
    console.log(`⚠️  Database already has ${existing.rows[0].count} customers. Skipping seed.`);
    console.log("   Run the purge first if you want a fresh seed.");
    await pool.end();
    return;
  }

  // ── 1. Crews ──────────────────────────────────────────────────────────────
  console.log("  Creating crews...");
  const crewColors = ["#3b82f6","#10b981","#f59e0b","#8b5cf6"];
  const crewData = [
    { name: "Alpha Team",  lead: "Carlos Rivera",   phone: "602-555-0101", email: "alpha@clearviewclean.com",  color: crewColors[0] },
    { name: "Beta Team",   lead: "Mike Thompson",   phone: "602-555-0102", email: "beta@clearviewclean.com",   color: crewColors[1] },
    { name: "Gamma Team",  lead: "Sandra Ortiz",    phone: "602-555-0103", email: "gamma@clearviewclean.com",  color: crewColors[2] },
    { name: "Delta Team",  lead: "James Nguyen",    phone: "602-555-0104", email: "delta@clearviewclean.com",  color: crewColors[3] },
  ];
  const crewIds: number[] = [];
  for (const c of crewData) {
    const r = await pool.query(
      `INSERT INTO crews (name, lead_technician, phone, email, members, is_active, color, notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7,NOW(),NOW()) RETURNING id`,
      [c.name, c.lead, c.phone, c.email, JSON.stringify([c.lead, "Tech 2", "Tech 3"]), c.color, "Standard 3-person crew"]
    );
    crewIds.push(r.rows[0].id);
  }
  console.log(`    ✓ ${crewIds.length} crews`);

  // ── 2. Services ───────────────────────────────────────────────────────────
  console.log("  Creating services...");
  const serviceData = [
    { name: "Exterior Window Cleaning",    desc: "Full exterior wash, squeegee, and detailing", category: "window_cleaning",    price: "149.00", unit: "per visit",  duration: 90  },
    { name: "Interior + Exterior Windows", desc: "Complete inside and outside window service",  category: "window_cleaning",    price: "249.00", unit: "per visit",  duration: 180 },
    { name: "Pressure Washing",            desc: "Driveway, walkways, and exterior surfaces",   category: "pressure_washing",   price: "199.00", unit: "per visit",  duration: 120 },
    { name: "Gutter Cleaning",             desc: "Clear gutters and flush downspouts",          category: "gutter_cleaning",    price: "179.00", unit: "per visit",  duration: 90  },
    { name: "Solar Panel Cleaning",        desc: "Soft wash solar panels to restore output",   category: "solar_panels",       price: "129.00", unit: "per panel",  duration: 60  },
    { name: "Screen Cleaning",             desc: "Remove, clean, and reinstall all screens",   category: "screen_cleaning",    price: "5.00",   unit: "per screen", duration: 30  },
    { name: "Hard Water Stain Removal",    desc: "Treatment for mineral deposits on glass",    category: "specialty",          price: "299.00", unit: "per visit",  duration: 150 },
    { name: "Commercial Package",          desc: "Full exterior service for commercial props",  category: "window_cleaning",    price: "399.00", unit: "per visit",  duration: 240 },
  ];
  const serviceIds: number[] = [];
  for (const s of serviceData) {
    const r = await pool.query(
      `INSERT INTO services (name, description, category, pricing_type, base_price, unit, estimated_duration, is_active, created_at, updated_at)
       VALUES ($1,$2,$3,'flat',$4,$5,$6,true,NOW(),NOW()) RETURNING id`,
      [s.name, s.desc, s.category, s.price, s.unit, s.duration]
    );
    serviceIds.push(r.rows[0].id);
  }
  console.log(`    ✓ ${serviceIds.length} services`);

  // ── 3. Leads ──────────────────────────────────────────────────────────────
  console.log("  Creating leads...");
  const leadIds: number[] = [];
  for (let i = 0; i < 18; i++) {
    const fn = pick(firstNames);
    const ln = pick(lastNames);
    const status = leadStatuses[i % leadStatuses.length];
    const r = await pool.query(
      `INSERT INTO leads (first_name, last_name, email, phone, source, status, notes, address, city, state, zip, estimated_value, follow_up_date, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'AZ',$10,$11,$12,NOW(),NOW()) RETURNING id`,
      [
        fn, ln,
        `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@email.com`,
        `602-555-${String(1200 + i).padStart(4,"0")}`,
        pick(leadSources), status,
        status === "lost" ? "Customer went with competitor" : status === "won" ? "Converted — great customer" : "Follow up scheduled",
        `${rand(100,9999)} ${pick(streets)}`,
        pick(cities), `850${rand(10,99)}`,
        price(150, 800),
        status === "qualified" || status === "proposal_sent" ? futureDate(rand(3,14)) : null,
      ]
    );
    leadIds.push(r.rows[0].id);
  }
  console.log(`    ✓ ${leadIds.length} leads`);

  // ── 4. Customers ──────────────────────────────────────────────────────────
  console.log("  Creating customers...");
  const customerIds: number[] = [];
  const customerStatuses = ["active","active","active","active","inactive","lead"];
  for (let i = 0; i < 24; i++) {
    const fn = pick(firstNames);
    const ln = pick(lastNames);
    const status = customerStatuses[i % customerStatuses.length];
    const customerTags = i % 4 === 0 ? [pick(tags)] : i % 7 === 0 ? [pick(tags), pick(tags)] : [];
    const r = await pool.query(
      `INSERT INTO customers (first_name, last_name, email, phone, billing_address, billing_city, billing_state, billing_zip, source, tags, notes, status, preferred_contact_method, tax_exempt, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'AZ',$7,$8,$9,$10,$11,$12,false,NOW(),NOW()) RETURNING id`,
      [
        fn, ln,
        `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@gmail.com`,
        `602-555-${String(2000 + i).padStart(4,"0")}`,
        `${rand(100,9999)} ${pick(streets)}`,
        pick(cities), `850${rand(10,99)}`,
        pick(sources),
        JSON.stringify(customerTags),
        status === "inactive" ? "Account paused per customer request" : "Great customer, always pays on time",
        status, pick(["email","phone","text"]),
      ]
    );
    customerIds.push(r.rows[0].id);
  }
  console.log(`    ✓ ${customerIds.length} customers`);

  // ── 5. Properties ─────────────────────────────────────────────────────────
  console.log("  Creating properties...");
  const propertyIds: number[] = [];
  for (let i = 0; i < customerIds.length; i++) {
    const cid = customerIds[i];
    const ptype = propertyTypes[i % propertyTypes.length];
    const stories = rand(1, 3);
    const windows = rand(8, 40);
    const r = await pool.query(
      `INSERT INTO properties (customer_id, name, address, city, state, zip, property_type, stories, window_count, access_notes, gate_code, has_screens, has_hard_water, has_tracks, service_notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'AZ',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW()) RETURNING id`,
      [
        cid,
        ptype === "commercial" ? `${pick(lastNames)} Business` : "Primary Residence",
        `${rand(100,9999)} ${pick(streets)}`,
        pick(cities), `850${rand(10,99)}`,
        ptype, stories, windows,
        stories > 1 ? "Second floor requires extension pole — no ladder access on north side" : "Ground floor, easy access",
        i % 3 === 0 ? `${rand(1000,9999)}` : null,
        i % 2 === 0, i % 5 === 0, i % 3 === 0,
        windows > 25 ? "Large property — schedule 3+ hours" : "Standard service",
      ]
    );
    propertyIds.push(r.rows[0].id);
    // Some customers get a second property
    if (i % 5 === 0) {
      const r2 = await pool.query(
        `INSERT INTO properties (customer_id, name, address, city, state, zip, property_type, stories, window_count, access_notes, has_screens, has_hard_water, has_tracks, service_notes, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'AZ',$5,'commercial',2,$6,$7,$8,$9,$10,$11,NOW(),NOW()) RETURNING id`,
        [
          cid, "Rental Property",
          `${rand(100,9999)} ${pick(streets)}`,
          pick(cities), `850${rand(10,99)}`,
          rand(10, 20),
          "Tenant must be notified 48 hrs in advance",
          true, false, true,
          "Rental — bill customer not tenant",
        ]
      );
      propertyIds.push(r2.rows[0].id);
    }
  }
  console.log(`    ✓ ${propertyIds.length} properties`);

  // ── 6. Quotes ─────────────────────────────────────────────────────────────
  console.log("  Creating quotes...");
  const quoteStatuses = ["draft","draft","sent","sent","approved","approved","approved","rejected","accepted"];
  const quoteIds: number[] = [];
  for (let i = 0; i < 22; i++) {
    const cid = customerIds[i % customerIds.length];
    const pid = propertyIds[i % propertyIds.length];
    const status = quoteStatuses[i % quoteStatuses.length];
    const sub = parseFloat(price(200, 900));
    const tax = parseFloat((sub * 0.08).toFixed(2));
    const disc = i % 4 === 0 ? parseFloat((sub * 0.1).toFixed(2)) : 0;
    const total = (sub + tax - disc).toFixed(2);
    const r = await pool.query(
      `INSERT INTO quotes (customer_id, property_id, quote_number, status, subtotal, tax_total, discount_total, total_amount, notes, terms, valid_until, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW()) RETURNING id`,
      [
        cid, pid,
        `Q-${String(1000 + i).padStart(5,"0")}`,
        status, sub.toFixed(2), tax.toFixed(2), disc.toFixed(2), total,
        "All windows cleaned inside and out. Tracks and sills wiped down.",
        "Payment due upon completion. 10% discount for recurring service sign-up.",
        futureDate(rand(7, 30)),
      ]
    );
    const qid = r.rows[0].id;
    quoteIds.push(qid);
    // Add 2-3 line items per quote
    const numItems = rand(2, 3);
    for (let j = 0; j < numItems; j++) {
      const sid = serviceIds[j % serviceIds.length];
      const qty = rand(1, 3);
      const unitPrice = parseFloat(price(80, 250));
      await pool.query(
        `INSERT INTO quote_line_items (quote_id, service_id, description, quantity, unit_price, total_price, sort_order, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())`,
        [qid, sid, serviceData[j % serviceData.length].name, qty, unitPrice.toFixed(2), (qty * unitPrice).toFixed(2), j]
      );
    }
  }
  console.log(`    ✓ ${quoteIds.length} quotes`);

  // ── 7. Jobs ───────────────────────────────────────────────────────────────
  console.log("  Creating jobs...");
  const jobStatuses = ["scheduled","scheduled","in_progress","completed","completed","completed","canceled"];
  const jobIds: number[] = [];
  for (let i = 0; i < 28; i++) {
    const cid = customerIds[i % customerIds.length];
    const pid = propertyIds[i % propertyIds.length];
    const status = jobStatuses[i % jobStatuses.length];
    const isCompleted = status === "completed";
    const isPast = isCompleted || status === "canceled";
    const schedDate = isPast ? pastDate(rand(1, 60)) : futureDate(rand(1, 21));
    const amount = parseFloat(price(150, 700));
    const startHour = rand(7, 14);
    const r = await pool.query(
      `INSERT INTO jobs (customer_id, property_id, quote_id, crew_id, job_number, status, service_type, scheduled_date, scheduled_start_time, scheduled_end_time, estimated_duration, total_amount, notes, tech_notes, line_items, completed_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW()) RETURNING id`,
      [
        cid, pid,
        i < quoteIds.length ? quoteIds[i] : null,
        crewIds[i % crewIds.length],
        `J-${String(2000 + i).padStart(5,"0")}`,
        status,
        pick(serviceTypes),
        schedDate,
        `${String(startHour).padStart(2,"0")}:00`,
        `${String(startHour + rand(2,4)).padStart(2,"0")}:00`,
        rand(90, 240),
        amount.toFixed(2),
        "Please call 30 min before arrival. Park in driveway.",
        isCompleted ? "Job completed without issues. Customer very happy." : null,
        JSON.stringify([{ description: pick(serviceTypes).replace(/_/g," "), quantity: 1, unitPrice: amount.toFixed(2), total: amount.toFixed(2) }]),
        isCompleted ? pastDate(rand(1, 60)) : null,
      ]
    );
    jobIds.push(r.rows[0].id);
  }
  console.log(`    ✓ ${jobIds.length} jobs`);

  // ── 8. Invoices ───────────────────────────────────────────────────────────
  console.log("  Creating invoices...");
  const invoiceStatuses = ["draft","sent","sent","paid","paid","paid","overdue","overdue"];
  const invoiceIds: number[] = [];
  for (let i = 0; i < 22; i++) {
    const cid = customerIds[i % customerIds.length];
    const jid = jobIds[i % jobIds.length];
    const status = invoiceStatuses[i % invoiceStatuses.length];
    const sub = parseFloat(price(150, 800));
    const tax = parseFloat((sub * 0.08).toFixed(2));
    const total = (sub + tax).toFixed(2);
    const amtPaid = status === "paid" ? total : "0.00";
    const balDue = status === "paid" ? "0.00" : total;
    const isPaid = status === "paid";
    const isOverdue = status === "overdue";
    const r = await pool.query(
      `INSERT INTO invoices (customer_id, job_id, invoice_number, status, subtotal, tax_amount, total_amount, amount_paid, balance_due, due_date, paid_at, notes, line_items, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW()) RETURNING id`,
      [
        cid, jid,
        `INV-${String(3000 + i).padStart(5,"0")}`,
        status, sub.toFixed(2), tax.toFixed(2), total, amtPaid, balDue,
        isOverdue ? pastDate(rand(5, 30)) : futureDate(rand(5, 30)),
        isPaid ? pastDate(rand(1, 20)) : null,
        "Thank you for your business!",
        JSON.stringify([{ description: "Window Cleaning Services", quantity: 1, unitPrice: sub.toFixed(2), total: sub.toFixed(2) }]),
      ]
    );
    invoiceIds.push(r.rows[0].id);
  }
  console.log(`    ✓ ${invoiceIds.length} invoices`);

  // ── 9. Recurring Plans ────────────────────────────────────────────────────
  console.log("  Creating recurring plans...");
  const planStatuses = ["active","active","active","paused","canceled"];
  const freqTypes = ["weekly","biweekly","monthly","quarterly"];
  for (let i = 0; i < 10; i++) {
    const cid = customerIds[i % customerIds.length];
    const pid = propertyIds[i % propertyIds.length];
    await pool.query(
      `INSERT INTO recurring_plans (customer_id, property_id, crew_id, name, status, frequency_type, interval_value, preferred_day_of_week, preferred_time_window, next_run_date, service_type, estimated_amount, auto_generate_jobs, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,NOW(),NOW())`,
      [
        cid, pid,
        crewIds[i % crewIds.length],
        `${freqTypes[i % freqTypes.length].charAt(0).toUpperCase() + freqTypes[i % freqTypes.length].slice(1)} Window Service`,
        planStatuses[i % planStatuses.length],
        freqTypes[i % freqTypes.length],
        1, rand(1,5),
        pick(["morning","afternoon","anytime"]),
        futureDate(rand(3, 30)),
        pick(serviceTypes),
        price(150, 400),
      ]
    );
  }
  console.log(`    ✓ 10 recurring plans`);

  // ── 10. Tasks ─────────────────────────────────────────────────────────────
  console.log("  Creating tasks...");
  const taskTitles = [
    "Follow up on overdue invoice","Send quote reminder","Schedule annual deep clean","Call to confirm tomorrow's job",
    "Review property access notes","Send satisfaction survey","Renew recurring plan","Check in on new customer",
    "Update credit card on file","Confirm crew availability","Send referral thank-you","Review hard water notes",
  ];
  const taskStatuses = ["pending","pending","in_progress","completed"];
  const taskPriorities = ["low","medium","high","urgent"];
  for (let i = 0; i < 14; i++) {
    await pool.query(
      `INSERT INTO tasks (related_type, related_id, title, description, status, priority, due_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())`,
      [
        pick(["customer","job","invoice"]),
        customerIds[i % customerIds.length],
        taskTitles[i % taskTitles.length],
        "Auto-generated reminder for follow-up action.",
        taskStatuses[i % taskStatuses.length],
        taskPriorities[i % taskPriorities.length],
        futureDate(rand(1, 14)),
      ]
    );
  }
  console.log(`    ✓ 14 tasks`);

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log("\n✅  Seed complete!\n");
  console.log("  Crews:           ", crewIds.length);
  console.log("  Services:        ", serviceIds.length);
  console.log("  Leads:           ", leadIds.length);
  console.log("  Customers:       ", customerIds.length);
  console.log("  Properties:      ", propertyIds.length);
  console.log("  Quotes:          ", quoteIds.length);
  console.log("  Jobs:            ", jobIds.length);
  console.log("  Invoices:        ", invoiceIds.length);
  console.log("  Recurring Plans: 10");
  console.log("  Tasks:           14");
  const total = crewIds.length + serviceIds.length + leadIds.length + customerIds.length + propertyIds.length + quoteIds.length + jobIds.length + invoiceIds.length + 10 + 14;
  console.log(`\n  Total records:   ${total}\n`);

  await pool.end();
}

main().catch((err) => {
  console.error("❌  Seed failed:", err);
  process.exit(1);
});
