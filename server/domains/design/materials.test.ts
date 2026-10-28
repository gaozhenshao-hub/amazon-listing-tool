import { beforeEach, afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtemp, readdir, unlink, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { once } from "node:events";
import type { Server } from "node:http";
const f = vi.hoisted(() => ({
  execute: vi.fn(),
  permission: vi.fn(),
  asset: vi.fn(),
  conversation: vi.fn(),
  dir: "",
  user: { id: 2, role: "designer", status: "active", defaultWorkspaceId: 3 },
}));
vi.mock("./repository", async original => ({
  ...(await original<any>()),
  execute: f.execute,
  ownAsset: f.asset,
  ownConversation: f.conversation,
  transaction: (cb: any) => cb({}),
}));
vi.mock("../../repositories/auth/authRepository", () => ({
  getRolePermission: f.permission,
}));
vi.mock("../../_core/context", () => ({
  createContext: async () => ({ user: f.user }),
}));
vi.mock("./assets", () => ({
  assetDirectory: async () => f.dir,
  assetBytes: async () => Buffer.from("generated image"),
}));
import { designMaterialsRouter } from "./materials";
import {
  designMaterialsHttpRouter,
  uploadedMaterialName,
} from "./materialsStorage";
import { insertMaterial } from "./materialsRepository";
const id = "11111111-1111-4111-8111-111111111111",
  projectId = "22222222-2222-4222-8222-222222222222",
  assetId = "33333333-3333-4333-8333-333333333333";
const user = {
  id: 2,
  role: "designer",
  status: "active",
  defaultWorkspaceId: 3,
};
const scope = { workspaceId: 3, userId: 2 };
let material: any,
  project: any,
  generation: any,
  duplicate = false,
  usage = 0,
  server: Server,
  base: string;
const caller = (u: any = user) =>
  designMaterialsRouter.createCaller({ user: u } as any);
beforeAll(async () => {
  f.dir = await mkdtemp(path.join(tmpdir(), "design-materials-test-"));
  const app = express();
  app.use("/api/design/materials", designMaterialsHttpRouter);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as any).port}/api/design/materials`;
});
afterAll(async () => {
  server.close();
  await once(server, "close");
  const folder = path.join(f.dir, "materials");
  for (const n of await readdir(folder).catch(() => []))
    await unlink(path.join(folder, n));
  await rmdir(folder).catch(() => {});
  await rmdir(f.dir);
});
beforeEach(() => {
  vi.clearAllMocks();
  f.user = { ...user };
  f.permission.mockResolvedValue(null);
  material = undefined;
  project = undefined;
  generation = undefined;
  duplicate = false;
  usage = 0;
  f.asset.mockResolvedValue({ mime: "image/png" });
  f.conversation.mockResolvedValue({ id });
  f.execute.mockImplementation(async (q: string, v: any[]) => {
    if (q.includes("workspace_memberships")) return [{ id: 1 }];
    if (q.startsWith("SELECT * FROM design_material_projects"))
      return project &&
        project.id === v[0] &&
        (v.length === 1 ||
          (project.workspaceId === v[1] && project.userId === v[2]))
        ? [project]
        : [];
    if (q.startsWith("SELECT f.* FROM design_material_files f WHERE"))
      return material &&
        material.workspaceId === v[1] &&
        (material.projectId === null ||
          (project?.userId === v[2] && project.workspaceId === v[1]))
        ? [material]
        : [];
    if (q.startsWith("SELECT * FROM design_generations"))
      return generation ? [generation] : [];
    if (q.startsWith("SELECT id FROM design_material_files"))
      return duplicate ? [{ id }] : [];
    if (q.startsWith("SELECT COALESCE(SUM(bytes)")) return [{ bytes: usage }];
    return [];
  });
});
it("scopes project listing to the authenticated workspace and creator, including admins", async () => {
  await caller({ ...user, role: "admin" }).projects();
  expect(
    f.execute.mock.calls.find(c => c[0].startsWith("SELECT p.id"))?.[1]
  ).toEqual([3, 2]);
});
it("rejects another designer's project before listing its files", async () => {
  project = { id: projectId, workspaceId: 3, userId: 7 };
  await expect(caller().list({ projectId })).rejects.toThrow("无权访问");
  expect(f.execute.mock.calls.some(c => c[0].includes("LEFT JOIN users"))).toBe(
    false
  );
});
it("cannot rename someone else's project by guessing its identifier", async () => {
  project = { id: projectId, workspaceId: 3, userId: 7 };
  await expect(
    caller().saveProject({ id: projectId, name: "覆盖" })
  ).rejects.toThrow();
  expect(f.execute.mock.calls.some(c => c[0].startsWith("UPDATE"))).toBe(false);
});
it("public listing remains workspace scoped and escapes wildcard search", async () => {
  await caller().list({ projectId: null, search: "100%_" });
  const call = f.execute.mock.calls.find(c =>
    c[0].includes("LEFT JOIN users")
  )!;
  expect(call[1]).toEqual([3, null, "100!%!_", "%100!%!_%", 0]);
});
it("another designer can read public files but cannot rename or delete them", async () => {
  material = { id, workspaceId: 3, userId: 7, projectId: null, revision: 1 };
  await expect(
    caller().rename({ id, revision: 1, name: "更名" })
  ).rejects.toThrow();
  await expect(caller().trash({ id, revision: 1 })).rejects.toThrow();
});
it("an administrator can maintain public materials", async () => {
  material = { id, workspaceId: 3, userId: 7, projectId: null, revision: 1 };
  await caller({ ...user, role: "admin" }).rename({
    id,
    revision: 1,
    name: "更名",
  });
  expect(
    f.execute.mock.calls.some(c =>
      c[0].startsWith("UPDATE design_material_files")
    )
  ).toBe(true);
});
it("rejects stale edits", async () => {
  material = { id, workspaceId: 3, userId: 2, projectId: null, revision: 2 };
  await expect(
    caller().rename({ id, revision: 1, name: "更名" })
  ).rejects.toThrow("已被更新");
});
it("moves files to recoverable trash and prevents conflicting restores", async () => {
  material = {
    id,
    workspaceId: 3,
    userId: 2,
    projectId: null,
    revision: 1,
    sha256: "hash",
  };
  await caller().trash({ id, revision: 1 });
  expect(
    f.execute.mock.calls.some(c => c[0].includes("SET deletedAt=NOW(3)"))
  ).toBe(true);
  duplicate = true;
  await expect(
    caller().trash({ id, revision: 1, restore: true })
  ).rejects.toThrow("无需重复恢复");
});
it("requires an active design account and membership", async () => {
  await expect(
    caller({ ...user, status: "disabled" }).projects()
  ).rejects.toThrow();
  f.execute.mockResolvedValue([]);
  await expect(caller().projects()).rejects.toThrow("工作空间");
});
it("does not save somebody else's or unselected generated images", async () => {
  await expect(
    caller().saveGenerated({
      generationId: id,
      assetId,
      projectId: null,
      name: "作品.png",
    })
  ).rejects.toThrow();
  generation = { conversationId: id, assetIds: [id] };
  await expect(
    caller().saveGenerated({
      generationId: id,
      assetId,
      projectId: null,
      name: "作品.png",
    })
  ).rejects.toThrow();
  expect(f.asset).not.toHaveBeenCalled();
});
it("stores an independent image copy without disclosing private conversation or reference ids", async () => {
  generation = { conversationId: id, assetIds: [assetId] };
  const result = await caller().saveGenerated({
    generationId: id,
    assetId,
    projectId: null,
    name: "作品.png",
  });
  expect(result.duplicate).toBe(false);
  const values = f.execute.mock.calls.find(c =>
    c[0].startsWith("INSERT INTO design_material_files")
  )![1];
  expect(values.slice(1, 5)).toEqual([3, 2, null, "作品.png"]);
  expect(values).not.toContain(assetId);
  expect(values).not.toContain(id);
});
it("deduplicates within the target location and checks storage quota", async () => {
  const file = {
    id,
    name: "图.png",
    mime: "image/png",
    bytes: 10,
    sha256: "hash",
    storageName: id + ".blob",
  };
  duplicate = true;
  expect(await insertMaterial(scope, file, null, {})).toEqual({
    id,
    duplicate: true,
  });
  duplicate = false;
  usage = 10 * 1024 ** 3;
  await expect(insertMaterial(scope, file, null, {})).rejects.toThrow(
    "空间不足"
  );
});
it.each(["../a.png", "a\\b.png", "a.html", "a.exe"])(
  "rejects unsafe or unsupported upload name %s",
  name => {
    expect(() => uploadedMaterialName(name)).toThrow();
  }
);
it("decodes Chinese multipart filenames without damaging ASCII filenames", () => {
  expect(
    uploadedMaterialName(Buffer.from("源文件.psd").toString("latin1"))
  ).toBe("源文件.psd");
  expect(uploadedMaterialName("product.psd")).toBe("product.psd");
});
it("HTTP uploads accept source files and clean duplicate temporary files", async () => {
  const form = new FormData();
  form.append("file", new Blob(["PSD sample"]), "sample.psd");
  const response = await fetch(base + "/upload", {
    method: "POST",
    body: form,
  });
  expect(response.status).toBe(200);
  expect((await response.json()).duplicate).toBe(false);
  const before = await readdir(path.join(f.dir, "materials"));
  duplicate = true;
  const again = new FormData();
  again.append("file", new Blob(["PSD sample"]), "renamed.psd");
  expect(
    (
      await (
        await fetch(base + "/upload", { method: "POST", body: again })
      ).json()
    ).duplicate
  ).toBe(true);
  // Cleanup happens after the response is sent; wait for the filesystem to settle.
  await vi.waitFor(async () =>
    expect(await readdir(path.join(f.dir, "materials"))).toEqual(before)
  );
});
it("HTTP uploads reject foreign projects and cross-site writes", async () => {
  project = { id: projectId, workspaceId: 3, userId: 7 };
  expect(
    (await fetch(base + "/upload?projectId=" + projectId, { method: "POST" }))
      .status
  ).toBe(404);
  expect(
    (
      await fetch(base + "/upload", {
        method: "POST",
        headers: { Origin: "https://foreign.example" },
      })
    ).status
  ).toBe(403);
});
it("HTTP downloads cannot bypass owner/workspace checks or read trashed files", async () => {
  material = { id, workspaceId: 3, userId: 7, projectId, revision: 1 };
  project = { id: projectId, workspaceId: 3, userId: 7 };
  expect((await fetch(base + "/files/" + id)).status).toBe(404);
  material = { ...material, projectId: null, workspaceId: 4 };
  expect((await fetch(base + "/files/" + id)).status).toBe(404);
  material = { ...material, workspaceId: 3, deletedAt: new Date() };
  expect((await fetch(base + "/files/" + id)).status).toBe(404);
});
it("public non-raster files download as attachments, never executable inline content", async () => {
  const storageName = id + ".blob",
    body = "<svg onload='alert(1)'/>";
  await writeFile(path.join(f.dir, "materials", storageName), body);
  material = {
    id,
    workspaceId: 3,
    userId: 7,
    projectId: null,
    name: "矢量.svg",
    mime: "application/octet-stream",
    storageName,
    bytes: Buffer.byteLength(body),
  };
  const response = await fetch(base + "/files/" + id);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toContain("attachment;");
  expect(response.headers.get("content-type")).toContain(
    "application/octet-stream"
  );
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(await response.text()).toBe(body);
});
