import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileWarning,
  Filter,
  Landmark,
  Loader2,
  RefreshCw,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import {
  getExportFinancialReconciliationCsvUrl,
  useGetFinancialReconciliationSummary,
  useListFinancialReconciliationDiscrepancies,
  useListFinancialReconciliationTransactions,
} from "@workspace/api-client-react";
import type {
  FinancialReconciliationTransaction,
  GetFinancialReconciliationSummaryParams,
  ListFinancialReconciliationTransactionsParams,
} from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function money(cents: number | null | undefined) {
  const value = Number(cents ?? 0);
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  return `${sign}$${Math.floor(absolute / 100).toLocaleString("en-US")}.${String(absolute % 100).padStart(2, "0")}`;
}

function errorMessage(error: unknown) {
  const body = (error as { data?: { error?: string } })?.data;
  return body?.error ?? "We couldn’t load the reconciliation report. Try again.";
}

function queryParams(
  startDate: string,
  endDate: string,
  method: string,
  source: string,
  kind: string,
): GetFinancialReconciliationSummaryParams {
  return {
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    ...(method ? { method } : {}),
    ...(source ? { source: source as "payment" | "credit_note" } : {}),
    ...(kind ? {
      kind: kind as "payment" | "refund" | "invoice_credit" | "customer_credit_application",
    } : {}),
  };
}

function SectionHeading({
  eyebrow,
  title,
  description,
  icon: Icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 rounded-xl bg-slate-900 p-2.5 text-white shadow-sm">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{eyebrow}</p>
        <h2 className="text-xl font-bold tracking-tight text-slate-900">{title}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone = "slate",
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "slate" | "emerald" | "rose" | "violet" | "amber";
  icon: LucideIcon;
}) {
  const tones = {
    slate: "border-slate-200 bg-white text-slate-900",
    emerald: "border-emerald-200 bg-emerald-50/60 text-emerald-950",
    rose: "border-rose-200 bg-rose-50/60 text-rose-950",
    violet: "border-violet-200 bg-violet-50/60 text-violet-950",
    amber: "border-amber-200 bg-amber-50/60 text-amber-950",
  };
  return (
    <Card className={tones[tone]}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] opacity-60">{label}</p>
            <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
            <p className="mt-1 text-xs opacity-60">{detail}</p>
          </div>
          <Icon className="h-5 w-5 opacity-60" />
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-48 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading reconciliation…
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
      <BarChart3 className="mx-auto h-8 w-8 text-slate-300" />
      <p className="mt-3 text-sm font-semibold text-slate-700">No {label} in this range</p>
      <p className="mt-1 text-xs text-slate-400">Try expanding the dates or clearing a filter.</p>
    </div>
  );
}

function TransactionLink({ row }: { row: FinancialReconciliationTransaction }) {
  if (row.invoiceId) {
    return <Link className="font-semibold text-primary hover:underline" href={`/invoices/${row.invoiceId}`}>{row.label}</Link>;
  }
  if (row.recordType === "payment" || row.recordType === "refund") {
    return <Link className="font-semibold text-primary hover:underline" href={`/payments?${row.recordType}Id=${row.recordId}`}>{row.label}</Link>;
  }
  return <span className="font-semibold text-slate-700">{row.label}</span>;
}

export default function FinancialReconciliation() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [method, setMethod] = useState("");
  const [source, setSource] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState({ startDate: "", endDate: "", method: "", source: "", kind: "" });
  const serverRangeInitialized = useRef(false);
  const pageSize = 25;
  const params = useMemo(() => queryParams(applied.startDate, applied.endDate, applied.method, applied.source, applied.kind), [applied]);
  const summaryQuery = useGetFinancialReconciliationSummary(params);
  const transactionParams: ListFinancialReconciliationTransactionsParams = { ...params, page, pageSize };
  const transactionsQuery = useListFinancialReconciliationTransactions(transactionParams);
  const discrepancyQuery = useListFinancialReconciliationDiscrepancies({
    startDate: applied.startDate,
    endDate: applied.endDate,
  });
  const summary = summaryQuery.data;
  const transactions = transactionsQuery.data;
  const discrepancies = discrepancyQuery.data;
  const hasError = summaryQuery.isError || transactionsQuery.isError || discrepancyQuery.isError;
  const isLoading = summaryQuery.isLoading || transactionsQuery.isLoading || discrepancyQuery.isLoading;

  useEffect(() => {
    if (!summary || serverRangeInitialized.current) return;
    serverRangeInitialized.current = true;
    setStartDate(summary.range.startDate);
    setEndDate(summary.range.endDate);
  }, [summary]);

  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    setApplied({ startDate, endDate, method, source, kind });
  };

  const exportCsv = () => {
    const url = getExportFinancialReconciliationCsvUrl(params);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const trendMax = Math.max(1, ...(summary?.daily ?? []).map((day) => Math.max(day.cashReceivedCents, day.recordedRefundsCents, day.invoiceCreditsCents, day.customerCreditApplicationsCents)));

  return (
    <Layout>
      <div className="space-y-8" data-testid="financial-reconciliation-page">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              <WalletCards className="h-4 w-4" /> Reports · Sandbox
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-950">Financial reconciliation</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">A read-only view of recorded cash activity, non-cash credits, availability, and outstanding A/R. Nothing here sends money or changes the ledger.</p>
          </div>
          <Button variant="outline" className="gap-2 self-start lg:self-auto" onClick={exportCsv} data-testid="button-export-reconciliation">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>

        <form onSubmit={applyFilters} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="reconciliation-filters">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><Filter className="h-4 w-4 text-primary" /> Report controls</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="text-xs font-semibold text-slate-500">Start date<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800" /></label>
            <label className="text-xs font-semibold text-slate-500">End date<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800" /></label>
            <label className="text-xs font-semibold text-slate-500">Payment method<select value={method} onChange={(e) => setMethod(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800"><option value="">All methods</option><option value="cash">Cash</option><option value="check">Check</option><option value="card">Card</option><option value="ach">ACH</option></select></label>
            <label className="text-xs font-semibold text-slate-500">Source origin<select value={source} onChange={(e) => setSource(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800"><option value="">All origins</option><option value="payment">Payment</option><option value="credit_note">Credit note</option></select></label>
            <label className="text-xs font-semibold text-slate-500">Transaction type<select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800"><option value="">All activity</option><option value="payment">Payments</option><option value="refund">Recorded refunds</option><option value="invoice_credit">Invoice credits</option><option value="customer_credit_application">Credit applications</option></select></label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button type="submit" className="gap-2"><CalendarDays className="h-4 w-4" /> Apply range</Button>
            <span className="text-xs text-slate-400">Maximum range: 366 days · all totals are integer cents on the server</span>
          </div>
        </form>

        {hasError && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" /> {errorMessage(summaryQuery.error || transactionsQuery.error || discrepancyQuery.error)}</span>
            <Button variant="outline" size="sm" className="gap-2 border-rose-200 bg-white" onClick={() => { summaryQuery.refetch(); transactionsQuery.refetch(); discrepancyQuery.refetch(); }}><RefreshCw className="h-3.5 w-3.5" /> Retry</Button>
          </div>
        )}

        {isLoading ? <LoadingState /> : summary ? (
          <>
            <section className="space-y-4" aria-labelledby="cash-activity-heading">
              <SectionHeading eyebrow="Cash activity" title="What was recorded as cash?" description={`${summary.range.startDate} through ${summary.range.endDate} · ${summary.range.timezone}`} icon={Landmark} />
              <div id="cash-activity-heading" className="grid gap-4 sm:grid-cols-3">
                <MetricCard label="Cash received" value={money(summary.cashReceivedCents)} detail="Payments recorded in range" tone="emerald" icon={ArrowDownRight} />
                <MetricCard label="Recorded refunds" value={money(summary.recordedRefundsCents)} detail="Ledger entries, not provider payouts" tone="rose" icon={ArrowUpRight} />
                <MetricCard label="Net recorded cash activity" value={money(summary.netRecordedCashActivityCents)} detail="Cash received less recorded refunds" tone="slate" icon={Landmark} />
              </div>
              <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm">
                <p className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" /> Recorded refund, not sent</p>
                <p className="mt-1 pl-6 text-xs text-amber-800">Refund totals reflect durable internal ledger activity only. They do not confirm that money was sent to a customer or payment provider.</p>
              </div>
              <Card>
                <CardHeader><CardTitle className="text-base">Daily trend</CardTitle></CardHeader>
                <CardContent>
                  {summary.daily.length === 0 ? <EmptyState label="daily activity" /> : (
                    <div className="space-y-2">
                      {summary.daily.filter((day) => day.cashReceivedCents || day.recordedRefundsCents || day.invoiceCreditsCents || day.customerCreditApplicationsCents).slice(-14).map((day) => (
                        <div key={day.date} className="grid grid-cols-[76px_1fr_86px] items-center gap-3 text-xs">
                          <span className="font-medium text-slate-500">{day.date.slice(5)}</span>
                          <div className="space-y-1">
                            <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(2, day.cashReceivedCents / trendMax * 100)}%` }} /></div>
                            <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(2, (day.invoiceCreditsCents + day.customerCreditApplicationsCents) / trendMax * 100)}%` }} /></div>
                          </div>
                          <span className="text-right font-semibold tabular-nums text-slate-700">{money(day.netRecordedCashActivityCents)}</span>
                        </div>
                      ))}
                      <div className="flex gap-4 pt-2 text-[11px] text-slate-400"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />Cash</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-violet-500" />Non-cash</span></div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            <section className="space-y-4" aria-labelledby="non-cash-heading">
              <SectionHeading eyebrow="Non-cash adjustments" title="Credits and availability" description="These values change invoice/customer-credit positions without being cash receipts." icon={WalletCards} />
              <div id="non-cash-heading" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard label="Invoice credits" value={money(summary.invoiceCreditsCents)} detail="Credit-note face value" tone="violet" icon={FileWarning} />
                <MetricCard label="Credit applications" value={money(summary.customerCreditApplicationsCents)} detail="Applied against invoices" tone="violet" icon={ArrowDownRight} />
                <MetricCard label="Unapplied payments" value={money(summary.currentPosition.unappliedPaymentCents)} detail="Available payment-origin balance" tone="amber" icon={Landmark} />
                <MetricCard label="Available customer credit" value={money(summary.currentPosition.availableCustomerCreditCents)} detail="Credit-note-origin balance" tone="amber" icon={WalletCards} />
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card><CardHeader><CardTitle className="text-base">Payment-method breakdown</CardTitle></CardHeader><CardContent>{summary.methods.length === 0 ? <EmptyState label="method activity" /> : <div className="space-y-3">{summary.methods.map((item) => <div key={item.method} className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0 last:pb-0"><span className="text-sm font-semibold capitalize text-slate-700">{item.method}</span><span className="text-right text-sm tabular-nums"><strong>{money(item.netRecordedCashActivityCents)}</strong><span className="ml-2 text-xs text-slate-400">net</span></span></div>)}</div>}</CardContent></Card>
                <Card><CardHeader><CardTitle className="text-base">Source-origin breakdown</CardTitle></CardHeader><CardContent><div className="space-y-3">{summary.origins.map((item) => <div key={item.origin} className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0 last:pb-0"><span className="text-sm font-semibold capitalize text-slate-700">{item.origin === "credit_note" ? "Credit note" : "Payment"}</span><span className="text-right text-sm tabular-nums"><strong>{money(item.applicationsCents)}</strong><span className="ml-2 text-xs text-slate-400">applied · {money(item.refundsCents)} refunded</span></span></div>)}</div></CardContent></Card>
              </div>
            </section>

            <section className="space-y-4" aria-labelledby="position-heading">
              <SectionHeading eyebrow="Current position" title="What remains open?" description="Current balances are not restricted to the selected date range." icon={BarChart3} />
              <div id="position-heading" className="grid gap-4 sm:grid-cols-2"><MetricCard label="Outstanding A/R" value={money(summary.currentPosition.outstandingArCents)} detail="Non-voided invoice balances" tone="slate" icon={BarChart3} /><MetricCard label="Customer-credit refunds" value={money(summary.customerCreditRefundsCents)} detail="Recorded credit consumption" tone="rose" icon={ArrowUpRight} /></div>
            </section>

            <section className="space-y-4" aria-labelledby="attention-heading">
              <SectionHeading eyebrow="Needs attention" title="Integrity checks" description="Read-only checks compare durable records without repairing or backfilling anything." icon={FileWarning} />
              <div id="attention-heading">
                {discrepancies?.total ? <Card className="border-rose-200"><CardContent className="p-0"><div className="border-b border-rose-100 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-900">{discrepancies.total} discrepancy{discrepancies.total === 1 ? "" : "ies"} found</div><div className="divide-y divide-slate-100">{discrepancies.discrepancies.map((item) => <div key={item.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-slate-800">{item.recordType.replaceAll("_", " ")} #{item.recordId}</p><p className="mt-1 text-xs text-slate-500">{item.reason}</p></div><span className="font-semibold tabular-nums text-rose-700">{money(item.differenceCents)}</span></div>)}</div></CardContent></Card> : <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900"><CheckCircle2 className="h-5 w-5" /><span><strong>No discrepancies found.</strong> Payments, credit sources, refunds, and invoices reconcile for this snapshot.</span></div>}
              </div>
            </section>

            <section className="space-y-4" aria-labelledby="transactions-heading">
              <div className="flex items-end justify-between gap-3"><SectionHeading eyebrow="Detail" title="Recorded activity" description="Newest first · select a record to drill through." icon={Landmark} /><span className="text-xs text-slate-400">{transactions?.total ?? 0} rows</span></div>
              <Card id="transactions-heading"><CardContent className="p-0">{transactions?.rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Date</th><th className="px-5 py-3">Activity</th><th className="px-5 py-3">Classification</th><th className="px-5 py-3">Origin / method</th><th className="px-5 py-3 text-right">Amount</th></tr></thead><tbody className="divide-y divide-slate-100">{transactions.rows.map((row) => <tr key={row.id} className="hover:bg-slate-50"><td className="whitespace-nowrap px-5 py-4 text-xs text-slate-500">{row.date}</td><td className="px-5 py-4"><TransactionLink row={row} /><p className="mt-1 text-xs text-slate-400">{row.recordType.replaceAll("_", " ")}</p></td><td className="px-5 py-4 text-xs text-slate-500">{row.cashClass === "cash_received" ? "Cash received" : row.cashClass === "recorded_refund" ? "Recorded refund" : "Non-cash adjustment"}</td><td className="px-5 py-4 text-xs capitalize text-slate-500">{row.sourceOrigin?.replace("_", " ") ?? row.method ?? "—"}</td><td className="px-5 py-4 text-right font-semibold tabular-nums text-slate-800">{money(row.amountCents)}</td></tr>)}</tbody></table></div> : <EmptyState label="transactions" />}<div className="flex items-center justify-between border-t border-slate-100 px-5 py-3"><span className="text-xs text-slate-400">Page {transactions?.page ?? 1} of {Math.max(1, transactions?.totalPages ?? 1)}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft className="h-4 w-4" /> Previous</Button><Button variant="outline" size="sm" disabled={!transactions || page >= transactions.totalPages} onClick={() => setPage((current) => current + 1)}>Next <ChevronRight className="h-4 w-4" /></Button></div></div></CardContent></Card>
            </section>
          </>
        ) : !hasError ? <EmptyState label="activity" /> : null}
      </div>
    </Layout>
  );
}