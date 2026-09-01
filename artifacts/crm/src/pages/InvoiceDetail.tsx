import { useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { Layout } from "@/components/Layout";
import {
  ArrowLeft, Receipt, Building2, Briefcase, Clock,
  CheckCircle2, Send, AlertTriangle, RotateCcw,
  Link2, Copy, ExternalLink, Zap, RefreshCw, X, MapPin, Ban, FilePlus2, Printer, CreditCard, Mail,
} from "lucide-react";
import {
  useGetInvoice,
  updateInvoice,
  voidInvoice,
  createInvoiceCreditNote,
  reissueInvoice,
  useGeneratePaymentLink,
  getGetInvoiceQueryKey,
  getListInvoicesQueryKey,
  getListPaymentsQueryKey,
  getGetCustomerCreditSummaryByCustomerQueryKey,
  getGetCustomerQueryKey,
  getListCustomersQueryKey,
  useGetFinancialCapabilities,
  getGetFinancialCapabilitiesQueryKey,
  createPayment,
} from "@workspace/api-client-react";
import type { InvoiceCreditLineInput } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";
import { createIdempotencyKey, idempotencyRequest } from "@/lib/idempotency";
import { PropertyPicker } from "@/components/PropertyPicker";
import { resolveInvoiceJobReference } from "@/lib/invoice-job-reference";
import { validateInvoicePayment } from "@/lib/payment-validation";
import { useAuth } from "@workspace/replit-auth-web";
import { authScopedQueryKey, protectedFetch } from "@/lib/auth-scope";

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, {
  label: string; bg: string; text: string; dot: string;
  heroBorder: string; bannerBg?: string; bannerText?: string; bannerBorder?: string;
}> = {
  draft:   { label: "Draft",   bg: "bg-slate-100",  text: "text-slate-700",   dot: "bg-slate-400",   heroBorder: "border-l-slate-300"  },
  sent:    { label: "Sent",    bg: "bg-blue-50",    text: "text-blue-700",    dot: "bg-blue-400",    heroBorder: "border-l-blue-400"   },
  paid:    { label: "Paid",    bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500", heroBorder: "border-l-emerald-400",
             bannerBg: "bg-emerald-50", bannerText: "text-emerald-800", bannerBorder: "border-emerald-200" },
  overdue: { label: "Overdue", bg: "bg-red-50",     text: "text-red-700",     dot: "bg-red-500",     heroBorder: "border-l-red-400",
             bannerBg: "bg-red-50",     bannerText: "text-red-800",     bannerBorder: "border-red-200"    },
  partial: { label: "Partially Paid", bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500", heroBorder: "border-l-amber-400" },
  partially_credited: { label: "Partially Credited", bg: "bg-violet-50", text: "text-violet-700", dot: "bg-violet-500", heroBorder: "border-l-violet-400" },
  credited: { label: "Credited", bg: "bg-violet-50", text: "text-violet-700", dot: "bg-violet-500", heroBorder: "border-l-violet-400",
              bannerBg: "bg-violet-50", bannerText: "text-violet-800", bannerBorder: "border-violet-200" },
  voided: { label: "Voided", bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400", heroBorder: "border-l-slate-400",
            bannerBg: "bg-slate-100", bannerText: "text-slate-700", bannerBorder: "border-slate-200" },
};

function fmtDate(d?: string | null, addT = true) {
  if (!d) return null;
  const parsed = addT ? new Date(d + "T00:00:00") : new Date(d);
  return parsed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
function fmtDateShort(d?: string | null, addT = true) {
  if (!d) return null;
  const parsed = addT ? new Date(d + "T00:00:00") : new Date(d);
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── ConfirmModal ─────────────────────────────────────────────────────────────

function ConfirmModal({
  title, description, confirmLabel, onConfirm, onClose, loading,
}: {
  title: string; description: string; confirmLabel: string;
  onConfirm: () => void; onClose: () => void; loading: boolean;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader><DialogTitle className="text-base">{title}</DialogTitle></DialogHeader>
        <p className="text-slate-600 text-sm">{description}</p>
        <DialogFooter className="mt-1 gap-2">
          <button onClick={onClose} className="flex-1 h-10 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold shadow-sm shadow-primary/20 hover:bg-primary/90 transition-colors disabled:opacity-60">
            {loading ? "Saving…" : confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CorrectionModal({
  kind, balanceDue, lines, onSubmit, onClose, loading,
}: {
  kind: "void" | "credit" | "reissue";
  balanceDue: number;
  lines: Array<{ id: number; description: string; lineTotal: string }>;
  onSubmit: (reason: string, lines: InvoiceCreditLineInput[]) => void;
  onClose: () => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState("");
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [generalAmount, setGeneralAmount] = useState("");
  const isCredit = kind === "credit";
  const selectedLines = Object.entries(amounts)
    .filter(([, amount]) => amount.trim() && Number(amount) > 0)
    .map(([invoiceLineId, amount]) => ({ invoiceLineId: Number(invoiceLineId), amount }));
  const generalCents = Math.round(Number(generalAmount || 0) * 100);
  const selectedCents = selectedLines.reduce((sum, line) => sum + Math.round(Number(line.amount) * 100), 0);
  const remaining = Math.max(0, Math.round(balanceDue * 100) - selectedCents - generalCents) / 100;
  const title = kind === "void" ? "Void invoice" : kind === "reissue" ? "Reissue invoice" : "Create credit note";
  const description = kind === "void"
    ? "Voiding closes this unpaid invoice without changing its original line snapshots."
    : kind === "reissue"
      ? "This creates a new draft invoice from the immutable original and preserves the replacement chain."
      : "Enter exact credit amounts. The original invoice and line snapshots remain unchanged.";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader><DialogTitle className="text-base">{title}</DialogTitle></DialogHeader>
        <p className="text-sm text-slate-600">{description}</p>
        <div className="space-y-3 mt-1">
          {isCredit && (
            <div className="rounded-xl bg-violet-50 border border-violet-100 px-3 py-2 text-xs font-semibold text-violet-800">
              Remaining after this note: {formatCurrency(remaining)}
            </div>
          )}
          {isCredit && lines.map((line) => (
            <label key={line.id} className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2">
              <span className="flex-1 min-w-0 text-sm text-slate-700 truncate">
                {line.description}
                <span className="block text-[11px] text-slate-400">up to {formatCurrency(Number(line.lineTotal))}</span>
              </span>
              <input
                type="number" min="0" max={line.lineTotal} step="0.01" placeholder="0.00"
                value={amounts[line.id] ?? ""}
                onChange={(event) => setAmounts((current) => ({ ...current, [line.id]: event.target.value }))}
                className="w-28 h-9 rounded-lg border border-slate-200 px-2 text-right text-sm focus:border-primary focus:outline-none"
              />
            </label>
          ))}
          {isCredit && (
            <label className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2">
              <span className="flex-1 text-sm text-slate-700">General credit</span>
              <input
                type="number" min="0" step="0.01" placeholder="0.00" value={generalAmount}
                onChange={(event) => setGeneralAmount(event.target.value)}
                className="w-28 h-9 rounded-lg border border-slate-200 px-2 text-right text-sm focus:border-primary focus:outline-none"
              />
            </label>
          )}
          <textarea
            required rows={3} value={reason} onChange={(event) => setReason(event.target.value)}
            placeholder="Reason for this correction…"
            className="w-full rounded-xl border border-slate-200 p-3 text-sm resize-none focus:border-primary focus:outline-none"
          />
        </div>
        <DialogFooter className="mt-1 gap-2">
          <button onClick={onClose} className="flex-1 h-10 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50">Cancel</button>
          <button
            onClick={() => onSubmit(reason, [
              ...selectedLines,
              ...(generalCents > 0 ? [{ invoiceLineId: null, amount: generalAmount, description: "General credit" }] : []),
            ])}
            disabled={loading || !reason.trim() || (isCredit && selectedLines.length === 0 && generalCents <= 0)}
            className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary/90 disabled:opacity-60"
          >
            {loading ? "Saving…" : kind === "credit" ? "Create credit note" : kind === "void" ? "Void invoice" : "Create replacement"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── PaymentLinkSection ───────────────────────────────────────────────────────

function PaymentLinkSection({
  invoiceId, existingLink, isClosed, onLinkGenerated,
}: {
  invoiceId: number; existingLink?: string | null; isClosed: boolean; onLinkGenerated: () => void;
}) {
  const { toast } = useToast();
  const [link, setLink] = useState<string | null>(existingLink ?? null);

  const generateMutation = useGeneratePaymentLink({
    mutation: {
      onSuccess: (data) => {
        setLink(data.paymentLink);
        onLinkGenerated();
        toast({ title: data.alreadyExisted ? "Payment link retrieved" : "Payment link created!" });
      },
      onError: (err: unknown) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to generate payment link";
        toast({ title: msg, variant: "destructive" });
      },
    },
  });

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: "Payment link copied to clipboard!" });
    } catch {
      toast({ title: "Could not copy — please copy manually", variant: "destructive" });
    }
  };

  if (isClosed && !link) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Link2 className="w-4 h-4 text-slate-400" />
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Payment Link</h3>
        </div>
        <p className="text-sm text-emerald-700 font-medium flex items-center gap-2">
           <CheckCircle2 className="w-4 h-4" /> Invoice is closed — no link needed.
        </p>
      </div>
    );
  }

  if (link) {
    return (
      <div className="bg-white rounded-2xl border border-emerald-100 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-emerald-600" />
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Payment Link</h3>
          </div>
          <span className="flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Ready
          </span>
        </div>
        {/* Link URL */}
        <div className="bg-slate-50 rounded-xl px-3 py-2 font-mono text-xs text-slate-600 truncate mb-3">
          {link}
        </div>
        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={copyLink}
            className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-primary text-white
                       text-sm font-bold shadow-sm shadow-primary/20 hover:bg-primary/90 active:scale-[.98] transition-all"
          >
            <Copy className="w-4 h-4" /> Copy Link
          </button>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 h-10 px-3.5 rounded-xl border border-slate-200
                       text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-all"
          >
            <ExternalLink className="w-4 h-4" /> Open
          </a>
          <button
            onClick={() => generateMutation.mutate({ id: invoiceId, params: { regenerate: "true" } })}
            disabled={generateMutation.isPending}
            title="Regenerate link"
            className="h-10 w-10 flex items-center justify-center rounded-xl border border-slate-200
                       text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-all disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${generateMutation.isPending ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>
    );
  }

  // No link yet
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5">
      <div className="flex items-center gap-2 mb-2">
        <Link2 className="w-4 h-4 text-slate-400" />
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Payment Link</h3>
      </div>
      <p className="text-sm text-slate-500 mb-3">
        Generate a Stripe payment link to send to your customer.
      </p>
      <button
        onClick={() => generateMutation.mutate({ id: invoiceId })}
        disabled={generateMutation.isPending}
        className="w-full flex items-center justify-center gap-2 h-10 rounded-xl bg-primary text-white
                   text-sm font-bold shadow-sm shadow-primary/20 hover:bg-primary/90 active:scale-[.98]
                   transition-all disabled:opacity-60"
      >
        <Zap className="w-4 h-4" />
        {generateMutation.isPending ? "Generating…" : "Generate Payment Link"}
      </button>
    </div>
  );
}

function InvoicePaymentHistory({
  invoiceId, customerId, balanceDue, isClosed, canRecord, permissionLoading, permissionError, onRecorded,
}: {
  invoiceId: number; customerId: number; balanceDue: number; isClosed: boolean;
  canRecord: boolean; permissionLoading: boolean; permissionError: boolean; onRecorded: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [recording, setRecording] = useState(false);
  const [amount, setAmount] = useState(String(balanceDue || ""));
  const [method, setMethod] = useState("check");
  const [reference, setReference] = useState("");
  const recordIdempotencyKey = useRef<string | null>(null);
  const paymentDate = new Date().toISOString().slice(0, 10);
  const validationError = validateInvoicePayment({
    customerId,
    invoiceId,
    amount,
    outstanding: balanceDue,
    paymentDate,
    method,
  });
  const payments = useQuery<Array<{
    id: number; amount: string; paymentDate: string; method: string; reference?: string | null;
    allocations: Array<{ id: number; invoiceId: number; amount: string }>;
  }>>({
    queryKey: authScopedQueryKey(user, ["invoice-payments", invoiceId]),
    queryFn: async () => {
      const response = await protectedFetch(`/api/payments?invoiceId=${invoiceId}`);
      if (!response.ok) throw new Error("Failed to load payment history");
      return response.json();
    },
  });
  const record = useMutation({
    mutationFn: () => createPayment({
      customerId,
      amount,
      paymentDate,
      method,
      reference: reference || null,
      mode: "manual",
      allocations: [{ invoiceId, amount }],
    }, idempotencyRequest(recordIdempotencyKey.current ??= createIdempotencyKey())),
    onSuccess: () => {
      recordIdempotencyKey.current = null;
      payments.refetch();
      onRecorded();
      setRecording(false);
      toast({ title: "Payment recorded" });
    },
    onError: (error: unknown) => {
      const message = (error as { data?: { error?: string } })?.data?.error ?? "Failed to record payment";
      toast({ title: message, variant: "destructive" });
    },
  });
  useEffect(() => {
    if (!record.isPending) recordIdempotencyKey.current = null;
  }, [amount, method, reference]);
  useEffect(() => {
    if (!recording) setAmount(String(balanceDue || ""));
  }, [balanceDue, recording]);
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-slate-400" />
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Payment History</h3>
        </div>
        {!isClosed && (
          <button
            onClick={() => canRecord && setRecording((value) => !value)}
            disabled={permissionLoading || permissionError || !canRecord}
            title={permissionLoading
              ? "Checking payment permission…"
              : permissionError
                ? "Payment permission could not be loaded"
                : !canRecord
                  ? "You do not have permission to record payments"
                  : undefined}
            className="text-xs font-bold text-primary hover:underline disabled:text-slate-300 disabled:no-underline"
          >
            {recording ? "Cancel" : "Record payment"}
          </button>
        )}
      </div>
      {!isClosed && (permissionLoading || permissionError || !canRecord) && (
        <p className="text-xs text-slate-500 mb-3">
          {permissionLoading
            ? "Checking payment permission…"
            : permissionError
              ? "Payment permission could not be loaded."
              : "Your role cannot record payments."}
        </p>
      )}
      {recording && (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 mb-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input type="number" min="0.01" max={balanceDue} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)}
              aria-label="Payment amount" className="h-9 rounded-lg border border-slate-200 px-3 text-sm" />
            <select value={method} onChange={(event) => setMethod(event.target.value)} aria-label="Payment method" className="h-9 rounded-lg border border-slate-200 px-2 text-sm bg-white">
              <option value="check">Check</option><option value="cash">Cash</option><option value="ach">ACH</option><option value="other">Other</option>
            </select>
          </div>
          <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Reference or check number (optional)"
            className="w-full h-9 rounded-lg border border-slate-200 px-3 text-sm" />
          {validationError && <p role="alert" className="text-xs text-amber-700">{validationError}</p>}
          <button onClick={() => !validationError && !record.isPending && record.mutate()} disabled={!canRecord || record.isPending || !!validationError}
            className="w-full h-9 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-50">
            {record.isPending ? "Recording…" : "Record & allocate to invoice"}
          </button>
        </div>
      )}
      {payments.isLoading ? (
        <p className="text-sm text-slate-400 animate-pulse">Loading payments…</p>
      ) : payments.isError ? (
        <button onClick={() => payments.refetch()} className="text-sm text-red-600 hover:underline">Payment history failed to load. Retry</button>
      ) : !payments.data?.length ? (
        <p className="text-sm text-slate-500">No payments have been allocated to this invoice.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {payments.data.map((payment) => (
            <div key={payment.id} className="py-2.5 flex items-center justify-between gap-3">
              <div><p className="text-sm font-semibold text-slate-800">{payment.method}</p><p className="text-xs text-slate-400">{fmtDateShort(payment.paymentDate)}{payment.reference ? ` · ${payment.reference}` : ""}</p></div>
              <p className="text-sm font-bold text-emerald-700">{formatCurrency(Number(payment.allocations.find((item) => item.invoiceId === invoiceId)?.amount ?? payment.amount))}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InvoiceCommunications({
  invoiceId, customerId, invoiceNumber, communications, onSent,
}: {
  invoiceId: number;
  customerId: number;
  invoiceNumber: string;
  communications: Array<{ id: number; channel: string; subject?: string | null; status: string; createdAt: string; recipient?: string | null }>;
  onSent: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState(`Invoice ${invoiceNumber}`);
  const [body, setBody] = useState(`Your invoice ${invoiceNumber} is ready. Please contact us if you have any questions.`);
  const customer = useQuery<{ id: number; firstName: string; lastName: string; email?: string | null }>({
    queryKey: authScopedQueryKey(user, ["invoice-customer", customerId]),
    queryFn: async () => {
      const response = await protectedFetch(`/api/customers/${customerId}`);
      if (!response.ok) throw new Error("Failed to load invoice customer");
      return response.json();
    },
  });
  const send = useMutation({
    mutationFn: async () => {
      const recipient = customer.data;
      if (!recipient?.email) throw new Error("Customer does not have an email address");
      const response = await protectedFetch("/api/emails/send-one", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Idempotency-Key": createIdempotencyKey() },
        body: JSON.stringify({
          entityType: "customer",
          entityId: recipient.id,
          email: recipient.email,
          firstName: recipient.firstName,
          lastName: recipient.lastName,
          subject,
          bodyHtml: body,
          relatedType: "invoice",
          relatedId: invoiceId,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to send invoice email");
      }
      return response.json();
    },
    onSuccess: () => {
      setComposing(false);
      onSent();
      toast({ title: "Invoice email sent" });
    },
    onError: (error: Error) => toast({ title: error.message, variant: "destructive" }),
  });
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-slate-400" />
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Invoice Communications</h3>
        </div>
        <button disabled={customer.isLoading || !customer.data?.email} onClick={() => setComposing((value) => !value)}
          className="text-xs font-bold text-primary hover:underline disabled:text-slate-300">
          {composing ? "Cancel" : "Email invoice"}
        </button>
      </div>
      {customer.isError && <p className="text-xs text-red-600 mb-2">Customer contact failed to load.</p>}
      {customer.data && !customer.data.email && <p className="text-xs text-amber-700 mb-2">Add an email address to the customer before sending.</p>}
      {composing && (
        <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3 space-y-2 mb-3">
          <input value={subject} onChange={(event) => setSubject(event.target.value)} aria-label="Invoice email subject"
            className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm" />
          <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={4} aria-label="Invoice email message"
            className="w-full rounded-lg border border-slate-200 bg-white p-3 text-sm resize-none" />
          <button onClick={() => send.mutate()} disabled={send.isPending || !subject.trim() || !body.trim()}
            className="w-full h-9 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-50">
            {send.isPending ? "Sending…" : "Send safely & record history"}
          </button>
        </div>
      )}
      {communications.length === 0 ? (
        <p className="text-sm text-slate-500">No communication has been recorded for this invoice.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {communications.map((message) => (
            <div key={message.id} className="py-2.5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{message.subject || "Invoice message"}</p>
                <p className="text-xs text-slate-400">{new Date(message.createdAt).toLocaleString()}{message.recipient ? ` · ${message.recipient}` : ""}</p>
              </div>
              <span className="text-[11px] font-bold uppercase text-slate-500">{message.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const invoiceId = Number(id);
  const [, navigate] = useLocation();
  const { goBack, backLabel } = useBackNavigation("/invoices");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [confirmAction, setConfirmAction] = useState<null | "draft">(null);
  const [correctionAction, setCorrectionAction] = useState<null | "void" | "credit" | "reissue">(null);
  const [propertyId, setPropertyId] = useState<number | "" | undefined>(undefined);
  const markPaidIdempotencyKey = useRef<string | null>(null);

  const { data: invoice, isLoading, isError } = useGetInvoice(invoiceId, {
    query: { queryKey: authScopedQueryKey(user, getGetInvoiceQueryKey(invoiceId)) },
  });
  const {
    data: financialCapabilities,
    isLoading: financialCapabilitiesLoading,
    isError: financialCapabilitiesError,
  } = useGetFinancialCapabilities({
    query: { queryKey: authScopedQueryKey(user, getGetFinancialCapabilitiesQueryKey()) },
  });
  const canRecordPayment = financialCapabilities?.capabilities.includes("payments.record") ?? false;

  useEffect(() => {
    if (invoice) setPropertyId(invoice.propertyId ?? "");
  }, [invoice?.id, invoice?.propertyId]);

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      data,
      key,
    }: {
      id: number;
      data: Parameters<typeof updateInvoice>[1];
      key?: string;
    }) => updateInvoice(id, data, key ? idempotencyRequest(key) : undefined),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getGetInvoiceQueryKey(invoiceId)) });
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListInvoicesQueryKey()) });
      const s = (variables.data as { status?: string }).status;
      const labels: Record<string, string> = {
        paid: "Invoice marked as paid!",
        sent: "Invoice marked as sent",
        overdue: "Invoice flagged as overdue",
        draft: "Invoice returned to draft",
      };
      toast({ title: labels[s ?? ""] ?? "Invoice updated" });
      setConfirmAction(null);
    },
    onError: () => {
      toast({ title: "Failed to update invoice", variant: "destructive" });
      setConfirmAction(null);
    },
  });
  const markPaidMutation = useMutation({
    mutationFn: () => {
      if (!canRecordPayment) throw new Error("You do not have permission to record payments");
      if (!invoice) throw new Error("Invoice is unavailable");
      if (!(Number(invoice.balanceDue) > 0)) throw new Error("Invoice has no outstanding balance");
      return createPayment({
        customerId: invoice.customerId,
        amount: String(invoice.balanceDue),
        paymentDate: new Date().toISOString().slice(0, 10),
        method: "manual",
        reference: invoice.invoiceNumber,
        note: "Marked paid from the CRM invoice action",
        mode: "manual",
        allocations: [{ invoiceId, amount: String(invoice.balanceDue) }],
      }, idempotencyRequest(markPaidIdempotencyKey.current ??= createIdempotencyKey()));
    },
    onSuccess: () => {
      markPaidIdempotencyKey.current = null;
      refreshInvoice();
      toast({ title: "Payment recorded and allocated" });
    },
    onError: (error: unknown) => {
      const message = (error as { data?: { error?: string } })?.data?.error ?? "Failed to record payment";
      toast({ title: message, variant: "destructive" });
    },
  });

  const correctionMutation = useMutation({
    mutationFn: async ({
      action, reason, lines,
    }: {
      action: "void" | "credit" | "reissue";
      reason: string;
      lines: InvoiceCreditLineInput[];
    }) => {
      const request = idempotencyRequest(createIdempotencyKey());
      if (action === "void") return voidInvoice(invoiceId, { reason }, request);
      if (action === "reissue") return reissueInvoice(invoiceId, { reason }, request);
      return createInvoiceCreditNote(invoiceId, { reason, lines }, request);
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getGetInvoiceQueryKey(invoiceId)) });
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListInvoicesQueryKey()) });
      queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
      setCorrectionAction(null);
      toast({ title: variables.action === "void" ? "Invoice voided" : variables.action === "reissue" ? "Replacement invoice created" : "Credit note created" });
      if (variables.action === "reissue" && data && "id" in data && data.id) navigate(`/invoices/${data.id}`);
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? "Failed to save invoice correction";
      toast({ title: message, variant: "destructive" });
    },
  });

  const doStatus = (status: string) => {
    if (status === "paid") {
      markPaidMutation.mutate();
      return;
    }
    updateMutation.mutate({ id: invoiceId, data: { status } });
  };

  const refreshInvoice = () => {
    queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getGetInvoiceQueryKey(invoiceId)) });
    queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListInvoicesQueryKey()) });
    queryClient.invalidateQueries({ queryKey: getListPaymentsQueryKey() });
    queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["invoice-payments", invoiceId]) });
    if (invoice?.customerId) {
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getGetCustomerCreditSummaryByCustomerQueryKey(invoice.customerId)) });
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getGetCustomerQueryKey(invoice.customerId)) });
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListCustomersQueryKey()) });
    }
  };

  const saveProperty = (next: number | "") => {
    setPropertyId(next);
    updateMutation.mutate({
      id: invoiceId,
      data: { propertyId: next === "" ? null : next },
    });
  };

  // ─ Loading ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <Layout>
        <div className="animate-pulse space-y-4">
          <div className="h-5 w-24 bg-slate-200 rounded mb-5" />
          <div className="h-32 bg-white rounded-2xl border border-slate-100" />
          <div className="h-12 bg-white rounded-2xl border border-slate-100" />
          <div className="h-48 bg-white rounded-2xl border border-slate-100" />
        </div>
      </Layout>
    );
  }

  if (isError || !invoice) {
    return (
      <Layout>
        <button onClick={goBack} className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 text-sm font-medium mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4" /> {backLabel ?? "Invoices"}
        </button>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Receipt className="w-12 h-12 text-slate-200 mb-4" />
          <h2 className="text-lg font-bold text-slate-700 mb-1">Invoice not found</h2>
          <p className="text-slate-400 text-sm mb-5">This invoice may have been deleted.</p>
          <button onClick={goBack} className="px-5 py-2.5 bg-primary text-white text-sm font-bold rounded-xl hover:bg-primary/90 transition-colors">
            {backLabel ?? "Invoices"}
          </button>
        </div>
      </Layout>
    );
  }

  // ─ Derived ────────────────────────────────────────────────────────────────

  const cfg      = STATUS_CFG[invoice.status] ?? {
    label: invoice.status?.trim()
      ? invoice.status.replace(/_/g, " ").replace(/\b\w/g, (letter: string) => letter.toUpperCase())
      : "Unknown",
    bg: "bg-slate-100",
    text: "text-slate-600",
    dot: "bg-slate-400",
    heroBorder: "border-l-slate-400",
  };
  const isPaid   = invoice.status === "paid";
  const isOverdue = invoice.status === "overdue";
  const isSent    = invoice.status === "sent";
  const isDraft   = invoice.status === "draft";
  const isVoided  = invoice.status === "voided";
  const isCredited = invoice.status === "credited";
  const isClosed = isPaid || isVoided || isCredited;
  const canVoid = !isClosed && invoice.amountPaid === 0 && invoice.status !== "partially_credited";
  const canCredit = !isVoided && !isCredited && invoice.totalAmount > 0;
  const canReissue = (isVoided || isCredited) && !invoice.correctionHistory?.reissue;
  const stripeLink = (invoice as { stripePaymentLink?: string | null }).stripePaymentLink;
  const creditNotes = invoice.correctionHistory?.creditNotes ?? [];
  const creditBalanceReduction = creditNotes.reduce((sum, note) => sum + Number(note.balanceReductionAmount ?? 0), 0);
  const customerCreditIssued = creditNotes.reduce((sum, note) => sum + Number(note.customerCreditAmount ?? 0), 0);
  const primaryJobReference = resolveInvoiceJobReference(
    invoice.jobId,
    invoice.jobNumber,
    invoice.linkedJobs,
  );

  return (
    <Layout>
      {/* ── Back nav ─────────────────────────────── */}
      <button
        onClick={goBack}
        className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 text-sm font-medium mb-4 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        {backLabel ?? "Invoices"}
      </button>

      {/* ══════════════════════════════════════════════
           STATUS BANNER — Overdue (red) / Paid (green)
      ══════════════════════════════════════════════ */}
      {(isPaid || isOverdue || isVoided || isCredited) && (
        <div className={`flex items-center gap-3 rounded-2xl px-5 py-4 mb-4 border
          ${cfg.bannerBg} ${cfg.bannerBorder}`}
        >
          {isPaid && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />}
          {isOverdue && <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />}
          {isVoided && <Ban className="w-5 h-5 text-slate-500 shrink-0" />}
          {isCredited && <FilePlus2 className="w-5 h-5 text-violet-600 shrink-0" />}
          <div className="flex-1">
            <p className={`font-bold text-sm ${cfg.bannerText}`}>
              {isPaid ? "Invoice Paid" : isVoided ? "Invoice Voided" : isCredited ? "Invoice Credited" : "Invoice Overdue"}
            </p>
            {isPaid && invoice.paidAt && (
              <p className="text-xs text-emerald-700 mt-0.5">
                Payment received on {fmtDate(invoice.paidAt, false)}
              </p>
            )}
            {isOverdue && invoice.dueDate && (
              <p className="text-xs text-red-600 mt-0.5">
                Due date passed on {fmtDate(invoice.dueDate)}
              </p>
            )}
            {isVoided && <p className="text-xs text-slate-600 mt-0.5">This invoice is closed and cannot receive payments.</p>}
            {isCredited && <p className="text-xs text-violet-700 mt-0.5">This invoice has no remaining balance to collect.</p>}
          </div>
          {isOverdue && (
            <button
              onClick={() => doStatus("paid")}
              disabled={financialCapabilitiesLoading || financialCapabilitiesError || !canRecordPayment || markPaidMutation.isPending || !(Number(invoice.balanceDue) > 0)}
              title={financialCapabilitiesLoading
                ? "Checking payment permission…"
                : financialCapabilitiesError
                  ? "Payment permission could not be loaded"
                  : !canRecordPayment
                    ? "You do not have permission to record payments"
                    : undefined}
              className="flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-emerald-500 text-white
                         text-xs font-bold hover:bg-emerald-600 active:scale-[.97] transition-all disabled:opacity-60"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {financialCapabilitiesLoading ? "Checking permission…" : "Mark Paid"}
            </button>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════
           HERO CARD
      ══════════════════════════════════════════════ */}
      <div className={`bg-white rounded-2xl border border-l-4 border-slate-200 ${cfg.heroBorder} p-5 mb-4`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <span className="font-mono text-xs text-slate-400">{invoice.invoiceNumber}</span>
            <h1 className="text-xl font-bold text-slate-900 mt-0.5 mb-1 truncate">
              {invoice.customerName ?? `Customer #${invoice.customerId}`}
            </h1>
            {primaryJobReference.kind === "available" && (
              <button onClick={() => navigate(primaryJobReference.href)}
                className="flex items-center gap-1 text-xs text-primary hover:underline font-medium mb-2">
                <Briefcase className="w-3 h-3" />
                {primaryJobReference.label}
              </button>
            )}
            {primaryJobReference.kind === "unavailable" && (
              <p className="flex items-center gap-1 text-xs text-slate-500 font-medium mb-2">
                <Briefcase className="w-3 h-3" />
                {primaryJobReference.label}
              </p>
            )}
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg ${cfg.bg} ${cfg.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                {cfg.label}
              </span>
              {invoice.dueDate && !isClosed && (
                <span className={`text-xs font-medium ${isOverdue ? "text-red-600" : "text-slate-500"}`}>
                  Due {fmtDateShort(invoice.dueDate)}
                </span>
              )}
              {isPaid && invoice.paidAt && (
                <span className="text-xs font-medium text-emerald-600">
                  Paid {fmtDateShort(invoice.paidAt, false)}
                </span>
              )}
            </div>
          </div>

          {/* Right: total + balance */}
          <div className="flex flex-col items-end shrink-0">
            <button
              onClick={() => window.print()}
              className="print:hidden flex items-center gap-1.5 h-8 px-2.5 mb-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-500 hover:bg-slate-50"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
            <span className="text-xs text-slate-400 font-medium mb-0.5">Total</span>
            <span className="text-4xl font-bold text-slate-900 tabular-nums leading-none">
              {formatCurrency(invoice.totalAmount)}
            </span>
            {invoice.balanceDue > 0 && !isClosed && (
              <span className={`text-sm font-bold mt-1 ${isOverdue ? "text-red-600" : "text-slate-500"}`}>
                {formatCurrency(invoice.balanceDue)} due
              </span>
            )}
            {isPaid && (
              <span className="text-xs font-bold text-emerald-600 mt-1 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Paid in full
              </span>
            )}
            {isVoided && <span className="text-xs font-bold text-slate-500 mt-1">Closed</span>}
            {isCredited && <span className="text-xs font-bold text-violet-600 mt-1">Credited in full</span>}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════
           PRIMARY ACTION ROW (desktop)
      ══════════════════════════════════════════════ */}
      <div className="hidden sm:flex gap-2.5 mb-4 flex-wrap">
        {/* Mark Paid — always primary if not paid */}
        {!isClosed && (
          <button
            onClick={() => doStatus("paid")}
            disabled={financialCapabilitiesLoading || financialCapabilitiesError || !canRecordPayment || markPaidMutation.isPending || !(Number(invoice.balanceDue) > 0)}
            title={financialCapabilitiesLoading
              ? "Checking payment permission…"
              : financialCapabilitiesError
                ? "Payment permission could not be loaded"
                : !canRecordPayment
                  ? "You do not have permission to record payments"
                  : undefined}
            className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl
                       bg-emerald-500 hover:bg-emerald-600 active:scale-[.98]
                       text-white text-sm font-bold shadow-sm shadow-emerald-200
                       transition-all disabled:opacity-60"
          >
            <CheckCircle2 className="w-4 h-4" />
            {financialCapabilitiesLoading ? "Checking permission…" : "Mark Paid"}
          </button>
        )}

        {/* Copy Payment Link — primary if link exists */}
        {stripeLink && !isClosed && (
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(stripeLink);
                toast({ title: "Payment link copied to clipboard!" });
              } catch {
                toast({ title: "Could not copy", variant: "destructive" });
              }
            }}
            className="flex items-center gap-2 h-11 px-5 rounded-xl
                       border-2 border-primary/30 text-primary bg-white hover:bg-primary/5 active:scale-[.98]
                       text-sm font-bold transition-all"
          >
            <Copy className="w-4 h-4" />
            Copy Payment Link
          </button>
        )}

        {/* Mark Sent */}
        {!isSent && !isClosed && (
          <button
            onClick={() => doStatus("sent")}
            disabled={updateMutation.isPending}
            className="flex items-center gap-2 h-11 px-5 rounded-xl
                       border-2 border-blue-200 text-blue-700 bg-white hover:bg-blue-50 active:scale-[.98]
                       text-sm font-bold transition-all disabled:opacity-60"
          >
            <Send className="w-4 h-4" />
            Mark Sent
          </button>
        )}

        {/* Mark Overdue */}
        {!isOverdue && !isClosed && (
          <button
            onClick={() => doStatus("overdue")}
            disabled={updateMutation.isPending}
            className="flex items-center gap-2 h-11 px-4 rounded-xl
                       border-2 border-amber-200 text-amber-700 bg-white hover:bg-amber-50 active:scale-[.98]
                       text-sm font-bold transition-all disabled:opacity-60"
          >
            <AlertTriangle className="w-4 h-4" />
            Mark Overdue
          </button>
        )}

        {canCredit && (
          <button onClick={() => setCorrectionAction("credit")}
            className="flex items-center gap-2 h-11 px-4 rounded-xl border-2 border-violet-200 text-violet-700 bg-white hover:bg-violet-50 text-sm font-bold transition-all">
            <FilePlus2 className="w-4 h-4" /> Credit Note
          </button>
        )}
        {canVoid && (
          <button onClick={() => setCorrectionAction("void")}
            className="flex items-center gap-2 h-11 px-4 rounded-xl border-2 border-slate-200 text-slate-600 bg-white hover:bg-slate-50 text-sm font-bold transition-all">
            <Ban className="w-4 h-4" /> Void
          </button>
        )}
        {canReissue && (
          <button onClick={() => setCorrectionAction("reissue")}
            className="flex items-center gap-2 h-11 px-4 rounded-xl border-2 border-primary/30 text-primary bg-white hover:bg-primary/5 text-sm font-bold transition-all">
            <FilePlus2 className="w-4 h-4" /> Reissue
          </button>
        )}

        {/* Return to Draft */}
        {!isDraft && (
          <button
            onClick={() => setConfirmAction("draft")}
            className="flex items-center justify-center h-11 w-11 rounded-xl
                       border border-slate-200 text-slate-400 bg-white hover:text-slate-700 hover:bg-slate-50
                       active:scale-[.98] transition-all"
            title="Return to Draft"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ══════════════════════════════════════════════
           MAIN 2-COL GRID
      ══════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">

        {/* ─── LEFT: Payment Link + Details ──────── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Payment Link */}
          <PaymentLinkSection
            invoiceId={invoiceId}
            existingLink={stripeLink}
            isClosed={isClosed}
            onLinkGenerated={refreshInvoice}
          />
          <InvoicePaymentHistory
            invoiceId={invoice.id}
            customerId={invoice.customerId}
            balanceDue={invoice.balanceDue}
            isClosed={isClosed}
            canRecord={canRecordPayment}
            permissionLoading={financialCapabilitiesLoading}
            permissionError={financialCapabilitiesError}
            onRecorded={refreshInvoice}
          />
          <InvoiceCommunications
            invoiceId={invoice.id}
            customerId={invoice.customerId}
            invoiceNumber={invoice.invoiceNumber}
            communications={(invoice.communications ?? []) as Array<{ id: number; channel: string; subject?: string | null; status: string; createdAt: string; recipient?: string | null }>}
            onSent={refreshInvoice}
          />

          {(invoice.linkedJobs?.length || invoice.invoiceLines?.length) ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-5">
              {invoice.linkedJobs && invoice.linkedJobs.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Briefcase className="w-4 h-4 text-primary" />
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Linked jobs</h3>
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">{invoice.linkedJobs.length}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {invoice.linkedJobs.map((job) => (
                      <button key={job.id} onClick={() => navigate(`/jobs/${job.id}`)}
                        className="text-left rounded-xl border border-slate-100 bg-slate-50/60 p-3 hover:border-primary/30 hover:bg-primary/5 transition-colors">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-bold text-primary">{job.jobNumber}</span>
                          {job.scheduledDate && <span className="text-[11px] text-slate-400">{fmtDateShort(job.scheduledDate)}</span>}
                        </div>
                        {(job.propertyName || job.propertyAddress) && (
                          <p className="flex items-center gap-1 mt-1 text-xs text-slate-500 truncate">
                            <MapPin className="w-3 h-3 shrink-0" /> {job.propertyName || job.propertyAddress}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {invoice.invoiceLines && invoice.invoiceLines.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Receipt className="w-4 h-4 text-slate-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Line items</h3>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {invoice.invoiceLines.map((line) => {
                      const lineJobReference = resolveInvoiceJobReference(
                        line.jobId,
                        invoice.linkedJobs?.find((job) => job.id === line.jobId)?.jobNumber,
                        invoice.linkedJobs,
                      );
                      const source = lineJobReference.kind === "none" ? "General" : lineJobReference.label;
                      return (
                        <div key={line.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-800 truncate">{line.description}</p>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {source} · {line.quantity} × {formatCurrency(Number(line.unitPrice))}
                              {Number(line.discountAmount) > 0 ? ` · −${formatCurrency(Number(line.discountAmount))}` : ""}
                              {Number(line.taxAmount) > 0 ? ` · +${formatCurrency(Number(line.taxAmount))} tax` : ""}
                            </p>
                          </div>
                          <span className="text-sm font-bold text-slate-900 tabular-nums shrink-0">{formatCurrency(Number(line.lineTotal))}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {/* Invoice details */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Receipt className="w-4 h-4 text-slate-400" />
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Invoice Details</h3>
            </div>

            <div className="space-y-0">
              {[
                { label: "Invoice #",  value: <span className="font-mono text-sm">{invoice.invoiceNumber}</span> },
                { label: "Subtotal",   value: formatCurrency(invoice.subtotal) },
                ...(invoice.taxAmount > 0 ? [{ label: "Tax", value: formatCurrency(invoice.taxAmount) }] : []),
                { label: "Cash paid", value: formatCurrency(invoice.amountPaid) },
                ...(creditBalanceReduction > 0
                  ? [{ label: "Credit-note reduction", value: <span className="text-violet-700 font-semibold">−{formatCurrency(creditBalanceReduction)}</span> }]
                  : []),
                ...(customerCreditIssued > 0
                  ? [{ label: "Customer credit issued", value: <span className="text-amber-700 font-semibold">{formatCurrency(customerCreditIssued)}</span> }]
                  : []),
                { label: "Total",
                  value: <span className="text-lg font-bold text-slate-900">{formatCurrency(invoice.totalAmount)}</span> },
                { label: "Balance Due",
                  value: invoice.balanceDue > 0
                    ? <span className={`font-bold ${isOverdue ? "text-red-600" : "text-slate-700"}`}>{formatCurrency(invoice.balanceDue)}</span>
                    : <span className={`font-bold ${isVoided ? "text-slate-500" : isCredited ? "text-violet-600" : "text-emerald-600"}`}>
                        {isVoided ? "Voided" : isCredited ? "Credited in full" : "Paid in full ✓"}
                      </span> },
                { label: "Due Date",
                  value: invoice.dueDate ? fmtDate(invoice.dueDate) : "Upon Receipt" },
                ...(isPaid && invoice.paidAt
                  ? [{ label: "Paid On",
                      value: <span className="text-emerald-700 font-semibold flex items-center gap-1.5">
                               <CheckCircle2 className="w-3.5 h-3.5" />{fmtDate(invoice.paidAt, false)}
                             </span> }]
                  : []),
              ].map(({ label, value }) => (
                <div key={label} className="flex items-start justify-between gap-4 py-3 border-b border-slate-50 last:border-0">
                  <span className="text-sm text-slate-500 shrink-0">{label}</span>
                  <span className="text-sm font-medium text-slate-900 text-right">{value ?? "—"}</span>
                </div>
              ))}
            </div>

            {invoice.notes && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Notes</p>
                <p className="text-sm text-slate-700 leading-relaxed">{invoice.notes}</p>
              </div>
            )}
          </div>

          {invoice.correctionHistory && (
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-violet-500" />
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Correction history</h3>
              </div>
              <div className="space-y-3 text-sm">
                {invoice.correctionHistory.void && (
                  <div className="rounded-xl bg-slate-50 px-3 py-2">
                    <p className="font-semibold text-slate-700">Voided · {fmtDateShort(invoice.correctionHistory.void.voidedAt, false)}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{invoice.correctionHistory.void.reason}</p>
                  </div>
                )}
                {invoice.correctionHistory.creditNotes.map((note) => (
                  <div key={note.id} className="rounded-xl bg-violet-50 px-3 py-2">
                    <div className="flex justify-between gap-3">
                      <p className="font-semibold text-violet-800">{note.creditNumber}</p>
                      <span className="font-bold text-violet-800">−{formatCurrency(note.totalAmount)}</span>
                    </div>
                    <p className="text-xs text-violet-700 mt-0.5">{note.reason}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[11px] text-violet-700">
                      <span>Balance reduction {formatCurrency(note.balanceReductionAmount ?? 0)}</span>
                      {(note.customerCreditAmount ?? 0) > 0 && <span>Customer credit {formatCurrency(note.customerCreditAmount)}</span>}
                    </div>
                  </div>
                ))}
                {invoice.correctionHistory.reissue && (
                  <button onClick={() => navigate(`/invoices/${invoice.correctionHistory!.reissue!.replacementInvoiceId}`)}
                    className="w-full text-left rounded-xl bg-primary/5 px-3 py-2 text-primary hover:bg-primary/10">
                    <p className="font-semibold">Replacement invoice created</p>
                    <p className="text-xs mt-0.5">Open invoice #{invoice.correctionHistory.reissue.replacementInvoiceId} →</p>
                  </button>
                )}
                {invoice.correctionHistory.replacementOf && (
                  <button onClick={() => navigate(`/invoices/${invoice.correctionHistory!.replacementOf!.sourceInvoiceId}`)}
                    className="w-full text-left rounded-xl bg-slate-50 px-3 py-2 text-slate-700 hover:bg-slate-100">
                    <p className="font-semibold">Replacement of invoice</p>
                    <p className="text-xs mt-0.5">Open original invoice #{invoice.correctionHistory.replacementOf.sourceInvoiceId} →</p>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Mobile: action buttons at bottom of content */}
          <div className="sm:hidden space-y-2">
            {!isClosed && (
              <button
                onClick={() => doStatus("paid")}
            disabled={markPaidMutation.isPending || !(Number(invoice.balanceDue) > 0)}
                className="w-full flex items-center justify-center gap-2 h-12 rounded-xl
                           bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold
                           shadow-sm shadow-emerald-200 transition-all disabled:opacity-60"
              >
                <CheckCircle2 className="w-5 h-5" /> Mark Paid
              </button>
            )}
            {stripeLink && !isClosed && (
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(stripeLink);
                    toast({ title: "Payment link copied!" });
                  } catch {
                    toast({ title: "Could not copy", variant: "destructive" });
                  }
                }}
                className="w-full flex items-center justify-center gap-2 h-11 rounded-xl
                           border-2 border-primary/30 text-primary bg-white text-sm font-bold
                           hover:bg-primary/5 transition-all"
              >
                <Copy className="w-4 h-4" /> Copy Payment Link
              </button>
            )}
            <div className="flex gap-2">
              {!isSent && !isClosed && (
                <button onClick={() => doStatus("sent")} disabled={updateMutation.isPending}
                  className="flex-1 h-10 rounded-xl border-2 border-blue-200 text-blue-700 text-sm font-bold hover:bg-blue-50 transition-all disabled:opacity-60">
                  <Send className="w-4 h-4 inline mr-1" /> Mark Sent
                </button>
              )}
              {!isOverdue && !isClosed && (
                <button onClick={() => doStatus("overdue")} disabled={updateMutation.isPending}
                  className="flex-1 h-10 rounded-xl border-2 border-amber-200 text-amber-700 text-sm font-bold hover:bg-amber-50 transition-all disabled:opacity-60">
                  <AlertTriangle className="w-4 h-4 inline mr-1" /> Overdue
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ─── RIGHT: Sticky sidebar ─────────────── */}
        <div className="hidden lg:flex flex-col gap-4">

          {/* Summary (sticky) */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5 sticky top-20">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-4">Summary</h3>

            <div className="space-y-2 pb-3 border-b border-slate-100">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Subtotal</span>
                <span className="font-semibold text-slate-700">{formatCurrency(invoice.subtotal)}</span>
              </div>
              {invoice.taxAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Tax</span>
                  <span className="font-medium text-slate-700">{formatCurrency(invoice.taxAmount)}</span>
                </div>
              )}
            </div>

            {/* Total */}
            <div className="flex justify-between items-end mt-3">
              <span className="text-base font-bold text-slate-800">Total</span>
              <span className="text-3xl font-bold text-slate-900 tabular-nums">{formatCurrency(invoice.totalAmount)}</span>
            </div>

            {/* Balance */}
            {invoice.balanceDue > 0 && !isClosed ? (
              <div className={`mt-2 px-3 py-2 rounded-xl text-xs font-bold text-center ${isOverdue ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                {formatCurrency(invoice.balanceDue)} balance due
              </div>
            ) : isPaid ? (
              <div className="mt-2 px-3 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-bold text-center flex items-center justify-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Paid in full
              </div>
            ) : isVoided ? (
              <div className="mt-2 px-3 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold text-center">Voided</div>
            ) : isCredited ? (
              <div className="mt-2 px-3 py-2 rounded-xl bg-violet-50 text-violet-700 text-xs font-bold text-center">Credited in full</div>
            ) : null}

            {/* Quick actions in sidebar */}
            {!isClosed && (
              <div className="mt-4 space-y-2">
                <button
                  onClick={() => doStatus("paid")}
                  disabled={markPaidMutation.isPending || !(Number(invoice.balanceDue) > 0)}
                  className="w-full flex items-center justify-center gap-2 h-10 rounded-xl
                             bg-emerald-500 hover:bg-emerald-600 active:scale-[.98]
                             text-white text-sm font-bold shadow-sm shadow-emerald-200
                             transition-all disabled:opacity-60"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Mark Paid
                </button>
                {!isSent && (
                  <button
                    onClick={() => doStatus("sent")}
                    disabled={updateMutation.isPending}
                    className="w-full flex items-center justify-center gap-2 h-9 rounded-xl
                               border-2 border-blue-200 text-blue-700 hover:bg-blue-50 active:scale-[.98]
                               text-sm font-bold transition-all disabled:opacity-60"
                  >
                    <Send className="w-3.5 h-3.5" /> Mark Sent
                  </button>
                )}
                {!isOverdue && (
                  <button
                    onClick={() => doStatus("overdue")}
                    disabled={updateMutation.isPending}
                    className="w-full flex items-center justify-center gap-2 h-9 rounded-xl
                               border border-amber-200 text-amber-700 hover:bg-amber-50 active:scale-[.98]
                               text-sm font-semibold transition-all disabled:opacity-60"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" /> Mark Overdue
                  </button>
                )}
                {canCredit && (
                  <button onClick={() => setCorrectionAction("credit")}
                    className="w-full flex items-center justify-center gap-2 h-9 rounded-xl border border-violet-200 text-violet-700 hover:bg-violet-50 text-xs font-bold">
                    <FilePlus2 className="w-3.5 h-3.5" /> Create Credit Note
                  </button>
                )}
                {canVoid && (
                  <button onClick={() => setCorrectionAction("void")}
                    className="w-full flex items-center justify-center gap-2 h-9 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-bold">
                    <Ban className="w-3.5 h-3.5" /> Void Invoice
                  </button>
                )}
              </div>
            )}
            {canReissue && (
              <button onClick={() => setCorrectionAction("reissue")}
                className="mt-3 w-full flex items-center justify-center gap-2 h-9 rounded-xl border border-primary/30 text-primary hover:bg-primary/5 text-xs font-bold">
                <FilePlus2 className="w-3.5 h-3.5" /> Reissue Invoice
              </button>
            )}

            {/* Return to draft */}
            {!isDraft && !isClosed && (
              <button
                onClick={() => setConfirmAction("draft")}
                className="mt-2 w-full flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 font-medium transition-colors py-1"
              >
                <RotateCcw className="w-3 h-3" /> Return to Draft
              </button>
            )}
          </div>

          {/* Customer */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Building2 className="w-3.5 h-3.5 text-slate-400" />
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Customer</h3>
            </div>
            <p className="font-bold text-slate-900 text-sm">
              {invoice.customerName ?? `Customer #${invoice.customerId}`}
            </p>
            <button
              onClick={() => navigate(`/customers/${invoice.customerId}`)}
              className="text-xs text-primary hover:underline font-medium mt-1"
            >
              View customer →
            </button>
          </div>

          {/* Service property */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <PropertyPicker
              customerId={invoice.customerId}
              value={propertyId}
              preserveEmpty
              disabled={updateMutation.isPending}
              onChange={saveProperty}
            />
            <p className="text-[11px] text-slate-400 mt-2">
              This invoice keeps its own property link; changing the job later will not move it.
            </p>
          </div>

          {/* Linked Job */}
          {primaryJobReference.kind !== "none" && (
            <div className="bg-white rounded-2xl border border-slate-100 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Briefcase className="w-3.5 h-3.5 text-slate-400" />
                <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Linked Job</h3>
              </div>
              <p className="font-mono font-bold text-slate-900 text-sm">
                {primaryJobReference.label}
              </p>
              {primaryJobReference.kind === "available" && (
                <button onClick={() => navigate(primaryJobReference.href)}
                  className="text-xs text-primary hover:underline font-medium mt-1">
                  View job →
                </button>
              )}
              {primaryJobReference.kind === "unavailable" && (
                <p className="text-xs text-slate-400 font-medium mt-1">The original job record is no longer available.</p>
              )}
            </div>
          )}

          {/* Timeline */}
          <div className="bg-white rounded-2xl border border-slate-100 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400">Timeline</h3>
            </div>
            <div className="space-y-2">
              {[
                { label: "Created", value: fmtDateShort(invoice.createdAt, false) },
                { label: "Updated", value: fmtDateShort(invoice.updatedAt, false) },
                ...(invoice.dueDate ? [{
                  label: "Due",
                  value: <span className={isOverdue && !isPaid ? "text-red-600 font-bold" : ""}>{fmtDateShort(invoice.dueDate)}</span>
                }] : []),
                ...(isPaid && invoice.paidAt ? [{
                  label: "Paid",
                  value: <span className="text-emerald-600 font-bold">{fmtDateShort(invoice.paidAt, false)}</span>
                }] : []),
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between text-xs">
                  <span className="text-slate-500">{label}</span>
                  <span className="text-slate-700 font-medium">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Return to Draft confirm ───────────────── */}
      {confirmAction === "draft" && (
        <ConfirmModal
          title="Return to Draft?"
          description="This will reset the invoice to draft status. Any payment date recorded will be cleared."
          confirmLabel="Return to Draft"
          onConfirm={() => doStatus("draft")}
          onClose={() => setConfirmAction(null)}
          loading={updateMutation.isPending}
        />
      )}
      {correctionAction && (
        <CorrectionModal
          kind={correctionAction}
          balanceDue={invoice.balanceDue}
          lines={(invoice.invoiceLines ?? []).map((line) => ({
            id: line.id,
            description: line.description,
            lineTotal: line.lineTotal,
          }))}
          loading={correctionMutation.isPending}
          onClose={() => {
            if (!correctionMutation.isPending) setCorrectionAction(null);
          }}
          onSubmit={(reason, lines) => correctionMutation.mutate({
            action: correctionAction,
            reason,
            lines,
          })}
        />
      )}
    </Layout>
  );
}
