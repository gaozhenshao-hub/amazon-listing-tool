import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
const f = vi.hoisted(() => ({
  locked: false,
  data: { productPhotos: [] } as any,
  put: vi.fn(),
  scope: null as any,
}));
vi.mock("./researchLocks", () => ({
  assertResearchEditable: async () => {
    if (f.locked) throw new Error("已锁定");
  },
}));
vi.mock("./researchManagedStore", () => ({
  mutateResearchManaged: async (scope: any, _page: any, fn: any) => {
    f.scope = scope;
    if (f.locked) throw new Error("已锁定");
    return { result: await fn(f.data), revision: 1 };
  },
}));
vi.mock("./aggregationStore", () => ({
  readListingAggregation: async () => ({ data: f.data }),
}));
vi.mock("../../storage", () => ({
  storagePut: f.put,
  resolveStoredObjectUrl: async (s: string) => "preview:" + s,
}));
import {
  uploadProductPhoto,
  reorderProductPhotos,
  productPhotos,
} from "./productPhotos";
const scope = { projectId: 11, workspaceId: 3, userId: 7 };
beforeEach(() => {
  f.locked = false;
  f.data = { productPhotos: [] };
  f.put
    .mockReset()
    .mockResolvedValue({ storageUri: "storage://local/owned.jpg" });
});
it("validates actual image data, strips metadata and stores a project-owned durable reference", async () => {
  const image = await sharp({
    create: { width: 10, height: 20, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await uploadProductPhoto(scope, {
    projectId: 11,
    name: "侧面.png",
    kind: "product",
    base64: image.toString("base64"),
  });
  expect(f.put.mock.calls[0][0]).toMatch(/^listing-product\/3\/11\//);
  expect(f.data.productPhotos[0]).toMatchObject({
    width: 10,
    height: 20,
    kind: "product",
    storageKey: "storage://local/owned.jpg",
  });
  expect((await productPhotos(scope))[0].url).toContain("preview:");
});
it("blocks uploads while locked and rejects SVG disguised as an image", async () => {
  f.locked = true;
  await expect(
    uploadProductPhoto(scope, {
      projectId: 11,
      name: "x.png",
      kind: "product",
      base64: "AAAA",
    })
  ).rejects.toThrow("已锁定");
  expect(f.put).not.toHaveBeenCalled();
  f.locked = false;
  await expect(
    uploadProductPhoto(scope, {
      projectId: 11,
      name: "x.png",
      kind: "product",
      base64: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
      ).toString("base64"),
    })
  ).rejects.toThrow("有效");
  expect(f.put).not.toHaveBeenCalled();
});
it("does not silently delete a concurrently uploaded photo during reorder", async () => {
  f.data.productPhotos = [{ id: "a" }, { id: "b" }];
  await expect(reorderProductPhotos(scope, ["a"], ["a"])).rejects.toThrow(
    "已变化"
  );
  expect(f.data.productPhotos).toHaveLength(2);
  await reorderProductPhotos(scope, ["b", "a"], ["a", "b"]);
  expect(f.data.productPhotos.map((p: any) => p.id)).toEqual(["b", "a"]);
});
