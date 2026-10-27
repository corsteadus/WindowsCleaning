/**
 * The rules for the business's identity — phase 8. Kept apart from the store
 * (company-profile.ts) so they can be checked without a database.
 */
export const MAX_LOGO_BYTES = 500 * 1024;
export const MAX_FOOTER = 1000;

/** (816) 555-0100 for a plain US number; anything else as written. */
export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return national.length === 10 && !/[a-z+]/i.test(raw) ? `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}` : raw;
}

/** The lines under the business name: address, then phone · email · website. */
export function contactLines(p: { address: string | null; city: string | null; state: string | null; zip: string | null; phone: string | null; email: string | null; website: string | null }): string[] {
  const place = [p.address, [p.city, [p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", ");
  const reach = [p.phone && formatPhone(p.phone), p.email, p.website].filter(Boolean).join(" · ");
  return [place, reach].filter(Boolean);
}

const text = (value: unknown, max: number, label: string): { value: string | null } | { error: string } => {
  if (value == null) return { value: null };
  if (typeof value !== "string") return { error: `${label} must be text` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { error: `${label} can be up to ${max} characters` };
  return { value: trimmed || null };
};

/** The profile as sent from Settings, or the first reason it cannot be saved. */
export function profileOf(raw: unknown): { profile: Record<string, string | boolean | null> } | { error: string } {
  const body = (raw ?? {}) as Record<string, unknown>;
  const fields: Array<[key: string, max: number, label: string]> = [
    ["businessName", 120, "The business name"], ["address", 200, "The address"], ["city", 80, "The city"],
    ["state", 40, "The state"], ["zip", 20, "The ZIP"], ["phone", 40, "The phone"], ["email", 160, "The email"],
    ["website", 200, "The website"], ["estimateFooter", MAX_FOOTER, "The estimate footer"],
  ];
  const profile: Record<string, string | boolean | null> = {};
  for (const [key, max, label] of fields) {
    const one = text(body[key], max, label);
    if ("error" in one) return one;
    profile[key] = one.value;
  }
  if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(profile.email))) return { error: "The email is not an email address" };
  for (const key of ["showUnitPrices", "showServiceDescriptions"]) {
    if (body[key] !== undefined && typeof body[key] !== "boolean") return { error: `${key} must be true or false` };
    profile[key] = body[key] === undefined ? true : Boolean(body[key]);
  }
  return { profile };
}

/** A JPEG's pixel size from its frame header; null when it is not a baseline or progressive JPEG. */
export function jpegSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buffer.length) {
    if (buffer[i] !== 0xff) return null;
    const marker = buffer[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    const length = buffer.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

/** The logo as uploaded (a data: URL or base64 JPEG), or why it cannot be one. */
export function logoOf(raw: unknown): { jpeg: Buffer; width: number; height: number } | { error: string } {
  if (typeof raw !== "string" || !raw) return { error: "Choose a logo image" };
  const base64 = raw.replace(/^data:image\/jpeg;base64,/, "");
  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) return { error: "The logo must be a JPEG image" };
  const jpeg = Buffer.from(base64, "base64");
  if (jpeg.length > MAX_LOGO_BYTES) return { error: "The logo is too large; use an image under 500 KB" };
  const size = jpegSize(jpeg);
  if (!size || size.width < 8 || size.height < 8) return { error: "The logo must be a JPEG image" };
  return { jpeg, ...size };
}

