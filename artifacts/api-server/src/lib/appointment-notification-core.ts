/**
 * Whether to ask the office if the customer should be told about a schedule.
 *
 * Kyle, 2026-09-24 #4: *"This feature must be optional … If the feature is
 * enabled, prompt the user when a job is first scheduled with a date and time.
 * Also prompt the user any time the job date or time is changed later … Nothing
 * should be sent automatically simply because a job was scheduled, dragged,
 * moved, or edited … a crew-only change does not need to trigger the scheduling
 * notification prompt."*
 *
 * So this module answers one question — **ask, or say nothing?** — and never
 * sends anything itself. The send only happens when somebody answers yes.
 *
 * Two readings worth knowing, both easy to change:
 *
 *  - Kyle wrote "first scheduled with a date and time". A job may be given a
 *    date with no time (the dashboard shows "Time not set"). Waiting for a time
 *    would mean an office that never sets times is never asked, so a **date
 *    alone is enough** to ask.
 *  - Taking a job **off** the calendar is a change to its date, so it asks too.
 *    The office can always say no, and a customer expecting a visit that is no
 *    longer booked is the worse failure.
 */

export interface ScheduleSnapshot {
  scheduledDate: string | null | undefined;
  scheduledStartTime: string | null | undefined;
  scheduledEndTime: string | null | undefined;
}

export interface NotificationSettings {
  emailEnabled: boolean;
  smsEnabled: boolean;
}

export type ScheduleChangeKind = "scheduled" | "rescheduled" | "unscheduled" | "none";
export type NotificationChannel = "email" | "sms";

export interface PromptDecision {
  /** Show the office the prompt. Never means "send". */
  prompt: boolean;
  kind: ScheduleChangeKind;
  /** The channels the business has turned on, in a fixed order. */
  channels: NotificationChannel[];
  /** Why there is no prompt, for the response and for tests. */
  reason:
    | "asked"
    | "nothing_changed"
    | "notifications_disabled"
    | "no_channel_enabled";
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? null) === (b ?? null);

/** What happened to the schedule, ignoring everything else about the job. */
export function scheduleChangeKind(before: ScheduleSnapshot, after: ScheduleSnapshot): ScheduleChangeKind {
  const dateMoved = !same(before.scheduledDate, after.scheduledDate);
  const timeMoved = !same(before.scheduledStartTime, after.scheduledStartTime)
    || !same(before.scheduledEndTime, after.scheduledEndTime);
  if (!dateMoved && !timeMoved) return "none";
  if (!before.scheduledDate && after.scheduledDate) return "scheduled";
  if (before.scheduledDate && !after.scheduledDate) return "unscheduled";
  return "rescheduled";
}

export function enabledChannels(settings: NotificationSettings | null | undefined): NotificationChannel[] {
  if (!settings) return [];
  const channels: NotificationChannel[] = [];
  if (settings.emailEnabled) channels.push("email");
  if (settings.smsEnabled) channels.push("sms");
  return channels;
}

export function decideSchedulePrompt(input: {
  before: ScheduleSnapshot;
  after: ScheduleSnapshot;
  settings: NotificationSettings | null | undefined;
}): PromptDecision {
  const kind = scheduleChangeKind(input.before, input.after);
  const channels = enabledChannels(input.settings);

  // A crew or status change reaches here with an untouched schedule, and is the
  // case Kyle asked us not to interrupt.
  if (kind === "none") return { prompt: false, kind, channels, reason: "nothing_changed" };
  if (!input.settings) return { prompt: false, kind, channels, reason: "notifications_disabled" };
  if (!channels.length) return { prompt: false, kind, channels, reason: "no_channel_enabled" };
  return { prompt: true, kind, channels, reason: "asked" };
}

/** What the prompt says, so the office knows what it is agreeing to. */
export function promptSummary(kind: ScheduleChangeKind, after: ScheduleSnapshot): string {
  const when = [after.scheduledDate, after.scheduledStartTime].filter(Boolean).join(" at ");
  if (kind === "scheduled") return `This job is now booked for ${when || "a new date"}.`;
  if (kind === "rescheduled") return `This job has moved to ${when || "a new date"}.`;
  if (kind === "unscheduled") return "This job is no longer booked.";
  return "";
}

/**
 * The event the send path already understands. Built here so the route and the
 * confirm endpoint cannot disagree about what a schedule change looks like.
 */
export function scheduleEventFor(kind: ScheduleChangeKind): "appointment.scheduled" | "appointment.changed" | null {
  if (kind === "scheduled") return "appointment.scheduled";
  if (kind === "rescheduled" || kind === "unscheduled") return "appointment.changed";
  return null;
}
