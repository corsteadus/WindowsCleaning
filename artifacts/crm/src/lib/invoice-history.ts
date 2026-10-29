/**
 * The invoice's history, read by a person — A3: who sent it to which address,
 * which address opened it and how often, and when the office was told. The same
 * sentences as an estimate's where the step is the same.
 */
import { describeEstimateActivity, type HistoryActivity, type HistoryDelivery, type HistoryLine } from "./estimate-history.ts";

export function describeInvoiceActivity(
  activity: HistoryActivity,
  context: { actors?: Record<string, string>; deliveries?: readonly HistoryDelivery[] } = {},
): HistoryLine {
  const d = activity.detail ?? {};
  const base = describeEstimateActivity(activity, context);
  switch (activity.activityType) {
    case "invoice_sent": {
      const to = (context.deliveries ?? []).filter((x) => x.publicLinkId === activity.publicLinkId).map((x) => x.recipient);
      const parts = [to.length ? `to ${to.join(", ")}` : null, d.attachPdf ? "with the PDF attached" : null].filter(Boolean);
      return { ...base, title: "Emailed the invoice", detail: parts.join(" ") || null };
    }
    case "link_created":
      return { ...base, title: "Copied the customer's link", detail: "opens of it are counted as a copied link" };
    case "opened":
      return { ...base, title: d.via === "pdf" ? "Opened the PDF" : "Opened the invoice" };
    default:
      return base;
  }
}
