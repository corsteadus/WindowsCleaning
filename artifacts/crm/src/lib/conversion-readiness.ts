/**
 * Why the scheduling button is off — Kyle's correction note #15.
 *
 * His report was that "the Schedule One Job button in the bottom-right remains
 * inactive and cannot be clicked". Walking the real data showed nothing broken
 * underneath: the estimate had its location, its services and its revision.
 * What was missing was an *acceptance* — and the dialog asked for one in an
 * amber box well above the button, then went silent. A disabled control that
 * will not say what it wants is indistinguishable from a broken one.
 *
 * So the rule and the explanation are the same function. The button is enabled
 * when `conversionBlockers` is empty, and the screen prints whatever it
 * returns. They cannot drift apart into a button that is off for a reason
 * nobody is shown, or on for work the server will then refuse.
 */

export interface ConversionScheduleRow {
  propertyId: number;
  scheduledDate: string;
  scheduledStartTime: string;
  scheduledEndTime: string;
}

export interface ConversionReadinessInput {
  /** Locations on the locked snapshot — what the office must schedule. */
  locationCount: number;
  rows: ConversionScheduleRow[];
  /** True while the estimate has no acceptance of any kind behind it. */
  requiresVerbalAcceptance: boolean;
  verbalRecorded: boolean;
  verbalNote: string;
}

/** Matches the server's own minimum for acceptance documentation. */
export const VERBAL_NOTE_MIN_LENGTH = 10;

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/**
 * Everything standing between the office and a scheduled job, in the order a
 * person would fix them. Empty means ready.
 */
export function conversionBlockers(input: ConversionReadinessInput): string[] {
  const blockers: string[] = [];

  if (input.locationCount === 0) {
    // Not reachable from an estimate built through the normal flow, but a
    // quote created without a service address would land here, and silence
    // was the original complaint.
    blockers.push(
      "This estimate has no service address, so there is nothing to schedule. "
      + "Add a property to the profile and finalize the estimate again.",
    );
    return blockers;
  }

  const missingDate = input.rows.filter((row) => !row.scheduledDate).length;
  if (missingDate > 0) {
    blockers.push(
      `${missingDate} ${plural(missingDate, "location needs", "locations need")} a date.`,
    );
  }

  const missingTime = input.rows.filter(
    (row) => row.scheduledDate && (!row.scheduledStartTime || !row.scheduledEndTime),
  ).length;
  if (missingTime > 0) {
    blockers.push(
      `${missingTime} ${plural(missingTime, "location needs", "locations need")} a start and end time.`,
    );
  }

  // The server refuses this too. Catching it here means the button never
  // enables onto a request that is going to come back as a 400.
  const backwards = input.rows.filter(
    (row) => row.scheduledStartTime && row.scheduledEndTime
      && row.scheduledEndTime <= row.scheduledStartTime,
  ).length;
  if (backwards > 0) {
    blockers.push(
      `${backwards} ${plural(backwards, "location ends", "locations end")} before it starts.`,
    );
  }

  if (input.rows.length < input.locationCount) {
    const short = input.locationCount - input.rows.length;
    blockers.push(`${short} ${plural(short, "location has", "locations have")} no schedule yet.`);
  }

  if (input.requiresVerbalAcceptance) {
    if (!input.verbalRecorded) {
      blockers.push(
        "Nobody has recorded that the customer accepted this estimate. "
        + "Tick “Record authorized verbal acceptance” above, or set the "
        + "estimate to Accepted with Correct Status.",
      );
    } else if (input.verbalNote.trim().length < VERBAL_NOTE_MIN_LENGTH) {
      blockers.push(
        `Say who accepted it and how — at least ${VERBAL_NOTE_MIN_LENGTH} characters.`,
      );
    }
  }

  return blockers;
}

export function isConversionReady(input: ConversionReadinessInput): boolean {
  return conversionBlockers(input).length === 0;
}
