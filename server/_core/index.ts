import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { syncRouter } from "../syncRoutes";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startUsageTracking, stopUsageTracking } from "../usageTracking";
import {
  aiWorkerTickHandler,
  databaseObservabilitySnapshotHandler,
  dataCleanupHandler,
  weeklyReportHandler,
} from "../scheduledHandlers";
import { kbExternalApiRouter } from "../kbExternalApi";
import { imageUploadRouter } from "../imageUploadRouter";
import {
  getRuntimeRole,
  shouldStartSchedulerTasks,
  shouldStartWebLocalTasks,
  shouldStartWorkerTasks,
} from "./runtime";
import { assertStartupConfig } from "./startupValidation";
import { registerRuntimeHealthRoutes } from "./runtimeHealth";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const role = getRuntimeRole();
  assertStartupConfig({ entrypoint: "web", role });

  const app = express();
  const server = createServer(app);
  registerRuntimeHealthRoutes(app, { service: "web" });
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // Knowledge base P2P sync routes
  app.use("/api/sync", syncRouter);
  // Knowledge base external API for Emperor platform (no OAuth, uses EMPEROR_KB_API_KEY)
  app.use("/api/external/kb", kbExternalApiRouter);
  // Fast image upload endpoint (multipart/form-data, avoids base64 overhead)
  app.use("/api/upload", imageUploadRouter);
  // Scheduled task handlers (Heartbeat HTTP cron)
  app.post("/api/scheduled/weekly-report", weeklyReportHandler);
  app.post("/api/scheduled/data-cleanup", dataCleanupHandler);
  // AI Worker Tick: drains AI Job queue every minute (Heartbeat HTTP cron, replaces always-on Worker process)
  app.post("/api/scheduled/ai-worker-tick", aiWorkerTickHandler);
  app.post("/api/scheduled/database-observability-snapshot", databaseObservabilitySnapshotHandler);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/ role=${role}`);
    // Start usage tracking background flush
    if (shouldStartWebLocalTasks(role)) {
      startUsageTracking();
    }
    if (shouldStartSchedulerTasks(role)) {
      import("../intelAutoCollect")
        .then(m => m.intelScheduler.start())
        .catch(err => console.error("[IntelScheduler] Failed to start:", err));
      // Start todo reminder scheduler (check every hour)
      import("../todoReminder")
        .then(m => m.startTodoReminderScheduler())
        .catch(err => console.error("[TodoReminder] Failed to start:", err));
    } else {
      console.log(
        "[Scheduler] Not started in Web process; use pnpm start:scheduler for production timers."
      );
    }
    // Lingxing API adapter removed - data now imported via Excel uploads only
    // Initialize NextSLS logistics API adapter from DB settings
    import("../nextsls/adapter")
      .then(m => m.initNextSlsAdapterFromDb())
      .catch(err => console.error("[NextSLS] Failed to init:", err));
    // Initialize weekly auto-sync cron job (every Monday 02:00 Asia/Shanghai)
    import("../cronJobs")
      .then(m => m.initCronJobs())
      .catch(err => console.error("[AutoSync] Failed to init:", err));
    if (shouldStartWorkerTasks(role)) {
      // Recover durable AI jobs that were queued/running before a restart.
      import("../services/aiJobRunner")
        .then(m => m.recoverActiveAiJobs())
        .then(result => {
          if (result.scheduled > 0 || result.skippedWithoutHandler > 0) {
            console.log(
              `[AI Job] Recovery scanned=${result.scanned}, scheduled=${result.scheduled}, skippedWithoutHandler=${result.skippedWithoutHandler}`
            );
          }
        })
        .catch(err => console.error("[AI Job] Recovery failed:", err));
      import("../services/emperorAgentRunner")
        .then(m => m.recoverTimedOutAgentNodes())
        .then(result => {
          if (
            result.failed > 0 ||
            result.retried > 0 ||
            result.skippedPaused > 0 ||
            result.skippedStale > 0
          ) {
            console.log(
              `[Agent Runtime] Timeout recovery scanned=${result.scanned}, retried=${result.retried}, failed=${result.failed}, skippedPaused=${result.skippedPaused}, skippedStale=${result.skippedStale}`
            );
          }
        })
        .catch(err =>
          console.error("[Agent Runtime] Timeout recovery failed:", err)
        );
    } else {
      console.log(
        "[AI Job] Recovery not started in Web process; use pnpm start:worker:ai for production jobs."
      );
    }
  });

  const shutdown = async (signal: string) => {
    console.log(`[Server] received ${signal}, shutting down gracefully`);
    await new Promise<void>(resolve => {
      server.close(error => {
        if (error) console.error("[Server] close failed:", error);
        resolve();
      });
    });
    if (shouldStartWebLocalTasks(role)) {
      await stopUsageTracking().catch(error =>
        console.error("[UsageTracking] Stop failed:", error)
      );
    }
    if (shouldStartSchedulerTasks(role)) {
      await import("../intelAutoCollect")
        .then(m => m.intelScheduler.stop())
        .catch(err => console.error("[IntelScheduler] Stop failed:", err));
      await import("../todoReminder")
        .then(m => m.stopTodoReminderScheduler())
        .catch(err => console.error("[TodoReminder] Stop failed:", err));
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

startServer().catch(console.error);
