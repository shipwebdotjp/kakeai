import { loadConfig } from "./config.ts";
import { createPrismaClient } from "./db/client.ts";
import { runMigrations } from "./db/migrate.ts";
import { applySqlitePragmas } from "./db/pragmas.ts";
import { logger } from "./logger.ts";
import { createApp } from "./server.ts";
import { ensureDataDirectories } from "./storage/paths.ts";
import { createWorker } from "./worker/index.ts";

async function main(): Promise<void> {
  const config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();

  const prisma = createPrismaClient(config.databaseUrl);
  const worker = createWorker();
  try {
    await applySqlitePragmas(prisma);
    await worker.start();
  } catch (error) {
    await prisma.$disconnect().catch(() => undefined);
    throw error;
  }

  const app = createApp({
    config,
    prisma,
    getWorkerStatus: worker.status,
  });

  const server = app.listen(config.port, config.host, () => {
    logger.info("api_listening", {
      url: `http://${config.host}:${config.port}`,
      dataRoot: config.dataRoot,
    });
  });

  let shuttingDown = false;
  const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("shutting_down", { signal });
    try {
      await worker.stop();
    } catch (error) {
      logger.warn("worker_stop_failed", { error: error instanceof Error ? error.message : String(error) });
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        logger.warn("server_close_timeout");
        resolve();
      }, 5000);
      timer.unref();
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    try {
      await prisma.$disconnect();
    } catch (error) {
      logger.warn("prisma_disconnect_failed", { error: error instanceof Error ? error.message : String(error) });
    }
    process.exit(exitCode);
  };

  server.on("error", (error) => {
    logger.error("listen_failed", { error: error.message });
    void shutdown("listen_failed", 1);
  });

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  logger.error("startup_failed", {
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  });
  process.exit(1);
});
