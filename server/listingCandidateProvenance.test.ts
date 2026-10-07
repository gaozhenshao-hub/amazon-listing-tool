import { beforeEach, describe, expect, it, vi } from "vitest";
import { users } from "../drizzle/schema/auth";
import { aiJobs, emperorSkillRuns } from "../drizzle/schema/ai_os";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), createCandidate: vi.fn() }));
vi.mock("./domains/listing/repository", () => ({ getDb: mocks.getDb }));
vi.mock("./domains/listing/services/listingCandidateReviewService", () => ({ createListingCandidate: mocks.createCandidate }));
import { persistGeneratedBulletCandidate } from "./domains/listing/services/listingCandidateProvenance";

const input = {
  projectId: 3, workspaceId: 8, userId: 7, jobRunId: "job_123",
  coreRevisionId: 11, coreInputHash: "a".repeat(64),
  execution: { runId: "skill_123", modelSlug: "quality/actual", skillVersion: "7", fallbackCount: 0 },
  bullet: { subtitle: "Padded Travel Shell:", fullText: "A supported benefit", evidenceUsed: ["Padded shell"] },
  factRevisions: [{ id: 23, attributeKey: "Feature", value: "Padded shell" }], issues: [], characterCount: 224,
};
let runStatus = "succeeded";
let jobStatus = "running";

beforeEach(() => {
  vi.clearAllMocks(); runStatus = "succeeded"; jobStatus = "running";
  mocks.getDb.mockResolvedValue({ select: () => ({ from: (table: unknown) => ({ where: () => ({ limit: async () => {
    if (table === users) return [{ id: 7, role: "admin" }];
    if (table === aiJobs) return [{ id: 4, status: jobStatus }];
    if (table === emperorSkillRuns) return [{ id: 9, modelSlug: "quality/actual", status: runStatus }];
    throw new Error("unexpected table");
  } }) }) }) });
  mocks.createCandidate.mockResolvedValue({ id: 31, candidateRevision: 1 });
});

describe("Listing候选的Job/Skill Run/事实来源审计", () => {
  it("通过实际审计记录把事实ID而非浏览器证据伪字符串保存为待审AI候选", async () => {
    await expect(persistGeneratedBulletCandidate(input)).resolves.toMatchObject({ id: 31 });
    expect(mocks.createCandidate).toHaveBeenCalledWith(expect.objectContaining({
      source: "ai", workspaceId: 8, actorId: 7, coreRevisionId: 11, jobId: 4, skillRunId: 9,
      evidenceFactIds: [23], promptVersion: "7", actualModel: "quality/actual",
      gateResult: expect.objectContaining({ status: "passed" }),
    }));
  });
  it("不能唯一映射已确认事实、失败门禁或不合格Run时不得创建候选", async () => {
    await expect(persistGeneratedBulletCandidate({ ...input, bullet: { ...input.bullet, evidenceUsed: ["Unknown data"] } }))
      .rejects.toThrow(/无法唯一映射/);
    await expect(persistGeneratedBulletCandidate({ ...input, issues: ["unsupported"] })).rejects.toThrow(/门禁未通过/);
    jobStatus = "failed";
    await expect(persistGeneratedBulletCandidate(input)).rejects.toThrow(/审计记录不匹配/);
    expect(mocks.createCandidate).not.toHaveBeenCalled();
  });
});
