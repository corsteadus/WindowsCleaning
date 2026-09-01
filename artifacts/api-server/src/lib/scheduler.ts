/**
 * In-process Scheduler
 *
 * Runs inside the API server process (no separate worker process).
 * Uses node-cron for daily automation runs and setInterval for frequent
 * campaign processing.
 *
 * Limitation: If the server process restarts, scheduled timers reset.
 * Any campaign mid-processing is detected on the next tick and re-queued
 * (see campaign-processor.ts: the stuck-campaign reset logic).
 *
 * Schedule:
 *   Campaign processor  — every 30 s (EMAIL_CAMPAIGN_POLL_MS env override)
 *   Automation engine   — daily at 06:00 server time (AUTOMATION_CRON env override)
 *   Retry sweep         — every 5 min (runs inside campaign processor tick)
 */

import cron from "node-cron";
import { processCampaigns } from "./campaign-processor";
import { runAutomationEngine } from "./automation-engine";
import { runRecurringPlanEngine } from "./recurring-plan-engine";
import { logger } from "./logger";
import { processCommunicationOutbox } from "./communication-dispatcher";

const POLL_MS       = parseInt(process.env.EMAIL_CAMPAIGN_POLL_MS ?? "30000", 10);
const AUTO_CRON     = process.env.AUTOMATION_CRON ?? "0 6 * * *";
const RECUR_CRON    = process.env.RECURRING_PLAN_CRON ?? "15 6 * * *";

let _started = false;

export function startScheduler(): void {
  if (_started) return;
  _started = true;

  // ── Campaign processor (every 30 s) ───────────────────────────────────────
  setInterval(async () => {
    try {
      await processCommunicationOutbox();
      await processCampaigns();
    } catch (err) {
      logger.error({ err }, "Scheduler: campaign processor error");
    }
  }, POLL_MS);

  // Also run immediately on startup to pick up any queued campaigns
  setTimeout(async () => {
    try {
      await processCommunicationOutbox();
      await processCampaigns();
    } catch (err) {
      logger.error({ err }, "Scheduler: initial campaign processor error");
    }
  }, 5000);

  // ── Automation engine (daily cron) ────────────────────────────────────────
  if (!cron.validate(AUTO_CRON)) {
    logger.warn({ AUTO_CRON }, "Invalid AUTOMATION_CRON expression — using default 0 6 * * *");
  }

  cron.schedule(cron.validate(AUTO_CRON) ? AUTO_CRON : "0 6 * * *", async () => {
    logger.info("Scheduler: automation engine starting");
    try {
      await runAutomationEngine();
    } catch (err) {
      logger.error({ err }, "Scheduler: automation engine error");
    }
  });

  // ── Recurring plan engine (daily at 06:15) ────────────────────────────────
  cron.schedule(cron.validate(RECUR_CRON) ? RECUR_CRON : "15 6 * * *", async () => {
    logger.info("Scheduler: recurring plan engine starting");
    try {
      const result = await runRecurringPlanEngine();
      logger.info(result, "Scheduler: recurring plan engine complete");
    } catch (err) {
      logger.error({ err }, "Scheduler: recurring plan engine error");
    }
  });

  // Also run recurring engine 10 s after startup
  setTimeout(async () => {
    try {
      const result = await runRecurringPlanEngine();
      if (result.generated > 0 || result.errors > 0) {
        logger.info(result, "Scheduler: startup recurring plan run");
      }
    } catch (err) {
      logger.error({ err }, "Scheduler: startup recurring plan error");
    }
  }, 10000);

  logger.info(
    { pollMs: POLL_MS, automationCron: AUTO_CRON, recurringCron: RECUR_CRON },
    "Scheduler started (communication outbox + campaign processor + automation engine + recurring plan engine)"
  );
}
