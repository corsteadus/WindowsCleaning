/**
 * Dropping a job on a day the office blocked off.
 *
 * Spec V1 #12, #34 and §7.15. The server is what *enforces* a hard block —
 * `calendar-blocks-store.ts` refuses the create, the reschedule and the day
 * move — and this is the same question asked of the blocks already on screen,
 * so a drag is answered in the moment instead of travelling to the API to be
 * told no.
 *
 * Two deliberate limits:
 *
 *  - **Soft blocks only exist here.** The API lets them through, because a
 *    warning it answered by itself would be a refusal wearing a different
 *    word. This is the screen that can ask, so this is where the asking lives.
 *  - **A calendar card carries its crew, not its technician**, so an
 *    employee-scoped block cannot be matched from the grid. The server still
 *    refuses it, and its message is what the move's error toast shows. Better
 *    a refusal that arrives a moment late than a drag that silently ignores a
 *    block.
 */
import type { CalendarOccurrence, SchedulingBlock } from "./calendar-api";
// Relative, not "@/": this file is unit-tested under node --test, where the
// alias does not resolve.
import { formatDateOnly } from "./quote-settings-form.ts";

/**
 * A block's message, with its dates written the way the rest of the screen
 * writes them. The rule composes "2026-10-18 is blocked: Closed" and the API
 * sends the same, which reads as a different system's wording next to a dialog
 * headed "Oct 18, 2026".
 */
export function readableBlockMessage(message: string): string {
  return message.replace(/\d{4}-\d{2}-\d{2}/g, (date) => formatDateOnly(date) || date);
}

export type BlockDrop =
  | { kind: "allowed" }
  | { kind: "warn"; blocks: SchedulingBlock[]; message: string }
  | { kind: "refused"; blocks: SchedulingBlock[]; message: string };

export interface DroppedBooking {
  date: string;
  crewId?: number | null;
  startTime?: string | null;
  endTime?: string | null;
}

/** The scope rule, matching the server's `coversScope`. */
function coversScope(block: SchedulingBlock, booking: DroppedBooking): boolean {
  if (block.scopeType === "company") return true;
  if (block.scopeType === "crew") return block.crewId !== null && block.crewId === (booking.crewId ?? null);
  // employee: not answerable from a calendar card. Left to the server.
  return false;
}

/** The hours rule, matching the server's `coversTime`. */
function coversTime(block: SchedulingBlock, booking: DroppedBooking): boolean {
  if (block.isAllDay || !block.startTime || !block.endTime) return true;
  if (!booking.startTime) return true;
  const end = booking.endTime && booking.endTime > booking.startTime ? booking.endTime : booking.startTime;
  return (booking.startTime < block.endTime && block.startTime < end)
    || (booking.startTime === end && booking.startTime >= block.startTime && booking.startTime < block.endTime);
}

/**
 * Hard refuses, soft asks, and a soft block beside a hard one does not soften
 * it. The message names the block: "that day is blocked" without saying which
 * is the kind of message people learn to click past.
 *
 * `blocks` is the list already drawn on that day, so this costs no read.
 */
export function blockDropDecision(
  booking: DroppedBooking,
  blocks: ReadonlyArray<SchedulingBlock>,
): BlockDrop {
  const affecting = blocks.filter((block) => block.isActive
    && coversScope(block, booking)
    && coversTime(block, booking));
  if (affecting.length === 0) return { kind: "allowed" };
  const named = (list: ReadonlyArray<SchedulingBlock>) => list.map((block) => block.title).join(", ");
  const hard = affecting.filter((block) => block.blockMode === "hard");
  if (hard.length > 0) {
    return { kind: "refused", blocks: affecting, message: `${booking.date} is blocked: ${named(hard)}` };
  }
  return {
    kind: "warn",
    blocks: affecting,
    message: `${booking.date} is marked ${named(affecting)}. Book it anyway?`,
  };
}

/** The same question, asked of a card being dragged. */
export function blockDropForOccurrence(
  occurrence: CalendarOccurrence,
  to: string,
  blocks: ReadonlyArray<SchedulingBlock>,
): BlockDrop {
  return blockDropDecision({
    date: to,
    crewId: occurrence.crewId,
    startTime: occurrence.startTime,
    endTime: occurrence.endTime,
  }, blocks);
}
