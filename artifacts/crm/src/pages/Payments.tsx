import { useEffect, useRef, useState } from "react";
import { Layout } from "@/components/Layout";
import {
  createPayment,
  getListInvoicesQueryKey,
  getGetInvoiceQueryKey,
  getListPaymentsQueryKey,
  useListInvoices,
  useListPayments,
  useGetCustomerCreditSummaryByCustomer,
  getGetCustomerCreditSummaryByCustomerQueryKey,
  getGetCustomerQueryKey,
  getListCustomersQueryKey,
  applyCustomerCredit,
  createCustomerCreditRefund,
  useGetFinancialCapabilities,
  getGetFinancialCapabilitiesQueryKey,
  useGeneratePaymentLink,
} from "@workspace/api-client-react";
import type { PaymentAllocationInput } from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  CreditCard,
  Link2,
  Copy,
  Check,
  Clock,
  DollarSign,
  ExternalLink,
  Send,
  AlertCircle,
  Banknote,
  ArrowUpRight,
  CheckCircle2,
  WalletCards,
  Undo2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { createIdempotencyKey, idempotencyRequest } from "@/lib/idempotency";
import { useAuth } from "@workspace/replit-auth-web";
import { authScopedQueryKey } from "@/lib/auth-scope";
import {
  isValidManualPaymentMethod,
  isValidPaymentDate,
  parsePaymentCents,
} from "@/lib/payment-validation";

function parseCents(value: unknown): bigint {
  const raw = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return 0n;
  const [whole, fraction = ""] = raw.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

function formatCents(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

function displayCents(cents: bigint): string {
  return `$${formatCents(cents)}`;
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Payments() {
  const { user } = useAuth();
  const { data: invoices = [] } = useListInvoices(undefined, {
    query: { queryKey: authScopedQueryKey(user, getListInvoicesQueryKey()) },
  });
  const { data: payments = [] } = useListPayments();
  const {
    data: financialCapabilities,
    isLoading: financialCapabilitiesLoading,
    isError: financialCapabilitiesError,
  } = useGetFinancialCapabilities({
    query: { queryKey: authScopedQueryKey(user, getGetFinancialCapabilitiesQueryKey()) },
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [recordForm, setRecordForm] = useState({
    customerId: "",
    amount: "",
    paymentDate: todayString(),
    method: "check",
    reference: "",
    note: "",
    mode: "auto" as "manual" | "auto",
  });
  const [manualAllocations, setManualAllocations] = useState<Record<number, string>>({});
  const recordIdempotencyKey = useRef<string | null>(null);
  const [creditCustomerId, setCreditCustomerId] = useState("");
  const [creditMode, setCreditMode] = useState<"oldest" | "manual">("oldest");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [creditInvoiceAllocations, setCreditInvoiceAllocations] = useState<Record<number, string>>({});
  const [creditOpen, setCreditOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundForm, setRefundForm] = useState({ amount: "", refundDate: todayString(), method: "check", reason: "", reference: "", note: "" });
  const [refundMode, setRefundMode] = useState<"oldest" | "manual">("oldest");
  const [refundSourceAllocations, setRefundSourceAllocations] = useState<Record<string, string>>({});
  const canRecordPayment = financialCapabilities?.capabilities.includes("payments.record") ?? false;
  const canApplyCredit = financialCapabilities?.capabilities.includes("customer_credit.apply") ?? false;
  const canRecordRefund = financialCapabilities?.capabilities.includes("refunds.record") ?? false;

  const recordPaymentMutation = useMutation({
    mutationFn: (input: Parameters<typeof createPayment>[0]) =>
      createPayment(input, idempotencyRequest(recordIdempotencyKey.current ??= createIdempotencyKey())),
    onSuccess: (data) => {
      recordIdempotencyKey.current = null;
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListPaymentsQueryKey()) });
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListInvoicesQueryKey()) });
      for (const allocation of data.allocations) {
        queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getGetInvoiceQueryKey(allocation.invoiceId)) });
        queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, ["invoice-payments", allocation.invoiceId]) });
      }
      queryClient.invalidateQueries({
        queryKey: authScopedQueryKey(user, getGetCustomerCreditSummaryByCustomerQueryKey(data.customerId)),
      });
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getGetCustomerQueryKey(data.customerId)) });
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListCustomersQueryKey()) });
      setRecordOpen(false);
      setManualAllocations({});
      toast({ title: "Payment recorded" });
    },
    onError: (error: unknown) => {
      const message = (error as { data?: { error?: string } })?.data?.error ?? "Failed to record payment";
      toast({ title: message, variant: "destructive" });
    },
  });
  useEffect(() => {
    if (!recordPaymentMutation.isPending) recordIdempotencyKey.current = null;
  }, [recordForm, manualAllocations]);
  const generatePaymentLinkMutation = useGeneratePaymentLink({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListInvoicesQueryKey()) });
        setGenerateOpen(false);
        setSelectedInvoice(null);
        toast({ title: data.alreadyExisted ? "Payment link retrieved" : "Payment link created" });
      },
      onError: (error: unknown) => {
        const message = (error as { data?: { error?: string } })?.data?.error ?? "Unable to generate a payment link";
        toast({ title: message, variant: "destructive" });
      },
    },
  });

  const copyLink = (id: string, link: string) => {
    navigator.clipboard.writeText(link);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({ title: "Link copied to clipboard" });
  };

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const totalCollectedCents = (payments as any[])
    .filter((payment) => new Date(`${payment.paymentDate}T00:00:00`) >= thirtyDaysAgo)
    .reduce((sum: bigint, payment: any) => sum + parseCents(payment.amount), 0n);
  const totalPendingCents = (invoices as any[])
    .filter((invoice) => !["paid", "voided", "credited"].includes(invoice.status))
    .reduce((sum: bigint, invoice: any) => sum + parseCents(invoice.balanceDue), 0n);
  const paymentLinkInvoices = (invoices as any[]).filter((invoice) => !!invoice.stripePaymentLink);

  const unpaidInvoices = (invoices as any[]).filter((inv: any) =>
    !["paid", "voided", "credited"].includes(inv.status) && parseCents(inv.balanceDue) > 0n);
  const customerOptions = Array.from(new Map(
    unpaidInvoices.map((invoice: any) => [
      invoice.customerId,
      { id: invoice.customerId, name: invoice.customerName ?? `Customer #${invoice.customerId}` },
    ]),
  ).values());
  const allCustomerOptions = Array.from(new Map(
    [...(invoices as any[]), ...(payments as any[])].map((record: any) => [
      record.customerId,
      { id: record.customerId, name: record.customerName ?? `Customer #${record.customerId}` },
    ]),
  ).values());
  const selectedCreditCustomerId = Number(creditCustomerId || allCustomerOptions[0]?.id || 0);
  const creditQuery = useGetCustomerCreditSummaryByCustomer(selectedCreditCustomerId, {
    query: {
      queryKey: authScopedQueryKey(user, getGetCustomerCreditSummaryByCustomerQueryKey(selectedCreditCustomerId)),
      enabled: selectedCreditCustomerId > 0,
    },
  });
  const creditSummary = creditQuery.data;
  const creditCustomerInvoices = (invoices as any[])
    .filter((invoice: any) =>
      Number(invoice.customerId) === selectedCreditCustomerId &&
      !["voided", "credited", "paid"].includes(invoice.status) &&
      parseCents(invoice.balanceDue) > 0n,
    )
    .sort((a: any, b: any) => String(a.dueDate ?? "9999-12-31").localeCompare(String(b.dueDate ?? "9999-12-31")) || a.id - b.id);
  const creditPreview = (() => {
    const result: Array<{ invoiceId: number; amount: string }> = [];
    let remaining = parseCents(creditAmount);
    if (creditMode === "manual") {
      return Object.entries(creditInvoiceAllocations)
        .filter(([, value]) => parseCents(value) > 0n)
        .map(([invoiceId, amount]) => ({ invoiceId: Number(invoiceId), amount }));
    }
    for (const invoice of creditCustomerInvoices) {
      if (remaining <= 0n) break;
      const allocation = remaining < parseCents(invoice.balanceDue) ? remaining : parseCents(invoice.balanceDue);
      if (allocation > 0n) {
        result.push({ invoiceId: invoice.id, amount: formatCents(allocation) });
        remaining -= allocation;
      }
    }
    return result;
  })();
  const previewCreditCents = creditPreview.reduce((sum, item) => sum + parseCents(item.amount), 0n);
  const previewCreditRemaining = parseCents(creditAmount) > previewCreditCents ? parseCents(creditAmount) - previewCreditCents : 0n;
  const applyCreditMutation = useMutation({
    mutationFn: (body: any) => applyCustomerCredit(body, idempotencyRequest(createIdempotencyKey())),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getGetCustomerCreditSummaryByCustomerQueryKey(selectedCreditCustomerId)) });
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListInvoicesQueryKey()) });
      setCreditOpen(false);
      setCreditAmount("");
      setCreditReason("");
      setCreditInvoiceAllocations({});
      toast({
        title: "approvalRequired" in data ? "Approval request submitted" : "Customer credit applied",
        description: "approvalRequired" in data ? "The credit will execute after an authorized approver accepts it." : undefined,
      });
    },
    onError: (error: any) => toast({ title: error?.data?.error ?? "Failed to apply customer credit", variant: "destructive" }),
  });
  const refundMutation = useMutation({
    mutationFn: (body: any) => createCustomerCreditRefund(body, idempotencyRequest(createIdempotencyKey())),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getGetCustomerCreditSummaryByCustomerQueryKey(selectedCreditCustomerId)) });
      queryClient.invalidateQueries({ queryKey: authScopedQueryKey(user, getListPaymentsQueryKey()) });
      setRefundOpen(false);
      setRefundForm({ amount: "", refundDate: todayString(), method: "check", reason: "", reference: "", note: "" });
      setRefundSourceAllocations({});
      toast({
        title: "approvalRequired" in data ? "Approval request submitted" : "Refund recorded",
        description: "approvalRequired" in data
          ? "An authorized approver must accept it. No money is sent by this recorded-refund workflow."
          : "The ledger was updated; no money was sent.",
      });
    },
    onError: (error: any) => toast({ title: error?.data?.error ?? "Failed to record refund", variant: "destructive" }),
  });
  const selectedCustomerInvoices = unpaidInvoices
    .filter((invoice: any) => String(invoice.customerId) === recordForm.customerId)
    .sort((a: any, b: any) =>
      String(a.dueDate ?? "9999-12-31").localeCompare(String(b.dueDate ?? "9999-12-31")) ||
      Number(a.id) - Number(b.id),
    );
  const paymentCents = parseCents(recordForm.amount);
  const previewAllocations: PaymentAllocationInput[] = recordForm.mode === "manual"
    ? Object.entries(manualAllocations)
        .filter(([, amount]) => parseCents(amount) > 0n)
        .map(([invoiceId, amount]) => ({ invoiceId: Number(invoiceId), amount }))
    : (() => {
        let remaining = paymentCents;
        const result: PaymentAllocationInput[] = [];
        for (const invoice of selectedCustomerInvoices) {
          if (remaining <= 0n) break;
          const balance = parseCents(invoice.balanceDue);
          if (balance <= 0n) continue;
          const allocation = remaining < balance ? remaining : balance;
          result.push({ invoiceId: invoice.id, amount: formatCents(allocation) });
          remaining -= allocation;
        }
        return result;
      })();
  const previewAllocatedCents = previewAllocations.reduce((sum, allocation) =>
    sum + parseCents(allocation.amount), 0n);
  const previewUnappliedCents = paymentCents > previewAllocatedCents
    ? paymentCents - previewAllocatedCents
    : 0n;
  const selectedOutstandingCents = selectedCustomerInvoices.reduce(
    (sum: bigint, invoice: any) => sum + parseCents(invoice.balanceDue),
    0n,
  );
  const manualAllocationIsValid = recordForm.mode !== "manual" || (
    previewAllocatedCents === paymentCents
    && previewAllocations.length > 0
    && previewAllocations.every((allocation) => {
      const invoice = selectedCustomerInvoices.find((candidate: any) => candidate.id === allocation.invoiceId);
      return !!invoice && parseCents(allocation.amount) <= parseCents(invoice.balanceDue);
    })
  );
  const recordPaymentValidationError = (() => {
    if (
      !recordForm.customerId
      || !Number.isInteger(Number(recordForm.customerId))
      || !customerOptions.some((customer) => customer.id === Number(recordForm.customerId))
    ) return "Choose a valid customer";
    const parsedAmount = parsePaymentCents(recordForm.amount);
    if (parsedAmount === null || parsedAmount <= 0n) return "Payment amount must be greater than zero";
    if (parsedAmount > selectedOutstandingCents) return "Payment amount cannot exceed the customer's outstanding balance";
    if (!isValidPaymentDate(recordForm.paymentDate)) return "Choose a valid payment date";
    if (!isValidManualPaymentMethod(recordForm.method)) return "Choose a valid payment method";
    if (!manualAllocationIsValid) return "Manual allocations must exactly match the payment and stay within invoice balances";
    return null;
  })();

  const openRecordPayment = () => {
    if (!canRecordPayment) return;
    setRecordForm((current) => ({
      ...current,
      customerId: current.customerId || String(customerOptions[0]?.id ?? ""),
      paymentDate: todayString(),
    }));
    setManualAllocations({});
    setRecordOpen(true);
  };

  const submitPayment = () => {
    if (recordPaymentMutation.isPending || recordPaymentValidationError) return;
    recordPaymentMutation.mutate({
      customerId: Number(recordForm.customerId),
      amount: recordForm.amount,
      paymentDate: recordForm.paymentDate,
      method: recordForm.method,
      reference: recordForm.reference || null,
      note: recordForm.note || null,
      mode: recordForm.mode,
      allocations: previewAllocations,
    });
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Payments</h1>
            <p className="text-slate-500 mt-1">Generate payment links and track collections</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Button
                onClick={openRecordPayment}
                disabled={financialCapabilitiesLoading || financialCapabilitiesError || !canRecordPayment}
                title={financialCapabilitiesLoading
                  ? "Checking payment permission…"
                  : financialCapabilitiesError
                    ? "Payment permission could not be loaded"
                    : !canRecordPayment
                      ? "You do not have permission to record payments"
                      : undefined}
                className="gap-2 bg-emerald-600 hover:bg-emerald-700"
              >
                <Banknote className="w-4 h-4" /> Record Payment
              </Button>
              <Button onClick={() => setGenerateOpen(true)} variant="outline" className="gap-2">
                <Link2 className="w-4 h-4" /> Generate Payment Link
              </Button>
            </div>
            {(financialCapabilitiesLoading || financialCapabilitiesError || !canRecordPayment) && (
              <p className="text-xs text-slate-500 text-right">
                {financialCapabilitiesLoading
                  ? "Checking payment permission…"
                  : financialCapabilitiesError
                    ? "Payment permission could not be loaded."
                    : "Your role cannot record payments."}
              </p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-5 pb-5">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-100 rounded-xl">
                  <DollarSign className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Collected (30 days)</p>
                  <p className="text-2xl font-bold text-slate-900">{displayCents(totalCollectedCents)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-5">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-yellow-100 rounded-xl">
                  <Clock className="w-6 h-6 text-yellow-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Open invoice balance</p>
                  <p className="text-2xl font-bold text-slate-900">{displayCents(totalPendingCents)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-5">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-red-100 rounded-xl">
                  <AlertCircle className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Unapplied credit</p>
                  <p className="text-2xl font-bold text-slate-900">{displayCents((payments as any[]).reduce((sum: bigint, payment: any) => sum + parseCents(payment.unappliedAmount), 0n))}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="links">
          <TabsList>
            <TabsTrigger value="links">Payment Links</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="credits">Customer Credits</TabsTrigger>
          </TabsList>

          <TabsContent value="links" className="mt-4 space-y-3">
            {paymentLinkInvoices.map((invoice: any) => {
              const link = invoice.stripePaymentLink as string;
              return (
                <Card key={invoice.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-4">
                      <div className="p-2.5 bg-slate-100 rounded-xl flex-shrink-0">
                        <CreditCard className="w-5 h-5 text-slate-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-semibold text-slate-900">{invoice.customerName ?? `Customer #${invoice.customerId}`}</span>
                          <span className="text-slate-400 text-sm">·</span>
                          <span className="text-slate-500 text-sm">{invoice.invoiceNumber ?? `Invoice #${invoice.id}`}</span>
                          <span className="ml-auto px-2 py-0.5 rounded-full text-xs font-medium flex items-center gap-1 bg-blue-100 text-blue-800">
                            <Link2 className="w-3 h-3" />
                            Link ready
                          </span>
                        </div>
                        <p className="text-2xl font-bold text-slate-900">{displayCents(parseCents(invoice.balanceDue))}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <div className="flex-1 min-w-0 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                            <Link2 className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                            <span className="text-sm text-slate-500 truncate font-mono">{link}</span>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => copyLink(String(invoice.id), link)}
                            className="flex-shrink-0 gap-1.5"
                          >
                            {copiedId === String(invoice.id) ? (
                              <><Check className="w-3.5 h-3.5 text-green-500" /> Copied</>
                            ) : (
                              <><Copy className="w-3.5 h-3.5" /> Copy</>
                            )}
                          </Button>
                          <Button size="sm" variant="outline" className="flex-shrink-0" title="Open link" asChild>
                            <a href={link} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </Button>
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                          <span>Invoice created {format(new Date(invoice.createdAt), "MMM d, yyyy")}</span>
                          <span>{displayCents(parseCents(invoice.balanceDue))} remaining</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {paymentLinkInvoices.length === 0 && (
              <Card><CardContent className="p-10 text-center text-sm text-slate-500">
                No payment links have been generated. Payment links require a connected Stripe account; recording cash, check, ACH, or other payments does not.
              </CardContent></Card>
            )}
          </TabsContent>

          <TabsContent value="transactions" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="text-left p-4 text-slate-500 font-medium">Customer</th>
                      <th className="text-left p-4 text-slate-500 font-medium">Date</th>
                      <th className="text-left p-4 text-slate-500 font-medium">Method</th>
                      <th className="text-left p-4 text-slate-500 font-medium">Status</th>
                      <th className="text-right p-4 text-slate-500 font-medium">Amount</th>
                    </tr>
                  </thead>
                   <tbody>
                     {(payments as any[]).map((payment: any, i: number) => {
                       const customer = customerOptions.find((option) => option.id === payment.customerId);
                       return (
                         <tr key={payment.id} className={`border-b last:border-0 hover:bg-slate-50 ${i % 2 === 0 ? "" : "bg-slate-50/30"}`}>
                           <td className="p-4 font-medium text-slate-900">{customer?.name ?? `Customer #${payment.customerId}`}</td>
                           <td className="p-4 text-slate-500">{format(new Date(`${payment.paymentDate}T00:00:00`), "MMM d, yyyy")}</td>
                           <td className="p-4 text-slate-500">
                             <span className="flex items-center gap-1.5">
                               <CreditCard className="w-3.5 h-3.5" />
                               {payment.method}
                             </span>
                             {payment.reference && <span className="block text-xs text-slate-400 mt-1">{payment.reference}</span>}
                           </td>
                           <td className="p-4">
                             <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                               {payment.status === "posted" ? "Posted" : payment.status}
                             </span>
                             <span className="block text-xs text-slate-400 mt-1">
                               {payment.allocations?.length ?? 0} allocation{payment.allocations?.length === 1 ? "" : "s"}
                             </span>
                           </td>
                           <td className="p-4 text-right font-semibold text-slate-900">
                             {displayCents(parseCents(payment.amount))}
                             {parseCents(payment.unappliedAmount) > 0n && (
                               <span className="block text-xs font-normal text-amber-600">
                                 {displayCents(parseCents(payment.unappliedAmount))} credit
                               </span>
                             )}
                           </td>
                         </tr>
                       );
                     })}
                     {(payments as any[]).length === 0 && (
                       <tr>
                         <td colSpan={5} className="p-10 text-center text-sm text-slate-500">
                            No recorded payments yet. Use Record Payment to add the first payment.
                         </td>
                       </tr>
                     )}
                   </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="credits" className="mt-4 space-y-4">
            <Card className="overflow-hidden border-violet-100">
              <CardHeader className="bg-gradient-to-r from-violet-50 via-white to-amber-50 border-b border-violet-100">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-slate-900">
                      <WalletCards className="w-5 h-5 text-violet-600" /> Customer credit ledger
                    </CardTitle>
                    <p className="text-sm text-slate-500 mt-1">Unapplied payments and credit-note value, tracked without sending money.</p>
                  </div>
                  <select
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white min-w-52"
                    value={creditCustomerId || String(selectedCreditCustomerId || "")}
                    onChange={(event) => {
                      setCreditCustomerId(event.target.value);
                      setCreditInvoiceAllocations({});
                      setRefundSourceAllocations({});
                    }}
                  >
                    <option value="">Choose a customer…</option>
                    {allCustomerOptions.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
                  </select>
                </div>
              </CardHeader>
              <CardContent className="p-5">
                {!selectedCreditCustomerId ? (
                  <p className="text-sm text-slate-500">Record a payment or invoice first to begin a customer credit ledger.</p>
                ) : creditQuery.isLoading ? (
                  <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                      <div className="rounded-xl bg-violet-50 border border-violet-100 p-4">
                        <p className="text-xs uppercase tracking-wide font-bold text-violet-600">Available customer credit</p>
                        <p className="text-3xl font-bold text-violet-900 mt-1">${Number(creditSummary?.availableTotal ?? 0).toFixed(2)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 border border-slate-100 p-4">
                        <p className="text-xs uppercase tracking-wide font-bold text-slate-500">Open sources</p>
                        <p className="text-3xl font-bold text-slate-900 mt-1">{creditSummary?.sources.filter((source) => source.availableAmount > 0).length ?? 0}</p>
                      </div>
                      <div className="rounded-xl bg-amber-50 border border-amber-100 p-4">
                        <p className="text-xs uppercase tracking-wide font-bold text-amber-700">Ledger movements</p>
                        <p className="text-3xl font-bold text-amber-900 mt-1">{(creditSummary?.applications.length ?? 0) + (creditSummary?.refunds.length ?? 0)}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-5">
                      <Button
                        onClick={() => { setCreditMode("oldest"); setCreditOpen(true); }}
                        disabled={!canApplyCredit || !creditSummary?.availableTotal || creditCustomerInvoices.length === 0}
                        className="gap-2 bg-violet-600 hover:bg-violet-700"
                      >
                        <ArrowUpRight className="w-4 h-4" /> Apply Credit
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => { setRefundMode("oldest"); setRefundOpen(true); }}
                        disabled={!canRecordRefund || !creditSummary?.availableTotal}
                        className="gap-2 border-amber-200 text-amber-800 hover:bg-amber-50"
                      >
                        <Undo2 className="w-4 h-4" /> Record Refund
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                      <div>
                        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Credit sources</h3>
                        <div className="space-y-2">
                          {(creditSummary?.sources ?? []).filter((source) => source.availableAmount > 0).map((source) => (
                            <div key={source.sourceKey} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2.5">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-800 truncate">{source.label}</p>
                                <p className="text-xs text-slate-400">{source.sourceType === "payment" ? "Unapplied payment" : "Credit-note customer credit"}</p>
                              </div>
                              <span className="font-bold text-violet-700">${source.availableAmount.toFixed(2)}</span>
                            </div>
                          ))}
                          {(creditSummary?.sources ?? []).filter((source) => source.availableAmount > 0).length === 0 && (
                            <p className="text-sm text-slate-500 rounded-xl bg-slate-50 p-4">No available credit for this customer.</p>
                          )}
                        </div>
                      </div>
                      <div>
                        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Recent history</h3>
                        <div className="space-y-2 max-h-56 overflow-y-auto">
                          {(creditSummary?.applications ?? []).slice(0, 5).map((application) => (
                            <div key={`application-${application.id}`} className="flex items-center justify-between rounded-xl bg-emerald-50 px-3 py-2 text-sm">
                              <span className="text-emerald-800">Applied to {application.invoiceNumber ?? `Invoice #${application.invoiceId}`}</span>
                              <span className="font-bold text-emerald-800">−${application.amount.toFixed(2)}</span>
                            </div>
                          ))}
                          {(creditSummary?.refunds ?? []).slice(0, 5).map((refund) => (
                            <div key={`refund-${refund.id}`} className="flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-sm">
                              <span className="text-amber-800">Refund {refund.refundNumber}</span>
                              <span className="font-bold text-amber-800">−${refund.amount.toFixed(2)}</span>
                            </div>
                          ))}
                          {(creditSummary?.applications.length ?? 0) + (creditSummary?.refunds.length ?? 0) === 0 && (
                            <p className="text-sm text-slate-500 rounded-xl bg-slate-50 p-4">No credit or refund movements yet.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Apply customer credit dialog */}
      <Dialog open={creditOpen} onOpenChange={setCreditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Apply customer credit</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-xl bg-violet-50 border border-violet-100 p-3 text-sm text-violet-900">
              Available for {allCustomerOptions.find((customer) => customer.id === selectedCreditCustomerId)?.name ?? `Customer #${selectedCreditCustomerId}`}: <strong>${Number(creditSummary?.availableTotal ?? 0).toFixed(2)}</strong>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["oldest", "manual"] as const).map((mode) => (
                <button key={mode} type="button" onClick={() => setCreditMode(mode)}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold ${creditMode === mode ? "border-violet-400 bg-violet-50 text-violet-800" : "border-slate-200 text-slate-600"}`}>
                  {mode === "oldest" ? "Oldest invoices first" : "Manual allocation"}
                </button>
              ))}
            </div>
            <div>
              <Label>Amount to apply</Label>
              <Input inputMode="decimal" value={creditAmount} onChange={(event) => setCreditAmount(event.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label>Reason (required if approval is enabled)</Label>
              <Input value={creditReason} onChange={(event) => setCreditReason(event.target.value)} placeholder="Why is this credit being applied?" />
            </div>
            {creditMode === "manual" && (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Open invoices</div>
                {creditCustomerInvoices.map((invoice: any) => (
                  <div key={invoice.id} className="flex items-center gap-3 px-4 py-3 border-t border-slate-100">
                    <div className="flex-1"><p className="text-sm font-semibold text-slate-800">{invoice.invoiceNumber}</p><p className="text-xs text-slate-500">{displayCents(parseCents(invoice.balanceDue))} open</p></div>
                    <Input className="w-28" inputMode="decimal" placeholder="0.00" value={creditInvoiceAllocations[invoice.id] ?? ""}
                      onChange={(event) => setCreditInvoiceAllocations({ ...creditInvoiceAllocations, [invoice.id]: event.target.value })} />
                  </div>
                ))}
              </div>
            )}
            <div className="rounded-xl bg-slate-50 border border-slate-100 p-4 space-y-2">
              <div className="flex justify-between text-sm"><span className="text-slate-500">Preview</span><span className="font-semibold">{creditPreview.length} invoice{creditPreview.length === 1 ? "" : "s"}</span></div>
              {creditPreview.map((allocation) => <div key={allocation.invoiceId} className="flex justify-between text-sm"><span>{creditCustomerInvoices.find((invoice: any) => invoice.id === allocation.invoiceId)?.invoiceNumber ?? `Invoice #${allocation.invoiceId}`}</span><strong>${Number(allocation.amount).toFixed(2)}</strong></div>)}
              {previewCreditRemaining > 0n && <p className="border-t border-slate-200 pt-2 text-xs text-amber-700">Unapplied after this operation: {displayCents(previewCreditRemaining)}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditOpen(false)}>Cancel</Button>
            <Button
              disabled={!canApplyCredit || applyCreditMutation.isPending || parseCents(creditAmount) <= 0n || creditPreview.length === 0 || previewCreditRemaining > 0n}
              onClick={() => applyCreditMutation.mutate({
                customerId: selectedCreditCustomerId,
                mode: creditMode,
                amount: creditMode === "oldest" ? creditAmount : undefined,
                allocations: creditPreview,
                reason: creditReason.trim() || undefined,
              })}
              className="bg-violet-600 hover:bg-violet-700"
            >
              {applyCreditMutation.isPending ? "Submitting…" : "Apply credit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record refund dialog */}
      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Record manual refund</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
              <strong>Ledger only:</strong> this records a refund and reduces available credit. It does not send money or call a payment provider.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label>Amount</Label><Input inputMode="decimal" value={refundForm.amount} onChange={(event) => setRefundForm({ ...refundForm, amount: event.target.value })} placeholder="0.00" /></div>
              <div><Label>Refund date</Label><Input type="date" value={refundForm.refundDate} onChange={(event) => setRefundForm({ ...refundForm, refundDate: event.target.value })} /></div>
              <div><Label>Method</Label><select className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white" value={refundForm.method} onChange={(event) => setRefundForm({ ...refundForm, method: event.target.value })}><option>check</option><option>cash</option><option>bank_transfer</option><option>card</option><option>other</option></select></div>
              <div><Label>Reference (optional)</Label><Input value={refundForm.reference} onChange={(event) => setRefundForm({ ...refundForm, reference: event.target.value })} placeholder="Check number or reference" /></div>
            </div>
            <div><Label>Reason</Label><Input value={refundForm.reason} onChange={(event) => setRefundForm({ ...refundForm, reason: event.target.value })} placeholder="Reason for refund" /></div>
            <div><Label>Note (optional)</Label><Input value={refundForm.note} onChange={(event) => setRefundForm({ ...refundForm, note: event.target.value })} placeholder="Internal note" /></div>
            <div className="grid grid-cols-2 gap-2">
              {(["oldest", "manual"] as const).map((mode) => <button key={mode} type="button" onClick={() => setRefundMode(mode)} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${refundMode === mode ? "border-amber-400 bg-amber-50 text-amber-800" : "border-slate-200 text-slate-600"}`}>{mode === "oldest" ? "Oldest credit first" : "Manual source allocation"}</button>)}
            </div>
            {refundMode === "manual" && (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">Available sources</div>
                {(creditSummary?.sources ?? []).filter((source) => source.availableAmount > 0).map((source) => <div key={source.sourceKey} className="flex items-center gap-3 px-4 py-3 border-t border-slate-100"><span className="flex-1 text-sm font-semibold text-slate-700">{source.label}<span className="block text-xs text-slate-400">${source.availableAmount.toFixed(2)} available</span></span><Input className="w-28" inputMode="decimal" placeholder="0.00" value={refundSourceAllocations[source.sourceKey] ?? ""} onChange={(event) => setRefundSourceAllocations({ ...refundSourceAllocations, [source.sourceKey]: event.target.value })} /></div>)}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundOpen(false)}>Cancel</Button>
            <Button
              disabled={!canRecordRefund || refundMutation.isPending || parseCents(refundForm.amount) <= 0n || !refundForm.reason.trim()}
              onClick={() => refundMutation.mutate({
                customerId: selectedCreditCustomerId,
                amount: refundForm.amount,
                refundDate: refundForm.refundDate,
                method: refundForm.method,
                reason: refundForm.reason,
                reference: refundForm.reference || null,
                note: refundForm.note || null,
                mode: refundMode,
                allocations: refundMode === "manual"
                  ? Object.entries(refundSourceAllocations).filter(([, value]) => parseCents(value) > 0n).map(([sourceKey, amount]) => ({ sourceKey, amount }))
                  : undefined,
              })}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {refundMutation.isPending ? "Recording…" : "Record refund"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record Payment Dialog */}
      <Dialog open={recordOpen} onOpenChange={setRecordOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record customer payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Customer</Label>
                <select
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                  value={recordForm.customerId}
                  onChange={(event) => {
                    setRecordForm({ ...recordForm, customerId: event.target.value });
                    setManualAllocations({});
                  }}
                >
                  <option value="">Choose a customer...</option>
                  {customerOptions.map((customer) => (
                    <option key={customer.id} value={customer.id}>{customer.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Amount</Label>
                <Input
                  inputMode="decimal"
                  value={recordForm.amount}
                  onChange={(event) => setRecordForm({ ...recordForm, amount: event.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label>Payment date</Label>
                <Input
                  type="date"
                  value={recordForm.paymentDate}
                  onChange={(event) => setRecordForm({ ...recordForm, paymentDate: event.target.value })}
                />
              </div>
              <div>
                <Label>Method</Label>
                <select
                  className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                  value={recordForm.method}
                  onChange={(event) => setRecordForm({ ...recordForm, method: event.target.value })}
                >
                  <option value="cash">Cash</option>
                  <option value="check">Check</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Reference (optional)</Label>
                <Input
                  value={recordForm.reference}
                  onChange={(event) => setRecordForm({ ...recordForm, reference: event.target.value })}
                  placeholder="Check number or non-sensitive reference"
                />
              </div>
              <div>
                <Label>Note (optional)</Label>
                <Input
                  value={recordForm.note}
                  onChange={(event) => setRecordForm({ ...recordForm, note: event.target.value })}
                  placeholder="Internal note"
                />
              </div>
            </div>
            <div>
              <Label>Apply payment</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {(["auto", "manual"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setRecordForm({ ...recordForm, mode })}
                    className={`rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
                      recordForm.mode === mode
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {mode === "auto" ? "Auto-apply oldest open invoices" : "Manual allocation"}
                  </button>
                ))}
              </div>
            </div>
            {recordForm.mode === "manual" && (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                  Invoice allocations
                </div>
                {selectedCustomerInvoices.length === 0 ? (
                  <p className="p-4 text-sm text-slate-500">No open invoices for this customer.</p>
                ) : selectedCustomerInvoices.map((invoice: any) => (
                  <div key={invoice.id} className="flex items-center gap-3 px-4 py-3 border-t border-slate-100">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800">{invoice.invoiceNumber}</p>
                      <p className="text-xs text-slate-500">{displayCents(parseCents(invoice.balanceDue))} open</p>
                    </div>
                    <Input
                      className="w-32"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={manualAllocations[invoice.id] ?? ""}
                      onChange={(event) => setManualAllocations({
                        ...manualAllocations,
                        [invoice.id]: event.target.value,
                      })}
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Allocation preview</span>
                <span className="font-semibold text-slate-800">{previewAllocations.length} invoice{previewAllocations.length === 1 ? "" : "s"}</span>
              </div>
              {previewAllocations.map((allocation) => {
                const invoice = selectedCustomerInvoices.find((item: any) => item.id === allocation.invoiceId);
                return (
                  <div key={allocation.invoiceId} className="flex justify-between text-sm">
                    <span className="text-slate-600">{invoice?.invoiceNumber ?? `Invoice #${allocation.invoiceId}`}</span>
                    <span className="font-semibold text-slate-800">{displayCents(parseCents(allocation.amount))}</span>
                  </div>
                );
              })}
              <div className="border-t border-slate-200 pt-2 flex justify-between text-sm">
                <span className="font-semibold text-slate-700">Unapplied customer credit</span>
                <span className={`font-bold ${previewUnappliedCents > 0n ? "text-amber-700" : "text-slate-800"}`}>
                  {displayCents(previewUnappliedCents)}
                </span>
              </div>
            </div>
            {recordPaymentValidationError && (
              <p role="alert" className="text-sm text-amber-700">{recordPaymentValidationError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRecordOpen(false)}>Cancel</Button>
            <Button
              onClick={submitPayment}
              disabled={!canRecordPayment || recordPaymentMutation.isPending || !!recordPaymentValidationError}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              <Banknote className="w-4 h-4" />
              {recordPaymentMutation.isPending ? "Recording…" : "Record payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generate Payment Link Dialog */}
      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Generate Payment Link</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800">Stripe payment links</p>
                <p className="text-xs text-amber-700 mt-0.5">This action uses Stripe. If Stripe is not connected, no link will be created; manual payment recording remains available.</p>
              </div>
            </div>
            <div>
              <Label>Select Invoice</Label>
              <select
                className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
                value={selectedInvoice || ""}
                onChange={(e) => setSelectedInvoice(e.target.value)}
              >
                <option value="">Choose an invoice...</option>
                {(invoices as any[]).filter((inv: any) => !["paid", "voided", "credited"].includes(inv.status)).map((inv: any) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoiceNumber ?? `INV-${inv.id}`} — {displayCents(parseCents(inv.balanceDue))}
                  </option>
                ))}
              </select>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Accepted Payment Methods</p>
              <div className="flex flex-wrap gap-2">
                {["Visa", "Mastercard", "Amex", "ACH / Bank"].map((m) => (
                  <span key={m} className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 flex items-center gap-1">
                    <CreditCard className="w-3 h-3 text-slate-400" />
                    {m}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenerateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => selectedInvoice && generatePaymentLinkMutation.mutate({ id: Number(selectedInvoice) })}
              disabled={!selectedInvoice || generatePaymentLinkMutation.isPending}
              className="gap-2"
            >
              <Link2 className="w-4 h-4" /> {generatePaymentLinkMutation.isPending ? "Generating…" : "Generate Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
