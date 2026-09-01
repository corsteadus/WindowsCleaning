import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useGetFinancialCapabilities,
  useListFinancialApprovalPolicies,
  upsertFinancialApprovalPolicy,
  deactivateFinancialApprovalPolicy,
} from "@workspace/api-client-react";
import type { FinancialApprovalAction } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import { createIdempotencyKey, idempotencyRequest } from "@/lib/idempotency";
import { ArrowLeft, CheckCircle2, LockKeyhole, ShieldCheck, SlidersHorizontal } from "lucide-react";

const ACTIONS: Array<{ value: FinancialApprovalAction; label: string; description: string }> = [
  { value: "refunds.record", label: "Manual refunds", description: "Recorded customer-credit refunds; this does not send money." },
  { value: "invoices.credit", label: "Invoice credit notes", description: "Immutable credit-note corrections." },
  { value: "invoices.void", label: "Invoice voids", description: "Voids for unpaid invoices." },
  { value: "invoices.reissue", label: "Invoice reissues", description: "Replacement invoices from voided or fully credited invoices." },
  { value: "customer_credit.apply", label: "Customer-credit applications", description: "Applying available customer credit to open invoices." },
];

export default function FinancialPermissions() {
  const { data: capabilities, isLoading: capabilitiesLoading } = useGetFinancialCapabilities();
  const { data: policyData, isLoading: policiesLoading, refetch } = useListFinancialApprovalPolicies();
  const { toast } = useToast();
  const canManage = capabilities?.capabilities.includes("approvals.manage") ?? false;
  const [drafts, setDrafts] = useState<Record<string, { enabled: boolean; threshold: string; distinctApprover: boolean }>>({});

  const activePolicies = useMemo(() => {
    const map = new Map<string, any>();
    for (const policy of policyData?.data ?? []) {
      if (policy.isActive && !map.has(policy.actionType)) map.set(policy.actionType, policy);
    }
    return map;
  }, [policyData]);

  const draftFor = (action: FinancialApprovalAction) => {
    const existing = drafts[action];
    if (existing) return existing;
    const policy = activePolicies.get(action);
    return {
      enabled: policy?.enabled ?? false,
      threshold: policy?.threshold ?? "",
      distinctApprover: policy?.distinctApprover ?? false,
    };
  };

  const updateDraft = (action: FinancialApprovalAction, update: Partial<ReturnType<typeof draftFor>>) => {
    setDrafts((current) => ({ ...current, [action]: { ...draftFor(action), ...update } }));
  };

  async function save(action: FinancialApprovalAction) {
    const draft = draftFor(action);
    try {
      await upsertFinancialApprovalPolicy({
        actionType: action,
        enabled: draft.enabled,
        threshold: draft.threshold.trim() || null,
        distinctApprover: draft.distinctApprover,
      }, idempotencyRequest(createIdempotencyKey()));
      await refetch();
      toast({ title: "Approval policy saved" });
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Could not save policy", variant: "destructive" });
    }
  }

  async function deactivate(action: FinancialApprovalAction) {
    try {
      await deactivateFinancialApprovalPolicy(action, idempotencyRequest(createIdempotencyKey()));
      await refetch();
      toast({ title: "Approval policy deactivated" });
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Could not deactivate policy", variant: "destructive" });
    }
  }

  return (
    <Layout>
      <div className="p-4 lg:p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-slate-400">Settings · Financial controls</p>
            <h1 className="text-2xl font-bold text-slate-900 mt-1">Financial Permissions &amp; Approvals</h1>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">
              Server-enforced capabilities and configurable approval gates for sensitive financial actions.
              No policy row means the existing direct action flow remains unchanged.
            </p>
          </div>
          <Link href="/payments/approvals" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-4 h-4" /> Approval Inbox
          </Link>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h2 className="font-bold text-slate-900">Your financial capabilities</h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">Role: <span className="font-semibold text-slate-700">{capabilities?.role ?? (capabilitiesLoading ? "Loading…" : "Unavailable")}</span></p>
          <div className="flex flex-wrap gap-2 mt-4">
            {(capabilities?.capabilities ?? []).map((capability) => (
              <span key={capability} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="w-3 h-3" /> {capability}
              </span>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-slate-500" />
            <div>
              <h2 className="font-bold text-slate-900">Approval policies</h2>
              <p className="text-xs text-slate-500">Thresholds are exact cents and inclusive: at or above the threshold requires approval.</p>
            </div>
          </div>
          {policiesLoading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading policy history…</div>
          ) : ACTIONS.map((action) => {
            const draft = draftFor(action.value);
            const policy = activePolicies.get(action.value);
            return (
              <div key={action.value} className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div>
                    <p className="font-bold text-slate-900">{action.label}</p>
                    <p className="text-sm text-slate-500 mt-1">{action.description}</p>
                    <p className="text-[11px] text-slate-400 mt-2">
                      {policy ? `Active policy #${policy.id} · ${policy.enabled ? "enabled" : "disabled"}` : "No active policy · direct flow preserved"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <LockKeyhole className="w-3.5 h-3.5" />
                    {canManage ? "Administrator control" : "Read-only"}
                  </div>
                </div>
                <div className="grid sm:grid-cols-3 gap-3 mt-4">
                  <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                    <input type="checkbox" checked={draft.enabled} disabled={!canManage} onChange={(event) => updateDraft(action.value, { enabled: event.target.checked })} />
                    Require approval
                  </label>
                  <label className="rounded-xl border border-slate-200 px-3 py-2">
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Threshold (optional)</span>
                    <input
                      value={draft.threshold}
                      disabled={!canManage}
                      onChange={(event) => updateDraft(action.value, { threshold: event.target.value })}
                      placeholder="Any amount"
                      className="w-full mt-1 text-sm outline-none disabled:bg-transparent"
                    />
                  </label>
                  <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                    <input type="checkbox" checked={draft.distinctApprover} disabled={!canManage} onChange={(event) => updateDraft(action.value, { distinctApprover: event.target.checked })} />
                    Distinct approver
                  </label>
                </div>
                {draft.distinctApprover && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mt-3">
                    Requesters cannot approve their own requests while this control is enabled.
                  </p>
                )}
                {canManage && (
                  <div className="flex justify-end gap-2 mt-4">
                    {policy && <button onClick={() => deactivate(action.value)} className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50">Deactivate</button>}
                    <button onClick={() => save(action.value)} className="px-3 py-2 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary/90">Save policy</button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </Layout>
  );
}