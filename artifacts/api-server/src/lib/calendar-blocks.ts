/**
 * Days and hours when work should not be booked.
 *
 * Spec V1 #12 and §7.15. A scheduling block is **not a fake job** (§11.4): it
 * lives in `calendar_events`, so it never appears in a day's job count or its
 * scheduled value. The table has existed since Step 1 and nothing read it.
 *
 * Two kinds, and the difference matters:
 *
 * - a **hard** block refuses the drop — a public holiday, a day the business is
 *   closed;
 * - a **soft** block warns and lets the scheduler decide — one crew on training,
 *   a van in for service. The spec's posture everywhere else is to warn rather
 *   than refuse (see `crew-overlap.ts`), because only the person booking knows
 *   whether the exception is deliberate.
 *
 * A block can cover the whole company, one crew, or one person.
 */

export const BLOCK_SCOPES = ["company", "crew", "employee"] as const;
export const BLOCK_MODES = ["hard", "soft"] as const;

export type BlockScope = (typeof BLOCK_SCOPES)[number];
export type BlockMode = (typeof BLOCK_MODES)[number];

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ONLY = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export interface SchedulingBlock {
  id: number;
  title: string;
  startDate: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  scopeType: BlockScope;
  crewId: number | null;
  userId: string | null;
  blockMode: BlockMode;
  reason: string | null;
  isActive: boolean;
}

export interface BlockInput {
  title?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  isAllDay?: unknown;
  scopeType?: unknown;
  crewId?: unknown;
  userId?: unknown;
  blockMode?: unknown;
  reason?: unknown;
}

export type BlockValidation =
  | { ok: false; error: string }
  | {
    ok: true;
    values: {
      title: string;
      startDate: string;
      endDate: string | null;
      startTime: string | null;
      endTime: string | null;
      isAllDay: boolean;
      scopeType: BlockScope;
      crewId: number | null;
      userId: string | null;
      blockMode: BlockMode;
      reason: string | null;
    };
  };

/**
 * Checked here as well as by the table, so a block that cannot be saved says
 * which field is wrong rather than arriving as a constraint violation.
 */
export function validateBlock(input: BlockInput): BlockValidation {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return { ok: false, error: "A block needs a title — what is it for?" };
  if (title.length > 120) return { ok: false, error: "The title must be 120 characters or fewer" };

  const startDate = typeof input.startDate === "string" ? input.startDate.trim() : "";
  if (!DATE_ONLY.test(startDate)) return { ok: false, error: "startDate must be a YYYY-MM-DD date" };

  const rawEnd = input.endDate;
  const endDate = rawEnd === null || rawEnd === undefined || rawEnd === "" ? null : String(rawEnd).trim();
  if (endDate !== null && !DATE_ONLY.test(endDate)) {
    return { ok: false, error: "endDate must be a YYYY-MM-DD date, or left empty for one day" };
  }
  if (endDate !== null && endDate < startDate) {
    return { ok: false, error: "A block cannot end before it starts" };
  }

  const isAllDay = input.isAllDay === undefined ? true : input.isAllDay === true;
  const time = (value: unknown): string | null => {
    if (value === null || value === undefined || value === "") return null;
    const text = String(value).trim();
    return TIME_ONLY.test(text) ? text : "";
  };
  const startTime = isAllDay ? null : time(input.startTime);
  const endTime = isAllDay ? null : time(input.endTime);
  if (startTime === "" || endTime === "") {
    return { ok: false, error: "A time must be HH:mm on a 24-hour clock" };
  }
  if (startTime && endTime && endTime <= startTime) {
    return { ok: false, error: "A block must end after it starts" };
  }

  const scopeType = typeof input.scopeType === "string" ? input.scopeType.trim() : "company";
  if (!BLOCK_SCOPES.includes(scopeType as BlockScope)) {
    return { ok: false, error: `scopeType must be one of ${BLOCK_SCOPES.join(", ")}` };
  }
  const crewId = input.crewId === null || input.crewId === undefined || input.crewId === ""
    ? null
    : Number(input.crewId);
  if (crewId !== null && (!Number.isInteger(crewId) || crewId <= 0)) {
    return { ok: false, error: "crewId must be a positive integer" };
  }
  const userId = input.userId === null || input.userId === undefined || input.userId === ""
    ? null
    : String(input.userId).trim();

  if (scopeType === "crew" && crewId === null) {
    return { ok: false, error: "A crew block has to say which crew" };
  }
  if (scopeType === "employee" && !userId) {
    return { ok: false, error: "A person's block has to say which person" };
  }

  const blockMode = typeof input.blockMode === "string" ? input.blockMode.trim() : "soft";
  if (!BLOCK_MODES.includes(blockMode as BlockMode)) {
    return { ok: false, error: "blockMode must be hard (refuses bookings) or soft (warns)" };
  }

  return {
    ok: true,
    values: {
      title,
      startDate,
      endDate,
      startTime,
      endTime,
      isAllDay,
      scopeType: scopeType as BlockScope,
      // The table insists a scoped block names its target and a company one
      // names none; mirror that rather than letting it fail at the database.
      crewId: scopeType === "crew" ? crewId : null,
      userId: scopeType === "employee" ? userId : null,
      blockMode: blockMode as BlockMode,
      reason: typeof input.reason === "string" && input.reason.trim() ? input.reason.trim() : null,
    },
  };
}

export interface Booking {
  date: string;
  crewId?: number | null;
  userId?: string | null;
  startTime?: string | null;
  endTime?: string | null;
}

function coversDate(block: SchedulingBlock, date: string): boolean {
  return date >= block.startDate && date <= (block.endDate ?? block.startDate);
}

function coversScope(block: SchedulingBlock, booking: Booking): boolean {
  if (block.scopeType === "company") return true;
  if (block.scopeType === "crew") return block.crewId !== null && block.crewId === (booking.crewId ?? null);
  return Boolean(block.userId) && block.userId === (booking.userId ?? null);
}

/**
 * Whether the hours clash.
 *
 * An all-day block, or one with no times, covers the day. A booking with no
 * time is treated as being somewhere in the day, so a timed block still
 * applies: the office should be told, not quietly allowed through.
 */
function coversTime(block: SchedulingBlock, booking: Booking): boolean {
  if (block.isAllDay || !block.startTime || !block.endTime) return true;
  if (!booking.startTime) return true;
  const bookingEnd = booking.endTime && booking.endTime > booking.startTime ? booking.endTime : booking.startTime;
  return booking.startTime < block.endTime && block.startTime < bookingEnd
    // A zero-length booking sitting exactly on the block's start still clashes.
    || (booking.startTime === bookingEnd && booking.startTime >= block.startTime && booking.startTime < block.endTime);
}

/** The blocks standing in the way of a booking, hardest first. */
export function blocksAffecting(
  booking: Booking,
  blocks: ReadonlyArray<SchedulingBlock>,
): SchedulingBlock[] {
  return blocks
    .filter((block) => block.isActive
      && coversDate(block, booking.date)
      && coversScope(block, booking)
      && coversTime(block, booking))
    .sort((a, b) => (a.blockMode === b.blockMode ? 0 : a.blockMode === "hard" ? -1 : 1));
}

export type BlockDecision =
  | { kind: "allowed" }
  | { kind: "warn"; blocks: SchedulingBlock[]; message: string }
  | { kind: "refused"; blocks: SchedulingBlock[]; message: string };

/**
 * Hard refuses, soft warns, and a soft block beside a hard one does not soften
 * it. The message names the block, because "that day is blocked" without saying
 * which block is the kind of message people learn to click past.
 */
export function blockDecision(
  booking: Booking,
  blocks: ReadonlyArray<SchedulingBlock>,
): BlockDecision {
  const affecting = blocksAffecting(booking, blocks);
  if (affecting.length === 0) return { kind: "allowed" };
  const hard = affecting.filter((block) => block.blockMode === "hard");
  const named = (list: SchedulingBlock[]) => list.map((block) => block.title).join(", ");
  if (hard.length > 0) {
    return {
      kind: "refused",
      blocks: affecting,
      message: `${booking.date} is blocked: ${named(hard)}`,
    };
  }
  return {
    kind: "warn",
    blocks: affecting,
    message: `${booking.date} is marked ${named(affecting)}. Book it anyway?`,
  };
}
