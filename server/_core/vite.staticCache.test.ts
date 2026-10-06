import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "http";
import fs from "fs/promises";
import path from "path";
import { serveStatic } from "./vite";

const runningServers: Server[] = [];
const testDistPath = path.resolve(process.cwd(), "dist", "public");
const hashedFixture = path.join(testDistPath, "assets", "cache-test-8fa901bc.js");
const plainFixture = path.join(testDistPath, "assets", "cache-test-plain.js");
let createdTestDist = false;

async function ensureStaticFixture() {
  try {
    await fs.access(path.join(testDistPath, "index.html"));
  } catch {
    await fs.mkdir(testDistPath, { recursive: true });
    await fs.writeFile(path.join(testDistPath, "index.html"), "<!doctype html><html><body><div id=\"root\"></div></body></html>");
    createdTestDist = true;
  }
}

async function startStaticServer() {
  await ensureStaticFixture();
  // 单测在源码目录运行，没有 esbuild 产物的 import.meta.dirname。
  vi.stubEnv("NODE_ENV", "development");
  const app = express();
  serveStatic(app);
  const server = await new Promise<Server>((resolve) => {
    const created = app.listen(0, () => resolve(created));
  });
  runningServers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to start static test server");
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  vi.unstubAllEnvs();
  await Promise.all([hashedFixture, plainFixture].map((file) => fs.rm(file, { force: true })));
  if (createdTestDist) {
    await fs.rm(path.resolve(process.cwd(), "dist"), { recursive: true, force: true });
    createdTestDist = false;
  }
});

describe("生产静态资源恢复策略", () => {
  it("为入口HTML禁用缓存，并让不存在的哈希资源明确返回404而非HTML", async () => {
    const baseUrl = await startStaticServer();
    const [entry, staleAsset] = await Promise.all([
      fetch(`${baseUrl}/listing/image-workflow`),
      fetch(`${baseUrl}/assets/ImageWorkflowPage-stale-deploy.js`),
    ]);

    expect(entry.status).toBe(200);
    expect(entry.headers.get("cache-control")).toContain("no-store");
    expect(staleAsset.status).toBe(404);
    expect(staleAsset.headers.get("content-type")).toContain("text/plain");
    expect(await staleAsset.text()).toBe("Asset not found");
  });

  it("仅对实际存在的内容哈希资源使用 immutable 缓存", async () => {
    await ensureStaticFixture();
    await fs.mkdir(path.dirname(hashedFixture), { recursive: true });
    await fs.writeFile(hashedFixture, "export const cached = true;");
    await fs.writeFile(plainFixture, "export const cached = false;");
    const baseUrl = await startStaticServer();
    const [hashed, plain, missing] = await Promise.all([
      fetch(`${baseUrl}/assets/cache-test-8fa901bc.js`),
      fetch(`${baseUrl}/assets/cache-test-plain.js`),
      fetch(`${baseUrl}/assets/cache-test-missing.js`),
    ]);

    expect(hashed.status).toBe(200);
    expect(hashed.headers.get("cache-control")).toContain("max-age=31536000");
    expect(hashed.headers.get("cache-control")).toContain("immutable");
    expect(plain.status).toBe(200);
    expect(plain.headers.get("cache-control")).not.toContain("immutable");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toContain("no-store");
  });
});
