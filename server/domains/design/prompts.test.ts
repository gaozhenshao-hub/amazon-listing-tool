import { beforeEach, expect, it, vi } from "vitest";
import { defaultDesignParams } from "../../../shared/designStudio";
const f = vi.hoisted(() => ({
  execute: vi.fn(),
  ownAsset: vi.fn(),
  ownConversation: vi.fn(),
  permission: vi.fn(),
}));
vi.mock("./repository", async original => ({
  ...(await original<any>()),
  execute: f.execute,
  ownAsset: f.ownAsset,
  ownConversation: f.ownConversation,
  transaction: (fn: any) => fn({}),
}));
vi.mock("../../repositories/auth/authRepository", () => ({
  getRolePermission: f.permission,
}));
import { designPromptRouter } from "./prompts";
import { designRoleAllows } from "./access";
const id = "11111111-1111-4111-8111-111111111111";
const source = "22222222-2222-4222-8222-222222222222";
const user = {
  id: 2,
  role: "designer",
  status: "active",
  defaultWorkspaceId: 3,
};
const caller = (u: any = user) =>
  designPromptRouter.createCaller({ user: u } as any);
const draft = {
  id,
  title: "白底产品图",
  category: "白底主图" as const,
  prompt: "保持产品外观",
  notes: "",
  params: defaultDesignParams,
};
let row: any, generation: any;
beforeEach(() => {
  vi.clearAllMocks();
  row = undefined;
  generation = undefined;
  f.permission.mockResolvedValue({ modules: '["design"]' });
  f.ownAsset.mockResolvedValue({ id: "asset" });
  f.ownConversation.mockResolvedValue({ id: "conversation" });
  f.execute.mockImplementation(async (query: string) => {
    if (query.includes("workspace_memberships")) return [{ id: 1 }];
    if (query.startsWith("SELECT p.*")) return row ? [row] : [];
    if (query.startsWith("SELECT * FROM design_prompt_library"))
      return row ? [row] : [];
    if (query.startsWith("SELECT * FROM design_generations"))
      return generation ? [generation] : [];
    return [];
  });
});
it("shares prompt content within the workspace without private asset or conversation identifiers", async () => {
  row = {
    ...draft,
    userId: 7,
    workspaceId: 3,
    revision: 1,
    authorName: "另一位美工",
    exampleAssetId: "private-result",
    sourceGenerationId: source,
    referenceIds: ["private-ref"],
  };
  const result = await caller().list({});
  expect(result.items[0].canManage).toBe(false);
  expect(result.items[0].hasExample).toBe(true);
  expect(result.items[0]).not.toHaveProperty("exampleAssetId");
  expect(result.items[0]).not.toHaveProperty("sourceGenerationId");
  expect(result.items[0]).not.toHaveProperty("referenceIds");
  const call = f.execute.mock.calls.find(c => c[0].startsWith("SELECT p.*"))!;
  expect(call[0]).toContain("p.workspaceId=?");
  expect(call[1][0]).toBe(3);
});
it("blocks inactive accounts before any data read", async () => {
  await expect(
    caller({ ...user, status: "disabled" }).list({})
  ).rejects.toThrow();
  expect(f.execute).not.toHaveBeenCalled();
});
it("requires active workspace membership", async () => {
  f.execute.mockResolvedValue([]);
  await expect(caller().list({})).rejects.toThrow("工作空间");
});
it("honors prompt permissions separately from image permissions", () => {
  const permissions = {
    modules: '["design"]',
    detailedPermissions: JSON.stringify([
      {
        moduleId: "design",
        operations: ["read"],
        subModules: [
          { subModuleId: "design_images", operations: ["read", "edit"] },
        ],
      },
    ]),
  };
  expect(
    designRoleAllows("designer", permissions, "edit", "design_images")
  ).toBe(true);
  expect(
    designRoleAllows("designer", permissions, "edit", "design_prompts")
  ).toBe(false);
});
it("lets a designer add their own shared prompt", async () => {
  await caller().save(draft);
  const insert = f.execute.mock.calls.find(c =>
    c[0].startsWith("INSERT INTO design_prompt_library")
  )!;
  expect(insert[1].slice(0, 3)).toEqual([id, 3, 2]);
});
it("prevents editing or deleting another designer's entry", async () => {
  row = { ...draft, userId: 7, revision: 1 };
  await expect(caller().save({ ...draft, revision: 1 })).rejects.toThrow();
  await expect(caller().remove({ id, revision: 1 })).rejects.toThrow();
  expect(f.execute.mock.calls.some(c => c[0].startsWith("UPDATE"))).toBe(false);
});
it("lets an administrator maintain shared prompts", async () => {
  row = { ...draft, userId: 7, revision: 1 };
  await caller({ ...user, role: "admin" }).save({ ...draft, revision: 1 });
  expect(f.execute.mock.calls.some(c => c[0].startsWith("UPDATE"))).toBe(true);
});
it("rejects stale edits instead of overwriting concurrent changes", async () => {
  row = { ...draft, userId: 2, revision: 2 };
  await expect(caller().save({ ...draft, revision: 1 })).rejects.toThrow(
    "已更新"
  );
});
it("rejects another person's generation and failed or removed results", async () => {
  await expect(
    caller().save({ ...draft, sourceGenerationId: source })
  ).rejects.toThrow();
  const query = f.execute.mock.calls.find(c =>
    c[0].startsWith("SELECT * FROM design_generations")
  )!;
  expect(query[0]).toContain(
    "userId=? AND status='succeeded' AND deletedAt IS NULL"
  );
  expect(query[1]).toEqual([source, 3, 2]);
});
it("checks source conversation ownership and only shares its output image", async () => {
  generation = {
    conversationId: "conversation",
    assetIds: '["asset"]',
    referenceIds: '["private-ref"]',
  };
  await caller().save({ ...draft, sourceGenerationId: source });
  expect(f.ownConversation).toHaveBeenCalledWith(
    "conversation",
    { workspaceId: 3, userId: 2 },
    {}
  );
  expect(f.ownAsset).toHaveBeenCalledWith("asset", {
    workspaceId: 3,
    userId: 2,
  });
  const insert = f.execute.mock.calls.find(c =>
    c[0].startsWith("INSERT INTO")
  )!;
  expect(insert[1].at(-1)).toBe("asset");
  expect(insert[1]).not.toContain("private-ref");
});
it("rejects a source from a deleted conversation", async () => {
  generation = { conversationId: "conversation", assetIds: [] };
  f.ownConversation.mockResolvedValue(null);
  await expect(
    caller().save({ ...draft, sourceGenerationId: source })
  ).rejects.toThrow();
});
it("escapes wildcard searches literally", async () => {
  await caller().list({ search: "50%_!" });
  const q = f.execute.mock.calls.find(c => c[0].startsWith("SELECT p.*"))!;
  expect(q[1][4]).toBe("%50!%!_!!%");
});
