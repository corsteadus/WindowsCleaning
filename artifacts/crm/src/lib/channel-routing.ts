/**
 * What routine mail an address or number receives — Kyle's correction note #7.
 *
 * He listed eight choices by name: All Emails; General Emails; Billing;
 * Estimates; General and Estimates; Billing and Estimates; General and
 * Billing; None. Those are exactly the eight subsets of the three purposes the
 * database already stores, so nothing new is kept — what was missing was the
 * empty one. Until 2026-10-10 the screen silently refused to let the last tick
 * go, and the server refused an empty list outright, so there was no way to
 * say "keep this address on file but send it nothing routine".
 *
 * **None is not a deactivation**, and #7 says so in as many words. Switching a
 * channel off for sending is a separate thing with its own reason — an
 * unsubscribe, a bounce, or a person asking — and that is #6's business. A
 * channel set to None is still live and can still be written to deliberately.
 *
 * Checkboxes could express all eight, but they made None reachable only by
 * clearing the last one, which is exactly the click the screen swallowed.
 * Kyle asked to "assign one of these options", so one named choice it is.
 */

export const CHANNEL_PURPOSES = ["general", "billing", "estimates"] as const;
export type ChannelPurpose = (typeof CHANNEL_PURPOSES)[number];

export interface RoutingChoice {
  /** Stable key for the <option>; the purposes are the truth. */
  key: string;
  label: string;
  purposes: ChannelPurpose[];
}

/** Kyle's eight, in the order he wrote them. */
export const ROUTING_CHOICES: readonly RoutingChoice[] = [
  { key: "all", label: "All Emails", purposes: ["general", "billing", "estimates"] },
  { key: "general", label: "General Emails", purposes: ["general"] },
  { key: "billing", label: "Billing", purposes: ["billing"] },
  { key: "estimates", label: "Estimates", purposes: ["estimates"] },
  { key: "general-estimates", label: "General and Estimates", purposes: ["general", "estimates"] },
  { key: "billing-estimates", label: "Billing and Estimates", purposes: ["billing", "estimates"] },
  { key: "general-billing", label: "General and Billing", purposes: ["general", "billing"] },
  { key: "none", label: "None", purposes: [] },
];

const canonical = (purposes: readonly string[]): string =>
  [...new Set(purposes)]
    .filter((purpose): purpose is ChannelPurpose =>
      (CHANNEL_PURPOSES as readonly string[]).includes(purpose))
    .sort()
    .join("+");

const BY_SIGNATURE = new Map(ROUTING_CHOICES.map((choice) => [canonical(choice.purposes), choice]));

/**
 * The stored purposes as one of Kyle's eight. Order and duplicates do not
 * matter, and anything unrecognised is dropped rather than inventing a ninth
 * choice the screen could not display.
 */
export function routingChoiceFor(purposes: readonly string[] | null | undefined): RoutingChoice {
  return BY_SIGNATURE.get(canonical(purposes ?? [])) ?? ROUTING_CHOICES[ROUTING_CHOICES.length - 1];
}

/** The purposes behind a choice, for sending back to the server. */
export function purposesForChoice(key: string): ChannelPurpose[] {
  return [...(ROUTING_CHOICES.find((choice) => choice.key === key)?.purposes ?? [])];
}

export function routingLabel(purposes: readonly string[] | null | undefined): string {
  return routingChoiceFor(purposes).label;
}

/**
 * What the screen reads back for a channel whose server answer predates this,
 * where only the older single `purpose` field was sent.
 */
export function purposesOf(
  channel: { purposes?: readonly string[] | null; purpose?: string | null },
): ChannelPurpose[] {
  if (Array.isArray(channel.purposes)) {
    // An empty array is None, and must not be mistaken for "nothing was sent".
    return channel.purposes.filter((purpose): purpose is ChannelPurpose =>
      (CHANNEL_PURPOSES as readonly string[]).includes(purpose));
  }
  if (channel.purpose && (CHANNEL_PURPOSES as readonly string[]).includes(channel.purpose)) {
    return [channel.purpose as ChannelPurpose];
  }
  return [];
}
