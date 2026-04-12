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
import { startUsageTracking } from "../usageTracking";
import { intelScheduler } from "../intelAutoCollect";

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
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // Knowledge base P2P sync routes
  app.use("/api/sync", syncRouter);
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
    console.log(`Server running on http://localhost:${port}/`);
    // Start usage tracking background flush
    startUsageTracking();
    // Start intel auto-collect scheduler
    intelScheduler.start();
    // Start todo reminder scheduler (check every hour)
    import("../todoReminder").then(m => m.startTodoReminderScheduler()).catch(err => console.error("[TodoReminder] Failed to start:", err));
    // Initialize Lingxing API adapter from DB settings (proxy config, credentials)
    import("../lingxingAdapter").then(m => m.initLingxingAdapterFromDb()).catch(err => console.error("[LingxingAdapter] Failed to init:", err));
    // Initialize NextSLS logistics API adapter from DB settings
    import("../nextsls/adapter").then(m => m.initNextSlsAdapterFromDb()).catch(err => console.error("[NextSLS] Failed to init:", err));
    // Initialize weekly auto-sync cron job (every Monday 02:00 Asia/Shanghai)
    import("../cronJobs").then(m => m.initCronJobs()).catch(err => console.error("[AutoSync] Failed to init:", err));
  });
}

startServer().catch(console.error);
