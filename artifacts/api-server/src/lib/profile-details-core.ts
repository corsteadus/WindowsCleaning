export const CONTACT_CHANNEL_PURPOSES = ["general", "billing", "estimates"] as const;
export type ContactChannelPurpose = (typeof CONTACT_CHANNEL_PURPOSES)[number];

export function catalogSelectionInput(
  body: Record<string, unknown>,
  idKey: string,
  valueKey: string,
): unknown {
  return Object.prototype.hasOwnProperty.call(body, valueKey) ? body[valueKey] : body[idKey];
}

/**
 * Which routine categories a channel receives.
 *
 * Kyle's correction note #7 lists eight choices, and they are exactly the
 * eight subsets of the three purposes — "All Emails" is all three and **None**
 * is the empty set. None was refused until 2026-10-10, which left no way to
 * say "keep this address on file but send it nothing routine".
 *
 * None is **not** a deactivation. #7 says so in as many words: it is separate
 * from unsubscribe, bounce and manual deactivation, which live on
 * `sending_paused_at` and are #6's business. An address with no purposes is
 * still live and can still be written to deliberately; it simply joins no
 * routine category.
 *
 * Returns `undefined` when the body says nothing about purposes, so a partial
 * patch leaves what is stored alone — which is why the empty set has to be an
 * empty array and cannot be expressed by omission.
 */
export function channelPurposePatch(body: Record<string, unknown>): ContactChannelPurpose[] | undefined {
  const supplied = Object.prototype.hasOwnProperty.call(body, "purposes")
    || Object.prototype.hasOwnProperty.call(body, "purpose");
  if (!supplied) return undefined;
  // `purpose: null` is how a single-valued caller says None.
  const raw = Array.isArray(body.purposes)
    ? body.purposes
    : body.purpose == null ? [] : [body.purpose];
  return [...new Set(raw.map(String).filter(
    (value): value is ContactChannelPurpose =>
      CONTACT_CHANNEL_PURPOSES.includes(value as ContactChannelPurpose),
  ))];
}