import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { startScheduler } from "./lib/scheduler";
import { resumeInterruptedFiles } from "./services/import/staging-worker";
import { deduplicateExternalIds } from "./lib/migration-dedup-external-ids";
import { fixExternalIdAssignments } from "./lib/migration-fix-external-ids";
import { retryFailedCustomerInserts } from "./lib/migration-retry-failed-customers";
import { deduplicateJobs } from "./lib/migration-dedup-jobs";
import { recoverDeletedImportedJobs } from "./lib/migration-recover-jobs";
import { runRequiredMigrationsAtStartup } from "./migrations/application-migrations";
import { shouldRunLegacyStartupMaintenance, shouldStartMutationWorkers } from "./lib/startup-maintenance";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer() {
  const migrationStatus = await runRequiredMigrationsAtStartup(pool);
  logger.info(migrationStatus, "Application migration startup gate evaluated");

  await new Promise<void>((resolve, reject) => {
    // Express 5 hands a bind failure (EADDRINUSE, or EACCES on a port Windows
    // has reserved) to this callback. Ignoring it logged "Server listening" and
    // then exited with code 0 once the event loop emptied.
    const server = app.listen(port, (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      logger.info({ port }, "Server listening");
      resolve();
    });
    server.once("error", reject);
  });

  if (shouldRunLegacyStartupMaintenance()) {
    deduplicateExternalIds()
      .then(() => fixExternalIdAssignments())
      .then(() => retryFailedCustomerInserts())
      .then(() => deduplicateJobs())
      .then(() => recoverDeletedImportedJobs())
      .then(() => resumeInterruptedFiles())
      .catch((err) => logger.error({ err }, "Explicit legacy startup maintenance failed"));
  } else {
    logger.info("Legacy repair and import-resume startup maintenance disabled");
  }
  if (shouldStartMutationWorkers()) {
    startScheduler();
  } else {
    logger.info("State-changing background schedulers disabled");
  }
}

startServer().catch((err) => {
  logger.error({ err }, "Application startup aborted");
  process.exit(1);
});
