---
name: Radix Select sentinel blank-trigger
description: Non-empty sentinel values blank the closed Select trigger; use explicit SelectValue children or a mounted sentinel item
---

Rule: `@radix-ui/react-select` 2.x renders `SelectValue`'s `placeholder` ONLY when the controlled value is `""` or `undefined`. A non-empty sentinel (e.g. `"none"`) matching no mounted `SelectItem` renders neither placeholder nor item text — a visually blank closed trigger.

**Why:** A sentinel refactor that fixed the Radix empty-string crash silently blanked a closed trigger in production use; a code comment asserting the placeholder would show was wrong.

**How to apply:** Any Select using a "nothing selected" sentinel must either mount a `SelectItem` whose value IS the sentinel, or supply explicit `SelectValue` children computed from state (children suppress item-text portaling, so they must cover selected AND empty states). Never rely on the placeholder for sentinel states; never use `value=""` on a `SelectItem`.

Related: server-built display names like `` `${first} ${last}` `` produce a truthy `" "` for blank-name records, defeating `||` fallbacks — trim before falling back.

## Lesson 2: in-form bubble-input reset circuit (@radix-ui/react-select 2.2.x)

**Rule:** Never wire a raw state setter into a controlled Radix Select's `onValueChange` when the Select sits inside a `<form>`. Route it through a pure guard that rejects `""`/undefined/junk and keeps the current value (sentinel-space guard for selects whose stored state uses `""` to mean "any").

**Why:** When `trigger.closest("form")` matches, Radix renders a hidden native `<select>` (SelectBubbleInput) whose effect programmatically assigns the native value and dispatches a real `change` event; the handler feeds `event.target.value` straight back into controlled state. Native `<option>`s exist only while items are mounted — items unmount when content closes on selection — so engines can coerce the value to `""` and the dispatched event resets the selection. Firing is engine/pointer-type dependent: reproduced by users on prod+dev, NOT reproducible under headless Chromium mouse input. Symptom: trigger returns to placeholder right after picking an option; dependent form logic disables.

**How to apply:** guard every `onValueChange` (`nextSelectValue`/`nextOptionalSelectValue` in the CRM form lib) and pin wiring with source-regex tests. Known remaining exposure (unfixed, out of scope so far): JobNew.tsx and AutomationNew.tsx also have Selects inside forms with raw setters.
