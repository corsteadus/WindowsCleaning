import { useState } from "react";
import { Link } from "wouter";
import {
  useGetFinancialApprovalRequest,
  useGetFinancialCapabilities,
  useListFinancialApprovalRequests,
  approveFinancialApprovalRequest,
  rejectFinancialApprovalRequest,
  cancelFinancialApprovalRequest,
  getListFinancialApprovalRequestsQueryKey,
  getGetFinancialApprovalRequestQueryKey,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { useAuth } from "@workspace/replit-auth-web";
import { useToast } from "@/hooks/use-toast";
import { createIdempotencyKey, idempotencyRequest } from "@/lib/idempotency";
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Clock3, FileCheck2, X } from "lucide-react";

const ACTION_LABELS: Record<string, string> = {
  "refunds.record": "Manual refund",
  "invoices.credit": "Invoice credit note",
  "invoices.void": "Invoice void",
  "invoices.reissue": "Invoice reissue",
  "customer_credit.apply": "Customer-credit application",
};

function formatAmount(value: string | number): string {
  const cents = BigInt(String(value));
  return `$${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

function errorMessage(error: unknown): string {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error
    ?? (error instanceof Error ? error.message : "The approval action failed");
}

export default function ApprovalInbox() {
  const { user } = useAuth();
  const { data: capabilities } = useGetFinancialCapabilities();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | "cancel" | null>(null);
  const list = useListFinancialApprovalRequests({ status: "pending", page: 1, pageSize: 25 });
  const detail = useGetFinancialApprovalRequest(selectedId ?? 0);
  const canDecide = capabilities?.capabilities.includes("approvals.decide") ?? false;
  const canManage = capabilities?.capabilities.includes("approvals.manage") ?? false;
  const selected = detail.data;
  const distinctApprover = Boolean((selected?.policySnapshot as { distinctApprover?: unknown } | undefined)?.distinctApprover);
  const ownRequest = Boolean(selected && user && selected.requesterId === user.id);
  const approveDisabled = !canDecide || (distinctApprover && ownRequest);

  const finish = () => {
    queryClient.invalidateQueries({ queryKey: getListFinancialApprovalRequestsQueryKey({ status: "pending", page: 1, pageSize: 25 }) });
    if (selectedId != null) queryClient.invalidateQueries({ queryKey: getGetFinancialApprovalRequestQueryKey(selectedId) });
    setConfirmAction(null);
  };

  const actionMutation = useMutation({
    mutationFn: async (action: "approve" | "reject" | "cancel") => {
      const request = { note: action === "approve" ? "Approved from Approval Inbox" : `${action[0].toUpperCase()}${action.slice(1)}d from Approval Inbox` };
      const options = idempotencyRequest(createIdempotencyKey());
      if (action === "approve") return approveFinancialApprovalRequest(selectedId!, request, options);
      if (action === "reject") return rejectFinancialApprovalRequest(selectedId!, request, options);
      return cancelFinancialApprovalRequest(selectedId!, request, options);
    },
    onSuccess: finish,
    onError: (error) => toast({ title: errorMessage(error), variant: "destructive" }),
  });

  const requests = list.data?.data ?? [];
  const actionDisabledReason = !canDecide
    ? "You need approval-decision permission."
    : distinctApprover && ownRequest
      ? "Requesters cannot approve their own request under this policy."
      : null;

  return (
    <Layout>
      <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] font-bold text-slate-400">Revenue · Payments</p>
            <h1 className="text-2xl font-bold text-slate-900 mt-1">Approval Inbox</h1>
            <p className="text-sm text-slate-500 mt-1">Review pending financial actions before they execute.</p>
          </div>
          <Link href="/payments" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-4 h-4" /> Payments
          </Link>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3 text-sm text-amber-900">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p><strong>Manual refunds are recorded ledger activity.</strong> Approving a manual refund does not send money to a customer.</p>
        </div>

        <div className="grid lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)] gap-4">
          <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-slate-900">Pending requests</h2>
                <p className="text-xs text-slate-400 mt-0.5">{requests.length} shown</p>
              </div>
              <Clock3 className="w-4 h-4 text-slate-400" />
            </div>
            {list.isLoading ? (
              <p className="p-6 text-sm text-slate-500">Loading approval inbox…</p>
            ) : requests.length === 0 ? (
              <div className="p-8 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                <p className="font-semibold text-slate-800 mt-2">Inbox is clear</p>
                <p className="text-xs text-slate-500 mt-1">No pending approval requests.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {requests.map((request) => (
                  <button key={request.id} onClick={() => setSelectedId(request.id)} className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${selectedId === request.id ? "bg-primary/5 border-l-2 border-primary" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900">{request.approvalNumber}</span>
                      <span className="text-xs font-bold text-slate-700">{formatAmount(request.amountCents)}</span>
                    </div>
                    <p className="text-sm font-semibold text-slate-700 mt-1">{ACTION_LABELS[request.actionType] ?? request.actionType}</p>
                    <p className="text-xs text-slate-400 mt-1">{request.requesterName ?? request.requesterId}</p>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white min-h-[420px]">
            {!selectedId ? (
              <div className="h-full min-h-[420px] flex flex-col items-center justify-center text-center p-8">
                <FileCheck2 className="w-10 h-10 text-slate-300" />
                <p className="font-semibold text-slate-700 mt-3">Select a request</p>
                <p className="text-sm text-slate-500 mt-1 max-w-xs">Review the exact action, amount, reason, target, and immutable history before deciding.</p>
              </div>
            ) : detail.isLoading ? (
              <p className="p-6 text-sm text-slate-500">Loading request detail…</p>
            ) : !selected ? (
              <p className="p-6 text-sm text-rose-600">Approval request could not be loaded.</p>
            ) : (
              <div className="p-5 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400 font-bold">{selected.approvalNumber}</p>
                    <h2 className="text-xl font-bold text-slate-900 mt-1">{ACTION_LABELS[selected.actionType] ?? selected.actionType}</h2>
                  </div>
                  <span className="rounded-full bg-amber-50 border border-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">{selected.status}</span>
                </div>
                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] uppercase font-bold text-slate-400">Exact amount</p><p className="text-lg font-bold text-slate-900 mt-1">{formatAmount(selected.amountCents)}</p></div>
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] uppercase font-bold text-slate-400">Requester</p><p className="text-sm font-semibold text-slate-800 mt-1">{selected.requesterName ?? selected.requesterId}</p></div>
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-[11px] uppercase font-bold text-slate-400">Target IDs</p><p className="text-sm font-semibold text-slate-800 mt-1">{selected.targetIds.join(", ")}</p></div>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide font-bold text-slate-400">Reason</p>
                  <p className="text-sm text-slate-700 mt-1">{selected.reason}</p>
                </div>
                <details className="rounded-xl border border-slate-200">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-slate-600">Canonical request payload</summary>
                  <pre className="overflow-auto bg-slate-50 p-3 text-[11px] text-slate-600">{JSON.stringify(selected.canonicalPayload, null, 2)}</pre>
                </details>
                <div>
                  <p className="text-xs uppercase tracking-wide font-bold text-slate-400">Immutable history</p>
                  <div className="mt-2 space-y-2">
                    {(selected.history ?? []).map((event) => (
                      <div key={event.id} className="flex items-start gap-2 text-xs">
                        <span className="mt-1 w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                        <div><span className="font-bold text-slate-700">{event.eventType}</span><span className="text-slate-400"> · {event.actorName ?? event.actorId}</span>{event.note && <p className="text-slate-500 mt-0.5">{event.note}</p>}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {actionDisabledReason && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">{actionDisabledReason}</p>}
                <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-100">
                  {(selected.requesterId === user?.id || canManage) && (
                    <button disabled={actionMutation.isPending} onClick={() => setConfirmAction("cancel")} className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"><X className="w-3.5 h-3.5 inline mr-1" /> Cancel</button>
                  )}
                  {canDecide && <button disabled={actionMutation.isPending} onClick={() => setConfirmAction("reject")} className="px-3 py-2 rounded-xl border border-rose-200 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Reject</button>}
                  {canDecide && <button disabled={actionMutation.isPending || approveDisabled} onClick={() => setConfirmAction("approve")} className="px-3 py-2 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary/90 disabled:opacity-50"><Check className="w-3.5 h-3.5 inline mr-1" /> Approve &amp; execute</button>}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
      {confirmAction && selected && (
        <div className="fixed inset-0 z-50 bg-slate-900/30 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-5">
            <h3 className="font-bold text-slate-900">{confirmAction === "approve" ? "Approve and execute?" : `${confirmAction[0].toUpperCase()}${confirmAction.slice(1)} request?`}</h3>
            <p className="text-sm text-slate-600 mt-2">
              {confirmAction === "approve"
                ? "The existing financial domain core will execute once inside the approval transaction."
                : "This decision will not execute the underlying financial action."}
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setConfirmAction(null)} className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600">Keep reviewing</button>
              <button onClick={() => actionMutation.mutate(confirmAction)} disabled={actionMutation.isPending} className="px-3 py-2 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50">{actionMutation.isPending ? "Saving…" : "Confirm"}</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}