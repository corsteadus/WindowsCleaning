/**
 * An expandable section under the profile — Kyle, 2026-10-26: "Photos,
 * Estimates, Callbacks, and Email History should be available as expandable
 * sections underneath the main profile. Keep the Jump To menu on the right as
 * well." Closed by default so the page the office works from stays short; its
 * content is only mounted, and so only fetched, once it is opened.
 */
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function ProfileSection({ id, title, icon: Icon, count, open, onToggle, children }: {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number | null;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section id={`section-${id}`} data-testid={`section-${id}`} className="scroll-mt-28 rounded-2xl border border-slate-200 bg-white">
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`section-${id}-body`}
        className="flex w-full items-center gap-2 px-5 py-3.5 text-left">
        <Icon className="h-4 w-4 text-slate-400" />
        <span className="font-bold text-slate-900">{title}</span>
        {count != null && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{count}</span>}
        <ChevronDown className={`ml-auto h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={`section-${id}-body`} className="border-t border-slate-100 px-5 py-4">
          {children}
        </div>
      )}
    </section>
  );
}
