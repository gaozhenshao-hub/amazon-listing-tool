import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../../../_core/context";
// The repository Vitest include list excludes shared/. Keep its pure contract
// suite in the focused route run without changing the global test configuration.
import "../../../../shared/emperorSkillRead.test";
const mocks = vi.hoisted(() => ({ read: vi.fn(), getSkillBySlug: vi.fn(), rawExecute: vi.fn() }));
vi.mock("../services/skillReadonly", () => ({ skillReadonlyService: { read: mocks.read } }));
vi.mock("../routerContext", () => ({ getSkillBySlug: mocks.getSkillBySlug, rawExecute: mocks.rawExecute, normalizeSkillVersionForDb: vi.fn(), parseManifest: vi.fn() }));
vi.mock("../services/skillQualityGates", () => ({}));
vi.mock("../services/skillRollout", () => ({}));
vi.mock("../services/harnessCompletion", () => ({}));
vi.mock("../services/directRunRecovery", () => ({}));
vi.mock("../services/highQualitySkillGovernance", () => ({}));
import { emperorSkillsRouter } from "./skills";
const ctx = { user: { id: 3, role: "admin", defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue({ readonly: true }); });
describe("emperor.skills.getReadonly isolated route", () => {
  it("delegates exact ctx + strict input only to new secure reader", async () => {
    const input = { slug: "listing.title.research", expectedWorkspaceId: 7 };
    expect(await emperorSkillsRouter.createCaller(ctx).getReadonly(input)).toEqual({ readonly: true });
    expect(mocks.read).toHaveBeenCalledWith(ctx, input);
    expect(mocks.getSkillBySlug).not.toHaveBeenCalled(); expect(mocks.rawExecute).not.toHaveBeenCalled();
  });
  it("is a query, not mutation", () => expect(emperorSkillsRouter._def.procedures.getReadonly._def.type).toBe("query"));
  it("rejects missing authentication before service", async () => {
    await expect(emperorSkillsRouter.createCaller({ ...ctx, user: null }).getReadonly({ slug: "x", expectedWorkspaceId: 7 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each([{}, { slug: "x" }, { slug: "x", expectedWorkspaceId: undefined }, { slug: "x/y", expectedWorkspaceId: 7 }, { slug: " x", expectedWorkspaceId: 7 },
    { slug: "x", expectedWorkspaceId: "7" }, { slug: "x", expectedWorkspaceId: -1 }, { slug: "x", expectedWorkspaceId: 7, userId: 9 },
    { slug: "x", expectedWorkspaceId: 7, version: 3 }, { slug: "x", expectedWorkspaceId: 7, workspaceId: 8 }])("rejects malformed/extra client authority %j", async input => {
    await expect(emperorSkillsRouter.createCaller(ctx).getReadonly(input as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("passes explicit null without a default/global coercion", async () => {
    await emperorSkillsRouter.createCaller(ctx).getReadonly({ slug: "x", expectedWorkspaceId: null });
    expect(mocks.read.mock.calls[0][1]).toEqual({ slug: "x", expectedWorkspaceId: null });
  });
});
