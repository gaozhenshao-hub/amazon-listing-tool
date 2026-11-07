import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ acquire: vi.fn(), release: vi.fn(), records: vi.fn(), jobs: vi.fn() }));
vi.mock("../../_core/leaderLock", () => ({ MysqlLeaderLock: class {
  acquire = mocks.acquire;
  release = mocks.release;
} }));
vi.mock("../../repositories", () => ({ getCompetitorAnalysesByProject: mocks.records }));
vi.mock("../ai_os/routerContext", () => ({ rawExecute: mocks.jobs }));
import { withCompetitorCaptureAdmission } from "./competitorCaptureAdmission";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.acquire.mockResolvedValue({ acquired: true });
  mocks.release.mockResolvedValue(undefined);
  mocks.records.mockResolvedValue([{ asin: "B000000001" }, { asin: "B000000002" }, { asin: "B000000003" }]);
  mocks.jobs.mockResolvedValue([{ asin: "B000000004" }, { asin: "B000000005" }]);
});

describe("competitor capture admission", () => {
  const scope = { workspaceId: 3, projectId: 11, asin: "B000000006" };
  it("counts in-flight captures and refuses a sixth competitor", async () => {
    const work = vi.fn();
    await expect(withCompetitorCaptureAdmission(scope, work)).rejects.toThrow("最多采集 5 个竞品");
    expect(work).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("allows retry of a competitor already included in the limit", async () => {
    await expect(withCompetitorCaptureAdmission({ ...scope, asin: "b000000005" }, async () => "ok")).resolves.toBe("ok");
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("fails closed if another request holds the project lock", async () => {
    mocks.acquire.mockResolvedValueOnce({ acquired: false });
    const work = vi.fn();
    await expect(withCompetitorCaptureAdmission(scope, work)).rejects.toThrow("正在提交");
    expect(work).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
