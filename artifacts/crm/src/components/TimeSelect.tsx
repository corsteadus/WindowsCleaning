/**
 * Pick a time of day.
 *
 * Kyle (Testing Edits, 2026-10-01, #14): *"Anywhere Corstead asks the user to
 * select a time, use 15-minute increments rather than arbitrary minute-by-minute
 * selection … Use standard AM / PM formatting."*
 *
 * This replaces `<input type="time">` everywhere. That control let anybody type
 * 8:07, and showed the time in whatever format the browser's locale chose — on
 * a machine set to anything but the United States, no AM or PM at all.
 *
 * A native `<select>` on purpose: it is one tap on a phone, the keyboard jumps
 * by typing, and the value it stores is still the `HH:mm` the API expects.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { timeSelectOptions, toTimeValue } from "@/lib/time-of-day";

export interface TimeSelectProps {
  /** `HH:mm`, or empty for no time chosen. */
  value: string | null | undefined;
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
  /** Shown while nothing is chosen. */
  placeholder?: string;
  "aria-label"?: string;
}

export const TimeSelect = React.forwardRef<HTMLSelectElement, TimeSelectProps>(
  ({ value, onChange, className, placeholder = "Choose a time", ...rest }, ref) => {
    const current = toTimeValue(value);
    // Recomputed only when the value leaves the grid, which is once at most.
    const options = React.useMemo(() => timeSelectOptions(current), [current]);

    return (
      <select
        ref={ref}
        value={current}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          current ? "" : "text-muted-foreground",
          className,
        )}
        {...rest}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    );
  },
);
TimeSelect.displayName = "TimeSelect";
