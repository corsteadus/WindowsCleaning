import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import Papa from "papaparse";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload, Database, FileText, CheckCircle2, AlertTriangle, XCircle,
  ChevronRight, ChevronLeft, ArrowLeft, RefreshCw, Trash2, Play,
  RotateCcw, Eye, EyeOff, ChevronDown, ChevronUp, Users, Briefcase, Home,
  FileSpreadsheet, FileCode2, Table2, Plus, Loader2, Check, X,
  Filter, Download, Info, Search,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import APP_VERSION from "@/version";
import { protectedFetch } from "@/lib/auth-scope";

// Injected at build time by vite.config.ts define plugin
declare const __BUILD_TS__: number;
const _buildDate = new Date(__BUILD_TS__);
const BUILD_DATE = _buildDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
const BUILD_TIME = _buildDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await protectedFetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.text();
    // Extract a clean message from JSON error responses
    try {
      const json = JSON.parse(body);
      throw new Error(json.error || json.message || body);
    } catch (parseErr) {
      if (parseErr instanceof SyntaxError) throw new Error(body.slice(0, 200));
      throw parseErr;
    }
  }
  return res.json();
}

// ─── Types ─────────────────────────────────────────────────────────────────────

type FileGroup =
  | "active_customers" | "master_customers"
  | "active_prospects" | "master_prospects"
  | "invoices" | "sql_backup" | "unknown";

const FILE_GROUP_LABELS: Record<FileGroup, string> = {
  active_customers:   "Active Customers",
  master_customers:   "Master Customers",
  active_prospects:   "Active Prospects",
  master_prospects:   "Master Prospects",
  invoices:           "Invoices",
  sql_backup:         "SQL Backup",
  unknown:            "Unknown (re-classify)",
};

const FILE_GROUP_COLORS: Record<FileGroup, string> = {
  active_customers:   "bg-blue-100 text-blue-800 border-blue-200",
  master_customers:   "bg-indigo-100 text-indigo-800 border-indigo-200",
  active_prospects:   "bg-amber-100 text-amber-800 border-amber-200",
  master_prospects:   "bg-orange-100 text-orange-800 border-orange-200",
  invoices:           "bg-green-100 text-green-800 border-green-200",
  sql_backup:         "bg-violet-100 text-violet-800 border-violet-200",
  unknown:            "bg-slate-100 text-slate-600 border-slate-200",
};

const BATCH_STATUSES: Record<string, { label: string; color: string }> = {
  uploading:    { label: "Uploading",    color: "bg-blue-100 text-blue-700" },
  staged:       { label: "Staged",       color: "bg-amber-100 text-amber-700" },
  review:       { label: "Needs Review", color: "bg-orange-100 text-orange-700" },
  applying:     { label: "Applying…",   color: "bg-blue-100 text-blue-700" },
  applied:      { label: "Applied",      color: "bg-green-100 text-green-700" },
  rolling_back: { label: "Rolling Back…",color: "bg-rose-100 text-rose-700" },
  rolled_back:  { label: "Rolled Back",  color: "bg-slate-100 text-slate-600" },
  error:        { label: "Error",        color: "bg-red-100 text-red-700" },
};

// ─── CSV / TSV parsers — PapaParse handles quoted fields, embedded newlines, escaped quotes ─

function parseDelimited(text: string, delimiter: string): Record<string, string>[] {
  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    delimiter,
    skipEmptyLines: "greedy",
    transform: (val: string) => val.trim(),
    transformHeader: (h: string) => h.trim(),
    dynamicTyping: false,
  });

  if (result.errors && result.errors.length > 0) {
    console.warn(`[CSV Parse] ${result.errors.length} warning(s):`, result.errors.slice(0, 5));
  }

  return (result.data ?? []).filter(
    (r) => r && typeof r === "object" && Object.values(r).some((v) => v && String(v).trim())
  ) as Record<string, string>[];
}

// ─── Column mapping engine ────────────────────────────────────────────────────

const CRM_MAPPING_FIELDS: Array<{
  key: string;
  label: string;
  group: string;
  normalizedCol: string;
  autoDetect: string[];
}> = [
  { key: "externalId",     label: "External ID",  group: "Identity", normalizedCol: "Id",              autoDetect: ["Id", "id", "c_id", "external_id", "ExternalId", "CF ID"] },
  { key: "firstName",      label: "First Name",   group: "Identity", normalizedCol: "First Name",      autoDetect: ["First Name", "first_name", "FirstName", "Customer Name", "customer_name"] },
  { key: "lastName",       label: "Last Name",    group: "Identity", normalizedCol: "Last Name",       autoDetect: ["Last Name", "last_name", "LastName"] },
  { key: "companyName",    label: "Company Name", group: "Identity", normalizedCol: "Company Name",    autoDetect: ["Company Name", "company_name", "CompanyName", "Company"] },
  { key: "email",          label: "Email",        group: "Contact",  normalizedCol: "Email",           autoDetect: ["Email", "email", "E-mail", "EmailAddress"] },
  { key: "homePhone",      label: "Home Phone",   group: "Contact",  normalizedCol: "Home Phone",      autoDetect: ["Home Phone", "home_phone", "phone", "Phone"] },
  { key: "cellPhone",      label: "Cell Phone",   group: "Contact",  normalizedCol: "Cell Phone",      autoDetect: ["Cell Phone", "cell_phone", "phone3", "Mobile", "CellPhone"] },
  { key: "workPhone",      label: "Work Phone",   group: "Contact",  normalizedCol: "Work Phone",      autoDetect: ["Work Phone", "work_phone", "phone2", "Business Phone"] },
  { key: "billingAddress", label: "Address",      group: "Address",  normalizedCol: "Street Address",  autoDetect: ["Street Address", "street_address", "Address", "address"] },
  { key: "billingCity",    label: "City",         group: "Address",  normalizedCol: "City",            autoDetect: ["City", "city"] },
  { key: "billingState",   label: "State",        group: "Address",  normalizedCol: "State",           autoDetect: ["State", "state"] },
  { key: "billingZip",     label: "Zip",          group: "Address",  normalizedCol: "Zip Code",        autoDetect: ["Zip Code", "zip", "Zip", "ZipCode", "zip_code", "Postal Code"] },
  { key: "clientType",     label: "Client Type",  group: "Other",    normalizedCol: "Client Type",     autoDetect: ["Client Type", "client_type", "Customer Type", "customer_type", "Account Type", "Type"] },
  { key: "notes",          label: "Notes",        group: "Other",    normalizedCol: "Notes",           autoDetect: ["Notes", "notes"] },
  { key: "howHeard",       label: "How Heard",    group: "Other",    normalizedCol: "Marketing Method", autoDetect: ["Marketing Method", "how_heard", "hearus", "How Heard"] },
  { key: "salutation",     label: "Salutation",   group: "Other",    normalizedCol: "Salutation",      autoDetect: ["Salutation", "title", "Title"] },
  { key: "jobDate",        label: "Job Date",     group: "Job",      normalizedCol: "Job Date",        autoDetect: ["Job Date", "job_date", "scheduled_date", "Service Date", "Date of Service", "Date"] },
  { key: "jobNumber",      label: "Job / Invoice #", group: "Job",   normalizedCol: "Invoice Number",  autoDetect: ["Invoice Number", "invoice_number", "job_number", "cj_id", "Job Number", "Job #"] },
  { key: "jobType",        label: "Job Type",     group: "Job",      normalizedCol: "Job Type",        autoDetect: ["Job Type", "job_type", "service_type", "Service Type", "Type of Service"] },
  { key: "jobPrice",       label: "Price",        group: "Job",      normalizedCol: "Price",           autoDetect: ["Price", "price", "est", "total_amount", "Amount", "Total", "Job Price"] },
  { key: "jobDetails",     label: "Job Details",  group: "Job",      normalizedCol: "Job Details",     autoDetect: ["Job Details", "job_details", "invoice_comments", "Job Notes"] },
  { key: "jobLocation",    label: "Job Location", group: "Job",      normalizedCol: "Job Location",    autoDetect: ["Job Location", "job_location", "Service Address"] },
];

function autoDetectMapping(csvHeaders: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  const headerLower = csvHeaders.map(h => h.toLowerCase().trim());

  for (const field of CRM_MAPPING_FIELDS) {
    for (const pattern of field.autoDetect) {
      const idx = headerLower.indexOf(pattern.toLowerCase());
      if (idx !== -1 && !used.has(csvHeaders[idx])) {
        mapping[field.key] = csvHeaders[idx];
        used.add(csvHeaders[idx]);
        break;
      }
    }
  }
  return mapping;
}

function getMappingFingerprint(headers: string[]): string {
  return [...headers].sort().join("|").toLowerCase();
}

function validateIdentityMapping(mapping: Record<string, string>): { valid: boolean; message: string } {
  const hasFirstName = !!mapping.firstName;
  const hasLastName = !!mapping.lastName;
  const hasName = hasFirstName && hasLastName;
  const hasEmail = !!mapping.email;
  const hasPhone = !!(mapping.homePhone || mapping.cellPhone || mapping.workPhone);

  if (!hasName && !hasEmail && !hasPhone) {
    return {
      valid: false,
      message: "Missing required identity mapping. Please map name, email, or phone before continuing.",
    };
  }
  return { valid: true, message: "" };
}

function applyColumnMapping(
  rows: Record<string, string>[],
  mapping: Record<string, string>,
): Record<string, string>[] {
  const mappedCsvCols = new Set(Object.values(mapping).filter(Boolean));
  const hasAnyMapping = mappedCsvCols.size > 0;
  if (!hasAnyMapping) return rows;

  return rows.map(row => {
    const newRow: Record<string, string> = {};
    for (const field of CRM_MAPPING_FIELDS) {
      const csvCol = mapping[field.key];
      if (csvCol && row[csvCol] !== undefined) {
        newRow[field.normalizedCol] = row[csvCol];
      }
    }
    for (const [key, value] of Object.entries(row)) {
      if (!mappedCsvCols.has(key) && !(key in newRow)) {
        newRow[key] = value;
      }
    }
    return newRow;
  });
}

function ColumnMappingPanel({
  csvHeaders,
  mapping,
  onMappingChange,
  sampleRow,
}: {
  csvHeaders: string[];
  mapping: Record<string, string>;
  onMappingChange: (m: Record<string, string>) => void;
  sampleRow: Record<string, string> | null;
}) {
  const [showDebug, setShowDebug] = useState(false);
  const identity = validateIdentityMapping(mapping);
  const groups = ["Identity", "Contact", "Address", "Other"];
  const unmappedHeaders = csvHeaders.filter(h => !Object.values(mapping).includes(h));

  return (
    <div className="space-y-4 bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Table2 className="w-4 h-4" /> Column Mapping
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Map CSV columns to CRM fields. Auto-detected mappings are pre-filled — adjust as needed.
          </p>
        </div>
        <button
          onClick={() => setShowDebug(!showDebug)}
          className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors"
        >
          <Info className="w-3 h-3" /> {showDebug ? "Hide" : "Show"} Debug
        </button>
      </div>

      {!identity.valid && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700 font-medium">{identity.message}</p>
        </div>
      )}

      {identity.valid && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
          <p className="text-xs text-emerald-700 font-medium">Identity requirements met — ready to import.</p>
        </div>
      )}

      <div className="space-y-4">
        {groups.map(group => {
          const fields = CRM_MAPPING_FIELDS.filter(f => f.group === group);
          return (
            <div key={group}>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">{group}</p>
              <div className="space-y-1.5">
                {fields.map(field => {
                  const csvCol = mapping[field.key];
                  const sampleVal = csvCol && sampleRow ? sampleRow[csvCol] : null;
                  return (
                    <div key={field.key} className="flex items-center gap-3">
                      <label className="w-28 text-xs font-medium text-slate-600 text-right shrink-0">
                        {field.label}
                      </label>
                      <select
                        value={csvCol || ""}
                        onChange={e => {
                          const val = e.target.value;
                          const next = { ...mapping };
                          if (val) next[field.key] = val;
                          else delete next[field.key];
                          onMappingChange(next);
                        }}
                        className={`flex-1 text-xs px-2.5 py-1.5 border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary transition-colors ${
                          csvCol ? "border-emerald-300 bg-emerald-50/50 text-slate-800" : "border-slate-200 text-slate-400"
                        }`}
                      >
                        <option value="">— Not mapped —</option>
                        {csvHeaders.map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                      {sampleVal && (
                        <span className="text-[11px] text-slate-400 truncate max-w-[140px] font-mono" title={sampleVal}>
                          {sampleVal}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {unmappedHeaders.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
            Unmapped CSV Columns ({unmappedHeaders.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {unmappedHeaders.map(h => (
              <span key={h} className="text-[11px] px-2 py-0.5 bg-slate-100 text-slate-500 rounded border border-slate-200">
                {h}
              </span>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            These columns will be passed through as-is (job data, invoice data, etc.).
          </p>
        </div>
      )}

      {showDebug && sampleRow && (
        <div className="bg-slate-900 rounded-xl p-4 space-y-3 mt-2">
          <p className="text-xs font-semibold text-slate-400">Debug: Sample Row Transformation</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Raw CSV Row</p>
              <pre className="text-[11px] text-amber-300 font-mono overflow-x-auto max-h-52 whitespace-pre-wrap">
                {JSON.stringify(sampleRow, null, 2)}
              </pre>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Mapped Output</p>
              <pre className="text-[11px] text-emerald-300 font-mono overflow-x-auto max-h-52 whitespace-pre-wrap">
                {JSON.stringify(applyColumnMapping([sampleRow], mapping)[0], null, 2)}
              </pre>
            </div>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 mb-1 uppercase tracking-wider">Skipped CSV Columns</p>
            <div className="flex flex-wrap gap-1.5">
              {unmappedHeaders.length > 0 ? unmappedHeaders.map(h => (
                <span key={h} className="text-[11px] px-2 py-0.5 bg-slate-800 text-slate-400 rounded">{h}</span>
              )) : <span className="text-[11px] text-slate-500">All columns mapped</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function parseSQLCustomers(sqlText: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const marker = `Dumping data for table \`superior_customers\``;
  const start = sqlText.indexOf(marker);
  if (start === -1) return rows;
  const next = sqlText.indexOf("Dumping data for table `", start + marker.length);
  const section = sqlText.substring(start, next === -1 ? sqlText.length : next);

  const createMarker = `CREATE TABLE \`superior_customers\``;
  const cs = sqlText.indexOf(createMarker);
  const colMap: Record<string, number> = {};
  if (cs !== -1) {
    const bodyStart = sqlText.indexOf("(", cs) + 1;
    const engineIdx = sqlText.indexOf(") ENGINE=", bodyStart);
    let idx = 0;
    for (const line of sqlText.substring(bodyStart, engineIdx).split("\n")) {
      const t = line.trim(), m = t.match(/^`(\w+)`/);
      if (m && !t.startsWith("PRIMARY") && !t.startsWith("KEY") && !t.startsWith("UNIQUE")) colMap[m[1]] = idx++;
    }
  }

  const pat = `INSERT INTO \`superior_customers\` VALUES `;
  let pos = 0;
  const g = (r: (string | null)[], name: string) => r[colMap[name] ?? -1] ?? "";

  while (true) {
    const ins = section.indexOf(pat, pos);
    if (ins === -1) break;
    let end = ins + pat.length; let inStr = false;
    while (end < section.length) {
      if (inStr) { if (section[end] === "\\") { end += 2; continue; } if (section[end] === "'") inStr = false; }
      else { if (section[end] === "'") inStr = true; else if (section[end] === ";") break; }
      end++;
    }
    const valueStr = section.substring(ins + pat.length, end);
    const parsed = parseValuesString(valueStr);
    for (const row of parsed) {
      rows.push({
        "Id": g(row, "c_id"),
        "First Name": g(row, "first_name"),
        "Last Name": g(row, "last_name"),
        "Company Name": g(row, "company_name"),
        "Email": g(row, "email"),
        "Home Phone": g(row, "phone"),
        "Work Phone": g(row, "phone2"),
        "Cell Phone": g(row, "phone3"),
        "Fax": g(row, "phone4"),
        "Alt. Phone": g(row, "phone5"),
        "Street Address": g(row, "address"),
        "Address 2": g(row, "address2"),
        "City": g(row, "city"),
        "State": g(row, "state"),
        "Zip Code": g(row, "zip"),
        "Notes": g(row, "notes"),
        "Marketing Method": g(row, "hearus"),
        "Star Rating": g(row, "star_rating"),
        "Date Added": (() => {
          const ts = parseInt(g(row, "date_added") || "0", 10);
          return ts > 0 ? new Date(ts * 1000).toISOString().slice(0, 10) : "";
        })(),
      });
    }
    pos = end + 1;
  }
  return rows;
}

function parseValuesString(str: string): (string | null)[][] {
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

function detectFileGroup(fileName: string, firstHeaders: string[]): FileGroup {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".sql")) return "sql_backup";
  if (lower.includes("invoice")) return "invoices";
  const isMaster = lower.includes("master");
  const isProspect = lower.includes("prospect");
  const isCustomer = lower.includes("customer");
  if (isMaster && isProspect)  return "master_prospects";
  if (isMaster && isCustomer)  return "master_customers";
  if (isMaster)                 return "master_customers";
  if (isProspect)               return "active_prospects";
  if (isCustomer)               return "active_customers";
  if (lower.includes("active")) return "active_customers";
  // Check headers as fallback
  const headers = firstHeaders.map(h => h.toLowerCase());
  if (headers.includes("invoice number") || headers.includes("invoice_number")) return "invoices";
  if (headers.includes("id") || headers.includes("first name") || headers.includes("first_name")) return "active_customers";
  return "unknown";
}

// ─── Queued file (client-side before staging) ─────────────────────────────────

interface QueuedFile {
  id: string;
  file: File;
  fileGroup: FileGroup;
  rows: Record<string, string>[] | null;
  parsing: boolean;
  error: string | null;
  rowCount: number;
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = ["Select Batch", "Upload Files", "Review Conflicts", "Apply"];

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1 mb-8">
      {STEPS.map((label, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors
            ${i < current ? "bg-emerald-100 text-emerald-700" :
              i === current ? "bg-primary text-white shadow-sm" :
              "bg-slate-100 text-slate-400"}`}>
            {i < current
              ? <Check className="w-3 h-3" />
              : <span>{i + 1}</span>}
            <span>{label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Batch status badge ───────────────────────────────────────────────────────

function BatchBadge({ status }: { status: string }) {
  const cfg = BATCH_STATUSES[status] ?? { label: status, color: "bg-slate-100 text-slate-600" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

// ─── Backfill External IDs ────────────────────────────────────────────────────

function BackfillExternalIds() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<any>(null);
  const [expanded, setExpanded] = useState(false);
  const { toast } = useToast();

  const { data: stats } = useQuery({
    queryKey: ["external-id-stats"],
    queryFn: () => apiFetch("/api/admin/import/external-id-stats"),
    refetchInterval: 30000,
  });

  const backfillMut = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      const delimiter = text.includes("\t") ? "\t" : ",";
      const rows = parseDelimited(text, delimiter);
      return apiFetch("/api/admin/import/backfill-external-ids", {
        method: "POST",
        body: JSON.stringify({ rows }),
      });
    },
    onSuccess: (data: any) => {
      setResult(data);
      toast({ title: `Backfill complete: ${data.matched} linked, ${data.noMatch} unmatched` });
    },
    onError: (err: any) => {
      toast({ title: "Backfill failed", description: err?.message, variant: "destructive" });
    },
  });

  const pct = stats ? Math.round((stats.withExternalId / Math.max(stats.totalCustomers, 1)) * 100) : 0;

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
      <button onClick={() => setExpanded(!expanded)} className="flex items-center justify-between w-full text-left">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-bold text-blue-800">Customer Factor ID Backfill</span>
          {stats && (
            <span className="text-xs text-blue-600 font-medium">{stats.withExternalId}/{stats.totalCustomers} linked ({pct}%)</span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-blue-400" /> : <ChevronDown className="w-4 h-4 text-blue-400" />}
      </button>

      {expanded && (
        <div className="space-y-3 pt-2 border-t border-blue-200">
          <p className="text-xs text-blue-700">
            Upload a Customer Factor customer CSV to link existing CRM customers to their CF IDs.
            Matches by email, then phone, then name+address.
          </p>

          <div className="flex items-center gap-3">
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) backfillMut.mutate(f);
            }} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={backfillMut.isPending}
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {backfillMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Upload Customer CSV to Backfill
            </button>
          </div>

          {result && (
            <div className="bg-white rounded-lg p-3 text-xs space-y-1 border border-blue-100">
              <p className="font-semibold text-slate-700">Results: {result.total} rows processed</p>
              <div className="flex gap-4 flex-wrap">
                <span className="text-emerald-600">{result.matched} linked</span>
                <span className="text-slate-500">{result.alreadySet} already set</span>
                <span className="text-amber-600">{result.noMatch} unmatched</span>
                {result.conflicts > 0 && <span className="text-red-600">{result.conflicts} conflicts</span>}
              </div>
              {result.details?.length > 0 && (
                <details className="mt-2">
                  <summary className="text-blue-600 cursor-pointer font-medium">Details ({result.details.length})</summary>
                  <div className="mt-1 max-h-40 overflow-y-auto space-y-0.5">
                    {result.details.map((d: any, i: number) => (
                      <div key={i} className="text-slate-500">
                        CF #{d.extId}: {d.noMatch ? `No CRM match (${d.name || d.email || "?"})` : `Conflict with existing CF #${d.conflict} on CRM #${d.crmId}`}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {stats?.duplicateEmailDifferentExtId?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs">
              <p className="font-semibold text-amber-800">Identity Conflicts: Same email, different CF IDs</p>
              {stats.duplicateEmailDifferentExtId.map((d: any, i: number) => (
                <div key={i} className="text-amber-700">{d.email}: {d.ext_id_count} different CF IDs</div>
              ))}
            </div>
          )}

          <DuplicateExternalIdCleanup />
        </div>
      )}
    </div>
  );
}

function DuplicateExternalIdCleanup() {
  const [scanResult, setScanResult] = useState<any>(null);
  const [cleanupResult, setCleanupResult] = useState<any>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const scanMut = useMutation({
    mutationFn: () => apiFetch("/api/admin/import/duplicate-external-ids"),
    onSuccess: (data: any) => setScanResult(data),
    onError: (err: any) => toast({ title: "Scan failed", description: err?.message, variant: "destructive" }),
  });

  const cleanupMut = useMutation({
    mutationFn: (dryRun: boolean) =>
      apiFetch("/api/admin/import/cleanup-duplicate-external-ids", {
        method: "POST",
        body: JSON.stringify({ dryRun }),
      }),
    onSuccess: (data: any) => {
      setCleanupResult(data);
      if (!data.dryRun) {
        toast({ title: `Cleanup applied: ${data.merges} merged, ${data.conflicts} conflicts resolved` });
        queryClient.invalidateQueries({ queryKey: ["external-id-stats"] });
        scanMut.mutate();
      }
    },
    onError: (err: any) => toast({ title: "Cleanup failed", description: err?.message, variant: "destructive" }),
  });

  const indexMut = useMutation({
    mutationFn: () =>
      apiFetch("/api/admin/import/add-unique-external-id-index", { method: "POST" }),
    onSuccess: () => toast({ title: "Unique index created successfully" }),
    onError: (err: any) => toast({ title: "Index failed", description: err?.message, variant: "destructive" }),
  });

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-slate-700">Duplicate External ID Cleanup</p>
        <button onClick={() => scanMut.mutate()} disabled={scanMut.isPending}
          className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-600 text-white rounded text-[11px] font-semibold hover:bg-slate-700 disabled:opacity-50">
          {scanMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
          Scan for Duplicates
        </button>
      </div>

      {scanResult && (
        <div className="space-y-2">
          {scanResult.totalDuplicateGroups === 0 ? (
            <div className="flex items-center gap-2 text-emerald-700 text-xs font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" /> No duplicate external IDs found. Safe to add unique index.
            </div>
          ) : (
            <>
              <p className="text-xs text-amber-700 font-medium">
                {scanResult.totalDuplicateGroups} duplicate groups ({scanResult.totalAffectedRows} rows)
              </p>
              <div className="max-h-60 overflow-y-auto space-y-2">
                {scanResult.groups.map((g: any, i: number) => (
                  <div key={i} className={`rounded p-2 text-xs border ${g.isSamePerson ? "bg-white border-slate-200" : "bg-red-50 border-red-200"}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-slate-700">CF #{g.externalId}</span>
                      <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${g.isSamePerson ? "bg-blue-100 text-blue-700" : "bg-red-100 text-red-700"}`}>
                        {g.isSamePerson ? "Same Person — Auto Merge" : "Identity Conflict — Manual Review"}
                      </span>
                    </div>
                    {g.members.map((m: any) => (
                      <div key={m.id} className="flex items-center gap-2 text-slate-600 ml-2">
                        <span className={`font-mono text-[10px] ${m.id === g.keepId ? "text-emerald-600 font-bold" : "text-red-500"}`}>
                          #{m.id} {m.id === g.keepId ? "(KEEP)" : "(NULL)"}
                        </span>
                        <span>{m.first_name} {m.last_name}</span>
                        {m.email && <span className="text-slate-400">{m.email}</span>}
                        <span className="text-slate-400">{m.job_count}j {m.invoice_count}i {m.property_count}p</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
            {scanResult.totalDuplicateGroups > 0 && (
              <>
                <button onClick={() => cleanupMut.mutate(true)} disabled={cleanupMut.isPending}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-500 text-white rounded text-[11px] font-semibold hover:bg-amber-600 disabled:opacity-50">
                  {cleanupMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                  Dry Run
                </button>
                <button onClick={() => cleanupMut.mutate(false)} disabled={cleanupMut.isPending}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-red-600 text-white rounded text-[11px] font-semibold hover:bg-red-700 disabled:opacity-50">
                  {cleanupMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                  Apply Cleanup
                </button>
              </>
            )}
            {scanResult.totalDuplicateGroups === 0 && (
              <button onClick={() => indexMut.mutate()} disabled={indexMut.isPending}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-600 text-white rounded text-[11px] font-semibold hover:bg-emerald-700 disabled:opacity-50">
                {indexMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                Add Unique Index
              </button>
            )}
          </div>

          {cleanupResult && (
            <div className="bg-white rounded p-2 text-xs border border-slate-200">
              <p className="font-semibold text-slate-700">{cleanupResult.dryRun ? "DRY RUN" : "APPLIED"}: {cleanupResult.totalActions} actions</p>
              <div className="flex gap-3 text-slate-500">
                <span>{cleanupResult.merges} merges</span>
                <span>{cleanupResult.conflicts} conflicts</span>
              </div>
              <div className="mt-1 max-h-32 overflow-y-auto space-y-0.5">
                {cleanupResult.actions.map((a: any, i: number) => (
                  <div key={i} className={`text-[11px] ${a.type === "identity_conflict" ? "text-red-600" : "text-slate-600"}`}>
                    CF #{a.externalId}: {a.type === "merge_same_person"
                      ? `Keep #${a.keeperId} (${a.keeperName}, ${a.keeperLinked} linked) → Null #${a.loserId} (${a.loserLinked} linked, ${a.jobsMoved}j ${a.invoicesMoved}i moved)`
                      : `Conflict: #${a.keeperId} ${a.keeperName} vs #${a.loserId} ${a.loserName} — nulled #${a.loserId}`
                    }
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Batch list (Step 0) ──────────────────────────────────────────────────────

function BatchList({ onSelect, onCreate }: { onSelect: (b: any) => void; onCreate: () => void }) {
  const { data: batches = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["import-batches"],
    queryFn: () => apiFetch("/api/admin/import/batches"),
  });
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const { toast } = useToast();

  const deleteMut = useMutation({
    mutationFn: (batchId: number) =>
      apiFetch(`/api/admin/import/batches/${batchId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Batch deleted" });
      setConfirmDeleteId(null);
      refetch();
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err?.message ?? "Unknown error", variant: "destructive" });
      setConfirmDeleteId(null);
    },
  });

  const canDelete = (status: string) => !["applied", "applying", "rolling_back"].includes(status);

  if (isLoading) return (
    <div className="flex items-center gap-2 text-slate-400 py-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading batches…</div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Import Batches</h2>
          <p className="text-sm text-slate-500 mt-0.5">Start a new import or continue an existing one.</p>
        </div>
        <button
          onClick={onCreate}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> New Import Batch
        </button>
      </div>

      <BackfillExternalIds />

      {batches.length === 0 && (
        <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-2xl">
          <Database className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">No import batches yet</p>
          <p className="text-sm text-slate-400 mt-1">Click "New Import Batch" to get started.</p>
        </div>
      )}

      <div className="space-y-2">
        {batches.map((b: any) => {
          const isConfirming = confirmDeleteId === b.id;
          return (
            <div key={b.id} className="relative">
              {/* Confirmation overlay */}
              {isConfirming && (
                <div
                  className="absolute inset-0 z-10 flex items-center justify-between gap-3 px-4 bg-red-50 border-2 border-red-300 rounded-xl"
                  onClick={e => e.stopPropagation()}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                    <span className="text-sm font-semibold text-red-800 truncate">
                      Delete <span className="font-bold">"{b.name}"</span>? All staged data will be removed.
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-3 py-1.5 text-xs font-semibold border border-slate-300 text-slate-600 rounded-lg hover:bg-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => deleteMut.mutate(b.id)}
                      disabled={deleteMut.isPending}
                      className="px-3 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                    >
                      {deleteMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      Yes, Delete
                    </button>
                  </div>
                </div>
              )}

              {/* Batch card */}
              <div
                className={`flex items-center gap-4 p-4 bg-white border rounded-xl cursor-pointer transition-all group ${
                  isConfirming
                    ? "border-red-200 opacity-30 pointer-events-none"
                    : "border-slate-200 hover:border-primary/30 hover:shadow-sm"
                }`}
                onClick={() => !isConfirming && onSelect(b)}
              >
                <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0 group-hover:bg-primary/5">
                  <Database className="w-5 h-5 text-slate-400 group-hover:text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-800 text-sm truncate">{b.name}</span>
                    <BatchBadge status={b.status} />
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {new Date(b.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    {" · "}
                    {b.file_count ?? 0} file{b.file_count !== 1 ? "s" : ""}
                    {" · "}
                    {b.staged_rows ?? 0} rows staged
                    {(b.review_count ?? 0) > 0 && ` · ${b.review_count} need review`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canDelete(b.status) && (
                    <button
                      onClick={e => { e.stopPropagation(); setConfirmDeleteId(b.id); }}
                      className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete this batch"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-primary" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Create batch form ────────────────────────────────────────────────────────

function CreateBatch({ onCreated, onBack }: { onCreated: (b: any) => void; onBack: () => void }) {
  const [name, setName] = useState(`CF Import ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`);
  const createMut = useMutation({
    mutationFn: () => apiFetch("/api/admin/import/batches", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: (batch) => onCreated(batch),
  });

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h2 className="text-lg font-bold text-slate-800">New Import Batch</h2>
        <p className="text-sm text-slate-500 mt-0.5">Give this batch a name so you can identify it later (e.g., "Weekly Import 4/12/26").</p>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700">Batch Name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          placeholder="e.g. Weekly Import 4/12/26"
        />
      </div>
      <div className="flex gap-3">
        <button onClick={onBack} className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">
          Back
        </button>
        <button
          onClick={() => createMut.mutate()}
          disabled={!name.trim() || createMut.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {createMut.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : "Create Batch"}
        </button>
      </div>
      {createMut.isError && (
        <p className="text-sm text-red-600">{(createMut.error as Error).message}</p>
      )}
    </div>
  );
}

// ─── File upload step ─────────────────────────────────────────────────────────

function UploadStep({ batch, onRefresh }: { batch: any; onRefresh: () => void }) {
  const [queued, setQueued] = useState<QueuedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadLog, setUploadLog] = useState<{ type: "success" | "error" | "pending"; text: string }[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [lastFingerprint, setLastFingerprint] = useState("");
  const dropRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const csvHeaders = useMemo(() => {
    const headers = new Set<string>();
    for (const q of queued) {
      if (q.rows && q.rows.length > 0) {
        Object.keys(q.rows[0]).forEach(h => headers.add(h));
      }
    }
    return Array.from(headers);
  }, [queued]);

  useEffect(() => {
    if (csvHeaders.length === 0) {
      setLastFingerprint("");
      return;
    }
    const fingerprint = getMappingFingerprint(csvHeaders);
    if (fingerprint === lastFingerprint) return;
    setLastFingerprint(fingerprint);

    const saved = localStorage.getItem(`cf-import-mapping-${fingerprint}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (typeof parsed === "object" && parsed !== null) {
          const headerSet = new Set(csvHeaders);
          const validated: Record<string, string> = {};
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string" && headerSet.has(v)) validated[k] = v;
          }
          if (Object.keys(validated).length > 0) {
            setColumnMapping(validated);
            return;
          }
        }
      } catch { /* ignore */ }
    }
    setColumnMapping(autoDetectMapping(csvHeaders));
  }, [csvHeaders, lastFingerprint]);

  const handleMappingChange = useCallback((newMapping: Record<string, string>) => {
    setColumnMapping(newMapping);
    if (csvHeaders.length > 0) {
      const fingerprint = getMappingFingerprint(csvHeaders);
      localStorage.setItem(`cf-import-mapping-${fingerprint}`, JSON.stringify(newMapping));
    }
  }, [csvHeaders]);

  const hasCustomerFiles = useMemo(() =>
    queued.some(q => q.rows && q.rows.length > 0 && q.fileGroup !== "unknown" && q.fileGroup !== "invoices"),
    [queued]
  );

  const identityValidation = useMemo(
    () => hasCustomerFiles ? validateIdentityMapping(columnMapping) : { valid: true, message: "" },
    [columnMapping, hasCustomerFiles]
  );

  const sampleRow = useMemo(() => {
    for (const q of queued) {
      if (q.rows && q.rows.length > 0) return q.rows[0];
    }
    return null;
  }, [queued]);

  const parseFile = useCallback(async (file: File): Promise<QueuedFile> => {
    const id = `${file.name}-${Date.now()}`;
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const text = ev.target?.result as string;

          // Guard: if the browser returned HTML instead of file content, reject immediately
          const trimmed = text.trimStart();
          if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) {
            resolve({
              id, file, fileGroup: "unknown", rows: null, parsing: false, rowCount: 0,
              error: "File was read as HTML — not valid CSV. Please select the file from your filesystem, not a browser tab.",
            });
            return;
          }

          const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
          let rows: Record<string, string>[];
          let detectedGroup: FileGroup;

          if (ext === "sql") {
            rows = parseSQLCustomers(text);
            detectedGroup = "sql_backup";
          } else if (ext === "tsv" || ext === "xls" || ext === "xlsx") {
            rows = parseDelimited(text, "\t");
            detectedGroup = detectFileGroup(file.name, rows[0] ? Object.keys(rows[0]) : []);
          } else {
            rows = parseDelimited(text, ",");
            detectedGroup = detectFileGroup(file.name, rows[0] ? Object.keys(rows[0]) : []);
          }

          resolve({ id, file, fileGroup: detectedGroup, rows, parsing: false, error: null, rowCount: rows.length });
        } catch (err) {
          resolve({ id, file, fileGroup: "unknown", rows: null, parsing: false, error: String(err), rowCount: 0 });
        }
      };
      reader.readAsText(file);
    });
  }, []);

  const MAX_FILE_MB = 40;
  const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);

    // Pre-screen file sizes before parsing
    const oversized = fileArray.filter(f => f.size > MAX_FILE_BYTES);
    const acceptable = fileArray.filter(f => f.size <= MAX_FILE_BYTES);

    const oversizedEntries: QueuedFile[] = oversized.map(f => ({
      id: `${f.name}-${Date.now()}-${Math.random()}`,
      file: f, fileGroup: "unknown" as FileGroup,
      rows: null, parsing: false,
      error: `File is ${(f.size / 1024 / 1024).toFixed(1)} MB — exceeds the ${MAX_FILE_MB} MB limit. Split the export into smaller batches.`,
      rowCount: 0,
    }));

    const pending: QueuedFile[] = acceptable.map(f => ({
      id: `${f.name}-${Date.now()}-${Math.random()}`,
      file: f, fileGroup: "unknown" as FileGroup,
      rows: null, parsing: true, error: null, rowCount: 0,
    }));

    setQueued(prev => [...prev, ...oversizedEntries, ...pending]);

    for (let i = 0; i < acceptable.length; i++) {
      const parsed = await parseFile(acceptable[i]);
      setQueued(prev => prev.map(q => q.id === pending[i].id ? parsed : q));
    }
  }, [parseFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleGroupChange = (id: string, group: FileGroup) => {
    setQueued(prev => prev.map(q => q.id === id ? { ...q, fileGroup: group } : q));
  };

  const removeQueued = (id: string) => setQueued(prev => prev.filter(q => q.id !== id));

  const [uploadDone, setUploadDone] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  const uploadAll = async () => {
    if (!identityValidation.valid) {
      toast({ title: "Mapping incomplete", description: identityValidation.message, variant: "destructive" });
      return;
    }
    const ready = queued.filter(q => q.rows && q.rows.length > 0 && q.fileGroup !== "unknown");
    if (ready.length === 0) {
      toast({ title: "Nothing to upload", description: "Add files and make sure all are classified.", variant: "destructive" });
      return;
    }
    setUploading(true);
    setUploadLog([]);
    setUploadDone(false);

    const hasMapping = Object.values(columnMapping).some(Boolean);

    for (const q of ready) {
      const ext = q.file.name.split(".").pop()?.toLowerCase() ?? "csv";
      const fileType = ext === "sql" ? "sql" : (ext === "tsv" || ext === "xls" || ext === "xlsx") ? "tsv" : "csv";
      const mappedRows = hasMapping ? applyColumnMapping(q.rows!, columnMapping) : q.rows;
      try {
        const result = await apiFetch(`/api/admin/import/batches/${batch.id}/files`, {
          method: "POST",
          body: JSON.stringify({
            fileName: q.file.name,
            fileType,
            fileGroup: q.fileGroup,
            rows: mappedRows,
          }),
        });
        setUploadLog(prev => [...prev, { type: "success", text: `${q.file.name}: ${result.message}` }]);
      } catch (err) {
        setUploadLog(prev => [...prev, { type: "error", text: `${q.file.name}: ${(err as Error).message.slice(0, 80)}` }]);
      }
    }

    setUploading(false);
    setUploadDone(true);
    setQueued([]);
    qc.invalidateQueries({ queryKey: ["import-batch", batch.id] });
    qc.invalidateQueries({ queryKey: ["import-batches"] });
    onRefresh();
    // Scroll to top of the upload step so the success banner and progress are visible
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const unknownCount = queued.filter(q => q.fileGroup === "unknown").length;
  const readyCount = queued.filter(q => q.rows && q.rows.length > 0 && q.fileGroup !== "unknown").length;

  return (
    <div ref={topRef} className="space-y-5 scroll-mt-4">
      {/* Success banner — shown after upload completes */}
      {uploadDone && uploadLog.length > 0 && (
        <div className="flex items-start gap-3 px-4 py-3.5 bg-emerald-50 border border-emerald-200 rounded-xl">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-emerald-800">Upload started successfully</p>
            <p className="text-xs text-emerald-700 mt-0.5">
              Your files are now processing in the background. Check the status cards at the top of this page for progress.
            </p>
            <p className="text-xs text-emerald-600 mt-1 font-medium">
              You can leave this page and come back — processing continues automatically.
            </p>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-lg font-bold text-slate-800">Upload Files</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Drag and drop your Customer Factor export files. Each file is auto-classified by filename.
          You can change the classification before staging.
        </p>
      </div>

      {/* File type guide */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
        {Object.entries(FILE_GROUP_LABELS).filter(([k]) => k !== "unknown").map(([k, label]) => (
          <div key={k} className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium ${FILE_GROUP_COLORS[k as FileGroup]}`}>
            {label}
          </div>
        ))}
      </div>

      {/* Drop zone */}
      <div
        ref={dropRef}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all
          ${dragging ? "border-primary bg-primary/5" : "border-slate-200 hover:border-primary/40 hover:bg-slate-50"}`}
      >
        <Upload className="w-8 h-8 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-600 font-medium text-sm">Drop files here or click to browse</p>
        <p className="text-xs text-slate-400 mt-1">CSV, TSV, XLS, SQL — multiple files at once · max {MAX_FILE_MB} MB per file</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".csv,.tsv,.xls,.xlsx,.sql,.txt"
          className="hidden"
          onChange={e => { if (e.target.files) addFiles(e.target.files); }}
        />
      </div>

      {/* Queued files */}
      {queued.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">{queued.length} file{queued.length !== 1 ? "s" : ""} queued</p>
            {unknownCount > 0 && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {unknownCount} file{unknownCount !== 1 ? "s" : ""} need classification
              </p>
            )}
          </div>
          {queued.map(q => (
            <div key={q.id} className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-xl">
              <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center shrink-0">
                {q.parsing
                  ? <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                  : q.error
                    ? <AlertTriangle className="w-4 h-4 text-red-400" />
                    : <FileSpreadsheet className="w-4 h-4 text-slate-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{q.file.name}</p>
                <p className="text-xs text-slate-400">
                  {q.parsing ? "Parsing…" : q.error ? q.error : `${q.rowCount} rows`}
                </p>
              </div>
              <select
                value={q.fileGroup}
                onChange={e => handleGroupChange(q.id, e.target.value as FileGroup)}
                disabled={q.parsing}
                className={`text-xs font-semibold px-2 py-1 rounded-lg border ${FILE_GROUP_COLORS[q.fileGroup]} focus:outline-none focus:ring-1 focus:ring-primary`}
              >
                {(Object.entries(FILE_GROUP_LABELS) as [FileGroup, string][]).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <button onClick={() => removeQueued(q.id)} className="p-1 text-slate-400 hover:text-red-500 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {csvHeaders.length > 0 && (
        <ColumnMappingPanel
          csvHeaders={csvHeaders}
          mapping={columnMapping}
          onMappingChange={handleMappingChange}
          sampleRow={sampleRow}
        />
      )}

      {/* Upload log */}
      {uploadLog.length > 0 && (
        <div className="bg-slate-900 rounded-xl p-4 space-y-1.5 font-mono text-xs">
          {uploadLog.map((entry, i) => (
            <div key={i} className="flex items-start gap-2">
              {entry.type === "error"
                ? <XCircle  className="w-3.5 h-3.5 text-red-400    shrink-0 mt-px" />
                : <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-px" />}
              <p className={entry.type === "error" ? "text-red-400" : "text-amber-300"}>
                {entry.text}
              </p>
            </div>
          ))}
          {uploading && (
            <div className="flex items-center gap-2 text-slate-400 pt-0.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>Sending files…</span>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button
          onClick={uploadAll}
          disabled={uploading || readyCount === 0 || (csvHeaders.length > 0 && !identityValidation.valid)}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          {uploading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending to server…</>
            : <><Upload className="w-4 h-4" /> Start Processing {readyCount > 0 ? `(${readyCount} File${readyCount !== 1 ? "s" : ""})` : ""}</>}
        </button>
        {csvHeaders.length > 0 && !identityValidation.valid && (
          <p className="self-center text-xs text-red-600 font-medium">
            Map identity fields before processing
          </p>
        )}
        {unknownCount > 0 && (
          <p className="self-center text-xs text-amber-600">
            {unknownCount} file{unknownCount !== 1 ? "s" : ""} won't be uploaded (unknown type)
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Intent-based action button primitives ────────────────────────────────────

type ActionBtnVariant = "recommended" | "create" | "ghost" | "danger" | "amber" | "sky" | "teal";

function ActionBtn({
  children, onClick, disabled, title, variant = "ghost",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  variant?: ActionBtnVariant;
}) {
  const base = "px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const styles: Record<ActionBtnVariant, string> = {
    recommended: "bg-primary text-white hover:bg-primary/90 shadow-sm ring-2 ring-primary/20",
    create:      "bg-emerald-600 text-white hover:bg-emerald-700",
    ghost:       "bg-white border border-slate-300 text-slate-700 hover:bg-slate-100",
    danger:      "bg-white border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600",
    amber:       "bg-white border border-amber-300 text-amber-700 hover:bg-amber-50",
    sky:         "bg-white border border-sky-300 text-sky-700 hover:bg-sky-50",
    teal:        "bg-teal-600 text-white hover:bg-teal-700",
  };
  return (
    <button onClick={onClick} disabled={disabled} title={title} className={`${base} ${styles[variant]}`}>
      {children}
    </button>
  );
}

// Per-issue-type intent-based action buttons
function ConflictActionButtons({ item, proposed, actionMut }: { item: any; proposed: any; actionMut: any }) {
  const fire = (action: string, extra: Record<string, unknown> = {}) => actionMut.mutate({ itemId: item.id, action, ...extra });
  const busy = actionMut.isPending;

  if (item.action !== "pending") {
    return (
      <button
        onClick={() => fire("pending")}
        disabled={busy}
        className="px-2.5 py-1 text-[11px] font-medium text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
      >
        Undo
      </button>
    );
  }

  if (item.issue_type === "new_property_detected") {
    return (
      <>
        <ActionBtn variant="teal" onClick={() => fire("accept_import")} disabled={busy}
          title="Add this as a new service location — customer's billing address is not changed">
          Add as New Property
        </ActionBtn>
        <ActionBtn variant="sky" onClick={() => fire("replace_billing")} disabled={busy}
          title="Update the customer's billing address to this address (use only if the import has the correct current address)">
          Replace Existing Address
        </ActionBtn>
        <ActionBtn variant="danger" onClick={() => fire("ignore")} disabled={busy}
          title="Ignore this address — do not add a property or change the billing address">
          Keep Existing
        </ActionBtn>
      </>
    );
  }

  if (item.issue_type === "contact_duplicate") {
    const candidates = Array.isArray(proposed?._duplicateCandidates) ? proposed._duplicateCandidates : [];
    const eligible = candidates.filter((candidate: any) => candidate.canLink && !["inactive", "archived"].includes(candidate.lifecycleStatus));
    return (
      <>
        {eligible.map((candidate: any) => (
          <ActionBtn
            key={candidate.id}
            variant="recommended"
            onClick={() => fire("link_existing", { selectedCustomerId: candidate.id })}
            disabled={busy}
            title="Link only the source identity to this existing account; do not overwrite account or contact fields"
          >
            Link to {candidate.firstName} {candidate.lastName}
          </ActionBtn>
        ))}
        <ActionBtn
          variant="create"
          onClick={() => {
            const reason = window.prompt("Why is this intentionally a separate account?");
            if (reason?.trim()) fire("create_separate", { reason: reason.trim() });
          }}
          disabled={busy}
          title="Create a separate account after recording a reason"
        >
          Create Separate
        </ActionBtn>
        <ActionBtn variant="danger" onClick={() => fire("ignore")} disabled={busy} title="Skip this import row">
          Skip
        </ActionBtn>
      </>
    );
  }

  if (item.issue_type === "new_owner_at_property") {
    return (
      <>
        <ActionBtn variant="recommended" onClick={() => fire("accept_import")} disabled={busy}
          title="Create a new customer account for this person and link them as the current owner of the property. Prior owner history is preserved.">
          ✦ Create New Account + Link Property
        </ActionBtn>
        <ActionBtn variant="ghost" onClick={() => fire("keep_existing")} disabled={busy}
          title="Keep the existing owner — discard this import record entirely">
          Keep Prior Owner (Skip)
        </ActionBtn>
        <ActionBtn variant="danger" onClick={() => fire("ignore")} disabled={busy}
          title="Skip this record entirely">
          Skip
        </ActionBtn>
      </>
    );
  }

  if (item.issue_type === "household_match") {
    return (
      <>
        <ActionBtn variant="recommended" onClick={() => fire("merge")} disabled={busy}
          title="Merge into existing account — fill blank CRM fields, append notes. Existing name and billing address are preserved. Different address will appear as a separate New Property item.">
          ✦ Merge into Existing Account
        </ActionBtn>
        <ActionBtn variant="ghost" onClick={() => fire("keep_existing")} disabled={busy}
          title="Keep existing CRM account unchanged — import data for this record is ignored">
          Keep Existing Only
        </ActionBtn>
        <ActionBtn variant="amber" onClick={() => fire("accept_import")} disabled={busy}
          title="Update account with import data — imported name and fields will replace CRM values where import is non-empty">
          Replace with Import
        </ActionBtn>
        <ActionBtn variant="danger" onClick={() => fire("ignore")} disabled={busy}
          title="Skip this record entirely — no changes made">
          Skip
        </ActionBtn>
      </>
    );
  }

  if (item.issue_type === "field_conflict") {
    return (
      <>
        <ActionBtn variant="recommended" onClick={() => fire("merge")} disabled={busy}
          title="Fill blank CRM fields with import values · Append notes · Preserve all existing data">
          ✦ Merge
        </ActionBtn>
        <ActionBtn variant="ghost" onClick={() => fire("keep_existing")} disabled={busy}
          title="Keep all existing CRM data exactly as is — import data is ignored">
          Keep Existing
        </ActionBtn>
        <ActionBtn variant="amber" onClick={() => fire("accept_import")} disabled={busy}
          title="Overwrite CRM fields with import values (non-destructive COALESCE — import fills where CRM is blank, otherwise CRM wins)">
          Replace All
        </ActionBtn>
        <ActionBtn variant="danger" onClick={() => fire("ignore")} disabled={busy}
          title="Skip this record — no changes made">
          Skip
        </ActionBtn>
      </>
    );
  }

  if (item.issue_type === "new_record") {
    return (
      <>
        <ActionBtn variant="create" onClick={() => fire("accept_import")} disabled={busy}
          title="Create a new customer record in the CRM — no reliable existing match was found">
          Create New Customer
        </ActionBtn>
        <ActionBtn variant="danger" onClick={() => fire("ignore")} disabled={busy}
          title="Skip — do not create this record">
          Skip
        </ActionBtn>
      </>
    );
  }

  if (item.issue_type === "duplicate_job") {
    return (
      <>
        <ActionBtn variant="ghost" onClick={() => fire("keep_existing")} disabled={busy}
          title="Leave this job marked as a hidden suspected duplicate — no change">
          Keep Hidden
        </ActionBtn>
        <ActionBtn variant="amber" onClick={() => fire("accept_import")} disabled={busy}
          title="Make this job visible in the CRM">
          Restore Job
        </ActionBtn>
        <ActionBtn variant="danger" onClick={() => fire("ignore")} disabled={busy}
          title="Skip entirely — staging row is ignored">
          Skip
        </ActionBtn>
      </>
    );
  }

  if (item.issue_type === "exact_match") {
    return (
      <>
        <ActionBtn variant="recommended" onClick={() => fire("merge")} disabled={busy}
          title="Exact email/phone match confirmed — merge import data into existing CRM record (fill blank fields only, CRM data preserved)">
          ✦ Approve Merge
        </ActionBtn>
        <ActionBtn variant="create" onClick={() => fire("accept_import")} disabled={busy}
          title="Create as a separate customer instead of merging">
          Create as New Customer
        </ActionBtn>
        <ActionBtn variant="danger" onClick={() => fire("ignore")} disabled={busy}
          title="Skip this record entirely — no changes made">
          Skip
        </ActionBtn>
      </>
    );
  }

  if (item.issue_type === "weak_match") {
    return (
      <>
        <ActionBtn variant="recommended" onClick={() => fire("merge")} disabled={busy}
          title="This IS the same person — merge import data into existing CRM record (fill blank fields only, CRM data preserved)">
          ✦ Yes, Same Person — Merge
        </ActionBtn>
        <ActionBtn variant="create" onClick={() => fire("accept_import")} disabled={busy}
          title="This is a DIFFERENT person — create a brand new customer record in the CRM">
          Different Person — Create New
        </ActionBtn>
        <ActionBtn variant="danger" onClick={() => fire("ignore")} disabled={busy}
          title="Skip this record entirely — no changes made">
          Skip
        </ActionBtn>
      </>
    );
  }

  if (item.issue_type === "name_mismatch") {
    return (
      <>
        <ActionBtn variant="recommended" onClick={() => fire("merge")} disabled={busy}
          title="Same person despite name difference (e.g. nickname, maiden name) — merge into existing account (fill blank fields only)">
          ✦ Same Person — Merge
        </ActionBtn>
        <ActionBtn variant="create" onClick={() => fire("accept_import")} disabled={busy}
          title="Different person sharing the same email/phone — create a separate customer record">
          Different Person — Create New
        </ActionBtn>
        <ActionBtn variant="danger" onClick={() => fire("ignore")} disabled={busy}
          title="Skip this record entirely — no changes made">
          Skip
        </ActionBtn>
      </>
    );
  }

  if (item.issue_type === "identity_conflict") {
    return (
      <>
        <ActionBtn variant="create" onClick={() => fire("accept_import")} disabled={busy}
          title="These are separate customers sharing contact info — create a new customer record">
          Create as Separate Customer
        </ActionBtn>
        <ActionBtn variant="danger" onClick={() => fire("ignore")} disabled={busy}
          title="Skip this record entirely — no changes made">
          Skip
        </ActionBtn>
      </>
    );
  }

  if (item.issue_type === "missing_identity") {
    return (
      <>
        <ActionBtn variant="create" onClick={() => fire("accept_import")} disabled={busy}
          title="Create this customer anyway despite missing name/identity fields">
          Create Anyway
        </ActionBtn>
        <ActionBtn variant="danger" onClick={() => fire("ignore")} disabled={busy}
          title="Skip — do not create a record without proper identity fields">
          Skip
        </ActionBtn>
      </>
    );
  }

  return (
    <>
      <ActionBtn variant="ghost" onClick={() => fire("keep_existing")} disabled={busy}
        title="Keep existing CRM data — ignore import">
        Keep Existing
      </ActionBtn>
      <ActionBtn variant="create" onClick={() => fire("accept_import")} disabled={busy}
        title="Apply import data">
        Accept Import
      </ActionBtn>
      <ActionBtn variant="danger" onClick={() => fire("ignore")} disabled={busy}
        title="Skip this row">
        Skip
      </ActionBtn>
    </>
  );
}

// ─── Merge preview panel ───────────────────────────────────────────────────────

const PROP_TO_COL: Record<string, string> = {
  firstName: "first_name", lastName: "last_name", email: "email",
  homePhone: "home_phone", workPhone: "work_phone", cellPhone: "cell_phone",
  billingAddress: "billing_address", billingCity: "billing_city",
  billingState: "billing_state", billingZip: "billing_zip",
  notes: "notes", howHeard: "how_heard", windowCount: "window_count",
  windowType: "window_type", houseSize: "house_size", laddersNeeded: "ladders_needed",
  customerDate: "customer_date", sendingPreferences: "sending_preferences",
  starRating: "star_rating", companyName: "company_name", salutation: "salutation",
  clientType: "client_type",
};

const FRIENDLY_LABEL: Record<string, string> = {
  firstName: "First name", lastName: "Last name", email: "Email",
  homePhone: "Home phone", workPhone: "Work phone", cellPhone: "Cell phone",
  billingAddress: "Address", billingCity: "City", billingState: "State", billingZip: "ZIP",
  notes: "Notes", howHeard: "How heard", windowCount: "Window count", windowType: "Window type",
  houseSize: "House size", laddersNeeded: "Ladders", customerDate: "Customer since",
  sendingPreferences: "Send prefs", starRating: "Rating", companyName: "Company",
  salutation: "Salutation", clientType: "Client type",
};

function MergePreview({ current, proposed, conflicts }: { current: any; proposed: any; conflicts: string[] }) {
  if (!current || !proposed) return null;

  type Row = { key: string; label: string; importVal: string; crmVal: string; state: "fill" | "conflict" | "skip" | "append" };
  const rows: Row[] = [];

  for (const [propKey, propVal] of Object.entries(proposed)) {
    if (!propVal || propKey.startsWith("_")) continue;
    const strVal = String(propVal).trim();
    if (!strVal) continue;

    const crmCol = PROP_TO_COL[propKey] ?? propKey;
    const crmVal = String(current[crmCol] ?? current[propKey] ?? "").trim();
    const label = FRIENDLY_LABEL[propKey] ?? crmCol.replace(/_/g, " ");

    let state: Row["state"];
    if (propKey === "notes" && crmVal) {
      state = "append";
    } else if (!crmVal) {
      state = "fill";
    } else if (conflicts.includes(propKey) || conflicts.includes(crmCol)) {
      state = "conflict";
    } else {
      state = "skip";
    }
    rows.push({ key: propKey, label, importVal: strVal, crmVal, state });
  }

  const filling   = rows.filter(r => r.state === "fill");
  const appending = rows.filter(r => r.state === "append");
  const conflicts_ = rows.filter(r => r.state === "conflict");
  const skipping  = rows.filter(r => r.state === "skip");

  if (rows.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
      <p className="text-xs font-semibold text-slate-600">What Merge will do:</p>

      {filling.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
          <p className="text-[11px] font-semibold text-emerald-700 mb-2 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Will fill in ({filling.length} blank field{filling.length !== 1 ? "s" : ""})
          </p>
          <div className="space-y-0.5">
            {filling.map(r => (
              <div key={r.key} className="flex items-baseline gap-2 text-[11px]">
                <span className="text-emerald-700 w-28 shrink-0 font-medium capitalize">{r.label}</span>
                <span className="text-emerald-900 font-mono truncate max-w-xs">{r.importVal.slice(0, 60)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {appending.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
          <p className="text-[11px] font-semibold text-blue-700 mb-1 flex items-center gap-1.5">
            <Plus className="w-3 h-3" />
            Notes will be appended (not replaced)
          </p>
          {appending.map(r => (
            <p key={r.key} className="text-[11px] text-blue-800 font-mono mt-1 line-clamp-2">{r.importVal.slice(0, 120)}</p>
          ))}
        </div>
      )}

      {conflicts_.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
          <p className="text-[11px] font-semibold text-amber-700 mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            CRM data will be preserved — import values discarded ({conflicts_.length} field{conflicts_.length !== 1 ? "s" : ""})
          </p>
          <div className="space-y-1">
            {conflicts_.map(r => (
              <div key={r.key} className="text-[11px]">
                <span className="text-amber-700 w-28 inline-block font-medium capitalize">{r.label}</span>
                <span className="text-slate-600 font-mono">CRM: {r.crmVal.slice(0, 35)}</span>
                <span className="text-slate-400 mx-2">·</span>
                <span className="text-amber-600 font-mono line-through opacity-60">Import: {r.importVal.slice(0, 35)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {skipping.length > 0 && (
        <p className="text-[11px] text-slate-400">
          {skipping.length} field{skipping.length !== 1 ? "s" : ""} already have CRM values and will not be changed ({skipping.map(r => r.label).join(", ")}).
        </p>
      )}
    </div>
  );
}

// ─── Staging summary ──────────────────────────────────────────────────────────

function StagingSummary({ batchDetail }: { batchDetail: any }) {
  const counts = batchDetail?.stagingCounts ?? {};

  // File progress metrics
  const files: any[] = batchDetail?.files ?? [];
  const totalFiles      = files.length;
  const completedFiles  = files.filter((f: any) => f.status === "parsed" || f.status === "error").length;
  const processingFiles = files.filter((f: any) => f.status === "queued" || f.status === "processing").length;
  const progressPct     = totalFiles > 0 ? Math.round((completedFiles / totalFiles) * 100) : 0;
  const allDone         = totalFiles > 0 && completedFiles === totalFiles;

  const allFilesRawRows = files.reduce((s: number, f: any) => s + (Number(f.raw_row_count) || 0), 0);

  // Row-level accounting — use server-provided customer-only scoped numbers
  const ra = batchDetail?.rowAccounting ?? {};
  const totalRawRows         = ra.customerRawRows        ?? 0;
  const customerAutoApproved = ra.customerAutoApproved    ?? 0;
  const customerNeedsReview  = ra.customerNeedsReview     ?? 0;
  const customerErrors       = ra.customerErrors          ?? 0;
  const totalSkipped         = ra.customerSkippedDupes    ?? 0;
  const accountingSum        = ra.accountingSum            ?? 0;
  const accountingMatch      = ra.match                   ?? false;

  const jobStaged      = ra.jobStaged      ?? 0;
  const propertyStaged = ra.propertyStaged ?? 0;

  const autoCreatedCustomer  = Number(counts.auto_created_customer  ?? 0);

  const subParts: string[] = [];
  if (autoCreatedCustomer > 0) subParts.push(`${autoCreatedCustomer} new customers`);

  const extraParts: string[] = [];
  if (jobStaged > 0)      extraParts.push(`${jobStaged} jobs`);
  if (propertyStaged > 0) extraParts.push(`${propertyStaged} properties`);

  const stats = [
    { label: "Total Read",       value: totalRawRows,         color: "text-blue-600",    bg: "bg-blue-50"    },
    { label: "Auto-Approved",    value: customerAutoApproved, color: "text-emerald-600", bg: "bg-emerald-50",
      sub: subParts.length > 0 ? subParts.join(", ") : undefined },
    { label: "Needs Review",     value: customerNeedsReview,  color: "text-amber-600",   bg: "bg-amber-50"   },
    { label: "Errors",           value: customerErrors,       color: "text-red-600",     bg: "bg-red-50"     },
    { label: "Skipped (Dupes)",  value: totalSkipped,         color: "text-slate-400",   bg: "bg-slate-50"   },
  ];

  return (
    <div className="space-y-3">
      {/* File progress bar — only shown while there are files in the batch */}
      {totalFiles > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-semibold text-slate-700">{totalFiles} file{totalFiles !== 1 ? "s" : ""} uploaded</span>
              <span className="text-slate-300">·</span>
              <span className={completedFiles === totalFiles ? "text-emerald-600 font-medium" : ""}>
                {completedFiles} completed
              </span>
              {processingFiles > 0 && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="text-amber-600 font-medium flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {processingFiles} processing
                  </span>
                </>
              )}
              {allFilesRawRows > 0 && (
                <>
                  <span className="text-slate-300">·</span>
                  <span>{allFilesRawRows.toLocaleString()} rows queued</span>
                </>
              )}
            </div>
            <span className="font-semibold text-slate-600">{progressPct}%</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${allDone ? "bg-emerald-500" : "bg-primary"}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {allDone && (
            <p className="text-xs text-emerald-600 font-medium flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              All files processed — review your results below
            </p>
          )}
        </div>
      )}

      {/* Staging stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map(s => (
          <div key={s.label} className={`${s.bg} rounded-xl p-3.5`}>
            <p className={`text-xl font-bold ${s.color}`}>{s.value.toLocaleString()}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
            {(s as any).sub && (
              <p className="text-[10px] text-slate-400 mt-0.5">{(s as any).sub}</p>
            )}
          </div>
        ))}
      </div>

      {totalRawRows > 0 && (
        <div className="space-y-1">
          <div className={`text-[11px] px-3 py-1.5 rounded-lg flex items-center gap-2 ${accountingMatch ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            <span className="font-semibold">Row Accounting:</span>
            <span>
              {customerAutoApproved.toLocaleString()} approved + {customerNeedsReview.toLocaleString()} review + {customerErrors.toLocaleString()} errors + {totalSkipped.toLocaleString()} dupes = {accountingSum.toLocaleString()}
              {accountingMatch ? " = " : " vs "}
              {totalRawRows.toLocaleString()} read
            </span>
            <span className="font-bold">{accountingMatch ? "OK" : "MISMATCH"}</span>
          </div>
          {extraParts.length > 0 && (
            <p className="text-[10px] text-slate-400 px-3">
              Also staged: {extraParts.join(", ")} (extras from matched customers, not counted in row accounting)
            </p>
          )}
          {totalSkipped > 0 && (
            <p className="text-[10px] text-slate-400 px-3">
              {totalSkipped.toLocaleString()} repeated job-history rows collapsed (Customer Factor exports one row per job per customer)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Review queue step ────────────────────────────────────────────────────────

// ─── Label maps (shared between ReviewStep and bulk UI) ───────────────────────

const ISSUE_LABELS: Record<string, string> = {
  exact_match:             "Exact Match (Needs Approval)",
  new_record:              "New Record",
  field_conflict:          "Field Conflict",
  household_match:         "Household / Account Match",
  property_conflict:       "Property Conflict",
  new_property_detected:   "New Property",
  new_owner_at_property:   "New Owner at Property",
  duplicate_job:           "Duplicate Job",
  ambiguous_match:         "Ambiguous Match",
  phone_overflow:          "Phone Overflow",
  status_downgrade:        "Status Downgrade",
  name_mismatch:           "Name Mismatch",
  weak_match:              "Weak Match (No Email/Phone)",
  identity_conflict:       "Identity Conflict",
  missing_identity:        "Missing Identity Fields",
};
const ISSUE_COLORS: Record<string, string> = {
  exact_match:             "bg-emerald-100 text-emerald-700",
  new_record:              "bg-blue-100 text-blue-700",
  field_conflict:          "bg-amber-100 text-amber-700",
  household_match:         "bg-violet-100 text-violet-700",
  property_conflict:       "bg-purple-100 text-purple-700",
  new_property_detected:   "bg-teal-100 text-teal-700",
  new_owner_at_property:   "bg-orange-100 text-orange-700",
  duplicate_job:           "bg-orange-100 text-orange-700",
  ambiguous_match:         "bg-rose-100 text-rose-700",
  status_downgrade:        "bg-red-100 text-red-700",
  name_mismatch:           "bg-rose-100 text-rose-700",
  weak_match:              "bg-yellow-100 text-yellow-700",
  identity_conflict:       "bg-red-100 text-red-700",
  missing_identity:        "bg-red-100 text-red-700",
};
const ACTION_FRIENDLY: Record<string, string> = {
  pending:         "Pending",
  merge:           "Merge",
  accept_import:   "Create / Replace",
  keep_existing:   "Keep Existing",
  replace_billing: "Replace Address",
  ignore:          "Skip",
};
const ENTITY_FRIENDLY: Record<string, string> = {
  customer: "Customers", lead: "Leads", job: "Jobs", invoice: "Invoices", property: "Properties",
};

// ─── Review group definitions (grouped view) ───────────────────────────────────

type ConfidenceLevel = "High" | "Medium" | "Low";
type ReviewGroupDef = {
  id: string;
  issueTypes: string[];
  label: string;
  description: string;
  confidence: ConfidenceLevel;
  confidenceColors: string;
  headerBg: string;
  defaultAction?: string;
  bulkLabel?: string;
  bulkColors?: string;
};

const CONFIDENCE_COLORS: Record<ConfidenceLevel, string> = {
  High:   "bg-emerald-100 text-emerald-700 border-emerald-200",
  Medium: "bg-amber-100 text-amber-700 border-amber-200",
  Low:    "bg-red-100 text-red-700 border-red-200",
};

const REVIEW_GROUPS: ReviewGroupDef[] = [
  {
    id: "exact_match",
    issueTypes: ["exact_match"],
    label: "Exact Matches (Email/Phone Confirmed)",
    description: "Exact email or phone match found AND names match. These are safe to merge — CRM data is preserved, import only fills blank fields. You must approve each merge.",
    confidence: "High",
    confidenceColors: CONFIDENCE_COLORS.High,
    headerBg: "bg-emerald-50 border-emerald-200",
    defaultAction: "merge",
    bulkLabel: "✦ Approve All Merges",
    bulkColors: "bg-emerald-600 text-white hover:bg-emerald-700",
  },
  {
    id: "household_match",
    issueTypes: ["household_match"],
    label: "Household / Account Matches",
    description: "Same email matched a different name — likely a spouse or second contact on the same account. Merge fills blank fields and appends notes; existing name and billing address are never overwritten.",
    confidence: "High",
    confidenceColors: CONFIDENCE_COLORS.High,
    headerBg: "bg-violet-50 border-violet-200",
    defaultAction: "merge",
    bulkLabel: "✦ Merge All",
    bulkColors: "bg-violet-600 text-white hover:bg-violet-700",
  },
  {
    id: "new_property",
    issueTypes: ["new_property_detected"],
    label: "New Properties",
    description: "Existing customer with a different service address detected. Adding a property does not touch the customer's billing address.",
    confidence: "High",
    confidenceColors: CONFIDENCE_COLORS.High,
    headerBg: "bg-teal-50 border-teal-200",
    defaultAction: "accept_import",
    bulkLabel: "Add All Properties",
    bulkColors: "bg-teal-600 text-white hover:bg-teal-700",
  },
  {
    id: "new_owner",
    issueTypes: ["new_owner_at_property"],
    label: "New Owner at Existing Property",
    description: "Import address matches an existing property, but the name/email/phone belongs to a different person. This likely represents a change of ownership or sale. Approving creates a new customer account linked to the same property — prior owner history is preserved.",
    confidence: "Medium",
    confidenceColors: CONFIDENCE_COLORS.Medium,
    headerBg: "bg-orange-50 border-orange-200",
    defaultAction: "accept_import",
    bulkLabel: "Create All New Owner Accounts",
    bulkColors: "bg-orange-600 text-white hover:bg-orange-700",
  },
  {
    id: "new_customer",
    issueTypes: ["new_record"],
    label: "No Reliable Match Found",
    description: "No email, phone, company, or address match found — these records appear to be new customers. Safe to create. All records with a confirmed address match have already been auto-merged.",
    confidence: "High",
    confidenceColors: CONFIDENCE_COLORS.High,
    headerBg: "bg-blue-50 border-blue-200",
    defaultAction: "accept_import",
    bulkLabel: "Create All New Customers",
    bulkColors: "bg-blue-600 text-white hover:bg-blue-700",
  },
  {
    id: "field_conflict",
    issueTypes: ["field_conflict"],
    label: "Field Conflicts",
    description: "Matched an existing record but imported data differs. CRM values are always preserved; import only fills blank fields.",
    confidence: "High",
    confidenceColors: CONFIDENCE_COLORS.High,
    headerBg: "bg-amber-50 border-amber-200",
    defaultAction: "merge",
    bulkLabel: "✦ Merge All",
    bulkColors: "bg-amber-600 text-white hover:bg-amber-700",
  },
  {
    id: "weak_match",
    issueTypes: ["weak_match"],
    label: "Weak Matches (No Email/Phone)",
    description: "Matched by name+address or company name only — no email or phone confirmation. Review each record carefully. If the person is the same, merge. If unsure, create as new customer.",
    confidence: "Low",
    confidenceColors: CONFIDENCE_COLORS.Low,
    headerBg: "bg-yellow-50 border-yellow-200",
    defaultAction: undefined,
    bulkLabel: undefined,
  },
  {
    id: "name_mismatch",
    issueTypes: ["name_mismatch"],
    label: "Name Mismatches",
    description: "Email, phone, or external ID matched an existing record but the names are different. Could be a spouse, name change, or wrong match. Do NOT merge without verifying.",
    confidence: "Low",
    confidenceColors: CONFIDENCE_COLORS.Low,
    headerBg: "bg-rose-50 border-rose-200",
    defaultAction: undefined,
    bulkLabel: undefined,
  },
  {
    id: "identity_conflict",
    issueTypes: ["identity_conflict"],
    label: "Identity Conflicts",
    description: "Same email or phone but different Customer Factor IDs — these are separate customers sharing contact info. Do NOT merge.",
    confidence: "Low",
    confidenceColors: CONFIDENCE_COLORS.Low,
    headerBg: "bg-red-50 border-red-200",
    defaultAction: undefined,
    bulkLabel: undefined,
  },
  {
    id: "ambiguous_match",
    issueTypes: ["ambiguous_match"],
    label: "Possible Matches",
    description: "Name or company similarity found but no email or phone match confirmed. Manual review recommended — do not bulk-approve.",
    confidence: "Low",
    confidenceColors: CONFIDENCE_COLORS.Low,
    headerBg: "bg-rose-50 border-rose-200",
    defaultAction: undefined,
    bulkLabel: undefined,
  },
  {
    id: "other",
    issueTypes: ["duplicate_job", "phone_overflow", "status_downgrade", "property_conflict"],
    label: "Other Issues",
    description: "Duplicate jobs, phone overflows, status downgrades, and property conflicts that need individual attention.",
    confidence: "Medium",
    confidenceColors: CONFIDENCE_COLORS.Medium,
    headerBg: "bg-slate-50 border-slate-200",
    defaultAction: undefined,
    bulkLabel: undefined,
  },
];

function getItemConfidence(item: any, proposed: any): ConfidenceLevel {
  if (item.issue_type === "ambiguous_match") return "Low";
  if (item.issue_type === "new_owner_at_property" || item.issue_type === "duplicate_job" || item.issue_type === "status_downgrade" || item.issue_type === "phone_overflow") return "Medium";
  if (item.issue_type === "new_record" && proposed?._softMatch) return "Medium";
  return "High";
}

// ─── Filter pill ───────────────────────────────────────────────────────────────

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-[11px] font-semibold rounded-full border transition-all whitespace-nowrap ${
        active
          ? "bg-primary/10 border-primary/40 text-primary"
          : "bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700"
      }`}
    >
      {label}
    </button>
  );
}

// ─── Bulk pending type ─────────────────────────────────────────────────────────

type BulkPendingConfig = {
  action: string;
  label: string;
  scopeLabel: string;
  entityType?: string;
  issueType?: string;
  count: number;
  breakdown: Array<{ label: string; count: number }>;
};

const FIELD_MAP: Array<{
  field: string;
  label: string;
  csvCols: string[];
  required?: boolean;
}> = [
  { field: "firstName",      label: "First Name",    csvCols: ["First Name", "first_name", "Customer Name", "customer_name"],  required: true },
  { field: "lastName",       label: "Last Name",     csvCols: ["Last Name", "last_name"],                                          required: true },
  { field: "companyName",    label: "Company Name",  csvCols: ["Company Name", "company_name"] },
  { field: "email",          label: "Email",         csvCols: ["Email", "email"] },
  { field: "homePhone",      label: "Home Phone",    csvCols: ["Home Phone", "home_phone", "phone"] },
  { field: "cellPhone",      label: "Cell Phone",    csvCols: ["Cell Phone", "cell_phone", "phone3"] },
  { field: "workPhone",      label: "Work Phone",    csvCols: ["Work Phone", "work_phone", "phone2"] },
  { field: "billingAddress", label: "Address",        csvCols: ["Street Address", "street_address", "Address"] },
  { field: "billingCity",    label: "City",           csvCols: ["City", "city"] },
  { field: "billingState",   label: "State",          csvCols: ["State", "state"] },
  { field: "billingZip",     label: "Zip",            csvCols: ["Zip Code", "zip"] },
  { field: "externalId",     label: "External ID",    csvCols: ["Id", "id", "c_id"] },
  { field: "clientType",     label: "Client Type",    csvCols: ["Client Type", "client_type", "Customer Type", "customer_type", "Account Type", "account_type", "Type", "type"] },
  { field: "salutation",     label: "Salutation",     csvCols: ["Salutation", "title"] },
  { field: "altContact",     label: "Alt. Contact",   csvCols: ["Alt. Contact", "alt_contact", "contact_person"] },
  { field: "howHeard",       label: "How Heard",      csvCols: ["Marketing Method", "how_heard", "hearus"] },
  { field: "notes",          label: "Notes",           csvCols: ["Notes", "notes"] },
];

function StagingRowDetailModal({ row, onClose }: { row: any; onClose: () => void }) {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<"mapped" | "raw" | "mapping">("mapped");
  const nd = row.normalized_data ?? {};
  const rd = row.raw_data ?? {};
  const ROW_STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
    skipped_duplicate: { bg: "bg-slate-100", text: "text-slate-600", label: "Skipped Duplicate" },
    error:             { bg: "bg-red-50",    text: "text-red-600",   label: "Error" },
    review:            { bg: "bg-amber-50",  text: "text-amber-700", label: "In Review" },
    auto_approved:     { bg: "bg-emerald-50",text: "text-emerald-700",label: "Auto-Approved" },
    applied:           { bg: "bg-blue-50",   text: "text-blue-700",  label: "Applied" },
    ignored:           { bg: "bg-slate-50",  text: "text-slate-500", label: "Ignored" },
  };
  const badge = ROW_STATUS_BADGE[row.status] ?? { bg: "bg-slate-50", text: "text-slate-500", label: row.status };

  const matchLabels: Record<string, string> = {
    new_customer: "Auto-Created (New Customer)",
    exact_email: "Matched by Email",
    exact_phone: "Matched by Phone",
    weak_match: "Weak Match (External ID only)",
    duplicate: "Skipped Duplicate",
    external_id: "Matched by External ID",
    auto_created: "Auto-Created (New Customer)",
  };

  const customerId = row.matched_entity_id;
  const isDupe = row.status === "skipped_duplicate";

  const hasNameField = !!(nd.firstName || nd.lastName || nd.companyName);
  const hasEmail = !!nd.email;
  const hasPhone = !!(nd.homePhone || nd.cellPhone || nd.workPhone);
  const missingCore = !hasNameField || (!hasEmail && !hasPhone);

  const resolveSource = (fm: typeof FIELD_MAP[0]) => {
    for (const col of fm.csvCols) {
      if (rd[col] && rd[col].trim()) return { col, value: rd[col].trim() };
    }
    return null;
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold text-slate-900">Staging Row Detail</h3>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>
              {badge.label}
            </span>
            {row.external_id && <span className="text-xs text-slate-400">CF #{row.external_id}</span>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {missingCore && (
          <div className="mx-5 mt-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-start gap-2">
            <svg className="w-4 h-4 text-red-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div className="text-xs text-red-800">
              <p className="font-semibold">Missing core identity fields</p>
              <p className="mt-0.5">
                {!hasNameField && "No name (first, last, or company). "}
                {!hasEmail && !hasPhone && "No email or phone. "}
                {!hasEmail && hasPhone && "No email. "}
                {hasEmail && !hasPhone && "No phone. "}
                This record {row.status === "auto_approved" ? "was auto-created without full identity." : "requires review before creation."}
              </p>
            </div>
          </div>
        )}

        <div className="px-5 pt-4">
          <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
            {(["mapped", "raw", "mapping"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  activeTab === tab ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {tab === "mapped" ? "Mapped Fields" : tab === "raw" ? "Raw CSV Data" : "Column Mapping"}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 space-y-4">
          {activeTab === "mapped" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                {FIELD_MAP.map(fm => {
                  const val = nd[fm.field];
                  const isEmpty = !val;
                  if (isEmpty && !fm.required) return null;
                  return (
                    <div key={fm.field}>
                      <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">{fm.label}</span>
                      {isEmpty ? (
                        <p className="text-amber-600 mt-0.5 text-xs italic flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path d="M12 9v2m0 4h.01" />
                          </svg>
                          Field not mapped or empty during import
                        </p>
                      ) : (
                        <p className="text-slate-800 mt-0.5">{val}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === "raw" && (
            <div className="space-y-2">
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Original CSV Values</p>
              <div className="bg-slate-50 rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
                {Object.entries(rd).filter(([, v]) => v && String(v).trim()).length === 0 ? (
                  <div className="px-3 py-4 text-xs text-slate-400 text-center italic">No raw data stored</div>
                ) : (
                  Object.entries(rd)
                    .filter(([k]) => !k.startsWith("_"))
                    .map(([k, v]) => (
                      <div key={k} className="flex items-start px-3 py-1.5 text-xs">
                        <span className="text-slate-500 font-mono w-40 shrink-0 truncate" title={k}>{k}</span>
                        <span className={`text-slate-800 font-mono ${v && String(v).trim() ? "" : "text-slate-300 italic"}`}>
                          {v && String(v).trim() ? String(v) : "(empty)"}
                        </span>
                      </div>
                    ))
                )}
              </div>
            </div>
          )}

          {activeTab === "mapping" && (
            <div className="space-y-2">
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">CSV Column → CRM Field</p>
              <div className="bg-slate-50 rounded-lg border border-slate-200 divide-y divide-slate-100">
                {FIELD_MAP.map(fm => {
                  const source = resolveSource(fm);
                  const mapped = nd[fm.field];
                  return (
                    <div key={fm.field} className="flex items-center px-3 py-2 text-xs gap-2">
                      <div className="w-36 shrink-0">
                        {source ? (
                          <span className="font-mono text-slate-600 bg-slate-200/60 px-1.5 py-0.5 rounded">{source.col}</span>
                        ) : (
                          <span className="text-slate-300 italic">no column</span>
                        )}
                      </div>
                      <svg className="w-3 h-3 text-slate-300 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                      <div className="w-28 shrink-0">
                        <span className={`font-medium ${fm.required ? "text-slate-800" : "text-slate-600"}`}>
                          {fm.label}
                          {fm.required && <span className="text-red-400 ml-0.5">*</span>}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        {mapped ? (
                          <span className="font-mono text-emerald-700 truncate block">{mapped}</span>
                        ) : source ? (
                          <span className="text-amber-600 italic text-[10px]">normalized to empty</span>
                        ) : (
                          <span className="text-slate-300 italic text-[10px]">—</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="border-t border-slate-100 pt-3">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Source</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <DetailField label="File" value={row.file_name || "—"} />
              <DetailField label="Row Number" value={row.row_index != null ? String(row.row_index) : "—"} />
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Match Info</h4>
            <div className="space-y-2 text-sm">
              <DetailField
                label="Match Type"
                value={matchLabels[row.match_method] || row.match_method?.replace(/_/g, " ") || "None"}
              />
              {customerId && (
                <DetailField label="Matched Customer" value={`CRM #${customerId}`} />
              )}
              {isDupe && nd._duplicateOfRowIndex != null && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                  This row was a duplicate of row [{nd._duplicateOfRowIndex}] — same external ID.
                  The first occurrence was staged; this row's data was skipped.
                </div>
              )}
              {row.status === "error" && row.error_message && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                  {row.error_message}
                </div>
              )}
              {row.review_id && (
                <DetailField
                  label="Review"
                  value={`${(row.issue_type || "").replace(/_/g, " ")} — ${row.review_action || "pending"}`}
                />
              )}
            </div>
          </div>

          {nd.notes && (
            <div className="border-t border-slate-100 pt-3">
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Notes</h4>
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{nd.notes}</p>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-slate-100 flex justify-end gap-2">
          {customerId && (
            <button
              onClick={() => navigate(`/customers/${customerId}`)}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              View Customer Record
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">{label}</span>
      <p className="text-slate-800 mt-0.5">{value}</p>
    </div>
  );
}

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  skipped_duplicate: { bg: "bg-slate-100", text: "text-slate-600",   label: "Skipped Duplicate" },
  error:             { bg: "bg-red-50",    text: "text-red-600",     label: "Error" },
  review:            { bg: "bg-amber-50",  text: "text-amber-700",   label: "In Review" },
  auto_approved:     { bg: "bg-emerald-50",text: "text-emerald-700", label: "Auto-Approved" },
  applied:           { bg: "bg-blue-50",   text: "text-blue-700",    label: "Applied" },
  ignored:           { bg: "bg-slate-50",  text: "text-slate-500",   label: "Ignored" },
};

function DuplicateTracePanel({ batchId, searchTerm }: { batchId: number; searchTerm: string }) {
  const [showDupes, setShowDupes] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [tracePage, setTracePage] = useState(1);
  const [selectedRow, setSelectedRow] = useState<any>(null);

  useEffect(() => { setTracePage(1); }, [searchTerm, statusFilter]);

  const stagingQuery = useQuery<any>({
    queryKey: ["staging-search", batchId, searchTerm, statusFilter, tracePage],
    queryFn: () => {
      const params = new URLSearchParams({
        search: searchTerm,
        page: String(tracePage),
        pageSize: "50",
        ...(statusFilter && { status: statusFilter }),
      });
      return apiFetch(`/api/admin/import/batches/${batchId}/staging-search?${params}`);
    },
    enabled: !!searchTerm,
  });

  const rows = (stagingQuery.data?.data ?? []) as any[];
  const total = stagingQuery.data?.total ?? 0;
  const totalPages = stagingQuery.data?.totalPages ?? 1;
  const dupeRows = rows.filter((r: any) => r.status === "skipped_duplicate");
  const otherRows = rows.filter((r: any) => r.status !== "skipped_duplicate");

  if (!searchTerm || stagingQuery.isLoading) return null;
  if (total === 0) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-slate-700">All Staging Rows</h4>
          <span className="text-xs text-slate-400">{total} total</span>
          {dupeRows.length > 0 && (
            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
              {dupeRows.length} duplicate{dupeRows.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1"
          >
            <option value="">All statuses</option>
            <option value="skipped_duplicate">Skipped Duplicates</option>
            <option value="auto_approved">Auto-Approved</option>
            <option value="review">In Review</option>
            <option value="error">Errors</option>
            <option value="applied">Applied</option>
          </select>
          {dupeRows.length > 0 && !statusFilter && (
            <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
              <input type="checkbox" checked={showDupes} onChange={e => setShowDupes(e.target.checked)} className="rounded" />
              Show duplicates
            </label>
          )}
        </div>
      </div>

      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {(showDupes || statusFilter ? rows : otherRows).map((row: any) => {
          const nd = row.normalized_data ?? {};
          const badge = STATUS_BADGE[row.status] ?? { bg: "bg-slate-50", text: "text-slate-500", label: row.status };
          const isDupe = row.status === "skipped_duplicate";
          const dupeOfRow = nd._duplicateOfRowIndex;

          return (
            <div
              key={row.id}
              onClick={() => setSelectedRow(row)}
              className={`border rounded-lg p-3 text-xs space-y-1 cursor-pointer hover:ring-2 hover:ring-blue-200 transition-all ${isDupe ? "border-slate-200 bg-slate-50/50" : "border-slate-200"}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${badge.bg} ${badge.text}`}>
                    {badge.label}
                  </span>
                  {row.external_id && (
                    <span className="text-slate-500">CF #{row.external_id}</span>
                  )}
                  <span className="text-slate-700 font-medium">
                    {nd.firstName || nd.first_name || ""} {nd.lastName || nd.last_name || ""}
                    {nd.companyName || nd.company_name ? ` (${nd.companyName || nd.company_name})` : ""}
                  </span>
                  {(nd.email) && <span className="text-blue-500">{nd.email}</span>}
                  {(nd.homePhone || nd.cellPhone || nd.workPhone) && (
                    <span className="text-slate-400">{nd.cellPhone || nd.homePhone || nd.workPhone}</span>
                  )}
                </div>
                <span className="text-slate-400 text-[10px]">Row {row.row_index}</span>
              </div>

              {isDupe && (
                <div className="bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 text-amber-800 flex items-start gap-1.5">
                  <svg className="w-3.5 h-3.5 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <span className="font-semibold">Merged into row [{dupeOfRow}]</span>
                    <span className="text-amber-600 ml-1">— same externalId, first occurrence was staged. This row's job data was extracted separately.</span>
                  </div>
                </div>
              )}

              {row.status === "error" && row.error_message && (
                <div className="bg-red-50 border border-red-200 rounded-md px-2.5 py-1.5 text-red-700">
                  {row.error_message}
                </div>
              )}

              {row.review_id && (
                <div className="text-slate-400">
                  Review: {row.issue_type?.replace(/_/g, " ")} — {row.review_action}
                  {row.matched_entity_id && <span className="ml-1">(CRM #{row.matched_entity_id})</span>}
                </div>
              )}

              {row.match_method && row.match_method !== "duplicate" && (
                <div className="text-slate-400">
                  Match: {row.match_method.replace(/_/g, " ")}
                  {row.matched_entity_id && <span className="ml-1">→ CRM #{row.matched_entity_id}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            disabled={tracePage <= 1}
            onClick={() => setTracePage(p => p - 1)}
            className="text-xs px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-[10px] text-slate-400">
            Page {tracePage} of {totalPages} ({total} results)
          </span>
          <button
            disabled={tracePage >= totalPages}
            onClick={() => setTracePage(p => p + 1)}
            className="text-xs px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
      {selectedRow && <StagingRowDetailModal row={selectedRow} onClose={() => setSelectedRow(null)} />}
    </div>
  );
}

function ReviewStep({ batch, batchDetail, onRefresh, isProcessing }: { batch: any; batchDetail: any; onRefresh: () => void; isProcessing?: boolean }) {
  const [page, setPage] = useState(1);
  const [entityTypeFilter, setEntityTypeFilter] = useState("");
  const [issueTypeFilter, setIssueTypeFilter]   = useState("");
  const [actionFilter, setActionFilter]         = useState("pending");
  const [expandedId, setExpandedId]             = useState<number | null>(null);
  const [bulkPending, setBulkPending]           = useState<BulkPendingConfig | null>(null);
  const [viewMode, setViewMode]                 = useState<"grouped" | "flat">("grouped");
  const [searchInput, setSearchInput]           = useState("");
  const [searchTerm, setSearchTerm]             = useState("");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const pageSize = viewMode === "grouped" ? 100 : 25;

  const reviewQuery = useQuery<any>({
    queryKey: ["import-review", batch.id, page, entityTypeFilter, issueTypeFilter, actionFilter, pageSize, searchTerm],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        ...(entityTypeFilter && { entityType: entityTypeFilter }),
        ...(issueTypeFilter  && { issueType:  issueTypeFilter  }),
        ...(actionFilter     && { action:     actionFilter     }),
        ...(searchTerm       && { search:     searchTerm       }),
      });
      return apiFetch(`/api/admin/import/batches/${batch.id}/review?${params}`);
    },
  });

  const scopedPendingQuery = useQuery<any>({
    queryKey: ["import-review-scoped-count", batch.id, entityTypeFilter, issueTypeFilter, searchTerm],
    queryFn: () => {
      const p = new URLSearchParams({ page: "1", pageSize: "1", action: "pending" });
      if (entityTypeFilter) p.set("entityType", entityTypeFilter);
      if (issueTypeFilter)  p.set("issueType",  issueTypeFilter);
      if (searchTerm)       p.set("search",     searchTerm);
      return apiFetch(`/api/admin/import/batches/${batch.id}/review?${p}`);
    },
    staleTime: 0,
  });
  const pendingInScope = scopedPendingQuery.data?.total ?? 0;

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["import-review", batch.id] });
    qc.invalidateQueries({ queryKey: ["import-review-scoped-count", batch.id] });
    qc.invalidateQueries({ queryKey: ["import-batch", batch.id] });
    onRefresh();
  };

  /** Helper: snapshot item's current action+issueType from the review cache BEFORE mutating it. */
  const snapItemState = (itemId: number): { prevAction: string | undefined; issueType: string | undefined } => {
    let prevAction: string | undefined;
    let issueType: string | undefined;
    qc.getQueriesData({ queryKey: ["import-review", batch.id] }).forEach(([, d]: any) => {
      if (d?.data) {
        const found = d.data.find((i: any) => i.id === itemId);
        if (found) { prevAction = found.action; issueType = found.issue_type; }
      }
    });
    return { prevAction, issueType };
  };

  /** Optimistically adjusts the batch detail pending count and per-issue pending count. */
  const shiftPendingCount = (delta: number, affectedIssueType?: string) => {
    qc.setQueryData(["import-batch", batch.id], (old: any) => {
      if (!old?.reviewCounts) return old;
      return {
        ...old,
        reviewCounts: {
          ...old.reviewCounts,
          pending: Math.max(0, (old.reviewCounts.pending ?? 0) + delta),
        },
        issueCounts: affectedIssueType && old.issueCounts
          ? old.issueCounts.map((ic: any) =>
              ic.issue_type === affectedIssueType
                ? { ...ic, pending: Math.max(0, (ic.pending ?? 0) + delta) }
                : ic
            )
          : old.issueCounts,
      };
    });
  };

  const actionMut = useMutation({
    mutationFn: ({ itemId, action, ...decision }: { itemId: number; action: string; selectedCustomerId?: number; reason?: string }) =>
      apiFetch(`/api/admin/import/review/${itemId}`, { method: "PATCH", body: JSON.stringify({ action, ...decision }) }),
    onMutate: async ({ itemId, action }) => {
      // Cancel outgoing refetches so they don't race with our optimistic update
      await qc.cancelQueries({ queryKey: ["import-review", batch.id] });
      await qc.cancelQueries({ queryKey: ["import-batch", batch.id] });

      // Snapshot previous state BEFORE we mutate the cache
      const prevBatchDetail = qc.getQueryData(["import-batch", batch.id]);
      const { prevAction, issueType: prevIssueType } = snapItemState(itemId);

      // Optimistically update the review list: swap action, shrink total if now resolved
      qc.setQueriesData({ queryKey: ["import-review", batch.id] }, (old: any) => {
        if (!old?.data) return old;
        return {
          ...old,
          data: old.data.map((i: any) => i.id === itemId ? { ...i, action } : i),
          total: (actionFilter === "pending" && prevAction === "pending" && action !== "pending")
            ? Math.max(0, (old.total ?? 0) - 1)
            : (actionFilter === "pending" && prevAction !== "pending" && action === "pending")
            ? (old.total ?? 0) + 1
            : old.total,
        };
      });

      // Optimistically shift the batch-level pending count
      if (prevAction === "pending" && action !== "pending") {
        shiftPendingCount(-1, prevIssueType);
      } else if (prevAction !== "pending" && action === "pending") {
        shiftPendingCount(+1, prevIssueType);
      }

      return { prevBatchDetail };
    },
    onError: (_err, _vars, context) => {
      if (context?.prevBatchDetail) {
        qc.setQueryData(["import-batch", batch.id], context.prevBatchDetail);
      }
      invalidateAll();
    },
    onSuccess: () => {
      invalidateAll();
    },
  });

  const bulkMut = useMutation({
    mutationFn: (params: { action: string; entityType?: string; issueType?: string; search?: string }) =>
      apiFetch(`/api/admin/import/review/bulk`, {
        method: "PATCH",
        body: JSON.stringify({ batchId: batch.id, ...params }),
      }),
    onMutate: async ({ action, issueType: bulkIssueType, entityType: bulkEntityType }) => {
      await qc.cancelQueries({ queryKey: ["import-review", batch.id] });
      await qc.cancelQueries({ queryKey: ["import-batch", batch.id] });
      const prevBatchDetail = qc.getQueryData(["import-batch", batch.id]);

      // Compute how many pending items in scope will be resolved
      // and optimistically zero them out in the cache
      qc.setQueriesData({ queryKey: ["import-review", batch.id] }, (old: any) => {
        if (!old?.data) return old;
        let resolved = 0;
        const updated = old.data.map((i: any) => {
          const inScope =
            i.action === "pending" &&
            (!bulkIssueType  || i.issue_type  === bulkIssueType) &&
            (!bulkEntityType || i.entity_type === bulkEntityType);
          if (inScope) { resolved++; return { ...i, action }; }
          return i;
        });
        return {
          ...old,
          data: updated,
          total: actionFilter === "pending" ? Math.max(0, (old.total ?? 0) - resolved) : old.total,
        };
      });

      // Optimistically update batch detail counts
      qc.setQueryData(["import-batch", batch.id], (old: any) => {
        if (!old?.reviewCounts) return old;
        // Count pending items in the affected issue-type scope
        const affectedPending = bulkIssueType && old.issueCounts
          ? Number((old.issueCounts.find((ic: any) => ic.issue_type === bulkIssueType) ?? {}).pending ?? 0)
          : (old.reviewCounts.pending ?? 0);
        return {
          ...old,
          reviewCounts: {
            ...old.reviewCounts,
            pending: Math.max(0, (old.reviewCounts.pending ?? 0) - affectedPending),
          },
          issueCounts: bulkIssueType && old.issueCounts
            ? old.issueCounts.map((ic: any) =>
                ic.issue_type === bulkIssueType
                  ? { ...ic, pending: 0 }
                  : ic
              )
            : old.issueCounts,
        };
      });

      return { prevBatchDetail };
    },
    onError: (err, _vars, context) => {
      if (context?.prevBatchDetail) {
        qc.setQueryData(["import-batch", batch.id], context.prevBatchDetail);
      }
      toast({ title: "Bulk action failed", description: (err as Error).message, variant: "destructive" });
      invalidateAll();
    },
    onSuccess: (data) => {
      const n = data?.affected ?? 0;
      toast({ title: `Bulk action applied — ${n} record${n !== 1 ? "s" : ""} updated` });
      invalidateAll();
    },
  });

  const reviewData = reviewQuery.data;
  const items: any[] = reviewData?.data ?? [];
  const totalPages = reviewData?.totalPages ?? 1;
  const total = reviewData?.total ?? 0;

  // Build visible breakdown from current page items (for use in confirmation banner)
  const visibleBreakdown = (() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      const key = ISSUE_LABELS[item.issue_type] ?? item.issue_type;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts).map(([label, count]) => ({ label, count }));
  })();

  // Queue a bulk action for confirmation — computes scope and breakdown
  const queueBulk = (conf: {
    action: string;
    label: string;
    entityType?: string;
    issueType?: string;
  }) => {
    // Count pending items in the requested scope (use scoped count if scopes match, else total pending)
    const isSameScope =
      (conf.entityType ?? "") === entityTypeFilter &&
      (conf.issueType  ?? "") === issueTypeFilter;
    const count = isSameScope
      ? pendingInScope
      : null; // will show as "all" for smart bulk actions

    // Build scope label
    const parts: string[] = [];
    if (conf.issueType)  parts.push(ISSUE_LABELS[conf.issueType]  ?? conf.issueType);
    if (conf.entityType) parts.push(ENTITY_FRIENDLY[conf.entityType] ?? conf.entityType);
    if (!conf.issueType && !conf.entityType) parts.push("All pending records");
    const scopeLabel = parts.join(" · ") || "All pending records";

    setBulkPending({
      ...conf,
      scopeLabel,
      count: count ?? pendingInScope,
      breakdown: visibleBreakdown,
    });
  };

  const executeBulk = () => {
    if (!bulkPending) return;
    bulkMut.mutate({
      action:     bulkPending.action,
      entityType: bulkPending.entityType,
      issueType:  bulkPending.issueType,
      search:     searchTerm || undefined,
    });
    setBulkPending(null);
  };

  const pendingCount = batchDetail?.reviewCounts?.pending ?? 0;
  // issueCounts from batchDetail: [{issue_type, total, pending}]
  const issueCounts: Array<{ issue_type: string; total: number; pending: number }> =
    (batchDetail?.issueCounts ?? []).map((r: any) => ({
      issue_type: r.issue_type,
      total: Number(r.total),
      pending: Number(r.pending),
    }));
  const issueCountMap = Object.fromEntries(issueCounts.map(r => [r.issue_type, r]));

  return (
    <div className="space-y-5">
      {/* Processing guard — shown while background staging is still running */}
      {isProcessing && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <Loader2 className="w-4 h-4 text-amber-500 animate-spin shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Staging still in progress</p>
            <p className="text-xs text-amber-700 mt-0.5">
              New review items are still being generated. Please wait until processing completes before making decisions — otherwise counts may shift as additional items arrive.
            </p>
          </div>
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Review Conflicts</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {pendingCount > 0
              ? `${pendingCount} item${pendingCount !== 1 ? "s" : ""} need your decision before the batch can be applied.`
              : "All items have been reviewed. You can now apply the batch."}
          </p>
        </div>
        {/* View mode toggle */}
        <div className="flex items-center bg-slate-100 rounded-lg p-1 gap-1 shrink-0">
          <button
            onClick={() => { setViewMode("grouped"); setPage(1); }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${viewMode === "grouped" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            Grouped
          </button>
          <button
            onClick={() => { setViewMode("flat"); setPage(1); }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${viewMode === "flat" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            List
          </button>
        </div>
      </div>

      <StagingSummary batchDetail={batchDetail} />

      {/* ── Search bar ────────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-3">
        <form
          onSubmit={(e) => { e.preventDefault(); setSearchTerm(searchInput.trim()); setPage(1); }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by name, CF ID, email, phone, or address..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors shrink-0"
          >
            Search
          </button>
          {searchTerm && (
            <button
              type="button"
              onClick={() => { setSearchInput(""); setSearchTerm(""); setPage(1); }}
              className="px-3 py-2 text-sm font-medium text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shrink-0"
            >
              Clear
            </button>
          )}
        </form>
        {searchTerm && (
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className="text-slate-500">
              Searching for "<span className="font-semibold text-slate-700">{searchTerm}</span>"
            </span>
            <span className="text-slate-400">—</span>
            <span className="font-semibold text-primary">
              {reviewQuery.data?.total ?? "..."} review result{(reviewQuery.data?.total ?? 0) !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      {/* ── Duplicate Trace Panel (shown when searching) ────────────────── */}
      {searchTerm && (
        <DuplicateTracePanel batchId={batch.id} searchTerm={searchTerm} />
      )}

      {/* ── Filter panel ──────────────────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        {/* Action filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-slate-500 w-12 shrink-0">Status</span>
          {[
            { value: "",               label: "All" },
            { value: "pending",        label: "Pending" },
            { value: "merge",          label: "Merge" },
            { value: "accept_import",  label: "Create / Replace" },
            { value: "keep_existing",  label: "Keep Existing" },
            { value: "replace_billing",label: "Replace Address" },
            { value: "ignore",         label: "Skip" },
          ].map(opt => (
            <FilterPill
              key={opt.value}
              label={opt.label}
              active={actionFilter === opt.value}
              onClick={() => { setActionFilter(opt.value); setPage(1); setBulkPending(null); }}
            />
          ))}
        </div>

        {/* Entity type filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-slate-500 w-12 shrink-0">Type</span>
          {[
            { value: "", label: "All" },
            { value: "customer", label: "Customers" },
            { value: "lead",     label: "Leads" },
            { value: "job",      label: "Jobs" },
            { value: "invoice",  label: "Invoices" },
            { value: "property", label: "Properties" },
          ].map(opt => (
            <FilterPill
              key={opt.value}
              label={opt.label}
              active={entityTypeFilter === opt.value}
              onClick={() => { setEntityTypeFilter(opt.value); setPage(1); setBulkPending(null); }}
            />
          ))}
        </div>

        {/* Issue type filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-slate-500 w-12 shrink-0">Issue</span>
          {[
            { value: "",                     label: "All" },
            { value: "exact_match",          label: "Exact Match" },
            { value: "weak_match",           label: "Weak Match" },
            { value: "name_mismatch",        label: "Name Mismatch" },
            { value: "identity_conflict",    label: "Identity Conflict" },
            { value: "household_match",      label: "Household Match" },
            { value: "field_conflict",       label: "Field Conflict" },
            { value: "new_record",           label: "New Record" },
            { value: "new_property_detected",label: "New Property" },
            { value: "new_owner_at_property",label: "New Owner" },
            { value: "duplicate_job",        label: "Duplicate Job" },
            { value: "ambiguous_match",      label: "Ambiguous Match" },
          ].map(opt => (
            <FilterPill
              key={opt.value}
              label={opt.label}
              active={issueTypeFilter === opt.value}
              onClick={() => { setIssueTypeFilter(opt.value); setPage(1); setBulkPending(null); }}
            />
          ))}
        </div>

        {/* Active filter summary + count */}
        <div className="flex items-center justify-between pt-1 border-t border-slate-100">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Active filter chips */}
            {(actionFilter || entityTypeFilter || issueTypeFilter || searchTerm) ? (
              <>
                <span className="text-[11px] text-slate-400">Filtered:</span>
                {searchTerm && (
                  <span className="inline-flex items-center gap-1 text-[11px] bg-indigo-100 text-indigo-700 font-semibold px-2 py-0.5 rounded-full">
                    Search: "{searchTerm}"
                    <button onClick={() => { setSearchInput(""); setSearchTerm(""); setPage(1); }} className="hover:text-indigo-400 ml-0.5">×</button>
                  </span>
                )}
                {actionFilter && (
                  <span className="inline-flex items-center gap-1 text-[11px] bg-primary/10 text-primary font-semibold px-2 py-0.5 rounded-full">
                    {ACTION_FRIENDLY[actionFilter] ?? actionFilter}
                    <button onClick={() => { setActionFilter(""); setPage(1); setBulkPending(null); }} className="hover:text-primary/60 ml-0.5">×</button>
                  </span>
                )}
                {entityTypeFilter && (
                  <span className="inline-flex items-center gap-1 text-[11px] bg-slate-100 text-slate-600 font-semibold px-2 py-0.5 rounded-full">
                    {ENTITY_FRIENDLY[entityTypeFilter] ?? entityTypeFilter}
                    <button onClick={() => { setEntityTypeFilter(""); setPage(1); setBulkPending(null); }} className="hover:text-slate-400 ml-0.5">×</button>
                  </span>
                )}
                {issueTypeFilter && (
                  <span className="inline-flex items-center gap-1 text-[11px] bg-slate-100 text-slate-600 font-semibold px-2 py-0.5 rounded-full">
                    {ISSUE_LABELS[issueTypeFilter] ?? issueTypeFilter}
                    <button onClick={() => { setIssueTypeFilter(""); setPage(1); setBulkPending(null); }} className="hover:text-slate-400 ml-0.5">×</button>
                  </span>
                )}
                <button
                  onClick={() => { setActionFilter(""); setEntityTypeFilter(""); setIssueTypeFilter(""); setSearchInput(""); setSearchTerm(""); setPage(1); setBulkPending(null); }}
                  className="text-[11px] text-slate-400 hover:text-slate-600 underline underline-offset-2"
                >
                  Clear all
                </button>
              </>
            ) : (
              <span className="text-[11px] text-slate-400">No filters active — showing all records</span>
            )}
          </div>
          <span className="text-[11px] font-semibold text-slate-500 shrink-0">
            {total.toLocaleString()} record{total !== 1 ? "s" : ""} shown
          </span>
        </div>
      </div>

      {/* ── Scope-aware bulk actions ───────────────────────────────────────── */}
      <div className="space-y-3">
        {/* Visible-scope bulk row */}
        <div className="flex items-center gap-3 flex-wrap bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-700">
              Apply to visible records
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {pendingInScope > 0
                ? <><span className="font-semibold text-slate-700">{pendingInScope}</span> pending records match your current filters</>
                : "No pending records match your current filters"}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              disabled={pendingInScope === 0 || bulkMut.isPending}
              onClick={() => queueBulk({
                action: "merge",
                label: "✦ Merge",
                entityType: entityTypeFilter || undefined,
                issueType: issueTypeFilter || undefined,
              })}
              className="px-3 py-1.5 text-xs font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm ring-1 ring-primary/20 transition-colors"
              title="Fill blank CRM fields · Append notes · Preserve existing data"
            >
              ✦ Merge {pendingInScope > 0 ? pendingInScope : ""}
            </button>
            <button
              disabled={pendingInScope === 0 || bulkMut.isPending}
              onClick={() => queueBulk({
                action: "keep_existing",
                label: "Keep Existing",
                entityType: entityTypeFilter || undefined,
                issueType: issueTypeFilter || undefined,
              })}
              className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Keep all CRM data unchanged — ignore import values"
            >
              Keep {pendingInScope > 0 ? pendingInScope : ""}
            </button>
            <button
              disabled={pendingInScope === 0 || bulkMut.isPending}
              onClick={() => queueBulk({
                action: "ignore",
                label: "Skip",
                entityType: entityTypeFilter || undefined,
                issueType: issueTypeFilter || undefined,
              })}
              className="px-3 py-1.5 text-xs font-semibold bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Skip these records — no changes applied"
            >
              Skip {pendingInScope > 0 ? pendingInScope : ""}
            </button>
          </div>
        </div>

        {/* Smart bulk actions (fixed scopes) */}
        <div className="px-4 py-3 bg-white border border-slate-200 rounded-xl space-y-2">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Smart bulk actions</p>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={bulkMut.isPending}
              onClick={() => queueBulk({ action: "merge", label: "✦ Merge All Household Matches", issueType: "household_match" })}
              className="px-3 py-1.5 text-xs font-semibold bg-violet-50 border border-violet-200 text-violet-700 rounded-lg hover:bg-violet-100 transition-colors"
              title="For all household/spouse matches: merge into existing account — fill blank fields, append notes, preserve name and billing address"
            >
              ✦ Merge All Household Matches
            </button>
            <button
              disabled={bulkMut.isPending}
              onClick={() => queueBulk({ action: "merge", label: "✦ Merge All Field Conflicts", issueType: "field_conflict" })}
              className="px-3 py-1.5 text-xs font-semibold bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors"
              title="For all pending field conflicts: fill blank CRM fields, append notes, preserve existing data"
            >
              ✦ Merge All Field Conflicts
            </button>
            <button
              disabled={bulkMut.isPending}
              onClick={() => queueBulk({ action: "accept_import", label: "Create All New Customers", issueType: "new_record", entityType: "customer" })}
              className="px-3 py-1.5 text-xs font-semibold bg-blue-50 border border-blue-200 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
              title="Create new customer records for all unmatched imports (no reliable existing match found)"
            >
              Create All New Customers
            </button>
            <button
              disabled={bulkMut.isPending}
              onClick={() => queueBulk({ action: "accept_import", label: "Add All New Properties", issueType: "new_property_detected" })}
              className="px-3 py-1.5 text-xs font-semibold bg-teal-50 border border-teal-200 text-teal-700 rounded-lg hover:bg-teal-100 transition-colors"
              title="Add all detected new properties as service locations"
            >
              Add All New Properties
            </button>
            <button
              disabled={bulkMut.isPending}
              onClick={() => queueBulk({ action: "keep_existing", label: "Hide All Duplicate Jobs", issueType: "duplicate_job" })}
              className="px-3 py-1.5 text-xs font-semibold bg-slate-50 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
              title="Keep all duplicate jobs as hidden suspected duplicates"
            >
              Hide All Duplicate Jobs
            </button>
          </div>
        </div>

        {/* ── Confirmation banner ────────────────────────────────────────── */}
        {bulkPending && (
          <div className="border-2 border-amber-300 bg-amber-50 rounded-xl p-4 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-bold text-amber-900">
                  Confirm bulk action: {bulkPending.label}
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Scope: <span className="font-semibold">{bulkPending.scopeLabel}</span>
                </p>
                <p className="text-sm font-semibold text-amber-800 mt-1.5">
                  This will apply to <span className="text-amber-900 underline underline-offset-2">{bulkPending.count} pending records</span>.
                </p>
                {bulkPending.breakdown.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="text-[11px] text-amber-600">Visible page breakdown:</span>
                    {bulkPending.breakdown.map(b => (
                      <span key={b.label} className="text-[11px] bg-amber-100 text-amber-800 font-semibold px-2 py-0.5 rounded-full">
                        {b.count} {b.label}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-amber-600 mt-2">
                  This affects <strong>all matching pending records</strong> in the batch, not just this page.
                  You can undo individual decisions afterward.
                </p>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={executeBulk}
                disabled={bulkMut.isPending}
                className="px-4 py-2 text-sm font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors"
              >
                {bulkMut.isPending ? <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Applying…</span> : `Yes, apply to ${bulkPending.count} records`}
              </button>
              <button
                onClick={() => setBulkPending(null)}
                disabled={bulkMut.isPending}
                className="px-4 py-2 text-sm font-medium border border-slate-300 text-slate-600 rounded-lg hover:bg-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Review items */}
      {reviewQuery.isLoading && (
        <div className="flex items-center gap-2 text-slate-400 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      )}

      {/* ── Grouped view ──────────────────────────────────────────────────── */}
      {viewMode === "grouped" && !reviewQuery.isLoading && (
        <div className="space-y-4">
          {REVIEW_GROUPS.map((group) => {
            const groupTotals = group.issueTypes.reduce(
              (acc, it) => {
                const c = issueCountMap[it];
                if (c) { acc.total += c.total; acc.pending += c.pending; }
                return acc;
              },
              { total: 0, pending: 0 }
            );
            if (groupTotals.total === 0) return null;
            const groupItems = items.filter(i => group.issueTypes.includes(i.issue_type));
            const shownCount = groupItems.length;
            const moreCount = groupTotals.total - shownCount;

            return (
              <div key={group.id} className={`border rounded-2xl overflow-hidden ${group.headerBg}`}>
                {/* Group section header */}
                <div className="px-5 py-4 flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-bold text-slate-800">{group.label}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${group.confidenceColors}`}>
                        {group.confidence} Confidence
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {groupTotals.total} total
                        {groupTotals.pending > 0
                          ? <> · <span className="text-amber-600 font-semibold">{groupTotals.pending} pending</span></>
                          : <> · <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold"><CheckCircle2 className="w-3 h-3" />Complete</span></>}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">{group.description}</p>
                  </div>
                  {group.bulkLabel && group.defaultAction && groupTotals.pending > 0 && (
                    <button
                      disabled={bulkMut.isPending}
                      onClick={() => queueBulk({
                        action: group.defaultAction!,
                        label: group.bulkLabel!,
                        issueType: group.issueTypes.length === 1 ? group.issueTypes[0] : undefined,
                      })}
                      className={`px-3 py-2 text-xs font-bold rounded-xl shrink-0 transition-colors disabled:opacity-40 shadow-sm ${group.bulkColors}`}
                    >
                      {group.bulkLabel} ({groupTotals.pending})
                    </button>
                  )}
                </div>

                {/* Items in this group */}
                <div className="bg-white divide-y divide-slate-100 border-t border-slate-200/60">
                  {shownCount === 0 && (
                    groupTotals.pending === 0 ? (
                      <div className="px-5 py-4 text-xs text-emerald-700 flex items-center gap-2 bg-emerald-50/60">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
                        All items in this group have been resolved.
                      </div>
                    ) : (
                      <div className="px-5 py-4 text-xs text-slate-400 italic flex items-center gap-2">
                        <Info className="w-3.5 h-3.5 shrink-0" />
                        {groupTotals.pending} pending item{groupTotals.pending !== 1 ? "s" : ""} in this group
                        {actionFilter === "pending"
                          ? " are on other pages — remove the Pending filter to see them."
                          : " are on other pages."}
                      </div>
                    )
                  )}
                  {groupItems.map((item: any) => {
                    const isExpanded = expandedId === item.id;
                    const current = item.current_data ? JSON.parse(item.current_data) : null;
                    const proposed: any = JSON.parse(item.proposed_data);
                    const conflicts: string[] = item.conflict_fields ? JSON.parse(item.conflict_fields) : [];
                    const ITEM_ACTION_COLOR: Record<string, string> = {
                      pending:         "bg-amber-50 border-amber-200",
                      keep_existing:   "bg-slate-50",
                      accept_import:   "bg-emerald-50",
                      merge:           "bg-indigo-50",
                      replace_billing: "bg-sky-50",
                      ignore:          "opacity-60",
                    };
                    const actionColor = ITEM_ACTION_COLOR[item.action] ?? "";
                    return (
                      <div key={item.id} className={`transition-all ${actionColor}`}>
                        <div className="flex items-center gap-3 px-5 py-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-slate-800">
                                {item.entity_type === "property"
                                  ? `${proposed.customerName || "Customer"} — ${proposed.address || "?"}, ${proposed.city || "?"}`
                                  : item.entity_type === "customer" && (proposed.firstName || proposed.lastName)
                                    ? `${proposed.firstName || ""} ${proposed.lastName || ""}`.trim()
                                    : `${proposed.firstName || ""} ${proposed.lastName || ""}`.trim() || "—"}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium capitalize">
                                {item.entity_type}
                              </span>
                              {(() => {
                                const conf = getItemConfidence(item, proposed);
                                return (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold border ${CONFIDENCE_COLORS[conf]}`}>
                                    {conf}
                                  </span>
                                );
                              })()}
                            </div>
                            {item.issue_type === "new_record" && proposed._softMatch && (
                              <p className="text-xs text-amber-700 mt-1 flex items-start gap-1.5">
                                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                                <span>
                                  <span className="font-semibold">Possible existing match</span>
                                  {" — "}{proposed._softMatch.firstName} {proposed._softMatch.lastName}
                                  {proposed._softMatch.billingAddress ? ` · ${proposed._softMatch.billingAddress}` : ""}
                                  <span className="text-amber-500 ml-1">({proposed._softMatch.reason})</span>
                                </span>
                              </p>
                            )}
                            {item.action !== "pending" && (
                              <p className="text-xs text-slate-500 mt-0.5">
                                Decision: <span className={`font-semibold ${
                                  item.action === "merge"           ? "text-indigo-600" :
                                  item.action === "accept_import"   ? "text-emerald-600" :
                                  item.action === "replace_billing" ? "text-sky-600" :
                                  item.action === "keep_existing"   ? "text-slate-600" :
                                  "text-slate-400"
                                }`}>
                                  {((): string => {
                                    const labelMap: Record<string, string> = {
                                      merge:           item.issue_type === "household_match" ? "✦ Merge into Existing Account" : "✦ Merge (fill blanks + append notes)",
                                      accept_import:   item.issue_type === "new_record" ? "Create New Customer" : item.issue_type === "new_owner_at_property" ? "Create New Account + Link to Property" : item.issue_type === "household_match" ? "Replace with Import" : "Replace All with Import",
                                      keep_existing:   item.issue_type === "new_property_detected" ? "Keep Existing" : item.issue_type === "new_owner_at_property" ? "Keep Prior Owner (Skip)" : item.issue_type === "duplicate_job" ? "Keep Hidden" : "Keep Existing Only",
                                      replace_billing: "Replace Existing Address",
                                      ignore:          "Skip",
                                    };
                                    return labelMap[item.action] ?? item.action;
                                  })()}
                                </span>
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <ConflictActionButtons item={item} proposed={proposed} actionMut={actionMut} />
                            <button
                              onClick={() => setExpandedId(isExpanded ? null : item.id)}
                              className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
                              title={isExpanded ? "Collapse" : "Expand details"}
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="border-t border-slate-100 px-5 py-3 bg-white">
                            {item.issue_type === "household_match" && proposed._householdSignal && (
                              <div className="mb-4 bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 space-y-2.5">
                                <div className="flex items-center gap-2">
                                  <Users className="w-4 h-4 text-violet-600 shrink-0" />
                                  <p className="text-xs font-bold text-violet-900">Likely same account / household match</p>
                                </div>
                                <div className="grid grid-cols-2 gap-3 text-xs">
                                  <div className="bg-white rounded-lg px-3 py-2.5 border border-violet-100">
                                    <p className="text-[10px] font-bold text-violet-500 mb-1 uppercase tracking-wide">CRM Account</p>
                                    <p className="font-semibold text-slate-800 text-sm">{proposed._householdSignal.existingName}</p>
                                    {proposed._householdSignal.matchedEmail && <p className="text-slate-500 mt-0.5">{proposed._householdSignal.matchedEmail}</p>}
                                  </div>
                                  <div className="bg-violet-100 rounded-lg px-3 py-2.5 border border-violet-200">
                                    <p className="text-[10px] font-bold text-violet-500 mb-1 uppercase tracking-wide">Imported Name</p>
                                    <p className="font-semibold text-violet-900 text-sm">{proposed._householdSignal.importedName}</p>
                                    <p className="text-violet-600 mt-0.5">matched via {proposed._householdSignal.matchMethod}</p>
                                  </div>
                                </div>
                              </div>
                            )}
                            {item.issue_type === "new_property_detected" && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs mb-4">
                                <div className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                                  <p className="font-semibold text-slate-600 mb-2">Existing Billing Address</p>
                                  <div className="font-mono text-slate-700">{proposed.existingBillingAddress || <span className="italic text-slate-400">none</span>}</div>
                                </div>
                                <div className="bg-teal-50 rounded-lg px-3 py-2 border border-teal-200">
                                  <p className="font-semibold text-teal-700 mb-2">Detected in Import</p>
                                  <div className="font-mono text-teal-900">{proposed.address}{proposed.city ? `, ${proposed.city}` : ""}</div>
                                </div>
                              </div>
                            )}
                            {item.issue_type === "new_owner_at_property" && current && (
                              <div className="mb-4 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 space-y-2.5">
                                <div className="flex items-center gap-2">
                                  <Home className="w-4 h-4 text-orange-600 shrink-0" />
                                  <p className="text-xs font-bold text-orange-900">Property already linked to a different account</p>
                                </div>
                                <div className="grid grid-cols-2 gap-3 text-xs">
                                  <div className="bg-white rounded-lg px-3 py-2.5 border border-orange-100">
                                    <p className="text-[10px] font-bold text-orange-500 mb-1 uppercase tracking-wide">Prior CRM Owner</p>
                                    <p className="font-semibold text-slate-800 text-sm">
                                      {[current.customerFirstName, current.customerLastName].filter(Boolean).join(" ") || <span className="italic text-slate-400">Unknown</span>}
                                    </p>
                                    {current.customerEmail && <p className="text-slate-500 mt-0.5">{current.customerEmail}</p>}
                                    <p className="text-slate-400 mt-1 font-mono text-[10px]">{current.address}{current.city ? `, ${current.city}` : ""}{current.zip ? ` ${current.zip}` : ""}</p>
                                  </div>
                                  <div className="bg-orange-100 rounded-lg px-3 py-2.5 border border-orange-200">
                                    <p className="text-[10px] font-bold text-orange-500 mb-1 uppercase tracking-wide">New Import Record</p>
                                    <p className="font-semibold text-orange-900 text-sm">
                                      {[proposed.firstName, proposed.lastName].filter(Boolean).join(" ") || proposed.companyName || <span className="italic">Unknown</span>}
                                    </p>
                                    {proposed.email && <p className="text-orange-700 mt-0.5">{proposed.email}</p>}
                                    <p className="text-orange-500 mt-0.5 text-[10px]">Matched by address</p>
                                  </div>
                                </div>
                                <p className="text-[11px] text-orange-700 leading-snug">
                                  <strong>Approve</strong> to create a new account and link it to this property. Prior owner history will be preserved.
                                  <strong> Skip</strong> to keep the existing owner and discard this import record.
                                </p>
                              </div>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                              {current && (
                                <div>
                                  <p className="font-semibold text-slate-600 mb-2">Current CRM Data</p>
                                  <div className="space-y-1 font-mono">
                                    {Object.entries(current).filter(([k]) => !["id","created_at","updated_at"].includes(k) && current[k]).slice(0, 12).map(([k, v]) => (
                                      <div key={k} className={`flex gap-2 ${conflicts.includes(k) ? "bg-amber-50 rounded px-1" : ""}`}>
                                        <span className="text-slate-400 w-32 shrink-0">{k}:</span>
                                        <span className="text-slate-700 truncate">{String(v)}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              <div>
                                <p className="font-semibold text-slate-600 mb-2">{current ? "Proposed Import Data" : "New Record Data"}</p>
                                <div className="space-y-1 font-mono">
                                  {Object.entries(proposed).filter(([k, v]) => v && k !== "_softMatch" && k !== "_householdSignal").slice(0, 12).map(([k, v]) => (
                                    <div key={k} className={`flex gap-2 ${conflicts.includes(k) ? "bg-amber-50 rounded px-1" : ""}`}>
                                      <span className="text-slate-400 w-32 shrink-0">{k}:</span>
                                      <span className="text-slate-700 truncate">{String(v)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                            {(item.issue_type === "field_conflict" || item.issue_type === "household_match" || item.action === "merge") && current && (
                              <MergePreview current={current} proposed={proposed} conflicts={conflicts} />
                            )}
                            {item.staging_matched_id && (
                              <div className="mt-3 pt-3 border-t border-slate-100">
                                <button
                                  onClick={() => navigate(`/customers/${item.staging_matched_id}`)}
                                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                    <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                  </svg>
                                  View Customer Record
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* "More items" footer */}
                {moreCount > 0 && shownCount > 0 && (
                  <div className="px-5 py-2.5 border-t border-slate-200/60 bg-slate-50/80 flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">Showing {shownCount} of {groupTotals.total} · {moreCount} more not loaded</span>
                    <button
                      onClick={() => { setIssueTypeFilter(group.issueTypes[0]); setViewMode("flat"); setPage(1); setBulkPending(null); }}
                      className="text-[11px] text-primary font-semibold hover:underline"
                    >
                      View all →
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {issueCounts.length === 0 && (
            <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-slate-500 font-medium">No review items found</p>
            </div>
          )}
        </div>
      )}

      {/* ── Flat list view ────────────────────────────────────────────────── */}
      {viewMode === "flat" && !reviewQuery.isLoading && items.length === 0 && (
        <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
          <p className="text-slate-500 font-medium">No items match this filter</p>
        </div>
      )}

      {viewMode === "flat" && (
      <>
      <div className="space-y-2">
        {items.map((item: any) => {
          const isExpanded = expandedId === item.id;
          const current = item.current_data ? JSON.parse(item.current_data) : null;
          const proposed: any = JSON.parse(item.proposed_data);
          const conflicts: string[] = item.conflict_fields ? JSON.parse(item.conflict_fields) : [];

          const ITEM_ACTION_COLOR_BORDERED: Record<string, string> = {
            pending:         "bg-amber-50 border-amber-200",
            keep_existing:   "bg-slate-50 border-slate-200",
            accept_import:   "bg-emerald-50 border-emerald-200",
            merge:           "bg-indigo-50 border-indigo-200",
            replace_billing: "bg-sky-50 border-sky-200",
            ignore:          "bg-slate-50 border-slate-200 opacity-60",
          };
          const actionColor = ITEM_ACTION_COLOR_BORDERED[item.action] ?? "bg-white border-slate-200";

          return (
            <div key={item.id} className={`border rounded-xl overflow-hidden transition-all ${actionColor}`}>
              {/* Header row */}
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-800">
                      {item.entity_type === "property"
                        ? `${proposed.customerName || "Customer"} — ${proposed.address || "?"}, ${proposed.city || "?"}`
                        : item.entity_type === "customer" && (proposed.firstName || proposed.lastName)
                          ? `${proposed.firstName || ""} ${proposed.lastName || ""}`.trim()
                          : item.entity_type === "job"
                            ? `Job: ${proposed.scheduledDate || "?"} · ${proposed.serviceType || "?"}`
                            : item.entity_type === "invoice"
                              ? `Invoice: ${proposed.invoiceNumber || "?"}`
                              : `${proposed.firstName || ""} ${proposed.lastName || ""}`.trim() || "—"}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${ISSUE_COLORS[item.issue_type] ?? "bg-slate-100 text-slate-600"}`}>
                      {ISSUE_LABELS[item.issue_type] ?? item.issue_type}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium capitalize">
                      {item.entity_type}
                    </span>
                    {(() => {
                      const conf = getItemConfidence(item, proposed);
                      return (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold border ${CONFIDENCE_COLORS[conf]}`}>
                          {conf}
                        </span>
                      );
                    })()}
                  </div>
                  {item.issue_type === "new_record" && proposed._softMatch && (
                    <p className="text-xs text-amber-700 mt-1 flex items-start gap-1.5">
                      <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                      <span>
                        <span className="font-semibold">Possible existing match</span>
                        {" — "}
                        {proposed._softMatch.firstName} {proposed._softMatch.lastName}
                        {proposed._softMatch.billingAddress ? ` · ${proposed._softMatch.billingAddress}` : ""}
                        {proposed._softMatch.billingCity ? `, ${proposed._softMatch.billingCity}` : ""}
                        <span className="text-amber-500 ml-1">({proposed._softMatch.reason})</span>
                      </span>
                    </p>
                  )}
                  {item.action !== "pending" && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      Decision:{" "}
                      <span className={`font-semibold ${
                        item.action === "merge"           ? "text-indigo-600" :
                        item.action === "accept_import"   ? "text-emerald-600" :
                        item.action === "replace_billing" ? "text-sky-600" :
                        item.action === "keep_existing"   ? "text-slate-600" :
                        item.action === "ignore"          ? "text-slate-400" : "text-slate-600"
                      }`}>
                        {((): string => {
                          const labelMap: Record<string, string> = {
                            merge:           item.issue_type === "household_match" ? "✦ Merge into Existing Account" : "✦ Merge (fill blanks + append notes)",
                            accept_import:   item.issue_type === "new_record" ? "Create New Customer" : item.issue_type === "new_owner_at_property" ? "Create New Account + Link to Property" : item.issue_type === "household_match" ? "Replace with Import" : "Replace All with Import",
                            keep_existing:   item.issue_type === "new_property_detected" ? "Keep Existing" : item.issue_type === "new_owner_at_property" ? "Keep Prior Owner (Skip)" : item.issue_type === "duplicate_job" ? "Keep Hidden" : "Keep Existing Only",
                            replace_billing: "Replace Existing Address",
                            ignore:          "Skip",
                          };
                          return labelMap[item.action] ?? item.action;
                        })()}
                      </span>
                    </p>
                  )}
                </div>

                {/* Intent-based action buttons */}
                <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                  <ConflictActionButtons item={item} proposed={proposed} actionMut={actionMut} />
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
                    title={isExpanded ? "Collapse" : "Expand details"}
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-slate-100 px-4 py-3 bg-white">
                  {/* Household / account match: context panel */}
                  {item.issue_type === "household_match" && proposed._householdSignal && (
                    <div className="mb-4 bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 space-y-2.5">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-violet-600 shrink-0" />
                        <p className="text-xs font-bold text-violet-900">Likely same account / household match</p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="bg-white rounded-lg px-3 py-2.5 border border-violet-100">
                          <p className="text-[10px] font-bold text-violet-500 mb-1 uppercase tracking-wide">CRM Account</p>
                          <p className="font-semibold text-slate-800 text-sm">{proposed._householdSignal.existingName || <span className="text-slate-400 italic">—</span>}</p>
                          {proposed._householdSignal.matchedEmail && (
                            <p className="text-slate-500 mt-0.5">{proposed._householdSignal.matchedEmail}</p>
                          )}
                        </div>
                        <div className="bg-violet-100 rounded-lg px-3 py-2.5 border border-violet-200">
                          <p className="text-[10px] font-bold text-violet-500 mb-1 uppercase tracking-wide">Imported Name</p>
                          <p className="font-semibold text-violet-900 text-sm">{proposed._householdSignal.importedName || <span className="text-slate-400 italic">—</span>}</p>
                          <p className="text-violet-600 mt-0.5">matched via {proposed._householdSignal.matchMethod}</p>
                        </div>
                      </div>
                      <div className="text-[11px] text-violet-800 space-y-1 bg-violet-100/60 rounded-lg px-3 py-2.5 border border-violet-200/50">
                        <p className="font-semibold text-violet-900">Imported name appears to be an additional person or contact for this account.</p>
                        <p>• <strong>Merge into Existing Account</strong> — fills blank CRM fields (phone, notes, etc.) and appends notes. The existing account name and billing address are <em>never</em> overwritten.</p>
                        <p>• If the imported record has a different address, it will appear as a separate <em>New Property</em> item linked to this account.</p>
                        <p>• <strong>Replace with Import</strong> — only use this if the imported name is actually the correct primary name for this account.</p>
                      </div>
                    </div>
                  )}

                  {/* New-property-detected: dedicated side-by-side address comparison */}
                  {item.issue_type === "new_property_detected" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs mb-4">
                      <div className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                        <p className="font-semibold text-slate-600 mb-2">Existing Billing Address</p>
                        <div className="space-y-0.5 font-mono text-slate-700">
                          <div>{proposed.existingBillingAddress || <span className="text-slate-400 italic">none</span>}</div>
                          {proposed.existingBillingCity && <div>{proposed.existingBillingCity}{proposed.existingBillingState ? `, ${proposed.existingBillingState}` : ""} {proposed.existingBillingZip}</div>}
                        </div>
                      </div>
                      <div className="bg-teal-50 rounded-lg px-3 py-2 border border-teal-200">
                        <p className="font-semibold text-teal-700 mb-2">Detected in Import</p>
                        <div className="space-y-0.5 font-mono text-teal-900">
                          <div>{proposed.address}</div>
                          {proposed.city && <div>{proposed.city}{proposed.state ? `, ${proposed.state}` : ""} {proposed.zip}</div>}
                        </div>
                      </div>
                      <div className="md:col-span-2 text-[11px] text-slate-500 bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                        <span className="font-semibold text-slate-600">Add Property</span> creates a new service location for this customer without touching their billing address.{" "}
                        <span className="font-semibold text-slate-600">Replace Billing</span> updates the customer's billing address to this value (use only if the import has the correct address).
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    {current && (
                      <div>
                        <p className="font-semibold text-slate-600 mb-2">Current CRM Data</p>
                        <div className="space-y-1 font-mono">
                          {Object.entries(current).filter(([k]) => !["id","created_at","updated_at"].includes(k) && current[k]).slice(0, 12).map(([k, v]) => (
                            <div key={k} className={`flex gap-2 ${conflicts.includes(k) ? "bg-amber-50 rounded px-1" : ""}`}>
                              <span className="text-slate-400 w-32 shrink-0">{k}:</span>
                              <span className="text-slate-700 truncate">{String(v)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <p className="font-semibold text-slate-600 mb-2">{current ? "Proposed Import Data" : "New Record Data"}</p>
                      <div className="space-y-1 font-mono">
                        {Object.entries(proposed)
                          .filter(([k, v]) => v && k !== "_softMatch")
                          .slice(0, 12).map(([k, v]) => (
                            <div key={k} className={`flex gap-2 ${conflicts.includes(k) ? "bg-amber-50 rounded px-1" : ""}`}>
                              <span className="text-slate-400 w-32 shrink-0">{k}:</span>
                              <span className="text-slate-700 truncate">{String(v)}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  </div>

                  {/* Soft duplicate warning panel */}
                  {item.issue_type === "new_record" && proposed._softMatch && (
                    <div className="mt-3 pt-3 border-t border-amber-100 bg-amber-50 rounded-lg px-3 py-2">
                      <p className="text-xs font-semibold text-amber-800 mb-1.5 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Possible existing customer found ({proposed._softMatch.reason})
                      </p>
                      <div className="text-xs text-amber-900 space-y-0.5 font-mono">
                        {proposed._softMatch.firstName || proposed._softMatch.lastName
                          ? <div><span className="text-amber-600 w-20 inline-block">Name:</span> {proposed._softMatch.firstName} {proposed._softMatch.lastName}</div>
                          : null}
                        {proposed._softMatch.companyName
                          ? <div><span className="text-amber-600 w-20 inline-block">Company:</span> {proposed._softMatch.companyName}</div>
                          : null}
                        {proposed._softMatch.billingAddress
                          ? <div><span className="text-amber-600 w-20 inline-block">Address:</span> {proposed._softMatch.billingAddress}{proposed._softMatch.billingCity ? `, ${proposed._softMatch.billingCity}` : ""}</div>
                          : null}
                        {proposed._softMatch.email
                          ? <div><span className="text-amber-600 w-20 inline-block">Email:</span> {proposed._softMatch.email}</div>
                          : null}
                        {proposed._softMatch.homePhone
                          ? <div><span className="text-amber-600 w-20 inline-block">Phone:</span> {proposed._softMatch.homePhone}</div>
                          : null}
                      </div>
                      <p className="text-[10px] text-amber-600 mt-1.5">
                        Possible existing match detected. Use <strong>Use Existing + Merge</strong> to combine records, <strong>Create New Instead</strong> if this is truly a different person, or <strong>Skip</strong> if already in CRM.
                      </p>
                    </div>
                  )}

                  {/* Merge preview — shown for conflicts or when merge action is selected */}
                  {(item.issue_type === "field_conflict" || item.issue_type === "household_match" || item.action === "merge") && current && (
                    <MergePreview current={current} proposed={proposed} conflicts={conflicts} />
                  )}

                  {conflicts.length > 0 && item.issue_type !== "field_conflict" && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <p className="text-xs font-semibold text-amber-700">Conflicting fields: {conflicts.join(", ")}</p>
                    </div>
                  )}
                  {item.staging_matched_id && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <button
                        onClick={() => navigate(`/customers/${item.staging_matched_id}`)}
                        className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        View Customer Record
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination (flat mode) */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 justify-center pt-2">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1 border border-slate-200 rounded-lg text-sm disabled:opacity-40 hover:bg-slate-50">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm text-slate-600">Page {page} of {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1 border border-slate-200 rounded-lg text-sm disabled:opacity-40 hover:bg-slate-50">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
      </>
      )}
    </div>
  );
}

// ─── Apply step ───────────────────────────────────────────────────────────────

function ApplyStep({ batch, batchDetail, onRefresh }: { batch: any; batchDetail: any; onRefresh: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [rollbackConfirm, setRollbackConfirm] = useState(false);
  // Frozen snapshot of staging counts taken the moment Apply is confirmed.
  // We never let live polling update the staging summary once apply has started.
  const [frozenSnapshot, setFrozenSnapshot] = useState<{
    stagingCounts: any;
    totalToApply: number;
    autoApproved: number;
    autoMergedHousehold: number;
    autoMergedExact: number;
    autoCreatedCustomer: number;
    autoAddedProperty: number;
    accepted: number;
    merged: number;
  } | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const pendingCount = batchDetail?.reviewCounts?.pending ?? 0;
  const autoApproved         = batchDetail?.stagingCounts?.auto_approved          ?? 0;
  const autoMergedHousehold  = Number(batchDetail?.stagingCounts?.auto_merged_household  ?? 0);
  const autoMergedExact      = Number(batchDetail?.stagingCounts?.auto_merged_exact      ?? 0);
  const autoCreatedCustomer  = Number(batchDetail?.stagingCounts?.auto_created_customer  ?? 0);
  const autoAddedProperty    = Number(batchDetail?.stagingCounts?.auto_added_property    ?? 0);
  const totalAutoMerged      = autoMergedHousehold + autoMergedExact;
  const accepted = batchDetail?.reviewCounts?.accept_import ?? 0;
  const merged   = batchDetail?.reviewCounts?.merge ?? 0;
  const totalToApply = autoApproved + accepted + merged;
  const uniqueCustomers = Number(batchDetail?.applyPreview?.uniqueCustomers ?? 0);
  const jobsToCreate    = Number(batchDetail?.applyPreview?.jobsToCreate ?? 0);
  const isApplied = batch.status === "applied";
  const isRolledBack = batch.status === "rolled_back";

  // Use frozen snapshot for display if one has been captured
  const displaySnapshot = frozenSnapshot ?? {
    stagingCounts: batchDetail?.stagingCounts,
    totalToApply, autoApproved, autoMergedHousehold, autoMergedExact,
    autoCreatedCustomer, autoAddedProperty, accepted, merged,
  };

  const applyMut = useMutation({
    mutationFn: () => apiFetch(`/api/admin/import/batches/${batch.id}/apply`, { method: "POST" }),
    onSuccess: (data) => {
      setResult(data);
      setConfirming(false);
      const parts = [];
      if (data.customersCreated) parts.push(`${data.customersCreated} customers created`);
      if (data.customersUpdated) parts.push(`${data.customersUpdated} merged`);
      if (data.jobsCreated) parts.push(`${data.jobsCreated} jobs`);
      toast({ title: "Batch applied successfully", description: parts.length ? parts.join(", ") : `${data.applied} records written` });
      qc.invalidateQueries({ queryKey: ["import-batch", batch.id] });
      qc.invalidateQueries({ queryKey: ["import-batches"] });
      onRefresh();
    },
    onError: (err: Error) => {
      toast({ title: "Apply failed", description: err.message, variant: "destructive" });
      setConfirming(false);
    },
  });

  function captureAndApply() {
    // Freeze staging counts the instant Apply is confirmed — prevents live polling
    // from making the staging summary change while records are being written
    setFrozenSnapshot({
      stagingCounts: batchDetail?.stagingCounts,
      totalToApply, autoApproved, autoMergedHousehold, autoMergedExact,
      autoCreatedCustomer, autoAddedProperty, accepted, merged,
    });
    applyMut.mutate();
  }

  const rollbackMut = useMutation({
    mutationFn: () => apiFetch(`/api/admin/import/batches/${batch.id}/rollback`, { method: "POST" }),
    onSuccess: (data) => {
      setRollbackConfirm(false);
      toast({ title: "Rollback complete", description: `${data.reverted} changes reverted.` });
      qc.invalidateQueries({ queryKey: ["import-batch", batch.id] });
      qc.invalidateQueries({ queryKey: ["import-batches"] });
      onRefresh();
    },
    onError: (err: Error) => {
      toast({ title: "Rollback failed", description: err.message, variant: "destructive" });
      setRollbackConfirm(false);
    },
  });

  if (isRolledBack) {
    return (
      <div className="space-y-4 text-center py-8">
        <RotateCcw className="w-10 h-10 text-slate-400 mx-auto" />
        <div>
          <p className="text-lg font-bold text-slate-700">Batch Rolled Back</p>
          <p className="text-sm text-slate-500 mt-1">All changes from this batch have been undone. The data is back to its pre-import state.</p>
        </div>
        <p className="text-xs text-slate-400">You can re-upload and re-apply the files if needed.</p>
      </div>
    );
  }

  if (isApplied) {
    const appliedCount = result?.applied ?? batch.applied_count ?? displaySnapshot.totalToApply;
    const applyErrors  = result?.errors ?? [];
    const custCreated  = result?.customersCreated ?? 0;
    const custUpdated  = result?.customersUpdated ?? 0;
    const jobsCr       = result?.jobsCreated ?? 0;
    const dedupSkipped = result?.skippedDuplicateCustomers ?? 0;
    return (
      <div className="space-y-5">
        {/* ── Staging analysis (static — the pre-import picture) ── */}
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Staging Analysis</p>
          <StagingSummary batchDetail={{ ...batchDetail, stagingCounts: displaySnapshot.stagingCounts }} />
        </div>

        {/* ── Apply result (separate from staging metrics) ── */}
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Apply Result</p>
          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 shrink-0" />
              <div>
                <p className="text-base font-bold text-emerald-800">Batch Applied Successfully</p>
                {batch.applied_at && (
                  <p className="text-xs text-emerald-500 mt-0.5">
                    Applied {new Date(batch.applied_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </p>
                )}
              </div>
            </div>
            <div className={`grid gap-2 pt-1 ${(custCreated || custUpdated || jobsCr) ? "grid-cols-4" : "grid-cols-2"}`}>
              {(custCreated > 0 || !result) && (
                <div className="bg-white rounded-xl border border-emerald-100 p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-700">{result ? custCreated.toLocaleString() : appliedCount.toLocaleString()}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{result ? "Customers created" : "Records written"}</p>
                </div>
              )}
              {custUpdated > 0 && (
                <div className="bg-white rounded-xl border border-indigo-100 p-3 text-center">
                  <p className="text-2xl font-bold text-indigo-600">{custUpdated.toLocaleString()}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Customers merged</p>
                </div>
              )}
              {jobsCr > 0 && (
                <div className="bg-white rounded-xl border border-emerald-100 p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-600">{jobsCr.toLocaleString()}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Jobs created</p>
                </div>
              )}
              {dedupSkipped > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-3 text-center">
                  <p className="text-2xl font-bold text-slate-400">{dedupSkipped.toLocaleString()}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Dedup skipped</p>
                </div>
              )}
              <div className={`rounded-xl border p-3 text-center ${applyErrors.length > 0 ? "bg-amber-50 border-amber-200" : "bg-white border-emerald-100"}`}>
                <p className={`text-2xl font-bold ${applyErrors.length > 0 ? "text-amber-600" : "text-slate-400"}`}>{applyErrors.length}</p>
                <p className="text-xs text-slate-500 mt-0.5">Apply errors</p>
              </div>
            </div>
            {applyErrors.length > 0 && (
              <div className="bg-white border border-amber-200 rounded-xl p-3">
                <p className="text-xs font-semibold text-amber-800 mb-1.5">{applyErrors.length} error{applyErrors.length !== 1 ? "s" : ""} during apply</p>
                <ul className="text-xs text-amber-700 space-y-0.5 font-mono">
                  {applyErrors.slice(0, 10).map((e: string, i: number) => <li key={i}>{e}</li>)}
                  {applyErrors.length > 10 && <li className="text-amber-500">…and {applyErrors.length - 10} more</li>}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Rollback section */}
        <div className="border border-red-200 rounded-xl p-4 bg-red-50">
          <div className="flex items-start gap-3">
            <RotateCcw className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-red-800">Rollback This Batch</p>
              <p className="text-xs text-red-600 mt-0.5">
                This will undo every change made by this import — deletions, updates, and new records.
                Use this only if you made a mistake. This cannot be undone after rollback.
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            {!rollbackConfirm ? (
              <button
                onClick={() => setRollbackConfirm(true)}
                className="px-4 py-2 text-sm font-semibold bg-white border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
              >
                Rollback Batch
              </button>
            ) : (
              <>
                <button
                  onClick={() => rollbackMut.mutate()}
                  disabled={rollbackMut.isPending}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  {rollbackMut.isPending
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Rolling back…</>
                    : "Yes, Rollback Everything"}
                </button>
                <button
                  onClick={() => setRollbackConfirm(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Snapshot values to use in the pre-apply breakdown (frozen once apply starts)
  const ds = displaySnapshot;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-slate-800">Apply Batch</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Review the staging analysis below, then apply to write changes to the live database.
        </p>
      </div>

      {/* ── Staging summary — frozen once Apply starts, never changes during apply ── */}
      <div>
        {(applyMut.isPending || frozenSnapshot) && (
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
            Staging Analysis <span className="normal-case font-normal text-slate-400">(frozen at apply start)</span>
          </p>
        )}
        <StagingSummary batchDetail={{ ...batchDetail, stagingCounts: ds.stagingCounts }} />
      </div>

      {/* ── Apply progress — only shown while applying ── */}
      {applyMut.isPending && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin shrink-0" />
            <div>
              <p className="text-sm font-bold text-blue-800">
                Applying {uniqueCustomers.toLocaleString()} customers + {jobsToCreate.toLocaleString()} jobs…
              </p>
              <p className="text-xs text-blue-600 mt-0.5">Writing to the live database. Do not close this page.</p>
            </div>
          </div>
          <div className="h-2 bg-blue-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-400 rounded-full animate-pulse" style={{ width: "100%" }} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="bg-white rounded-lg border border-blue-100 p-2">
              <p className="font-bold text-blue-700 text-base">{ds.totalToApply.toLocaleString()}</p>
              <p className="text-slate-500">Total to apply</p>
            </div>
            <div className="bg-white rounded-lg border border-blue-100 p-2">
              <p className="font-bold text-slate-400 text-base">—</p>
              <p className="text-slate-500">Applied so far</p>
            </div>
            <div className="bg-white rounded-lg border border-blue-100 p-2">
              <p className="font-bold text-slate-400 text-base">—</p>
              <p className="text-slate-500">Remaining</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Pre-apply section — only shown while NOT applying ── */}
      {!applyMut.isPending && (
        <>
          {pendingCount > 0 && (
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  {pendingCount} review item{pendingCount !== 1 ? "s" : ""} still pending
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Go to the Review step and action all pending items before applying.
                </p>
              </div>
            </div>
          )}

          {pendingCount === 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-600">Auto-approved (no conflicts):</span><span className="font-semibold">{ds.autoApproved.toLocaleString()}</span></div>
              {ds.autoCreatedCustomer > 0 && (
                <div className="flex justify-between pl-4 text-xs">
                  <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Auto-created new customers:</span>
                  <span className="text-emerald-700 font-medium">{ds.autoCreatedCustomer.toLocaleString()}</span>
                </div>
              )}
              {ds.autoAddedProperty > 0 && (
                <div className="flex justify-between pl-4 text-xs">
                  <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Auto-added service properties:</span>
                  <span className="text-emerald-700 font-medium">{ds.autoAddedProperty.toLocaleString()}</span>
                </div>
              )}
              {(ds.autoMergedExact + ds.autoMergedHousehold) > 0 && (
                <div className="flex justify-between pl-4 text-xs">
                  <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Auto-merged (exact match):</span>
                  <span className="text-emerald-700 font-medium">{(ds.autoMergedExact + ds.autoMergedHousehold).toLocaleString()}</span>
                </div>
              )}
              {ds.autoMergedExact > 0 && (
                <div className="flex justify-between pl-8 text-xs">
                  <span className="text-slate-500">Email / phone matched:</span>
                  <span className="text-slate-600">{ds.autoMergedExact.toLocaleString()}</span>
                </div>
              )}
              {ds.autoMergedHousehold > 0 && (
                <div className="flex justify-between pl-8 text-xs">
                  <span className="text-slate-500">Household / spouse pattern:</span>
                  <span className="text-slate-600">{ds.autoMergedHousehold.toLocaleString()}</span>
                </div>
              )}
              {ds.merged > 0 && <div className="flex justify-between"><span className="text-indigo-600">✦ Merge (fill blanks + append notes):</span><span className="font-semibold text-indigo-700">{ds.merged.toLocaleString()}</span></div>}
              {ds.accepted > 0 && <div className="flex justify-between"><span className="text-emerald-600">Create / Replace all:</span><span className="font-semibold text-emerald-700">{ds.accepted.toLocaleString()}</span></div>}
              <div className="flex justify-between border-t border-slate-200 pt-2"><span className="font-semibold text-slate-800">Total to apply:</span><span className="font-bold text-primary">{uniqueCustomers.toLocaleString()} customers + {jobsToCreate.toLocaleString()} jobs</span></div>
            </div>
          )}

          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              disabled={pendingCount > 0 || totalToApply === 0}
              className="flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <Play className="w-4 h-4" /> Apply Batch to Database
            </button>
          ) : (
            <div className="border border-primary/20 bg-primary/5 rounded-xl p-4 space-y-3">
              <p className="text-sm font-semibold text-slate-800">
                Are you sure? This will create <strong>{uniqueCustomers.toLocaleString()} customers</strong> and <strong>{jobsToCreate.toLocaleString()} jobs</strong> in the live database.
              </p>
              <p className="text-xs text-slate-500">
                You can rollback the batch after applying if something looks wrong.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={captureAndApply}
                  className="flex items-center gap-2 px-5 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
                >
                  <Check className="w-4 h-4" /> Yes, Apply Now
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Batch detail panel ───────────────────────────────────────────────────────

function BatchDetail({
  batchId, onBack,
}: { batchId: number; onBack: () => void }) {
  const [activeStep, setActiveStep] = useState(1);
  const qc = useQueryClient();

  const batchDetailQuery = useQuery<any>({
    queryKey: ["import-batch", batchId],
    queryFn: () => apiFetch(`/api/admin/import/batches/${batchId}`),
    refetchInterval: 3000,
  });

  const batch = batchDetailQuery.data?.batch;
  const batchDetail = batchDetailQuery.data;
  const isProcessing: boolean = batchDetail?.isProcessing ?? false;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["import-batch", batchId] });
    qc.invalidateQueries({ queryKey: ["import-batches"] });
  };

  const deleteMut = useMutation({
    mutationFn: () => apiFetch(`/api/admin/import/batches/${batchId}`, { method: "DELETE" }),
    onSuccess: () => onBack(),
  });

  const resetMut = useMutation({
    mutationFn: () => apiFetch(`/api/admin/import/batches/${batchId}/reset-staging`, { method: "POST" }),
    onSuccess: () => { refresh(); setActiveStep(1); },
  });

  // Navigate to correct step based on batch state
  useEffect(() => {
    if (!batch) return;
    if (batch.status === "applied" || batch.status === "rolled_back") setActiveStep(3);
    else if (batch.status === "review" || (batch.staged_rows > 0 && batch.review_count > 0)) setActiveStep(2);
    else if (batch.staged_rows > 0) setActiveStep(2);
  }, [batch?.status]);

  // Auto-advance to Review tab when background processing finishes
  const prevIsProcessing = useRef(false);
  useEffect(() => {
    if (prevIsProcessing.current && !isProcessing && batchDetail?.stagingCounts?.total_staged > 0) {
      setActiveStep(2);
    }
    prevIsProcessing.current = isProcessing;
  }, [isProcessing]);

  if (batchDetailQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-slate-400 py-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading batch…</div>
    );
  }
  if (!batch) return <div className="text-red-500 text-sm">Batch not found.</div>;

  const stepIdx = { 1: 1, 2: 2, 3: 3 }[activeStep] ?? 1;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> All Batches
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-bold text-slate-900 text-base truncate">{batch.name}</h1>
            <BatchBadge status={batch.status} />
          </div>
        </div>
        {!["applied", "applying", "rolling_back"].includes(batch.status) && (
          <>
            {batch.staged_rows > 0 && (
              <button
                onClick={() => {
                  if (window.confirm("Clear all staging data and re-upload files to reprocess with current rules?")) {
                    resetMut.mutate();
                  }
                }}
                disabled={resetMut.isPending}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors"
                title="Clear staging data and re-stage files"
              >
                <RefreshCw className={`w-3 h-3 ${resetMut.isPending ? "animate-spin" : ""}`} />
                Re-stage
              </button>
            )}
            <button
              onClick={() => deleteMut.mutate()}
              disabled={deleteMut.isPending}
              className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
              title="Delete batch"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
        <button onClick={refresh} className="p-1.5 text-slate-400 hover:text-slate-600 transition-colors" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Step tabs */}
      <div className="flex border-b border-slate-200 gap-1">
        {[
          { step: 1, label: "Upload", icon: Upload, blockedWhileProcessing: false },
          { step: 2, label: "Review", icon: Eye,    blockedWhileProcessing: true  },
          { step: 3, label: "Apply",  icon: Play,   blockedWhileProcessing: true  },
        ].map(({ step, label, icon: Icon, blockedWhileProcessing }) => {
          const blocked = blockedWhileProcessing && isProcessing;
          return (
            <button
              key={step}
              onClick={() => !blocked && setActiveStep(step)}
              disabled={blocked}
              title={blocked ? "Staging is still running — please wait" : undefined}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
                ${blocked
                  ? "border-transparent text-slate-300 cursor-not-allowed"
                  : activeStep === step
                    ? "border-primary text-primary"
                    : "border-transparent text-slate-500 hover:text-slate-700"}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Processing banner — shown while background staging is running */}
      {isProcessing && (
        <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl">
          <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-blue-800">Staging in progress</p>
            <p className="text-xs text-blue-600 mt-0.5">
              Matching and reviewing records in the background. You can navigate anywhere — this
              page will update automatically when processing finishes.
            </p>
          </div>
        </div>
      )}

      {/* Batch files list (always shown) */}
      {batchDetail?.files?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {batchDetail.files.map((f: any) => {
            const inFlight = f.status === "queued" || f.status === "processing";
            const hasError  = f.status === "error";
            return (
              <span
                key={f.id}
                className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-lg border
                  ${hasError
                    ? "bg-red-50 text-red-700 border-red-200"
                    : FILE_GROUP_COLORS[f.file_group as FileGroup] ?? FILE_GROUP_COLORS.unknown}`}
              >
                {inFlight
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : hasError
                    ? <AlertTriangle className="w-3 h-3" />
                    : <FileSpreadsheet className="w-3 h-3" />}
                {f.original_name}
                {" — "}
                {inFlight
                  ? <span className="italic">{f.status === "queued" ? "queued…" : "staging…"}</span>
                  : hasError
                    ? <span className="text-red-500">error</span>
                    : f.raw_row_count > 0 && f.raw_row_count !== f.row_count
                      ? <>{f.raw_row_count.toLocaleString()} rows → {f.row_count.toLocaleString()} unique</>
                      : <>{(f.raw_row_count || f.row_count || 0).toLocaleString()} rows</>}
                {!inFlight && !hasError && f.skipped_rows > 0 && (
                  <span className="text-slate-400 ml-0.5">({f.skipped_rows.toLocaleString()} history dupes collapsed)</span>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Active step content */}
      <div className="pt-2">
        {activeStep === 1 && <UploadStep batch={batch} onRefresh={refresh} />}
        {activeStep === 2 && <ReviewStep batch={batch} batchDetail={batchDetail} onRefresh={refresh} isProcessing={isProcessing} />}
        {activeStep === 3 && <ApplyStep batch={batch} batchDetail={batchDetail} onRefresh={refresh} />}
      </div>
    </div>
  );
}

// ─── Debug Trace Panel ───────────────────────────────────────────────────────

function DebugTracePanel() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  const traceQuery = useQuery({
    queryKey: ["debug-trace", query],
    queryFn: () => apiFetch(`/api/admin/import/debug-trace?q=${encodeURIComponent(query)}`),
    enabled: !!query,
  });

  const data = traceQuery.data as any;
  const summary = data?.summary;

  const phaseColor: Record<string, string> = {
    staging: "bg-blue-100 text-blue-700",
    review: "bg-amber-100 text-amber-700",
    applied: "bg-emerald-100 text-emerald-700",
  };

  const statusColor: Record<string, string> = {
    pending: "bg-slate-100 text-slate-600",
    auto_approved: "bg-emerald-100 text-emerald-600",
    review: "bg-amber-100 text-amber-600",
    applied: "bg-emerald-100 text-emerald-600",
    error: "bg-red-100 text-red-600",
    ignored: "bg-slate-200 text-slate-500",
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => { e.preventDefault(); if (input.trim()) setQuery(input.trim()); }}
        className="flex items-center gap-2"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='Enter CF ID (e.g. 3050) or customer name (e.g. "Casey Campbell")'
            className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
        </div>
        <button
          type="submit"
          disabled={!input.trim() || traceQuery.isFetching}
          className="px-4 py-2.5 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 shrink-0"
        >
          {traceQuery.isFetching ? "Tracing..." : "Trace"}
        </button>
        {query && (
          <button
            type="button"
            onClick={() => { setInput(""); setQuery(""); }}
            className="px-3 py-2.5 text-sm text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 shrink-0"
          >
            Clear
          </button>
        )}
      </form>

      {traceQuery.isError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          Error: {(traceQuery.error as any)?.message ?? "Failed to trace"}
        </div>
      )}

      {summary && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className={`rounded-lg p-3 border ${summary.parsedFromCSV ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
              <p className="text-[11px] font-semibold text-slate-500 uppercase">Parsed from CSV?</p>
              <p className={`text-lg font-bold ${summary.parsedFromCSV ? "text-emerald-700" : "text-red-600"}`}>
                {summary.parsedFromCSV ? `Yes (${summary.stagedCount})` : "No"}
              </p>
            </div>
            <div className={`rounded-lg p-3 border ${summary.sentToReview ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-200"}`}>
              <p className="text-[11px] font-semibold text-slate-500 uppercase">Sent to review?</p>
              <p className={`text-lg font-bold ${summary.sentToReview ? "text-amber-700" : "text-slate-500"}`}>
                {summary.sentToReview ? `Yes (${summary.reviewCount})` : "No"}
              </p>
            </div>
            <div className={`rounded-lg p-3 border ${summary.appliedCount > 0 ? "bg-emerald-50 border-emerald-200" : "bg-slate-50 border-slate-200"}`}>
              <p className="text-[11px] font-semibold text-slate-500 uppercase">Applied to CRM?</p>
              <p className={`text-lg font-bold ${summary.appliedCount > 0 ? "text-emerald-700" : "text-slate-500"}`}>
                {summary.appliedCount > 0 ? `Yes (${summary.appliedCount})` : "No"}
              </p>
            </div>
            <div className={`rounded-lg p-3 border ${summary.crmMatchCount > 0 ? "bg-blue-50 border-blue-200" : "bg-slate-50 border-slate-200"}`}>
              <p className="text-[11px] font-semibold text-slate-500 uppercase">CRM records</p>
              <p className={`text-lg font-bold ${summary.crmMatchCount > 0 ? "text-blue-700" : "text-slate-500"}`}>
                {summary.crmMatchCount}
              </p>
            </div>
          </div>

          {/* Detail badges */}
          <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
            {summary.files?.length > 0 && (
              <div className="flex items-start gap-2 text-xs">
                <span className="text-slate-500 font-semibold w-20 shrink-0 pt-0.5">Files:</span>
                <div className="flex flex-wrap gap-1">{summary.files.map((f: string) => <span key={f} className="bg-slate-100 px-2 py-0.5 rounded-full text-slate-700">{f}</span>)}</div>
              </div>
            )}
            {summary.batches?.length > 0 && (
              <div className="flex items-start gap-2 text-xs">
                <span className="text-slate-500 font-semibold w-20 shrink-0 pt-0.5">Batches:</span>
                <div className="flex flex-wrap gap-1">{summary.batches.map((b: string) => <span key={b} className="bg-slate-100 px-2 py-0.5 rounded-full text-slate-700">{b}</span>)}</div>
              </div>
            )}
            {summary.stagingStatuses?.length > 0 && (
              <div className="flex items-start gap-2 text-xs">
                <span className="text-slate-500 font-semibold w-20 shrink-0 pt-0.5">Staging:</span>
                <div className="flex flex-wrap gap-1">{summary.stagingStatuses.map((s: string) => <span key={s} className={`px-2 py-0.5 rounded-full font-semibold ${statusColor[s] ?? "bg-slate-100 text-slate-600"}`}>{s}</span>)}</div>
              </div>
            )}
            {summary.reviewIssueTypes?.length > 0 && (
              <div className="flex items-start gap-2 text-xs">
                <span className="text-slate-500 font-semibold w-20 shrink-0 pt-0.5">Issues:</span>
                <div className="flex flex-wrap gap-1">{summary.reviewIssueTypes.map((t: string) => <span key={t} className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">{t}</span>)}</div>
              </div>
            )}
            {summary.reviewActions?.length > 0 && (
              <div className="flex items-start gap-2 text-xs">
                <span className="text-slate-500 font-semibold w-20 shrink-0 pt-0.5">Decisions:</span>
                <div className="flex flex-wrap gap-1">{summary.reviewActions.map((a: string) => <span key={a} className="bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">{a}</span>)}</div>
              </div>
            )}
          </div>

          {/* CRM matches */}
          {data.crmMatches?.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-slate-700 mb-2">CRM Customer Records</h4>
              <div className="space-y-2">
                {data.crmMatches.map((c: any) => (
                  <div key={c.id} className="bg-white border border-slate-200 rounded-lg p-3 text-xs space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-800 text-sm">#{c.id} — {c.name}</span>
                      {c.importExternalId && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">CF #{c.importExternalId}</span>}
                      <span className={`px-2 py-0.5 rounded-full font-semibold ${c.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{c.status}</span>
                      {c.isImported && <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-semibold">Imported</span>}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-slate-500">
                      {c.email && <span>Email: {c.email}</span>}
                      {c.phone && <span>Phone: {c.phone}</span>}
                      {c.cellPhone && <span>Cell: {c.cellPhone}</span>}
                      {c.workPhone && <span>Work: {c.workPhone}</span>}
                      {c.billingAddress && <span>Addr: {c.billingAddress}, {c.billingCity}</span>}
                      {c.companyName && <span>Co: {c.companyName}</span>}
                    </div>
                    {c.importBatchId && <div className="text-slate-400">Import batch: #{c.importBatchId} &nbsp;·&nbsp; Source: {c.importSource ?? "—"}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline */}
          {data.timeline?.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-slate-700 mb-2">Pipeline Timeline ({data.timeline.length} events)</h4>
              <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                {data.timeline.map((ev: any, i: number) => (
                  <div key={i} className="bg-white border border-slate-200 rounded-lg p-3 text-xs space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-full font-bold uppercase text-[10px] ${phaseColor[ev.phase] ?? "bg-slate-100 text-slate-600"}`}>{ev.phase}</span>
                      <span className="text-slate-400 text-[10px]">Batch #{ev.batchId} — {ev.batchName}</span>
                      {ev.externalId && <span className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded text-[10px] font-mono">CF #{ev.externalId}</span>}
                      {ev.fileName && <span className="text-slate-400 text-[10px]">{ev.fileName}</span>}
                    </div>

                    {ev.phase === "staging" && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`px-2 py-0.5 rounded-full font-semibold ${statusColor[ev.status] ?? "bg-slate-100 text-slate-600"}`}>Status: {ev.status}</span>
                          {ev.matchMethod && <span className="text-slate-500">Match: {ev.matchMethod}</span>}
                          {ev.matchedEntityId && <span className="text-slate-500">→ Customer #{ev.matchedEntityId}</span>}
                          {ev.hasParseError && <span className="text-red-500 font-semibold">PARSE ERROR</span>}
                        </div>
                        {ev.errorMessage && <div className="text-red-600 bg-red-50 rounded p-1.5">{ev.errorMessage}</div>}
                        {ev.normalizedData && (
                          <details className="text-slate-500">
                            <summary className="cursor-pointer hover:text-slate-700 font-semibold">Normalized data</summary>
                            <pre className="mt-1 bg-slate-50 rounded p-2 overflow-x-auto text-[10px] max-h-48">{JSON.stringify(ev.normalizedData, null, 2)}</pre>
                          </details>
                        )}
                      </div>
                    )}

                    {ev.phase === "review" && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">{ev.issueType}</span>
                          <span className={`px-2 py-0.5 rounded-full font-semibold ${ev.action === "pending" ? "bg-slate-100 text-slate-600" : "bg-primary/10 text-primary"}`}>Action: {ev.action}</span>
                          {ev.matchMethod && <span className="text-slate-500">Match: {ev.matchMethod}</span>}
                          {ev.stagingMatchedId && <span className="text-slate-500">→ Customer #{ev.stagingMatchedId}</span>}
                          {ev.reviewedBy && <span className="text-slate-400">by {ev.reviewedBy}</span>}
                        </div>
                        {ev.conflictFields && (
                          <div className="text-slate-500">Conflicts: {Array.isArray(ev.conflictFields) ? ev.conflictFields.join(", ") : String(ev.conflictFields)}</div>
                        )}
                        {ev.notes && <div className="text-slate-500 italic">Note: {ev.notes}</div>}
                        <div className="grid grid-cols-2 gap-2">
                          {ev.proposedData && (
                            <details className="text-slate-500">
                              <summary className="cursor-pointer hover:text-slate-700 font-semibold">Proposed data</summary>
                              <pre className="mt-1 bg-blue-50 rounded p-2 overflow-x-auto text-[10px] max-h-48">{JSON.stringify(ev.proposedData, null, 2)}</pre>
                            </details>
                          )}
                          {ev.currentData && (
                            <details className="text-slate-500">
                              <summary className="cursor-pointer hover:text-slate-700 font-semibold">Current CRM data</summary>
                              <pre className="mt-1 bg-emerald-50 rounded p-2 overflow-x-auto text-[10px] max-h-48">{JSON.stringify(ev.currentData, null, 2)}</pre>
                            </details>
                          )}
                        </div>
                      </div>
                    )}

                    {ev.phase === "applied" && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">{ev.operation}</span>
                          <span className="text-slate-500">Entity #{ev.entityId}</span>
                          {ev.rolledBack && <span className="bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-semibold">ROLLED BACK</span>}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {ev.beforeJson && (
                            <details className="text-slate-500">
                              <summary className="cursor-pointer hover:text-slate-700 font-semibold">Before</summary>
                              <pre className="mt-1 bg-red-50 rounded p-2 overflow-x-auto text-[10px] max-h-48">{JSON.stringify(ev.beforeJson, null, 2)}</pre>
                            </details>
                          )}
                          {ev.afterJson && (
                            <details className="text-slate-500">
                              <summary className="cursor-pointer hover:text-slate-700 font-semibold">After</summary>
                              <pre className="mt-1 bg-emerald-50 rounded p-2 overflow-x-auto text-[10px] max-h-48">{JSON.stringify(ev.afterJson, null, 2)}</pre>
                            </details>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!data.timeline?.length && !data.crmMatches?.length && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-6 text-center text-sm text-slate-500">
              No records found for "{data.query}" in any stage of the import pipeline.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main AdminImport page ────────────────────────────────────────────────────

type View = "list" | "create" | "batch";

export default function AdminImport() {
  const [view, setView] = useState<View>("list");
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [showDebugTrace, setShowDebugTrace] = useState(false);
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const handleSelectBatch = (b: any) => {
    setSelectedBatchId(b.id);
    setView("batch");
  };

  const handleBatchCreated = (b: any) => {
    qc.invalidateQueries({ queryKey: ["import-batches"] });
    setSelectedBatchId(b.id);
    setView("batch");
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-16">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <Link
          href="/admin"
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> Admin Panel
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            Customer Factor Import
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Safe, staged, weekly import workflow with conflict review and rollback.
          </p>
        </div>
      </div>

      {/* Info banner */}
      <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-3 flex gap-3 text-sm">
        <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
        <div className="text-sky-800 space-y-0.5">
          <p className="font-semibold">How it works</p>
          <p className="text-xs text-sky-700">
            Upload your CF exports → the system stages and analyzes each row → you review conflicts → apply writes to the database.
            Every change is logged so you can rollback if needed.
            Matching is done <strong>only by exact email or exact phone</strong> — never by name alone.
          </p>
        </div>
      </div>

      {/* Debug Trace toggle */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowDebugTrace(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${showDebugTrace ? "bg-orange-50 border-orange-300 text-orange-700" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"}`}
        >
          <Search className="w-3.5 h-3.5" />
          {showDebugTrace ? "Hide Debug Trace" : "Debug Trace"}
        </button>
      </div>

      {showDebugTrace && (
        <div className="bg-orange-50/50 border border-orange-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-orange-500" />
            <h3 className="text-sm font-bold text-orange-800">Import Pipeline Debug Trace</h3>
            <span className="text-[10px] bg-orange-200 text-orange-700 px-2 py-0.5 rounded-full font-semibold">Admin Tool</span>
          </div>
          <p className="text-xs text-orange-700">
            Enter a CF ID or customer name to trace exactly what happened during import — from CSV parsing through staging, review, and application.
          </p>
          <DebugTracePanel />
        </div>
      )}

      {/* Views */}
      {view === "list" && (
        <BatchList onSelect={handleSelectBatch} onCreate={() => setView("create")} />
      )}
      {view === "create" && (
        <CreateBatch
          onCreated={handleBatchCreated}
          onBack={() => setView("list")}
        />
      )}
      {view === "batch" && selectedBatchId && (
        <BatchDetail
          batchId={selectedBatchId}
          onBack={() => { setView("list"); setSelectedBatchId(null); }}
        />
      )}

      {/* Version footer */}
      <p className="text-center text-[11px] text-slate-300 pt-4 select-none">
        Revision {APP_VERSION} &nbsp;·&nbsp; Built {BUILD_DATE} at {BUILD_TIME}
      </p>
    </div>
  );
}
