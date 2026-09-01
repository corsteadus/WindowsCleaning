import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  History,
  LockKeyhole,
  Mail,
  Phone,
  ShieldCheck,
} from "lucide-react";
import { useGetFinancialCapabilities } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { protectedFetch } from "@/lib/auth-scope";

type Channel = "email" | "sms";
type ChannelSummary = {
  channel: Channel;
  available: boolean;
  destinationHash: string | null;
  maskedDestination: string | null;
  status: string;
  source?: string | null;
  consentAt?: string | null;
  reason?: string | null;
  hardSuppressed?: boolean;
};
type SafetySummary = { customerId: number; channels: ChannelSummary[] };
type HistoryEntry = {
  id: number;
  channel: Channel;
  destinationHash: string;
  action: string;
  classification?: string | null;
  emailMarketingStatus?: string | null;
  smsConsentStatus?: string | null;
  consentAt?: string | null;
  source: string;
  actor?: string | null;
  reason?: string | null;
  createdAt: string;
};

function makeIdempotencyKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

async function api(path: string, options?: RequestInit) {
  const response = await protectedFetch(path, {
    credentials: "include",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(body.error ?? "Communication safety request failed");
  return body;
}

function statusLabel(status: string) {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function CommunicationSafetyCard({
  customerId,
}: {
  customerId: number;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const capabilitiesQuery = useGetFinancialCapabilities();
  const capabilities = capabilitiesQuery.data?.capabilities ?? [];
  const canView = capabilities.includes("communication.view");
  const canManage = capabilities.includes("communication.manage");
  const [channel, setChannel] = useState<Channel>("email");
  const [destination, setDestination] = useState("");
  const [disclosureSnapshot, setDisclosureSnapshot] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const summaryQuery = useQuery<SafetySummary>({
    queryKey: ["communication-safety", customerId],
    enabled: canView,
    queryFn: () => api(`/api/customers/${customerId}/communication-safety`),
  });
  const historyQuery = useQuery<{ customerId: number; data: HistoryEntry[] }>({
    queryKey: ["communication-safety-history", customerId],
    enabled: canView && showHistory,
    queryFn: () =>
      api(`/api/customers/${customerId}/communication-safety/history`),
  });
  const mutation = useMutation({
    mutationFn: async ({
      action,
      proofRequired,
    }: {
      action: "consent" | "re-consent" | "opt-out";
      proofRequired?: boolean;
    }) => {
      if (proofRequired && !disclosureSnapshot.trim())
        throw new Error(
          "Add the exact SMS disclosure or terms snapshot before recording consent.",
        );
      if (
        action === "opt-out" &&
        !window.confirm(
          `Confirm ${channel.toUpperCase()} opt-out for this customer? This adds an auditable suppression and will block future matching sends.`,
        )
      )
        return null;
      return api(
        `/api/customers/${customerId}/communication-safety/${action}`,
        {
          method: "POST",
          headers: { "Idempotency-Key": makeIdempotencyKey() },
          body: JSON.stringify({
            channel,
            destination: destination.trim() || undefined,
            disclosureSnapshot: disclosureSnapshot.trim() || undefined,
            source: "crm.customer",
            reason:
              action === "opt-out"
                ? "Customer request recorded by operator"
                : undefined,
          }),
        },
      );
    },
    onSuccess: (result) => {
      if (!result) return;
      queryClient.invalidateQueries({
        queryKey: ["communication-safety", customerId],
      });
      queryClient.invalidateQueries({
        queryKey: ["communication-safety-history", customerId],
      });
      setDestination("");
      setDisclosureSnapshot("");
      toast({
        title: "Communication status recorded",
        description: "The immutable history entry was saved.",
      });
    },
    onError: (error: Error) =>
      toast({
        title: "Could not update communication status",
        description: error.message,
        variant: "destructive",
      }),
  });

  if (!canView && !capabilitiesQuery.isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
        <LockKeyhole className="w-4 h-4 text-slate-400 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-slate-700">
            Communication safety is restricted
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Your role does not have permission to view consent or suppression
            status.
          </p>
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Communication safety
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Consent and suppression controls are audited before any automation
              can send.
            </p>
          </div>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          No raw destinations in history
        </span>
      </div>
      <div className="p-4 space-y-4">
        {summaryQuery.isLoading ? (
          <p className="text-sm text-slate-400">Loading safety status…</p>
        ) : summaryQuery.error ? (
          <p className="text-sm text-red-600">Safety status is unavailable.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {(summaryQuery.data?.channels ?? []).map((item) => {
              const Icon = item.channel === "email" ? Mail : Phone;
              return (
                <div
                  key={item.channel}
                  className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-slate-500" />
                      <span className="text-xs font-bold uppercase tracking-wide text-slate-600">
                        {item.channel}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-semibold rounded-full px-2 py-1 ${item.hardSuppressed || ["unsubscribed", "opted_out", "invalid", "bounced", "complained"].includes(item.status) ? "bg-rose-100 text-rose-700" : item.status === "subscribed" || item.status === "opted_in" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}
                    >
                      {statusLabel(item.status)}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-slate-800 mt-2">
                    {item.maskedDestination ?? "No destination on file"}
                  </p>
                  {item.hardSuppressed && (
                    <p className="text-[11px] text-rose-700 mt-1">
                      Durably suppressed for this channel.
                    </p>
                  )}
                  {item.consentAt && (
                    <p className="text-[11px] text-slate-400 mt-1">
                      Recorded {new Date(item.consentAt).toLocaleString()}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {canManage && (
          <div className="rounded-xl border border-slate-200 p-3 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-slate-500" />
              <p className="text-xs font-bold uppercase tracking-wide text-slate-600">
                Record a status change
              </p>
            </div>
            <div className="grid sm:grid-cols-[120px_1fr] gap-2">
              <select
                value={channel}
                onChange={(event) => setChannel(event.target.value as Channel)}
                className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
              <input
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                placeholder={
                  channel === "email"
                    ? "Optional email override"
                    : "Optional phone override"
                }
                className="h-9 rounded-lg border border-slate-200 px-3 text-sm"
              />
            </div>
            {channel === "sms" && (
              <textarea
                value={disclosureSnapshot}
                onChange={(event) => setDisclosureSnapshot(event.target.value)}
                placeholder="Paste the exact SMS disclosure/terms snapshot for proof"
                className="min-h-16 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            )}
            <div className="flex flex-wrap gap-2">
              <button
                disabled={mutation.isPending}
                onClick={() =>
                  mutation.mutate({
                    action: "consent",
                    proofRequired: channel === "sms",
                  })
                }
                className="h-8 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Record consent
              </button>
              <button
                disabled={mutation.isPending}
                onClick={() =>
                  mutation.mutate({
                    action: "re-consent",
                    proofRequired: channel === "sms",
                  })
                }
                className="h-8 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              >
                Record re-consent
              </button>
              <button
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ action: "opt-out" })}
                className="h-8 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
              >
                Record opt-out
              </button>
            </div>
            <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
              Use these controls only when the customer’s request or consent
              proof has been confirmed. Every change is immutable.
            </p>
          </div>
        )}

        <button
          onClick={() => setShowHistory((value) => !value)}
          className="flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
        >
          <History className="w-3.5 h-3.5" />
          {showHistory ? "Hide" : "View"} immutable history
        </button>
        {showHistory && (
          <div className="space-y-2 border-t border-slate-100 pt-3">
            {(historyQuery.data?.data ?? []).length === 0 ? (
              <p className="text-xs text-slate-400">
                No preference history yet.
              </p>
            ) : (
              historyQuery.data?.data.map((entry) => (
                <div key={entry.id} className="flex items-start gap-2 text-xs">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5" />
                  <div>
                    <p className="font-semibold text-slate-700">
                      {statusLabel(entry.action)} · {entry.channel}
                    </p>
                    <p className="text-slate-400">
                      {new Date(entry.createdAt).toLocaleString()} ·{" "}
                      {entry.source}
                      {entry.reason ? ` · ${entry.reason}` : ""}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
        <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <Clock3 className="w-3.5 h-3.5" />
          Quiet hours and eligibility decisions are enforced centrally before
          automation execution.
        </p>
      </div>
    </section>
  );
}
