vi.mock("./researchLocks",()=>({assertResearchEditable:vi.fn()}));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertBusinessJobAgentBinding } from "../ai_os/services/businessJobBindingPolicy";
const f = vi.hoisted(() => ({ agent: vi.fn(), start: vi.fn(), handler: null as any, model: vi.fn(), readRun: vi.fn(), template: vi.fn(), sql: vi.fn() }));
vi.mock("../../repositories/dbClient", () => ({ requireDb: async () => ({ transaction: (fn: any) => fn({ execute: vi.fn() }) }) }));
vi.mock("./imagePlanningStore", () => ({ lockPlanningProject: vi.fn(), readImagePlan: async () => ({ revision: 1, data: { groups: [] }, jobRunId: null }), planningRows: async () => [{ manifest: {} }], planningJson: (v: any) => typeof v === "string" ? JSON.parse(v) : v, saveImagePlan: vi.fn() }));
vi.mock("./imagePlanningSources", () => ({ imagePlanningSources: async () => ({ upstream: { selling: [{ id: "benefit" }] }, sourceHash: "source", revision: 1 }), planningVisuals: vi.fn(), validateOutlineLinks: vi.fn() }));
vi.mock("./runCompetitorSkill", () => ({ runCompetitorSkill: f.model }));
vi.mock("../ai_os/services/skillRunner", () => ({ getEmperorSkillRuntimeSnapshot: async () => ({ version: 1 }), safeParseSkillJSON: JSON.parse }));
vi.mock("../ai_os/services/assistantConfigurations", () => ({ skillManifestHash: () => "hash", assistantConfigurationService: { get: async () => ({ status: "configured", record: { revision: 1, config: { enabled: true, skills: [{ slug: "listing.images.outline.v1", enabled: true, version: 1, manifestSha256: "hash" }] } } }) } }));
vi.mock("../../services/aiJobRunner", () => ({ getAiJobRun: async () => null, startRegisteredAiJob: f.start, registerAiJobHandler: (value: any) => { f.handler = value.handler; } }));
vi.mock("../ai_os/services/agentRunner", () => ({ getAgentRun: f.readRun, recordAgentTemplateVersion: f.template }));
vi.mock("../ai_os/routerContext", () => ({ rawExecute: f.sql }));
vi.mock("../ai_os/services/businessManagedAgent", () => ({ ensureBusinessManagedRun: f.agent, markBusinessManagedNodeConfirmed: vi.fn(), markBusinessManagedNodeRunning: vi.fn(), markBusinessManagedNodeWaitingHuman: vi.fn(), markBusinessManagedNodeFailed: vi.fn() }));
vi.mock("../ai_os/services/skillWorkbench", () => ({ createSkillImprovementDraft: vi.fn() }));
import { startImagePlanning } from "./imagePlanning";
import { imagePlanningDag, IMAGE_PLANNING_AGENT } from "./imagePlanningAgent";

describe("图片大纲任务绑定真实项目流程", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    f.agent.mockResolvedValue({ detail: { run: { runId: "image-planning-run" } } });
    f.readRun.mockResolvedValue({ run: { agentSlug: IMAGE_PLANNING_AGENT, projectId: 1, workspaceId: 1, userId: 2 }, dag: imagePlanningDag });
    f.start.mockImplementation(async (input: any) => { assertBusinessJobAgentBinding(input); return { runId: input.runId }; });
  });
  const scope = { projectId: 1, workspaceId: 1, userId: 2 };
  const input = { projectId: 1, revision: 1, mode: "generate" as const, message: "" };

  it("排队前建立独立图片策划流程，满足真实平台任务准入，不依赖旧Listing流程的可选节点", async () => {
    await expect(startImagePlanning(scope, input)).resolves.toHaveProperty("runId");
    expect(f.agent).toHaveBeenCalledWith(expect.objectContaining({ ...scope, agentSlug: IMAGE_PLANNING_AGENT }));
    expect(f.template).toHaveBeenCalledWith(expect.objectContaining({ agentSlug: IMAGE_PLANNING_AGENT, agentName: "图片策划流程", dag: imagePlanningDag }));
    expect(f.start).toHaveBeenCalledWith(expect.objectContaining({ module: "listing", input: expect.objectContaining({ agentRunId: "image-planning-run", agentNodeId: "outline", ...scope }) }));
  });
  it("无法取得项目流程时不创建无归属任务", async () => {
    f.agent.mockRejectedValue(new Error("图片策划流程暂未准备好"));
    await expect(startImagePlanning(scope, input)).rejects.toThrow("暂未准备好");
    expect(f.start).not.toHaveBeenCalled();
  });
  it("缺少图片大纲节点时在排队前拒绝，不把新任务挂到不完整的旧流程", async () => {
    f.readRun.mockResolvedValue({ run: { agentSlug: IMAGE_PLANNING_AGENT, ...scope }, dag: { nodes: [] } });
    await expect(startImagePlanning(scope, input)).rejects.toThrow("当前项目不匹配");
    expect(f.start).not.toHaveBeenCalled();
  });
  it("工作端信任任务归属并在模型调用前拒绝其他工作区的流程绑定", async () => {
    await startImagePlanning(scope, input);
    const created = f.start.mock.calls[0][0];
    await expect(f.handler({ ...created, workspaceId: 9, attempt: 1 }, { signal: new AbortController().signal })).rejects.toThrow("当前项目不匹配");
    expect(f.model).not.toHaveBeenCalled();
  });
});
