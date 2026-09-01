/**
 * CustomerCombobox — the ONE shared customer picker for creation pages
 * (JobNew, QuoteNew, RecurringPlanNew). Extracted from two previously
 * duplicated page-local implementations; do not fork a third copy — inject
 * presentation via props instead.
 *
 * Mechanics (identical for every consumer):
 *  - Popover + cmdk with shouldFilter={false}: filtering happens on the
 *    SERVER via /api/customers?search=… (name / full-name concat / company /
 *    email / phone / city, case-insensitive), debounced by
 *    CUSTOMER_SEARCH_DEBOUNCE_MS and fetched only while the popover is open.
 *  - One bounded result page per term (API default 75, hard cap 200) —
 *    never a full-table preload.
 *  - Every debounced term maps to its own React Query cache key via
 *    getListCustomersQueryKey(params): a slow response for an older term can
 *    only fill that older cache entry, so rapid typing cannot paint stale
 *    rows over newer results.
 *  - Selection hands the FULL customer record to the parent. Pages hold that
 *    record (never an id to re-find in a list), so the closed-trigger label
 *    survives search changes, result-page churn, refetches, and the selected
 *    record being absent from the current page.
 *  - cmdk rows are keyed/valued by String(id): duplicate display names stay
 *    individually selectable.
 *
 * This is a cmdk text input inside a popover — NOT a Radix Select. There is
 * no hidden bubble-<select> circuit here, so the select-guards predicates do
 * not apply: state can only change through onSelect with a real record, and
 * closing/cancelling the popover never touches the current selection.
 */
import { useEffect, useState } from "react";
import { AlertCircle, Building2, Check, ChevronsUpDown, Loader2, User } from "lucide-react";
import { useListCustomers, getListCustomersQueryKey } from "@workspace/api-client-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { extractCustomerArray } from "@/lib/customer-list";
import { customerSearchParams, CUSTOMER_SEARCH_DEBOUNCE_MS } from "@/lib/customer-search";
import { useAuth } from "@workspace/replit-auth-web";
import { authScopedQueryKey } from "@/lib/auth-scope";

/** Minimal structural contract — every page's customer row type satisfies it. */
export interface CustomerComboboxRecord {
  id: number;
  email?: string | null;
  clientType?: string | null;
}

export interface CustomerComboboxProps<T extends CustomerComboboxRecord> {
  /** Held by the PARENT page as a full record — see file header. */
  selectedCustomer: T | null | undefined;
  onSelect: (customer: T) => void;
  /** Page-specific display label (each page keeps its historical format). */
  labelFor: (customer: T) => string;
  /** Closed-trigger text when nothing is selected. */
  placeholder: string;
  /** Show a building icon for commercial clients (QuoteNew/RecurringPlanNew). */
  showClientTypeIcon?: boolean;
  /** Default true (JobNew/QuoteNew scope). RecurringPlanNew passes false. */
  activeOnly?: boolean;
}

export function CustomerCombobox<T extends CustomerComboboxRecord>({
  selectedCustomer,
  onSelect,
  labelFor,
  placeholder,
  showClientTypeIcon = false,
  activeOnly = true,
}: CustomerComboboxProps<T>) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), CUSTOMER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const params = customerSearchParams(debouncedSearch, { activeOnly });
  const { data, isLoading, isError } = useListCustomers(
    params,
    { query: { enabled: open, queryKey: authScopedQueryKey(user, getListCustomersQueryKey(params)) } },
  );
  const customers = extractCustomerArray<T>(data);

  const recordIcon = (record: T) =>
    showClientTypeIcon && record.clientType === "commercial" ? (
      <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
    ) : (
      <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={placeholder}
          className="w-full h-11 px-3 flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white
                     text-sm hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
        >
          {selectedCustomer ? (
            <span className="flex items-center gap-1.5 min-w-0 text-slate-900 font-medium truncate">
              {recordIcon(selectedCustomer)}
              <span className="truncate">{labelFor(selectedCustomer)}</span>
            </span>
          ) : (
            <span className="text-slate-400">{placeholder}</span>
          )}
          <ChevronsUpDown className="w-4 h-4 text-slate-400 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search customers by name, company, email…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {isLoading && (
              <div className="py-6 flex items-center justify-center gap-2 text-sm text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading customers…
              </div>
            )}
            {isError && !isLoading && (
              <div className="py-6 flex flex-col items-center justify-center gap-1.5 text-sm text-red-500 px-4 text-center">
                <AlertCircle className="w-4 h-4" />
                Couldn&apos;t load customers. Try again.
              </div>
            )}
            {!isLoading && !isError && (
              <CommandEmpty className="py-6 text-center text-sm text-slate-400">
                No customers found.
              </CommandEmpty>
            )}
            {!isLoading && !isError && (
              <CommandGroup>
                {customers.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={String(c.id)}
                    onSelect={() => {
                      onSelect(c);
                      setOpen(false);
                      setSearch("");
                    }}
                    className="cursor-pointer"
                  >
                    <Check
                      className={cn(
                        "w-4 h-4",
                        selectedCustomer?.id === c.id ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {recordIcon(c)}
                    <span className="flex-1 truncate">{labelFor(c)}</span>
                    {c.email && <span className="text-xs text-slate-400 truncate max-w-[120px]">{c.email}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
