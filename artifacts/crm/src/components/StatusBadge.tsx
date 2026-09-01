const STATUS_MAP: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  // Jobs / Schedule
  scheduled:   { label: "Scheduled",   bg: "bg-blue-50",    text: "text-blue-700",    dot: "bg-blue-400"   },
  in_progress: { label: "In Progress", bg: "bg-amber-50",   text: "text-amber-700",   dot: "bg-amber-400"  },
  completed:   { label: "Completed",   bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  canceled:    { label: "Canceled",    bg: "bg-slate-100",  text: "text-slate-500",   dot: "bg-slate-400"  },
  // Quotes
  draft:       { label: "Draft",       bg: "bg-slate-100",  text: "text-slate-600",   dot: "bg-slate-400"  },
  sent:        { label: "Sent",        bg: "bg-blue-50",    text: "text-blue-700",    dot: "bg-blue-400"   },
  approved:    { label: "Approved",    bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  accepted:    { label: "Accepted",    bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  rejected:    { label: "Rejected",    bg: "bg-red-50",     text: "text-red-700",     dot: "bg-red-500"    },
  // Invoices
  paid:        { label: "Paid",        bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  overdue:     { label: "Overdue",     bg: "bg-red-50",     text: "text-red-700",     dot: "bg-red-500"    },
  partial:     { label: "Partially Paid", bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  partially_credited: { label: "Partially Credited", bg: "bg-violet-50", text: "text-violet-700", dot: "bg-violet-500" },
  credited:    { label: "Credited",     bg: "bg-violet-50", text: "text-violet-700", dot: "bg-violet-500" },
  voided:      { label: "Voided",      bg: "bg-slate-100",  text: "text-slate-500",   dot: "bg-slate-300"  },
  // Customers / Recurring
  active:      { label: "Active",      bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  customer:   { label: "Customer",    bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  prospect:   { label: "Prospect",    bg: "bg-violet-50",  text: "text-violet-700",  dot: "bg-violet-500"  },
  inactive:    { label: "Inactive",    bg: "bg-slate-100",  text: "text-slate-500",   dot: "bg-slate-400"  },
  archived:   { label: "Archived",    bg: "bg-slate-100",  text: "text-slate-500",   dot: "bg-slate-400"  },
  paused:      { label: "Paused",      bg: "bg-amber-50",   text: "text-amber-700",   dot: "bg-amber-400"  },
  // Leads
  new:         { label: "New",         bg: "bg-blue-50",    text: "text-blue-700",    dot: "bg-blue-400"   },
  contacted:   { label: "Contacted",   bg: "bg-amber-50",   text: "text-amber-700",   dot: "bg-amber-400"  },
  won:         { label: "Won",         bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  lost:        { label: "Lost",        bg: "bg-red-50",     text: "text-red-700",     dot: "bg-red-500"    },
};

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
  showDot?: boolean;
  className?: string;
}

export function StatusBadge({ status, size = "sm", showDot = true, className = "" }: StatusBadgeProps) {
  const cfg = STATUS_MAP[status] ?? {
    label: status?.trim() ? status.replace(/_/g, " ") : "Unknown",
    bg: "bg-slate-100",
    text: "text-slate-600",
    dot: "bg-slate-400",
  };

  const padding = size === "md" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[11px]";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg font-bold capitalize
        ${padding} ${cfg.bg} ${cfg.text} ${className}`}
    >
      {showDot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />}
      {cfg.label}
    </span>
  );
}
