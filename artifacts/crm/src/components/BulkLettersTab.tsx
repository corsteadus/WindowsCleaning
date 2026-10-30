/**
 * Letters to many profiles at once — A5 (Kyle, Video 8). Pick a saved letter
 * template, find the profiles, tick the ones to write to, and Corstead prints
 * one PDF with each customer's own letter on its own page. Profiles with no
 * mailing address are left out, and the screen says who.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Printer, Search } from "lucide-react";
import { protectedFetch } from "@/lib/auth-scope";
import { estimateCall } from "@/lib/estimate-actions";
import type { MessageTemplate } from "@/lib/profile-messages";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const FIELD = "h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm";
const LABEL = "block text-[11px] font-semibold uppercase tracking-wide text-slate-400";
export const MAX_LETTERS = 200;

interface Profile { id: number; entityType: "customer" | "lead"; firstName: string; lastName: string; companyName: string | null; city: string | null; state: string | null; status: string | null }

export function BulkLettersTab() {
  const [templateId, setTemplateId] = useState("");
  const [filters, setFilters] = useState({ status: "active", clientType: "", city: "", state: "" });
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const templates = useQuery({
    queryKey: ["message-templates", "letter"],
    queryFn: () => estimateCall<{ templates: MessageTemplate[] }>("/email-templates?channel=letter").then((r) => r.templates),
  });

  const find = useMutation({
    mutationFn: () => {
      const query = new URLSearchParams({ entityTypes: "customer" });
      for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
      return estimateCall<{ recipients: Profile[] }>(`/emails/recipients?${query}`).then((r) => r.recipients.filter((p) => p.entityType === "customer"));
    },
    onSuccess: (found) => { setProfiles(found); setSelected(new Set(found.slice(0, MAX_LETTERS).map((p) => p.id))); setMessage(null); },
    onError: (e: Error) => setMessage({ tone: "error", text: e.message }),
  });

  const print = useMutation({
    mutationFn: async () => {
      const tab = window.open("", "_blank");
      const res = await protectedFetch(`${BASE}/api/letters/pdf`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: Number(templateId), customerIds: [...selected] }),
      });
      if (!res.ok) {
        tab?.close();
        throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "The letters could not be made");
      }
      const skipped = res.headers.get("X-Letters-Skipped");
      const url = URL.createObjectURL(await res.blob());
      if (tab) tab.location.href = url; else window.location.assign(url);
      return skipped ? decodeURIComponent(skipped) : null;
    },
    onSuccess: (skipped) => setMessage({
      tone: "ok",
      text: `The letters opened in a new tab — print them from there.${skipped ? ` Left out (no mailing address): ${skipped}.` : ""}`,
    }),
    onError: (e: Error) => setMessage({ tone: "error", text: e.message }),
  });

  const name = (p: Profile) => [p.firstName, p.lastName].filter(Boolean).join(" ") || p.companyName || `#${p.id}`;
  const all = profiles ?? [];
  const toggle = (id: number) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-5" data-testid="bulk-letters">
      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="space-y-1">
          <label className={LABEL} htmlFor="bulk-letter-template">Letter template</label>
          <select id="bulk-letter-template" data-testid="bulk-letter-template" className={`${FIELD} w-full max-w-md`}
            value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">{templates.isLoading ? "Loading…" : templates.data?.length ? "Choose a letter template" : "No letter templates yet"}</option>
            {templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {!templates.isLoading && !templates.data?.length && (
            <p className="text-xs text-slate-500">Open any profile, click <strong>Letter</strong>, write it, and “Save as new template”.</p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className={LABEL} htmlFor="bulk-letter-status">Status</label>
            <select id="bulk-letter-status" className={FIELD} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="active">Active</option><option value="inactive">Inactive</option><option value="">Any</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className={LABEL} htmlFor="bulk-letter-type">Type</label>
            <select id="bulk-letter-type" className={FIELD} value={filters.clientType} onChange={(e) => setFilters({ ...filters, clientType: e.target.value })}>
              <option value="">Any</option><option value="residential">Residential</option><option value="commercial">Commercial</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className={LABEL} htmlFor="bulk-letter-city">City</label>
            <input id="bulk-letter-city" className={`${FIELD} w-36`} value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })} />
          </div>
          <div className="space-y-1">
            <label className={LABEL} htmlFor="bulk-letter-state">State</label>
            <input id="bulk-letter-state" className={`${FIELD} w-20`} value={filters.state} onChange={(e) => setFilters({ ...filters, state: e.target.value })} />
          </div>
          <button type="button" data-testid="bulk-letter-find" onClick={() => find.mutate()} disabled={find.isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            {find.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Find profiles
          </button>
        </div>
      </div>

      {profiles && (
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 text-sm">
            <label className="flex items-center gap-2 font-medium text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-primary" data-testid="bulk-letter-all"
                checked={all.length > 0 && all.every((p) => selected.has(p.id))}
                onChange={(e) => setSelected(new Set(e.target.checked ? all.slice(0, MAX_LETTERS).map((p) => p.id) : []))} />
              {all.length} found · <span data-testid="bulk-letter-count">{selected.size}</span> ticked
            </label>
            {selected.size > MAX_LETTERS && <span className="text-xs text-red-600">At most {MAX_LETTERS} at once</span>}
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-50">
            {all.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">No profiles match.</p>}
            {all.map((p) => (
              <label key={p.id} className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-slate-50">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                <span className="font-medium text-slate-800">{name(p)}</span>
                <span className="text-xs text-slate-400">{[p.city, p.state].filter(Boolean).join(", ")}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {message && (
        <p className={`rounded-lg px-3 py-2 text-sm ${message.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`} data-testid="bulk-letter-message">{message.text}</p>
      )}

      <button type="button" data-testid="bulk-letter-print"
        disabled={!templateId || selected.size === 0 || selected.size > MAX_LETTERS || print.isPending}
        onClick={() => print.mutate()}
        className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50">
        {print.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
        Print {selected.size || ""} {selected.size === 1 ? "letter" : "letters"}
      </button>
    </div>
  );
}
