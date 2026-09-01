const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function safelyDecode(value: string): string | null {
  let decoded = value;
  try {
    for (let pass = 0; pass < 3; pass++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    return decoded;
  } catch {
    return null;
  }
}

/** Accept only an unambiguous same-origin absolute-path reference. */
export function getSafeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  const decoded = safelyDecode(value);
  if (
    decoded === null
    || decoded.startsWith("//")
    || decoded.includes("\\")
    || CONTROL_CHARACTERS.test(decoded)
    || value.includes("\\")
    || CONTROL_CHARACTERS.test(value)
  ) {
    return "/";
  }

  try {
    const base = new URL("https://local.invalid/");
    const resolved = new URL(value, base);
    if (resolved.origin !== base.origin || !resolved.pathname.startsWith("/")) return "/";
  } catch {
    return "/";
  }
  return value;
}