/**
 * How long a quote stays valid, and the terms the company puts on it.
 *
 * Kyle (Testing Edits, 2026-10-01):
 *
 * - **#11** *"Do not require the user to manually enter a specific Valid Until
 *   date on every quote. Add a company-level Admin setting where the business
 *   chooses how many days a quote remains valid."*
 * - **#13** *"Do not provide any default Corstead terms and conditions … Each
 *   business is responsible for its own terms and conditions."*
 *
 * The box therefore starts empty and stays empty until somebody writes in it.
 * There is no example, no placeholder wording and no suggestion.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, FileText, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { protectedFetch } from "@/lib/auth-scope";
import {
  MAX_QUOTE_TERMS_LENGTH,
  QUOTE_VALIDITY_PRESETS,
  type QuoteSettingsDraft,
  type SavedQuoteSettings,
  draftFromSaved,
  expiryPreview,
  formatDateOnly,
  isQuoteSettingsDirty,
  quoteSettingsBody,
  validateQuoteSettingsDraft,
  validityChoice,
} from "@/lib/quote-settings-form";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface QuoteSettingsResponse extends SavedQuoteSettings {
  updatedBy: string | null;
  updatedAt: string | null;
  presets: number[];
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await protectedFetch(`${BASE}/api${path}`, {
    ...init, credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string })?.error ?? "Request failed");
  return body as T;
}

export function QuoteSettingsCard({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<QuoteSettingsDraft>({ validityDays: "30", terms: "" });
  const [problem, setProblem] = useState<string | null>(null);

  const query = useQuery<QuoteSettingsResponse>({
    queryKey: ["quote-settings"],
    queryFn: () => api<QuoteSettingsResponse>("/quote-settings"),
  });

  useEffect(() => {
    if (!query.data) return;
    setDraft(draftFromSaved(query.data));
  }, [query.data]);

  const save = useMutation({
    mutationFn: () => api<QuoteSettingsResponse>("/quote-settings", {
      method: "PUT",
      body: JSON.stringify(quoteSettingsBody(draft)),
    }),
    onSuccess: (settings) => {
      qc.invalidateQueries({ queryKey: ["quote-settings"] });
      toast({
        title: "Quote settings saved",
        description: `New quotes stay valid for ${settings.validityDays} days`
          + (settings.terms ? ", and carry your terms and conditions." : "."),
      });
    },
    onError: (error) => toast({
      title: "Could not save", variant: "destructive",
      description: error instanceof Error ? error.message : undefined,
    }),
  });

  const saved: SavedQuoteSettings | null = query.data
    ? { validityDays: query.data.validityDays, terms: query.data.terms }
    : null;
  const dirty = saved ? isQuoteSettingsDirty(draft, saved) : false;
  const choice = validityChoice(draft.validityDays);
  const days = Number(draft.validityDays);
  const preview = Number.isInteger(days) && days > 0 && days <= 365
    ? formatDateOnly(expiryPreview(days))
    : null;

  const attempt = () => {
    const reason = validateQuoteSettingsDraft(draft);
    setProblem(reason);
    if (!reason) save.mutate();
  };

  return (
    <section className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="bg-slate-50 px-5 py-3 flex items-center gap-2 border-b border-slate-200">
        <FileText className="w-4 h-4 text-slate-500" />
        <h2 className="font-bold text-slate-900">Quotes</h2>
      </div>
      <div className="p-5 space-y-6">
        {/* ── #11 How long a quote stays valid ───────────────────────────── */}
        <div className="space-y-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <CalendarClock className="w-3.5 h-3.5 text-slate-400" />
              How long a quote stays valid
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Corstead works out each quote's expiry from this, so nobody has to pick a date
              on every quote. The customer's link stops working at the end of that day; the
              quote itself stays on their profile.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {QUOTE_VALIDITY_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                disabled={!canManage}
                aria-pressed={choice === preset}
                onClick={() => { setProblem(null); setDraft((d) => ({ ...d, validityDays: String(preset) })); }}
                className={`h-9 px-4 rounded-xl border text-sm font-semibold transition-colors disabled:opacity-50
                  ${choice === preset
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"}`}
              >
                {preset} days
              </button>
            ))}
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <span className="font-semibold">Other</span>
              <input
                type="number"
                min={1}
                max={365}
                disabled={!canManage}
                aria-label="Another number of days"
                value={choice === "other" ? draft.validityDays : ""}
                placeholder="days"
                onChange={(event) => {
                  setProblem(null);
                  setDraft((d) => ({ ...d, validityDays: event.target.value }));
                }}
                className="h-9 w-24 px-3 rounded-xl border border-slate-200 text-sm
                           focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
              />
            </label>
          </div>

          {preview && (
            <p className="text-xs text-slate-500">
              A quote raised today would be valid until <span className="font-semibold text-slate-700">{preview}</span>.
            </p>
          )}
        </div>

        {/* ── #13 The company's own terms ────────────────────────────────── */}
        <div className="space-y-2 pt-1 border-t border-slate-100">
          <div className="pt-4">
            <h3 className="text-sm font-bold text-slate-800">Terms and conditions</h3>
            <p className="text-xs text-slate-500 mt-1">
              Whatever you write here is added to new quotes, where the customer reads it.
              Leave it empty and quotes carry no terms at all.
            </p>
          </div>
          <label className="sr-only" htmlFor="company-quote-terms">Terms and conditions</label>
          <textarea
            id="company-quote-terms"
            disabled={!canManage}
            value={draft.terms}
            maxLength={MAX_QUOTE_TERMS_LENGTH}
            onChange={(event) => { setProblem(null); setDraft((d) => ({ ...d, terms: event.target.value })); }}
            rows={6}
            className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white text-slate-900
                       focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
          />
          <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            These are your company's terms. Corstead supplies no wording of its own and cannot
            advise on what yours should say.
          </p>
        </div>

        {problem && <p className="text-xs font-semibold text-red-600">{problem}</p>}

        {canManage ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={attempt}
              disabled={!dirty || save.isPending}
              className="h-9 rounded-lg bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-40"
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
            {query.data?.updatedAt && (
              <span className="text-xs text-slate-400">
                Last changed by {query.data.updatedBy ?? "someone"} on {query.data.updatedAt.slice(0, 10)}
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400">
            You have read-only access. An administrator can change what the company quotes on.
          </p>
        )}
      </div>
    </section>
  );
}
