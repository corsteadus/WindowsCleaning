type NamedFormControls = {
  namedItem(name: string): unknown;
};

type TemporalControl = {
  type: string;
  value: string;
};

function isTemporalControl(value: unknown, type: "date" | "time"): value is TemporalControl {
  if (!value || typeof value !== "object") return false;
  const control = value as Partial<TemporalControl>;
  return control.type === type && typeof control.value === "string";
}

export function liveDateControlValue(
  control: unknown,
  controlledValue: string,
): string {
  return isTemporalControl(control, "date") ? control.value : controlledValue;
}

/**
 * A time control is now a 15-minute `<select>` rather than
 * `<input type="time">` (Kyle, Testing Edits 2026-10-01 #14), and a native
 * select reports its type as "select-one". Both are read here, so the live DOM
 * value is still what gets submitted.
 */
function isTimeControl(value: unknown): value is TemporalControl {
  if (isTemporalControl(value, "time")) return true;
  if (!value || typeof value !== "object") return false;
  const control = value as Partial<TemporalControl>;
  return control.type === "select-one" && typeof control.value === "string";
}

export function liveTimeControlValue(
  control: unknown,
  controlledValue: string,
): string {
  return isTimeControl(control) ? control.value : controlledValue;
}

export function submittedJobSchedule(
  form: { elements: NamedFormControls },
  controlled: { date: string; startTime: string; endTime: string },
): { date: string; startTime: string; endTime: string } {
  return {
    date: liveDateControlValue(form.elements.namedItem("scheduledDate"), controlled.date),
    startTime: liveTimeControlValue(form.elements.namedItem("scheduledStartTime"), controlled.startTime),
    endTime: liveTimeControlValue(form.elements.namedItem("scheduledEndTime"), controlled.endTime),
  };
}

/**
 * Prefer the browser's submitted date control over React's last observed state.
 * This preserves the visible YYYY-MM-DD value even when an external automation
 * updates the DOM property without dispatching the event React needs to sync.
 */
export function submittedJobScheduledDate(
  form: { elements: NamedFormControls },
  controlledValue: string,
): string {
  const control = form.elements.namedItem("scheduledDate");
  return liveDateControlValue(control, controlledValue);
}