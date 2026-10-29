/**
 * The estimate's history, read by a person — A2, Videos 7 and 9: what happened,
 * who did it (the office, the customer, or Corstead on its own), and to or from
 * which address. The server stores activity names and ids; this turns them into
 * sentences and is the only place that does.
 */

export interface HistoryActivity {
  id: number;
  activityType: string;
  actorType?: string | null;
  actorId?: string | null;
  publicLinkId?: number | null;
  detail?: Record<string, unknown> | null;
  occurredAt: string;
}

export interface HistoryDelivery {
  id: number;
  publicLinkId: number;
  channel: string;
  recipient: string;
}

export interface HistoryLine {
  title: string;
  detail: string | null;
  who: string;
  /** Whose step it was: colours the line, and lets the office tell its own steps from the customer's. */
  by: "customer" | "office" | "system";
}

const money = (value: unknown) =>
  `$${Number(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

const SKIP_REASONS: Record<string, string> = {
  turned_off: "turned off in Settings",
  no_profile: "the estimate has no profile",
  no_email_address: "there is no email address",
};

export function describeEstimateActivity(
  activity: HistoryActivity,
  context: { actors?: Record<string, string>; deliveries?: readonly HistoryDelivery[] } = {},
): HistoryLine {
  const d = activity.detail ?? {};
  const by: HistoryLine["by"] = activity.actorType === "customer" ? "customer" : activity.actorType === "system" ? "system" : "office";
  const who = by === "customer" ? "Customer"
    : by === "system" ? "Corstead (automatic)"
    : (activity.actorId && context.actors?.[activity.actorId]) || "Office";
  const line = (title: string, detail: string | null = null): HistoryLine => ({ title, detail, who, by });
  const deliveries = context.deliveries ?? [];

  switch (activity.activityType) {
    case "estimate_finalized":
      return line(`Finalized${d.revisionNumber ? ` revision ${d.revisionNumber}` : ""}`, d.totalAmount != null ? money(d.totalAmount) : null);
    case "revision_created":
      return line("New revision started");
    case "appointment_scheduled":
      return line("Estimate appointment booked", d.startsAt ? new Date(String(d.startsAt)).toLocaleString() : null);
    case "estimate_sent": {
      const to = deliveries.filter((x) => x.publicLinkId === activity.publicLinkId).map((x) => x.recipient);
      const how = d.via === "estimate_email" ? "Emailed the estimate" : "Sent the estimate";
      const parts = [to.length ? `to ${to.join(", ")}` : null, d.attachPdf ? "with the PDF attached" : null].filter(Boolean);
      return line(how, parts.join(" ") || null);
    }
    case "opened": {
      const delivery = deliveries.find((x) => x.id === d.deliveryRequestId);
      const through = delivery ? `through the link sent to ${delivery.recipient}` : "through a copied link";
      const visit = Number(d.openCount ?? 0) > 1 ? ` (visit ${d.openCount})` : "";
      return line(d.via === "pdf" ? "Opened the PDF" : "Opened the estimate", `${through}${visit}`);
    }
    case "printed":
      return line("Printed or saved it as a PDF");
    case "downloaded":
      return line("Downloaded the PDF");
    case "question_requested":
      return line("Asked a question", text(d.message));
    case "estimate_accepted": {
      const ids = Array.isArray(d.acceptedLineItemIds) ? d.acceptedLineItemIds.length : 0;
      const declined = Array.isArray(d.declinedLineItemIds) ? d.declinedLineItemIds.length : 0;
      const scope = d.whole || !declined ? "the whole estimate" : `${ids} of ${plural(ids + declined, "service")}`;
      const notes = text(d.customerNotes);
      return line("Accepted online", `${scope}, ${money(d.acceptedTotal)}${notes ? ` · Notes: “${notes}”` : ""}`);
    }
    case "estimate_declined": {
      const reason = text(d.declineReason);
      return line("Declined online", [reason ? `Reason: “${reason}”` : "No reason given", d.followUpRequested ? "asked to be contacted" : null].filter(Boolean).join(" · "));
    }
    case "verbal_acceptance_recorded":
      return line("Accepted by phone or in person, recorded by the office", text(d.note));
    case "estimate_converted_and_scheduled": {
      const jobs = Array.isArray(d.jobIds) ? d.jobIds.length : 0;
      // A4: what the office changed from the customer's choice, and the invoice made with the jobs.
      const added = Array.isArray(d.addedLineItemIds) ? d.addedLineItemIds.length : 0;
      const removed = Array.isArray(d.removedLineItemIds) ? d.removedLineItemIds.length : 0;
      const parts = [
        jobs ? plural(jobs, "job") : null,
        added ? `${plural(added, "declined service")} added` : null,
        removed ? `${plural(removed, "accepted service")} left out` : null,
        text(d.invoiceNumber) ? `invoice ${text(d.invoiceNumber)} created` : null,
      ].filter(Boolean);
      return line("Converted and scheduled", parts.join(" · ") || null);
    }
    case "customer_thanked":
      return line("Thank-you email sent to the customer", text(d.to));
    case "customer_thank_you_failed":
      return line("Thank-you email could not be sent", text(d.error));
    case "customer_thank_you_skipped":
      return line("No thank-you email sent", SKIP_REASONS[String(d.reason)] ?? text(d.reason));
    case "office_notified":
      return line("Office emailed", text(d.subject));
    case "office_notification_failed":
      return line("Office email could not be sent", text(d.error) ?? text(d.subject));
    default: {
      const words = activity.activityType.replaceAll("_", " ");
      return line(words.charAt(0).toUpperCase() + words.slice(1));
    }
  }
}

/** One line per address for the Delivery section: whether it went, and whether they opened it. */
export function openSummary(delivery: { openCount?: number | null; lastOpenedAt?: string | null }): string {
  const count = Number(delivery.openCount ?? 0);
  if (!count) return "Not opened yet";
  const last = delivery.lastOpenedAt ? `, last ${new Date(delivery.lastOpenedAt).toLocaleString()}` : "";
  return `Opened ${count === 1 ? "once" : `${count} times`}${last}`;
}
