/**
 * The business's identity on its estimates — phase 8, Kyle's Video 6: "businesses
 * format their own estimate: what is shown, footer, terms, logo." (The terms are in
 * Quote settings, above.) What is saved here appears on every estimate PDF, the
 * customer's estimate page, the printed estimate and the estimate email.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { estimateCall } from "@/lib/estimate-actions";
import { logoToJpeg } from "@/lib/logo-image";
import { formatPhoneAsTyped } from "@/lib/phone-format";

const FIELD = "h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm";
const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface Profile {
  businessName: string; address: string | null; city: string | null; state: string | null; zip: string | null;
  phone: string | null; email: string | null; website: string | null;
  estimateFooter: string | null; showUnitPrices: boolean; showServiceDescriptions: boolean;
  logoUrl: string | null; updatedBy: string | null;
}
type Draft = Omit<Profile, "logoUrl" | "updatedBy">;
const TEXT_FIELDS: Array<[keyof Draft, string, string]> = [
  ["businessName", "Business name", "Superior Professional Window Cleaning"],
  ["phone", "Phone", "(816) 555-0100"], ["email", "Email", "office@example.com"], ["website", "Website", "www.example.com"],
  ["address", "Street address", "123 Main St"], ["city", "City", "Kansas City"], ["state", "State", "MO"], ["zip", "ZIP", "64111"],
];

export function CompanyBrandingCard({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ["company-profile"], queryFn: () => estimateCall<Profile>("/company-profile") });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!profile.data) return;
    const { logoUrl: _l, updatedBy: _u, ...rest } = profile.data;
    setDraft({ ...rest, phone: rest.phone ? formatPhoneAsTyped(rest.phone) : rest.phone });
  }, [profile.data]);

  const save = useMutation({
    mutationFn: () => estimateCall("/company-profile", { method: "PUT", body: JSON.stringify(draft) }),
    onSuccess: async () => { setMessage({ kind: "ok", text: "Saved. New estimates use it straight away." }); await queryClient.invalidateQueries({ queryKey: ["company-profile"] }); },
    onError: (cause: Error) => setMessage({ kind: "error", text: cause.message }),
  });
  const uploadLogo = useMutation({
    mutationFn: async (file: File) => {
      const image = await logoToJpeg(file);
      return estimateCall("/company-profile/logo", { method: "PUT", body: JSON.stringify({ image }) });
    },
    onSuccess: async () => { setMessage({ kind: "ok", text: "Logo saved." }); await queryClient.invalidateQueries({ queryKey: ["company-profile"] }); },
    onError: (cause: Error) => setMessage({ kind: "error", text: cause.message }),
  });
  const removeLogo = useMutation({
    mutationFn: () => estimateCall("/company-profile/logo", { method: "DELETE" }),
    onSuccess: async () => { setMessage({ kind: "ok", text: "Logo removed." }); await queryClient.invalidateQueries({ queryKey: ["company-profile"] }); },
  });

  if (!canManage) return null;
  const set = (patch: Partial<Draft>) => { setDraft((d) => (d ? { ...d, ...patch } : d)); setMessage(null); };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden" data-testid="company-branding-card">
      <div className="px-5 py-4 border-b border-slate-100 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center"><Building2 className="w-4 h-4" /></div>
        <div>
          <h2 className="text-base font-bold text-slate-900">Company &amp; branding</h2>
          <p className="text-xs text-slate-500 mt-0.5">Your name, contact details and logo on every estimate — the PDF, the customer's page, the print and the email.</p>
        </div>
      </div>
      {!draft ? <p className="p-5 text-sm text-slate-400">Loading…</p> : (
        <div className="p-5 space-y-5">
          {/* Logo */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-20 w-48 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 p-2" data-testid="branding-logo-preview">
              {profile.data?.logoUrl
                ? <img src={`${BASE}${profile.data.logoUrl}`} alt="Your logo" className="max-h-full max-w-full object-contain" />
                : <span className="text-xs text-slate-400">No logo yet</span>}
            </div>
            <div className="space-y-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" data-testid="branding-logo-input"
                onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadLogo.mutate(file); e.target.value = ""; }} />
              <button type="button" data-testid="branding-logo-upload" disabled={uploadLogo.isPending} onClick={() => fileRef.current?.click()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                {uploadLogo.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                {profile.data?.logoUrl ? "Change logo" : "Upload logo"}
              </button>
              {profile.data?.logoUrl && (
                <button type="button" data-testid="branding-logo-remove" onClick={() => removeLogo.mutate()}
                  className="ml-2 inline-flex h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-slate-500 hover:text-red-600">
                  <Trash2 className="h-4 w-4" /> Remove
                </button>
              )}
              <p className="text-[11px] text-slate-400">PNG or JPEG. It is kept at its own proportions; a transparent background prints white.</p>
            </div>
          </div>

          {/* Who */}
          <div className="grid gap-3 sm:grid-cols-2">
            {TEXT_FIELDS.map(([key, label, placeholder]) => (
              <label key={key} className={`space-y-1 ${key === "businessName" || key === "address" ? "sm:col-span-2" : ""}`}>
                <span className="text-xs font-semibold text-slate-500">{label}</span>
                <input aria-label={label} className={FIELD} placeholder={placeholder} value={(draft[key] as string | null) ?? ""}
                  onChange={(e) => set({ [key]: key === "phone" ? formatPhoneAsTyped(e.target.value) : e.target.value } as Partial<Draft>)} />
              </label>
            ))}
          </div>

          {/* What an estimate shows */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500">On estimates</p>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-1" data-testid="branding-show-unit-prices" checked={draft.showUnitPrices} onChange={(e) => set({ showUnitPrices: e.target.checked })} />
              <span>Show quantity and unit price for each service <span className="text-slate-400">(off: only each service's amount)</span></span>
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-1" data-testid="branding-show-descriptions" checked={draft.showServiceDescriptions} onChange={(e) => set({ showServiceDescriptions: e.target.checked })} />
              <span>Show each service's description</span>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-slate-500">Footer on every page <span className="font-normal text-slate-400">— e.g. licence and insurance numbers</span></span>
              <textarea aria-label="Estimate footer" data-testid="branding-footer" rows={2} maxLength={1000}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" value={draft.estimateFooter ?? ""}
                onChange={(e) => set({ estimateFooter: e.target.value })} />
            </label>
          </div>

          {message && <p className={`rounded-lg px-3 py-2 text-sm ${message.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`} data-testid="branding-message">{message.text}</p>}
          <div className="flex justify-end">
            <button type="button" data-testid="branding-save" disabled={save.isPending} onClick={() => save.mutate()}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
