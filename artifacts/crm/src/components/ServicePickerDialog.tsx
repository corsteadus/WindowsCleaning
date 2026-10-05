/**
 * Add from Service Catalog.
 *
 * Kyle (Testing Edits, 2026-10-01, #7): *"When the user clicks Add Service, open
 * the Add from Service Catalog screen. From there, the user can either select an
 * existing service or create a new service."*
 *
 * This lived inside QuoteNew while only the builder could add a line. The quote
 * page needs the same thing, and two copies would be two chances to drift apart
 * from Kyle's rules, so it is one component used by both.
 */
import { useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QuickAddService } from "@/components/QuickAddService";
import { useServiceCategoryName } from "@/components/ServiceCategoryPicker";
import { formatCurrency } from "@/lib/utils";

export interface PickableService {
  id: number;
  name: string;
  description?: string | null;
  basePrice?: number | string | null;
  category?: string | null;
  unit?: string | null;
  isActive: boolean;
}

export function ServicePickerDialog({
  services,
  onAdd,
  onClose,
  navigate,
}: {
  services: PickableService[];
  onAdd: (service: { id: number; name: string; basePrice?: number | string | null }) => void;
  onClose: () => void;
  navigate: (to: string) => void;
}) {
  const active = services.filter((service) => service.isActive);
  // An empty catalogue opens straight onto the quick-add; otherwise it is one click away.
  const [adding, setAdding] = useState(false);
  const showQuickAdd = adding || active.length === 0;
  const categoryName = useServiceCategoryName();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="w-4 h-4 text-primary" />
            Add from Service Catalog
          </DialogTitle>
        </DialogHeader>
        {showQuickAdd ? (
          <QuickAddService
            onCreated={(service) => onAdd(service)}
            onCancel={active.length > 0 ? () => setAdding(false) : undefined}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-2 text-sm font-medium text-primary hover:bg-primary/5"
          >
            <Plus className="h-4 w-4" /> New service
          </button>
        )}
        <div className="max-h-[60vh] overflow-y-auto space-y-1.5 -mx-2 px-2">
          {active.length === 0 ? (
            <p className="py-2 text-center text-xs text-slate-400">
              The catalog is empty. A service you add here is saved to it for every profile.{" "}
              <button
                type="button"
                className="text-primary font-medium hover:underline"
                onClick={() => { onClose(); navigate("/services"); }}
              >
                Open the catalog
              </button>
            </p>
          ) : (
            active.map((service) => (
              <button
                type="button"
                key={service.id}
                onClick={() => onAdd(service)}
                className="w-full text-left flex items-center justify-between p-3.5 rounded-xl border border-slate-100
                           hover:bg-primary/5 hover:border-primary/20 active:scale-[.99] transition-all group"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900 text-sm truncate group-hover:text-primary transition-colors">
                    {service.name}
                  </p>
                  {service.description && (
                    <p className="text-xs text-slate-500 truncate mt-0.5">{service.description}</p>
                  )}
                  {service.category && (
                    <Badge variant="outline" className="mt-1 text-[10px] bg-blue-50 border-blue-100 text-blue-700 px-1.5 py-0">
                      {categoryName(service.category)}
                    </Badge>
                  )}
                </div>
                <div className="ml-4 shrink-0 text-right">
                  {/* #8: a catalogue service need not have a price. The quote decides. */}
                  <p className="font-bold text-slate-900 text-sm">
                    {service.basePrice === null || service.basePrice === undefined
                      ? ""
                      : formatCurrency(Number(service.basePrice))}
                  </p>
                  {service.unit && <p className="text-[10px] text-slate-400">per {service.unit}</p>}
                </div>
              </button>
            ))
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-full h-10 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors"
        >
          Cancel
        </button>
      </DialogContent>
    </Dialog>
  );
}
