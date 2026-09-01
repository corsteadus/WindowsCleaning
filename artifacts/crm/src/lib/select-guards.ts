/**
 * Generic state-transition guards for controlled Radix Select values.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Radix (@radix-ui/react-select 2.2.6) renders a hidden native <select>
 * ("bubble input") whenever a Select sits inside a <form>.  Its circuit
 * programmatically assigns the native value and re-dispatches a real
 * `change` event whose handler feeds `event.target.value` straight back
 * into the controlled state.  When that assignment lands while the item
 * options are unmounted (the content closes on selection), engines can
 * coerce the native value to "" — and the dispatched event then resets the
 * controlled state to "", permanently blanking the selection (placeholder
 * shows again, dependent form logic disables).  Whether the circuit fires
 * depends on engine and pointer type, so pages must never trust raw
 * onValueChange payloads for ANY Select rendered inside a <form>.
 *
 * Shipped regression: /recurring-plans/new (2026-08) — a picked customer
 * reverted to the placeholder.  The same raw wiring existed in JobNew and
 * AutomationNew; all three pages now route through these guards.
 *
 * USAGE RULE
 * ----------
 * Always wire through a functional update so the guard compares against the
 * latest committed state, never a stale render closure (the bubble event can
 * arrive in the same tick as the legitimate selection):
 *
 *   onValueChange={(v) => setX((prev) => nextSelectValue(prev, v))}
 *
 * Legitimate programmatic resets (e.g. clearing the property when the
 * customer changes) must call the state setter directly — NOT go through
 * onValueChange — so they are unaffected by these guards.
 */

/**
 * Total transition for a select whose stored state is the Radix-facing
 * string itself.  The incoming value is accepted only if it is a non-empty,
 * non-whitespace string that is not a literal "undefined"/"null" token;
 * anything else keeps the current value.  Sentinel item values (non-empty
 * by contract) pass through unchanged.  List-independent by construction:
 * refetches, reorders and duplicate options cannot influence the held value.
 */
export function nextSelectValue(current: string, incoming: unknown): string {
  if (typeof incoming !== "string") return current;
  const t = incoming.trim();
  if (!t || /^(undefined|null)$/i.test(t)) return current;
  return incoming;
}

/**
 * Guard for selects whose STORED state uses "" to mean "unset / any" while
 * the Radix-facing value substitutes a non-empty `sentinel`
 * (value={stored || sentinel}, with a mounted <SelectItem value={sentinel}>).
 *
 * A naive `v === sentinel ? "" : v` mapping lets empty-string bubble noise
 * masquerade as a legitimate reset and silently wipe the user's choice.
 * This guards in sentinel space first, then maps the sentinel back to the
 * stored empty string — so ONLY an actual click on the sentinel item can
 * clear the stored value.
 */
export function nextOptionalSelectValue(
  currentStored: string,
  incoming: unknown,
  sentinel: string,
): string {
  const currentSentinel = currentStored === "" ? sentinel : currentStored;
  const next = nextSelectValue(currentSentinel, incoming);
  return next === sentinel ? "" : next;
}

/**
 * Guard for selects whose STORED state is a numeric id or "" ("unset"),
 * rendered as value={stored ? String(stored) : sentinel}.
 *
 * On top of the sentinel-space guard, only positive-integer numeric strings
 * are accepted as ids.  This also closes the `Number("") === 0` /
 * `Number(junk) === NaN` coercion hole of the old inline mappings, where
 * bubble noise stored 0/NaN, rendered as the sentinel, and silently dropped
 * the user's choice at submit time.
 */
export function nextIdSelectValue(
  currentStored: number | "",
  incoming: unknown,
  sentinel: string,
): number | "" {
  const currentSentinel = currentStored === "" ? sentinel : String(currentStored);
  const next = nextSelectValue(currentSentinel, incoming);
  if (next === sentinel) return "";
  const n = Number(next);
  if (!Number.isInteger(n) || n <= 0) return currentStored;
  return n;
}
