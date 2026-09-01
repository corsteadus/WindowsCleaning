import { createHash } from "crypto";

export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/\D/g, "");
}

export function normalizeEmail(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().toLowerCase();
}

export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().replace(/\s+/g, " ");
}

export function normalizeAddress(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().replace(/\s+/g, " ");
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function parseDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = raw.trim();
  if (!s) return "";

  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, yStr, mStr, dStr] = isoMatch;
    const y = parseInt(yStr, 10), m = parseInt(mStr, 10), d = parseInt(dStr, 10);
    if (isValidCalendarDate(y, m, d)) return s;
    console.warn(`[parseDate] invalid calendar date: "${s}"`);
    return "";
  }

  const slashMatch = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (slashMatch) {
    const [, mStr, dStr, yStr] = slashMatch;
    let year = parseInt(yStr, 10);
    const month = parseInt(mStr, 10);
    const day = parseInt(dStr, 10);

    if (yStr.length === 2) {
      year = year >= 50 ? 1900 + year : 2000 + year;
    }

    if (year < 1900 || year > 2100 || !isValidCalendarDate(year, month, day)) {
      console.warn(`[parseDate] invalid date: "${s}"`);
      return "";
    }

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const d = new Date(s);
  if (!isNaN(d.getTime()) && d.getFullYear() >= 1900 && d.getFullYear() <= 2100) {
    return d.toISOString().slice(0, 10);
  }

  console.warn(`[parseDate] unparseable: "${s}"`);
  return "";
}

export function cleanNumeric(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const n = parseInt(trimmed, 10);
  return isNaN(n) ? "" : String(n);
}

export function fingerprint(data: Record<string, unknown>): string {
  const sorted = Object.keys(data).sort().reduce<Record<string, unknown>>((acc, k) => {
    acc[k] = data[k] ?? "";
    return acc;
  }, {});
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 32);
}

export function jobFingerprint(
  customerId: number,
  scheduledDate: string,
  serviceType: string,
  totalAmount: string
): string {
  return fingerprint({ customerId: String(customerId), scheduledDate, serviceType, totalAmount });
}

// ─── Residential name safeguards ──────────────────────────────────────────────
//
// Words that strongly suggest a name is a property/location, not a person.
// When a residential customer's company_name contains one of these words,
// it is treated as a property name and NOT used as the primary account name.
const PROPERTY_KEYWORDS = new Set([
  "farm", "farms", "ranch", "ranches", "estate", "estates", "manor", "manors",
  "house", "cabin", "lodge", "camp", "cottage", "villa", "plantation",
  "homestead", "acres", "creek", "ridge", "heights", "hills", "hollow",
  "meadow", "meadows", "woods", "wood", "grove", "glen", "lake", "lakes",
  "pond", "pines", "property", "properties", "land", "lands", "barn", "mill",
  "springs", "spring", "field", "fields", "valley", "valley", "run",
]);

/** Returns true if the name contains location/property keywords. */
export function looksLikePropertyName(name: string): boolean {
  const words = name.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/);
  return words.some(w => w.length > 2 && PROPERTY_KEYWORDS.has(w));
}

/**
 * Returns true if the name looks like a simple person name:
 * 2–3 words, no location keywords, no digits.
 */
export function looksLikePersonName(name: string): boolean {
  if (/\d/.test(name)) return false;
  const words = name.trim().split(/\s+/);
  if (words.length < 2 || words.length > 3) return false;
  return !looksLikePropertyName(name);
}

/**
 * Normalise client_type values from CF CSV exports.
 * Accepts "Residential", "R", "residential", "Commercial", "C", etc.
 */
function parseClientType(raw: string): "residential" | "commercial" | "" {
  const v = raw.trim().toLowerCase();
  if (v === "residential" || v === "r" || v === "res") return "residential";
  if (v === "commercial" || v === "c" || v === "com") return "commercial";
  return "";
}

export function normalizeCustomerRow(raw: Record<string, string>) {
  const addr1 = raw["Street Address"] || raw["street_address"] || raw["Address"] || "";
  const addr2 = raw["Address 2"] || raw["address_2"] || raw["address2"] || "";
  const sendEmail = (raw["Send Preference: Email"] || "").trim().toUpperCase() === "X";
  const sendText  = (raw["Send Preference: Text"]  || "").trim().toUpperCase() === "X";

  // Read client type from any of the common CF column names
  // "Customer Type" is the column name in CF customer-list CSV exports
  const rawClientType =
    raw["Client Type"] || raw["client_type"] ||
    raw["Customer Type"] || raw["customer_type"] ||
    raw["Account Type"] || raw["account_type"] ||
    raw["Type"] || raw["type"] || "";
  const clientType = parseClientType(rawClientType);

  let firstName   = normalizeName(raw["First Name"]    || raw["first_name"]   || "");
  let lastName    = normalizeName(raw["Last Name"]     || raw["last_name"]    || "");
  let companyName = normalizeName(raw["Company Name"]  || raw["company_name"] || "");
  let notes       = (raw["Notes"] || raw["notes"] || "").trim();

  // "Customer Name" is a single combined-name column in CF job/invoice CSV exports.
  // If First Name / Last Name are absent, split it into first+last.
  const customerNameRaw = normalizeName(raw["Customer Name"] || raw["customer_name"] || "");
  if (customerNameRaw && !firstName && !lastName && !companyName) {
    const parts = customerNameRaw.trim().split(/\s+/);
    if (parts.length >= 2) {
      firstName   = parts.slice(0, -1).join(" ");
      lastName    = parts[parts.length - 1];
    } else {
      firstName   = customerNameRaw;
    }
  }

  if (firstName && !lastName && firstName.includes(" ")) {
    const parts = firstName.trim().split(/\s+/);
    if (parts.length >= 2) {
      lastName  = parts[parts.length - 1];
      firstName = parts.slice(0, -1).join(" ");
    }
  }

  // ── Residential name safeguards ──────────────────────────────────────────
  // Only apply when the record is explicitly residential OR when it has
  // first+last name set (strong indicator it's a person, not a company).
  const isResidential =
    clientType === "residential" || (!!firstName && !!lastName && !companyName);

  if (isResidential) {
    // Case A: company_name is set + first/last are also set
    //   → If company looks like a property name, clear it (person name takes over).
    //   → If company looks like a person name or business, keep it as-is.
    if (companyName && (firstName || lastName)) {
      if (looksLikePropertyName(companyName)) {
        // Move the property label to notes so it isn't lost, then clear company_name
        const tag = `[Property: ${companyName}]`;
        notes = notes ? `${notes}\n${tag}` : tag;
        companyName = "";
      }
    }

    // Case B: no first/last name, only company_name
    //   → If the company name looks like a person name, split it into first + last.
    //     This rescues records where CF stored a person's name as a "company".
    //   → If it looks like a property/location, move to notes (don't use as name).
    if (!firstName && !lastName && companyName) {
      if (looksLikePersonName(companyName)) {
        const parts = companyName.trim().split(/\s+/);
        firstName   = parts.slice(0, -1).join(" ");
        lastName    = parts[parts.length - 1];
        companyName = "";
      } else if (looksLikePropertyName(companyName)) {
        const tag = `[Property: ${companyName}]`;
        notes = notes ? `${notes}\n${tag}` : tag;
        companyName = "";
      }
    }

    // Case C: first_name itself looks like a property (e.g., "Hickman Farm" in first_name)
    //   → Don't use it as a person name; move to notes.
    if (firstName && looksLikePropertyName(firstName)) {
      const tag = `[Property: ${firstName}${lastName ? " " + lastName : ""}]`;
      notes = notes ? `${notes}\n${tag}` : tag;
      firstName = "";
      lastName  = "";
    }
  }

  return {
    externalId:    normalizeCfId(raw["Id"] || raw["id"] || raw["c_id"] || ""),
    firstName,
    lastName,
    companyName,
    clientType:    clientType || (companyName && !firstName ? "commercial" : "residential"),
    salutation:    (raw["Salutation"] || raw["title"] || "").trim(),
    email:         normalizeEmail(raw["Email"] || raw["email"] || ""),
    homePhone:     normalizePhone(raw["Home Phone"]  || raw["home_phone"]  || raw["phone"] || ""),
    workPhone:     normalizePhone(raw["Work Phone"]  || raw["work_phone"]  || raw["phone2"] || ""),
    cellPhone:     normalizePhone(raw["Cell Phone"]  || raw["cell_phone"]  || raw["phone3"] || ""),
    fax:           normalizePhone(raw["Fax"]         || raw["fax"]         || raw["phone4"] || ""),
    altPhone:      normalizePhone(raw["Alt. Phone"]  || raw["alt_phone"]   || raw["phone5"] || ""),
    altContact:    normalizeName(raw["Alt. Contact"] || raw["alt_contact"] || raw["contact_person"] || ""),
    billingAddress: normalizeAddress(addr2 ? `${addr1} ${addr2}`.trim() : addr1),
    billingCity:   normalizeName(raw["City"]     || raw["city"]  || ""),
    billingState:  (raw["State"]    || raw["state"] || "").trim().toUpperCase(),
    billingZip:    (raw["Zip Code"] || raw["zip"]   || "").trim(),
    notes,
    howHeard:      (raw["Marketing Method"] || raw["how_heard"] || raw["hearus"] || "").trim(),
    starRating:    cleanNumeric(raw["Star Rating"] || raw["star_rating"] || ""),
    windowCount:   cleanNumeric(raw["Window Count"] || raw["window_count"] || ""),
    windowType:    (raw["Window Type"]  || raw["window_type"]  || "").trim(),
    houseSize:     (raw["House Size"]   || raw["house_size"]   || "").trim(),
    laddersNeeded: (raw["Ladders"]      || raw["ladders_needed"] || "").trim(),
    sendingPreferences: [sendEmail ? "email" : "", sendText ? "sms" : ""].filter(Boolean).join(","),
    customerDate:  parseDate(raw["Date Added"] || raw["date_added"] || raw["customer_date"]),
    status: "active",
    tags: (raw["tags"] || "").trim(),
  };
}

export function normalizeLeadRow(raw: Record<string, string>) {
  const base = normalizeCustomerRow(raw);
  return {
    ...base,
    estimatedValue: (raw["Estimated Value"] || raw["estimated_value"] || "").trim(),
    source:         (raw["Source"] || raw["source"] || raw["hearus"] || "").trim(),
    assignedTo:     (raw["Assigned To"] || raw["assigned_to"] || "").trim(),
    followUpDate:   parseDate(raw["Follow Up Date"] || raw["follow_up_date"]),
    clientType:     "residential" as const,
  };
}

export function normalizeJobRow(raw: Record<string, string>) {
  return {
    cfCustomerId:   raw["Id"] || raw["id"] || raw["c_id"] || raw["cfCustomerId"] || "",
    jobNumber:      (raw["Invoice Number"] || raw["invoice_number"] || raw["job_number"] || raw["cj_id"] || "").trim(),
    scheduledDate:  parseDate(raw["Job Date"] || raw["job_date"] || raw["scheduled_date"]),
    serviceType:    (raw["Job Type"]  || raw["job_type"]  || raw["service_type"]  || "").trim(),
    notes:          (raw["Job Details"] || raw["job_details"] || raw["invoice_comments"] || raw["notes"] || "").trim(),
    totalAmount:    (raw["Price"] || raw["price"] || raw["est"] || raw["total_amount"] || "0").trim(),
    status:         "completed",
    techNotes:      raw["Assigned To"] ? `Assigned to: ${raw["Assigned To"]}` : (raw["tech_notes"] || ""),
    serviceAddress: (raw["Job location"] || raw["job_location"] || raw["Job Location"] || raw["service_address"] || "").trim(),
  };
}

export function mergeJobGroupRows(rows: Record<string, string>[]) {
  const first = normalizeJobRow(rows[0]);

  if (rows.length === 1) return first;

  const serviceLines: { type: string; details: string; price: number }[] = [];
  let totalPrice = 0;
  const techNotesParts: string[] = [];

  for (const raw of rows) {
    const n = normalizeJobRow(raw);
    const price = parseFloat(n.totalAmount.replace(/[^0-9.-]/g, "")) || 0;
    totalPrice += price;
    const type = n.serviceType || "Service";
    const details = n.notes || "";
    serviceLines.push({ type, details, price });
    if (n.techNotes && !techNotesParts.includes(n.techNotes)) {
      techNotesParts.push(n.techNotes);
    }
  }

  const uniqueTypes = [...new Set(serviceLines.map(l => l.type).filter(Boolean))];
  const combinedServiceType = uniqueTypes.join(" + ");

  const lineItemsJson = JSON.stringify(serviceLines.map(l => ({
    service: l.type,
    details: l.details,
    amount: l.price,
  })));

  const notesParts: string[] = [];
  for (let i = 0; i < serviceLines.length; i++) {
    const l = serviceLines[i];
    const parts = [`${l.type}: $${l.price.toFixed(2)}`];
    if (l.details) parts.push(l.details);
    notesParts.push(parts.join(" — "));
  }
  const combinedNotes = notesParts.join("\n");

  return {
    ...first,
    serviceType: combinedServiceType,
    totalAmount: totalPrice.toFixed(2),
    notes: combinedNotes,
    techNotes: techNotesParts.join("\n"),
    lineItems: lineItemsJson,
    serviceCount: rows.length,
  };
}

export function normalizeCfId(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const num = parseFloat(trimmed);
  if (!isNaN(num) && Number.isFinite(num)) {
    return String(Math.trunc(num));
  }
  return trimmed;
}

export function normalizeInvoiceRow(raw: Record<string, string>) {
  const customerIdRaw =
    raw["Customer ID"] || raw["Customer Id"] || raw["CustomerID"] || raw["CustomerId"] ||
    raw["customer_id"] || raw["customerid"]  ||
    raw["customerId"]  || raw["cfCustomerId"] || raw["cf_customer_id"] ||
    raw["c_id"] || raw["CID"] || raw["cid"]  ||
    raw["Id"] || raw["ID"] || raw["id"] || "";

  return {
    invoiceNumber:  (raw["Invoice No"] || raw["Invoice Number"] || raw["invoice_number"] || raw["Invoice #"] || "").trim(),
    invoiceDate:    parseDate(raw["Date"] || raw["Invoice Date"] || raw["invoice_date"]),
    customerId:     normalizeCfId(customerIdRaw),
    customerName:   (raw["Customer"] || raw["Customer Name"] || raw["customer_name"] || "").trim(),
    address:        (raw["Address"] || raw["address"] || "").trim(),
    city:           (raw["City"] || raw["city"] || "").trim(),
    state:          (raw["State"] || raw["state"] || "").trim(),
    zip:            (raw["Zip Code"] || raw["Zip"] || raw["zip"] || raw["zip_code"] || "").trim(),
    amount:         (raw["Amount"] || raw["amount"] || "0").trim(),
    discount:       (raw["Discount"] || raw["discount"] || "0").trim(),
    lateFee:        (raw["Late Fee"] || raw["late_fee"] || "0").trim(),
    totalAmount:    (raw["Total"] || raw["total"] || raw["total_amount"] || "0").trim(),
    amountPaid:     (raw["Paid"] || raw["Amount Paid"] || raw["amount_paid"] || "0").trim(),
    datePaid:       parseDate(raw["Date Paid"] || raw["date_paid"]),
    paymentMethod:  (raw["Form of payment"] || raw["Payment Method"] || raw["payment_method"] || "").trim(),
    balanceDue:     (raw["Due"] || raw["Balance Due"] || raw["balance_due"] || "0").trim(),
    status:         (raw["Status"] || raw["status"] || "draft").trim().toLowerCase(),
    subtotal:       (raw["Subtotal"] || raw["subtotal"] || raw["Amount"] || "0").trim(),
    taxAmount:      (raw["Tax"] || raw["tax"] || "0").trim(),
    dueDate:        parseDate(raw["Due Date"] || raw["due_date"]),
    notes:          (raw["Notes"] || raw["notes"] || "").trim(),
  };
}
