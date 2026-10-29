import { app } from "./app.js";
import { config } from "./config/index.js";
import { runMigrations } from "./db/migrate.js";
import { initElasticsearchIndex } from "./services/elasticsearchService.js";
import { getEmailTransporter } from "./services/emailService.js";
import { reconcileScheduledJobs } from "./queues/emailQueue.js";
import { createEmailWorker } from "./workers/emailWorker.js";

async function bootstrap() {
  try {
    await runMigrations();
    await initElasticsearchIndex();
    await getEmailTransporter();
    await reconcileScheduledJobs();

    const worker = createEmailWorker();

    const server = app.listen(config.port, () => {
      console.log(`Server listening on port ${config.port}`);
      console.log(`Bull Board dashboard available at http://localhost:${config.port}/admin/queues`);
    });

    const shutdown = async () => {
      console.log("Shutting down gracefully...");
      server.close(async () => {
        await worker.close();
        process.exit(0);
      });
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (err) {
    console.error("Bootstrap error:", err);
    process.exit(1);
  }
}

bootstrap();
