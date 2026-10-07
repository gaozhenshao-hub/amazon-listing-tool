import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(), getUserById: vi.fn(), getProjectById: vi.fn(), getProjectByIdAdmin: vi.fn(),
  getExpressionGroupByProject: vi.fn(), countExpressionGroupImages: vi.fn(), storagePut: vi.fn(),
}));
vi.mock("./_core/sdk", () => ({ sdk: { verifySession: mocks.verifySession, authenticateRequest: vi.fn() } }));
vi.mock("./repositories", () => ({
  getUserById: mocks.getUserById, getProjectById: mocks.getProjectById,
  getProjectByIdAdmin: mocks.getProjectByIdAdmin, getExpressionGroupByProject: mocks.getExpressionGroupByProject,
  countExpressionGroupImages: mocks.countExpressionGroupImages, insertCompetitorImage: vi.fn(),
}));
vi.mock("./storage", () => ({ storagePut: mocks.storagePut }));

import { imageUploadRouter } from "./imageUploadRouter";
import { requireImageAssetReceipt } from "./domains/image/services/imageAssetReceipt";

let server: Server | undefined;
let baseUrl: string;
const originalSecret = process.env.JWT_SECRET;
beforeEach(async () => {
  process.env.JWT_SECRET = "local-only-synthetic-test-secret";
  vi.clearAllMocks();
  mocks.verifySession.mockResolvedValue({ openId: "pwd_17" });
  mocks.getUserById.mockResolvedValue({ id: 17, role: "super_admin", status: "active", defaultWorkspaceId: 7 });
  mocks.getProjectByIdAdmin.mockResolvedValue({ id: 51, workspaceId: 7, userId: 17 });
  mocks.getExpressionGroupByProject.mockResolvedValue({ id: 9, projectId: 51 });
  mocks.countExpressionGroupImages.mockResolvedValue(0);
  mocks.storagePut.mockResolvedValue({ url: "https://assets.example.invalid/synthetic.png" });
  const app = express();
  app.use(imageUploadRouter);
  server = await new Promise<Server>(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve()));
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});
async function upload(path: string, extras: Record<string, string>) {
  const body = new FormData();
  body.set("projectId", "51");
  for (const [key, value] of Object.entries(extras)) body.set(key, value);
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#ffffff" } }).png().toBuffer();
  body.set("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "test.png");
  return fetch(`${baseUrl}/${path}`, { method: "POST", headers: { cookie: "app_session_id=synthetic" }, body });
}

describe("图片上传HTTP回执与项目范围", () => {
  it("当前工作空间之外的设计师图片不会进入对象存储", async () => {
    mocks.getProjectByIdAdmin.mockResolvedValue({ id: 51, workspaceId: 8, userId: 17 });
    const response = await upload("designer-image", { imageNumber: "main" });
    expect(response.status).toBe(404);
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });
  it("表达组groupId不属于项目时在上传前拒绝", async () => {
    mocks.getExpressionGroupByProject.mockResolvedValue(null);
    const response = await upload("expression-group-image", { groupId: "9" });
    expect(response.status).toBe(404);
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });
  it("合法设计师上传只返回对应项目/上传者/类型的可核验回执", async () => {
    const response = await upload("designer-image", { imageNumber: "main" });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(mocks.storagePut).toHaveBeenCalledTimes(1);
    expect(requireImageAssetReceipt({ reference: payload.url, kind: "designer", projectId: 51, userId: 17 }).url)
      .toBe("https://assets.example.invalid/synthetic.png");
  });
  it("PNG文件名和MIME无法让HTML冒充已验证图片", async () => {
    const body = new FormData();
    body.set("projectId", "51");
    body.set("imageNumber", "main");
    body.set("file", new Blob(["<html><script>untrusted</script></html>"], { type: "image/png" }), "fake.png");
    const response = await fetch(`${baseUrl}/designer-image`, {
      method: "POST", headers: { cookie: "app_session_id=synthetic" }, body,
    });
    expect(response.status).toBe(400);
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });
  it("仅包含PNG魔数但没有完整像素数据的截断文件不能获得上传回执", async () => {
    const body = new FormData();
    body.set("projectId", "51");
    body.set("imageNumber", "main");
    const truncated = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
    body.set("file", new Blob([truncated], { type: "image/png" }), "broken.png");
    const response = await fetch(`${baseUrl}/designer-image`, {
      method: "POST", headers: { cookie: "app_session_id=synthetic" }, body,
    });
    expect(response.status).toBe(400);
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });
});
