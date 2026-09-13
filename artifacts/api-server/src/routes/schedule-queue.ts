import { Router, type IRouter, type Request } from "express";
import { isAssignmentScopedOperationalRole } from "../lib/authorization.ts";
import { QUEUE_STATUSES, MAX_QUEUE_PAGE } from "../lib/schedule-queue-core.ts";
import {
  holdEntry,
  readQueue,
  releaseEntry,
  scheduleEntry,
  setQueueStatus,
  type Actor,
  type TransitionResult,
} from "../services/schedule-queue.ts";

/**
 * The scheduling queue — spec §4.
 *
 * Work that is not on the calendar still has to be visible and actionable.
 * These endpoints exist rather than extending `/jobs/unscheduled` because that
 * one returns every unscheduled job with no bound, hydrates each with a whole
 * customer and property row, and has no notion of hold, waiting reason, or
 * position. The queue needs all four.
 *
 * This file does three things and no more: parse the request, name the actor,
 * and shape the response. Rules live in `services/schedule-queue.ts`.
 */

const router: IRouter = Router();

function actorOf(req: Request): Actor {
  return {
    id: req.user?.id,
    email: req.user?.email ?? null,
    firstName: req.user?.firstName ?? null,
    lastName: req.user?.lastName ?? null,
    role: req.user?.role ?? null,
  };
}

function viewerOf(req: Request) {
  return {
    isAssignmentScoped: isAssignmentScopedOperationalRole(req.user?.role),
    userId: req.user?.id,
  };
}

function entryIdOf(req: Request): number {
  return Number.parseInt(String(req.params.id), 10);
}

/**
 * Every transition answers the same shape, so the client can treat them
 * uniformly: the entry's new state on success, or a code it can branch on.
 * A 409 always means "someone else moved this" and is the UI's cue to reload.
 */
function respond(res: Parameters<Parameters<IRouter["get"]>[1]>[1], result: TransitionResult): void {
  if (result.ok) {
    res.json({ entryId: result.entryId, jobId: result.jobId, status: result.state });
    return;
  }
  res.status(result.refusal.status).json({
    error: result.refusal.error,
    code: result.refusal.code,
  });
}

async function guard(
  res: Parameters<Parameters<IRouter["get"]>[1]>[1],
  what: string,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: `Failed to ${what}` });
  }
}

/**
 * GET /schedule-queue?tab=ready|on_hold&limit=&cursor=&status=
 *
 * One bounded page of queued or held work, oldest first, plus a count per
 * waiting reason for the filter chips. `nextCursor` is null on the last page.
 */
router.get("/schedule-queue", async (req, res): Promise<void> => {
  await guard(res, "load the scheduling queue", async () => {
    const result = await readQueue(req.query as Record<string, unknown>, viewerOf(req));
    if (!result.ok) {
      res.status(result.refusal.status).json({
        error: result.refusal.error,
        code: result.refusal.code,
      });
      return;
    }
    res.json({
      tab: result.tab,
      entries: result.page.items,
      counts: result.counts,
      nextCursor: result.page.nextCursor,
      hasMore: result.page.hasMore,
      limit: result.page.limit,
      maxLimit: MAX_QUEUE_PAGE,
    });
  });
});

/** The waiting reasons this deployment knows, so the UI never hardcodes them. */
router.get("/schedule-queue/statuses", (_req, res): void => {
  res.json({ statuses: QUEUE_STATUSES });
});

/** POST /schedule-queue/:id/schedule — put queued or held work on the calendar. */
router.post("/schedule-queue/:id/schedule", async (req, res): Promise<void> => {
  await guard(res, "schedule this job", async () => {
    respond(res, await scheduleEntry(entryIdOf(req), req.body ?? {}, actorOf(req)));
  });
});

/** POST /schedule-queue/:id/hold — take work off the calendar, keeping the job intact. */
router.post("/schedule-queue/:id/hold", async (req, res): Promise<void> => {
  await guard(res, "put this job on hold", async () => {
    respond(res, await holdEntry(entryIdOf(req), req.body ?? {}, actorOf(req)));
  });
});

/** POST /schedule-queue/:id/release — return held work to Ready to Schedule. */
router.post("/schedule-queue/:id/release", async (req, res): Promise<void> => {
  await guard(res, "return this job to the queue", async () => {
    respond(res, await releaseEntry(entryIdOf(req), req.body ?? {}, actorOf(req)));
  });
});

/** PATCH /schedule-queue/:id/status — change what a card is waiting on. */
router.patch("/schedule-queue/:id/status", async (req, res): Promise<void> => {
  await guard(res, "update the queue status", async () => {
    respond(res, await setQueueStatus(entryIdOf(req), req.body?.queueStatus, actorOf(req)));
  });
});

export default router;
