/**
 * The Estimate Status module (Kyle 2026-09-24 #2).
 *
 * The office's queue comes first and loudest — accepted estimates nobody has
 * scheduled — because that is the only part of this module that asks somebody
 * to do something. The six groupings sit under it as the standing picture.
 */
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, parseISO } from "date-fns";
import { BellRing, ChevronRight, FileSpreadsheet } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/utils";
import { authScopedQueryKey, protectedFetch } from "@/lib/auth-scope";
import { useAuth } from "@workspace/replit-auth-web";
import { hasClientCapability } from "@/lib/rbac";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface NeedsAction {
  quoteId: number;
  quoteNumber: string;
  customerId: number | null;
  customerName: string | null;
  totalAmount: number;
  acceptedAt: string | null;
  acceptedLineItemCount: number | null;
}
interface EstimateStatus {
  groups: Array<{ group: string; label: string; count: number }>;
  total: number;
  needsScheduling: number;
  needsSchedulingLabel: string | null;
  needsAction: NeedsAction[];
}

const TINT: Record<string, string> = {
  open: "bg-slate-50 text-slate-700",
  pending: "bg-sky-50 text-sky-700",
  accepted: "bg-amber-50 text-amber-800",
  accepted_scheduled: "bg-emerald-50 text-emerald-700",
  declined: "bg-rose-50 text-rose-700",
  closed: "bg-slate-100 text-slate-500",
};

function waited(acceptedAt: string | null): string | null {
  if (!acceptedAt) return null;
  try {
    return `accepted ${formatDistanceToNow(parseISO(acceptedAt), { addSuffix: true })}`;
  } catch {
    return null;
  }
}

export function EstimateStatusModule() {
  const { user } = useAuth();
  const canSee = hasClientCapability(user, "quotes.view") && hasClientCapability(user, "dashboard.view");
  const [, navigate] = useLocation();
  const { data, isLoading, isError } = useQuery<EstimateStatus>({
    queryKey: authScopedQueryKey(user, ["dashboard", "estimate-status"]),
    queryFn: async () => {
      const response = await protectedFetch(`${BASE}/api/dashboard/estimate-status`, { credentials: "include" });
      if (!response.ok) throw new Error("Estimate status unavailable");
      return response.json();
    },
    enabled: canSee,
  });

  if (!canSee) return null;
  if (isLoading) return <Skeleton className="mb-7 h-40 rounded-2xl" />;
  if (isError || !data) return null;

  return (
    <section className="mb-7" aria-labelledby="estimate-status">
      <h2 id="estimate-status" className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-500">
        Estimate status
      </h2>

      {data.needsScheduling > 0 && (
        <div className="mb-3 overflow-hidden rounded-2xl border-2 border-amber-300 bg-amber-50">
          <div className="flex items-center gap-3 px-5 py-4">
            <span className="rounded-xl bg-amber-400/25 p-2"><BellRing className="h-5 w-5 text-amber-700" /></span>
            <div>
              <p className="text-base font-black text-amber-900">{data.needsSchedulingLabel}</p>
              <p className="text-xs text-amber-800">The customer has accepted. Nothing is booked until somebody schedules it.</p>
            </div>
          </div>
          <div className="divide-y divide-amber-200 border-t border-amber-200 bg-white/70">
            {data.needsAction.map((row) => (
              <button
                key={row.quoteId}
                onClick={() => navigate(`/quotes/${row.quoteId}`)}
                className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-amber-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">{row.customerName ?? row.quoteNumber}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {row.quoteNumber}
                    {waited(row.acceptedAt) && <> · {waited(row.acceptedAt)}</>}
                    {row.acceptedLineItemCount ? <> · {row.acceptedLineItemCount} service{row.acceptedLineItemCount === 1 ? "" : "s"}</> : null}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-2 font-black text-slate-950">
                  {formatCurrency(row.totalAmount)}
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {data.groups.map((group) => (
          <button
            key={group.group}
            onClick={() => navigate("/quotes")}
            className={`rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300 hover:shadow-sm`}
          >
            <span className={`inline-block rounded-lg px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${TINT[group.group] ?? TINT.open}`}>
              {group.label}
            </span>
            <p className="mt-2 text-2xl font-black text-slate-950">{group.count}</p>
          </button>
        ))}
      </div>

      {data.total === 0 && (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
          <FileSpreadsheet className="h-4 w-4 text-slate-400" />
          No estimates yet. They will appear here as soon as one is written.
        </p>
      )}
    </section>
  );
}
