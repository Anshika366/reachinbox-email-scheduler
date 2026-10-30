import { app } from "./app.js";
import { config } from "./config/index.js";
import { runMigrations } from "./db/migrate.js";
import { initElasticsearchIndex } from "./services/elasticsearchService.js";
import { getEmailTransporter } from "./services/emailService.js";
import { reconcileScheduledJobs } from "./queues/emailQueue.js";
import { createEmailWorker } from "./workers/emailWorker.js";
import { startDatabaseEmailDispatcher } from "./workers/dbDispatcher.js";

async function bootstrap() {
  // Start HTTP server immediately so Render port binding & health checks succeed
  const server = app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
    console.log(`Bull Board dashboard available at http://localhost:${config.port}/admin/queues`);
  });

  let worker: any = null;

  try {
    console.log("Running database migrations...");
    await runMigrations();
    console.log("Database migrations completed successfully.");

    // Always start reliable database fallback dispatcher
    startDatabaseEmailDispatcher();

    await initElasticsearchIndex();
    await getEmailTransporter();
    
    console.log("Reconciling scheduled jobs...");
    await reconcileScheduledJobs();
    console.log("Job reconciliation completed.");

    worker = createEmailWorker();
    console.log("BullMQ email worker fleet initialized.");
  } catch (err: any) {
    console.error("Startup background services warning:", err?.message || err);
    // Keep HTTP server alive so error diagnostics, health checks, and CORS headers function
  }

  const shutdown = async () => {
    console.log("Shutting down gracefully...");
    server.close(async () => {
      if (worker) {
        await worker.close();
      }
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap();
