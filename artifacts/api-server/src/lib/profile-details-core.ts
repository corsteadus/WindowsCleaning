export const CONTACT_CHANNEL_PURPOSES = ["general", "billing", "estimates"] as const;
export type ContactChannelPurpose = (typeof CONTACT_CHANNEL_PURPOSES)[number];

export function catalogSelectionInput(
  body: Record<string, unknown>,
  idKey: string,
  valueKey: string,
): unknown {
  return Object.prototype.hasOwnProperty.call(body, valueKey) ? body[valueKey] : body[idKey];
}

export function channelPurposePatch(body: Record<string, unknown>): ContactChannelPurpose[] | undefined {
  const supplied = Object.prototype.hasOwnProperty.call(body, "purposes")
    || Object.prototype.hasOwnProperty.call(body, "purpose");
  if (!supplied) return undefined;
  const raw = Array.isArray(body.purposes) ? body.purposes : [body.purpose];
  const purposes = [...new Set(raw.map(String).filter(
    (value): value is ContactChannelPurpose =>
      CONTACT_CHANNEL_PURPOSES.includes(value as ContactChannelPurpose),
  ))];
  if (purposes.length === 0) throw new Error("At least one valid channel purpose is required");
  return purposes;
}