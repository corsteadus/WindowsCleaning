/**
 * The call list — phase 4, Kyle's Video 4: "someone in the office, or even a
 * virtual assistant, going through a list and calling customers or prospects."
 * Every open callback, overdue first; Call opens the same call screen as the
 * profile, and "book it" carries on to the profile to book the work.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Loader2, PhoneCall } from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { CallbackDialog } from "@/components/CallbackDialog";
import { authScopedQueryKey } from "@/lib/auth-scope";
import { estimateCall } from "@/lib/estimate-actions";
import { formatPhoneAsTyped } from "@/lib/phone-format";
import { BUCKET_LABELS, groupByDue, whenLabel, type ListedCallback } from "@/lib/callbacks";

const BUCKET_STYLE = { overdue: "text-red-700", today: "text-amber-700", upcoming: "text-slate-500" };

export default function Callbacks() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [mine, setMine] = useState(false);
  const [calling, setCalling] = useState<ListedCallback | null>(null);
  const list = useQuery({
    queryKey: authScopedQueryKey(user, ["callbacks", mine ? "me" : "all"]),
    queryFn: () => estimateCall<ListedCallback[]>(`/callbacks${mine ? "?assigned=me" : ""}`),
  });
  const profileHref = (c: ListedCallback) => `/${c.profile.list === "prospect" ? "prospects" : "customers"}/${c.profile.id}`;
  const groups = groupByDue(list.data ?? [], new Date());

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6" data-testid="callbacks-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Callbacks</h1>
          <p className="text-sm text-slate-500">Prospects and customers to call, soonest first.</p>
        </div>
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1" role="tablist" aria-label="Whose callbacks">
          {[{ id: false, label: "Everyone" }, { id: true, label: "Mine" }].map((tab) => (
            <button key={tab.label} type="button" role="tab" aria-selected={mine === tab.id} data-testid={`callbacks-${tab.label.toLowerCase()}`}
              onClick={() => setMine(tab.id)}
              className={`h-8 rounded-lg px-3 text-sm font-semibold ${mine === tab.id ? "bg-primary text-white" : "text-slate-600 hover:bg-slate-50"}`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {list.isLoading && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}
      {list.isError && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{(list.error as Error).message}</p>}
      {list.data && list.data.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-slate-400">
          <PhoneCall className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">{mine ? "No callbacks for you." : "No callbacks to make."} Schedule one from a profile's Callbacks section.</p>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.bucket} className="space-y-2" data-testid="callbacks-group" data-bucket={group.bucket}>
          <h2 className={`text-xs font-bold uppercase tracking-wide ${BUCKET_STYLE[group.bucket]}`}>
            {BUCKET_LABELS[group.bucket]} <span className="font-normal text-slate-400">· {group.callbacks.length}</span>
          </h2>
          {group.callbacks.map((callback) => (
            <div key={callback.id} data-testid="callbacks-row" className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={profileHref(callback)} className="text-sm font-semibold text-slate-900 hover:text-primary hover:underline">{callback.profile.name}</Link>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${callback.profile.list === "prospect" ? "bg-violet-50 text-violet-700" : "bg-emerald-50 text-emerald-700"}`}>
                    {callback.profile.list}
                  </span>
                </span>
                <span className="block text-xs text-slate-500">
                  {[whenLabel(callback.dueAt), callback.profile.phone && formatPhoneAsTyped(callback.profile.phone), callback.assignedTo ?? "Anyone in the office", callback.reason].filter(Boolean).join(" · ")}
                </span>
              </span>
              <button type="button" data-testid="callbacks-call" onClick={() => setCalling(callback)}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700">
                <PhoneCall className="h-4 w-4" /> Call
              </button>
            </div>
          ))}
        </section>
      ))}

      {calling && (
        <CallbackDialog profile={calling.profile} callback={calling} open={calling != null}
          onOpenChange={(value) => { if (!value) setCalling(null); }}
          onSaved={() => setCalling(null)}
          onBook={() => navigate(`${profileHref(calling)}?book=1`)} />
      )}
    </div>
  );
}
