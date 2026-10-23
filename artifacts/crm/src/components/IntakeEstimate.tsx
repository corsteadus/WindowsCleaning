/**
 * The estimate booked on the Add Prospect form — piece B2, Kyle's Video 3:
 * services (each at one of the form's locations, priced or "to be quoted"),
 * and the estimator and time. The logic is lib/intake-estimate.ts.
 */
import { Plus, Trash2 } from "lucide-react";
import { TimeSelect } from "@/components/TimeSelect";
import {
  estimateTotal,
  type EstimateAppointmentDraft, type EstimateLineDraft,
} from "@/lib/intake-estimate";

const FIELD = "w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all placeholder:text-slate-300 disabled:opacity-50";
const LABEL = "text-[11px] font-semibold uppercase tracking-wide text-slate-500";

export interface EstimateService { id: number; name: string; basePrice?: number | string | null; isActive?: boolean }
export interface EstimateLocationOption { index: number; label: string }

export function IntakeEstimate({
  lines, onLines, appointment, onAppointment, services, estimators, locations, canSchedule,
}: {
  lines: EstimateLineDraft[];
  onLines: (lines: EstimateLineDraft[]) => void;
  appointment: EstimateAppointmentDraft;
  onAppointment: (draft: EstimateAppointmentDraft) => void;
  services: EstimateService[];
  estimators: Array<{ id: string; displayName: string }>;
  locations: EstimateLocationOption[];
  canSchedule: boolean;
}) {
  const update = (key: string, patch: Partial<EstimateLineDraft>) =>
    onLines(lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  // Blank is "to be quoted"; $0 is a price (Kyle, 2026-10-24).
  const toBeQuoted = lines.filter((line) => line.description.trim() && line.unitPrice.trim() === "").length;
  const anyPriced = lines.some((line) => line.description.trim() && line.unitPrice.trim() !== "");
  const total = estimateTotal(lines);
  const set = (patch: Partial<EstimateAppointmentDraft>) => onAppointment({ ...appointment, ...patch });

  return (
    <div className="space-y-4" data-testid="intake-estimate">
      <div className="space-y-3">
        {lines.map((line, index) => (
          <div key={line.key} data-testid="intake-estimate-line" className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
            <div className="grid items-end gap-2 sm:grid-cols-[1.6fr_70px_110px_1fr_28px]">
              <label className="block">
                <span className={LABEL}>Service</span>
                <select aria-label={`Service ${index + 1}`} className={`${FIELD} mt-1`}
                  value={line.serviceId ?? ""}
                  onChange={(event) => {
                    const service = services.find((candidate) => String(candidate.id) === event.target.value);
                    update(line.key, service
                      ? {
                        serviceId: service.id, description: service.name,
                        // The same starting price the estimate page offers; blank when the service has none.
                        unitPrice: service.basePrice == null || Number(service.basePrice) === 0 ? "" : String(service.basePrice),
                      }
                      : { serviceId: null, description: "", unitPrice: "" });
                  }}>
                  <option value="">Choose a service…</option>
                  {services.filter((service) => service.isActive !== false).map((service) => (
                    <option key={service.id} value={service.id}>{service.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={LABEL}>Qty</span>
                <input aria-label={`Service ${index + 1} quantity`} inputMode="decimal" className={`${FIELD} mt-1`} value={line.quantity}
                  onChange={(event) => update(line.key, { quantity: event.target.value })} />
              </label>
              <label className="block">
                <span className={LABEL}>Price</span>
                <input aria-label={`Service ${index + 1} price`} inputMode="decimal" placeholder="To be quoted" className={`${FIELD} mt-1`}
                  value={line.unitPrice} onChange={(event) => update(line.key, { unitPrice: event.target.value })} />
              </label>
              <label className="block">
                <span className={LABEL}>Location</span>
                <select aria-label={`Service ${index + 1} location`} className={`${FIELD} mt-1`} value={line.location}
                  onChange={(event) => update(line.key, { location: Number(event.target.value) })}>
                  {locations.map((location) => <option key={location.index} value={location.index}>{location.label}</option>)}
                </select>
              </label>
              {lines.length > 1 ? (
                <button type="button" aria-label={`Remove service ${index + 1}`} onClick={() => onLines(lines.filter((item) => item.key !== line.key))}
                  className="mb-1 inline-flex h-8 w-7 items-center justify-center rounded-lg text-red-500 hover:bg-red-50">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : <span />}
            </div>
            {/* Kyle #31: what the customer reads under this service. */}
            <input aria-label={`Service ${index + 1} description for the customer`} className={FIELD}
              placeholder="What the customer sees for this service, e.g. all exterior windows, two storeys"
              value={line.serviceNotes} onChange={(event) => update(line.key, { serviceNotes: event.target.value })} />
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" data-testid="intake-add-service"
            onClick={() => onLines([...lines, { key: `s${Date.now()}`, serviceId: null, description: "", quantity: "1", unitPrice: "", location: 0, serviceNotes: "" }])}
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            <Plus className="h-3.5 w-3.5" /> Add another service
          </button>
          <span data-testid="intake-estimate-total" className="text-xs font-semibold text-slate-600">
            {anyPriced ? `$${total.toFixed(2)}` : "No price yet"}
            {toBeQuoted > 0 && anyPriced && ` · ${toBeQuoted} to be quoted`}
          </span>
        </div>
      </div>

      {canSchedule && (
        <div className="space-y-2 border-t border-slate-200 pt-3">
          <p className={LABEL}>Estimate appointment <span className="normal-case font-normal text-slate-400">— optional</span></p>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_110px_1.2fr]">
            <input type="date" aria-label="Estimate date" className={FIELD} value={appointment.date} onChange={(event) => set({ date: event.target.value })} />
            <TimeSelect value={appointment.time} onChange={(time) => set({ time })} className={FIELD} />
            <select aria-label="Estimate duration" className={FIELD} value={appointment.duration} onChange={(event) => set({ duration: event.target.value })}>
              <option value="30">30 min</option><option value="60">1 hour</option><option value="90">90 min</option><option value="120">2 hours</option>
            </select>
            <select aria-label="Estimator" className={FIELD} value={appointment.assignedUserId} onChange={(event) => set({ assignedUserId: event.target.value })}>
              <option value="">Estimator…</option>
              {estimators.map((estimator) => <option key={estimator.id} value={estimator.id}>{estimator.displayName}</option>)}
            </select>
          </div>
          {estimators.length === 0 && (
            <p className="text-[11px] text-amber-700">No active technician can be booked yet; save the estimate and book it later.</p>
          )}
          <input aria-label="Appointment notes" className={FIELD} placeholder="Appointment notes, e.g. call 15 minutes before"
            value={appointment.appointmentNotes} onChange={(event) => set({ appointmentNotes: event.target.value })} />
        </div>
      )}
    </div>
  );
}
