import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  script: vi.fn(), sections: vi.fn(), requireDb: vi.fn(), storagePut: vi.fn(),
}));
vi.mock("./videoScriptDb", async importOriginal => ({
  ...await importOriginal<typeof import("./videoScriptDb")>(),
  getVideoScriptById: mocks.script,
  getSections: mocks.sections,
}));
vi.mock("./repositories/dbClient", async importOriginal => ({
  ...await importOriginal<typeof import("./repositories/dbClient")>(),
  requireDb: mocks.requireDb,
}));
vi.mock("./storage", async importOriginal => ({
  ...await importOriginal<typeof import("./storage")>(),
  storagePut: mocks.storagePut,
}));

import { videoScriptRouter } from "./routers/videoScript";
import type { TrpcContext } from "./_core/context";

function caller(role: "user" | "super_admin", workspaceId: number | null = 7) {
  return videoScriptRouter.createCaller({
    user: { id: 20, role, openId: "test", name: "Reviewer" } as TrpcContext["user"],
    workspaceId,
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.script.mockResolvedValue({ id: 6, projectId: 51, scriptName: "Synthetic Demo" });
  mocks.requireDb.mockResolvedValue({ select: () => ({
    from: () => ({ where: () => ({ limit: async () => [] }) }),
  }) });
});

describe("视频脚本超管导出门禁", () => {
  it.each(["exportToExcel", "getFullScript"] as const)("%s rejects a regular user before loading a script", async (endpoint) => {
    await expect(endpoint === "exportToExcel"
      ? caller("user").exportToExcel({ videoScriptId: 6 })
      : caller("user").getFullScript({ videoScriptId: 6 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.script).not.toHaveBeenCalled();
    expect(mocks.requireDb).not.toHaveBeenCalled();
  });

  it.each(["exportToExcel", "getFullScript"] as const)("%s rejects super_admin outside the exact project workspace before content access", async (endpoint) => {
    await expect(endpoint === "exportToExcel"
      ? caller("super_admin").exportToExcel({ videoScriptId: 6 })
      : caller("super_admin").getFullScript({ videoScriptId: 6 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.requireDb).toHaveBeenCalledOnce();
    expect(mocks.sections).not.toHaveBeenCalled();
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });

  it("requires a selected workspace even for super_admin", async () => {
    await expect(caller("super_admin", null).exportToExcel({ videoScriptId: 6 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.script).not.toHaveBeenCalled();
  });
});
