/**
 * Phone numbers format themselves.
 *
 * Kyle (Testing Edits, 2026-10-01, #2): *"The user should be able to type a cell
 * phone number as digits only. Corstead should automatically format the number
 * into the standard phone-number format. The user should not have to manually
 * enter parentheses, dashes, spaces, or other punctuation."*
 *
 * So this shapes what the person sees while they type, and never stands in their
 * way: anything that is not a plain North American number is left exactly as
 * typed, because an extension, an international number or a note in the field is
 * the person telling us something we should not overwrite.
 */

/** Just the digits, so the shaping below has something predictable to work on. */
export function phoneDigits(value: string): string {
  return (value ?? "").replace(/\D/g, "");
}

/**
 * What to show in the field for what has been typed so far. Grows with the
 * number — "816" becomes "(816)", "8165" becomes "(816) 5" — so the punctuation
 * appears as it is earned rather than all at once at the end.
 */
export function formatPhoneAsTyped(value: string): string {
  const raw = value ?? "";
  if (!raw.trim()) return raw;

  // A number that carries anything else — an extension, a "+" country code, a
  // note — belongs to the person who typed it.
  if (/[a-zA-Z]/.test(raw) || raw.trim().startsWith("+")) return raw;

  const digits = phoneDigits(raw);
  if (!digits) return raw;

  // A leading 1 is the country code, kept aside so the ten digits shape normally.
  const hasCountry = digits.length === 11 && digits.startsWith("1");
  const national = hasCountry ? digits.slice(1) : digits;
  if (national.length > 10) return raw;      // longer than a US number: leave it alone

  const prefix = hasCountry ? "1 " : "";
  if (national.length <= 3) return `${prefix}(${national}`.replace("(", national.length ? "(" : "");
  if (national.length <= 6) return `${prefix}(${national.slice(0, 3)}) ${national.slice(3)}`;
  return `${prefix}(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

/** True once there are enough digits to be a real number. */
export function isCompletePhone(value: string): boolean {
  const digits = phoneDigits(value);
  return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
}
