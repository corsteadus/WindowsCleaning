/**
 * The parts of the Add Prospect / Add Customer form that the profile page also
 * has — whose number it is, several named emails, named locations — so a
 * profile looks the same on the day it is created as when it is edited
 * (Kyle, Videos 2 and 3). The logic is lib/intake-form.ts.
 */
import { MapPin, Plus, Trash2 } from "lucide-react";
import { ROUTING_CHOICES } from "@/lib/channel-routing";
import {
  ACCOUNT_OWNER, MAX_EXTRA_LOCATIONS, personKey,
  type IntakeEmailRow, type IntakeLocationRow, type Owner,
} from "@/lib/intake-form";

const FIELD = "w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all placeholder:text-slate-300 disabled:opacity-50";
const NEW = "new";

type Person = { key: string; firstName: string; lastName: string };

/** Whose number or address it is: the account holder, someone already named, or someone new. */
export function OwnerSelect({ label, owner, people, accountName, disabled, onChange }: {
  label: string; owner: Owner; people: Person[]; accountName: string; disabled?: boolean;
  onChange: (owner: Owner) => void;
}) {
  const typing = owner.kind === "person" && owner.isNew;
  const value = owner.kind === "account" ? "account" : typing ? NEW : `p:${personKey(owner.firstName, owner.lastName)}`;
  return (
    <div className="space-y-1.5">
      <select aria-label={label} value={value} disabled={disabled} className={FIELD}
        onChange={(event) => {
          const next = event.target.value;
          if (next === "account") onChange(ACCOUNT_OWNER);
          else if (next === NEW) onChange({ kind: "person", firstName: "", lastName: "", isNew: true });
          else {
            const person = people.find((candidate) => `p:${candidate.key}` === next);
            if (person) onChange({ kind: "person", firstName: person.firstName, lastName: person.lastName });
          }
        }}>
        <option value="account">{accountName || "Account holder"}</option>
        {people.map((person) => <option key={person.key} value={`p:${person.key}`}>{person.firstName} {person.lastName}</option>)}
        <option value={NEW}>+ Someone else…</option>
      </select>
      {owner.kind === "person" && owner.isNew && (
        <div className="grid grid-cols-2 gap-1.5">
          <input aria-label={`${label} first name`} placeholder="First name" className={FIELD} value={owner.firstName}
            onChange={(event) => onChange({ ...owner, firstName: event.target.value })} />
          <input aria-label={`${label} last name`} placeholder="Last name" className={FIELD} value={owner.lastName}
            onChange={(event) => onChange({ ...owner, lastName: event.target.value })} />
        </div>
      )}
    </div>
  );
}

export function EmailRows({ rows, people, accountName, error, onChange }: {
  rows: IntakeEmailRow[]; people: Person[]; accountName: string; error?: string;
  onChange: (rows: IntakeEmailRow[]) => void;
}) {
  const update = (key: string, patch: Partial<IntakeEmailRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  return (
    <div className="space-y-2" data-testid="intake-emails">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Email addresses</span>
        <button type="button" data-testid="intake-add-email"
          onClick={() => onChange([...rows, { key: `e${Date.now()}`, value: "", owner: ACCOUNT_OWNER, routing: "general" }])}
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          <Plus className="h-3.5 w-3.5" /> Add email
        </button>
      </div>
      {rows.map((row, index) => (
        <div key={row.key} data-testid="intake-email-row" className="grid items-start gap-2 sm:grid-cols-[1.4fr_1fr_150px_28px]">
          <input type="email" aria-label={index === 0 ? "Email" : `Email ${index + 1}`} placeholder="name@example.com"
            className={FIELD} value={row.value} onChange={(event) => update(row.key, { value: event.target.value })} />
          <OwnerSelect label={index === 0 ? "Whose email" : `Whose email ${index + 1}`} owner={row.owner} people={people}
            accountName={accountName} disabled={!row.value.trim()} onChange={(owner) => update(row.key, { owner })} />
          <select aria-label={index === 0 ? "Email routing" : `Email ${index + 1} routing`} className={FIELD} value={row.routing}
            disabled={!row.value.trim()} onChange={(event) => update(row.key, { routing: event.target.value })}>
            {ROUTING_CHOICES.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
          </select>
          {rows.length > 1 ? (
            <button type="button" aria-label={`Remove ${row.value || "email"}`} onClick={() => onChange(rows.filter((item) => item.key !== row.key))}
              className="mt-1 inline-flex h-8 w-7 items-center justify-center rounded-lg text-red-500 hover:bg-red-50">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : <span />}
        </div>
      ))}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function ExtraLocations({ rows, onChange }: { rows: IntakeLocationRow[]; onChange: (rows: IntakeLocationRow[]) => void }) {
  const update = (key: string, patch: Partial<IntakeLocationRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const field = (row: IntakeLocationRow, index: number, key: "address" | "city" | "state" | "zip", placeholder: string) => (
    <input aria-label={`Location ${index + 2} ${placeholder}`} placeholder={placeholder} className={FIELD} value={row[key]}
      onChange={(event) => update(row.key, { [key]: event.target.value })} />
  );
  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div key={row.key} data-testid="intake-location" className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary shrink-0" />
            <input aria-label={`Location ${index + 2} name`} placeholder="Location name, e.g. Mom's house" className={`${FIELD} max-w-xs py-1.5`}
              value={row.name} onChange={(event) => update(row.key, { name: event.target.value })} />
            <button type="button" aria-label={`Remove location ${index + 2}`} onClick={() => onChange(rows.filter((item) => item.key !== row.key))}
              className="ml-auto rounded p-1 text-red-500 hover:bg-red-50">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-[2fr_1fr_70px_100px]">
            {field(row, index, "address", "Street")}
            {field(row, index, "city", "City")}
            {field(row, index, "state", "State")}
            {field(row, index, "zip", "Zip")}
          </div>
        </div>
      ))}
      {rows.length < MAX_EXTRA_LOCATIONS ? (
        <button type="button" data-testid="intake-add-location"
          onClick={() => onChange([...rows, { key: `l${Date.now()}`, name: "", address: "", city: "", state: "", zip: "" }])}
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          <Plus className="h-3.5 w-3.5" /> Add another location
        </button>
      ) : (
        <p className="text-[11px] text-slate-400">Up to three locations here; add more from the profile after saving.</p>
      )}
    </div>
  );
}
