import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { createVideoWorkflowService, type videoWorkflowRuntimes } from "./videoWorkflowService";
import { createVideoWorkflowTestFixture, videoOperation, videoApplyOperation } from "./videoWorkflow.testFixture";
import { VideoWorkflowOperationSchema } from "../../../shared/videoWorkflow";
import { createVideoWorkflowProcessor } from "./videoWorkflowWorker";

function setup() {
  const f = createVideoWorkflowTestFixture(), ctx = { user: { id: 3, defaultWorkspaceId: 7 }, workspaceId: 7 } as TrpcContext;
  const runtimes = Object.fromEntries(VideoWorkflowOperationSchema.options.map(operation => [operation, f.runtime])) as typeof videoWorkflowRuntimes;
  const service = createVideoWorkflowService({ repository: f.repository, runtimes, enabled: () => f.control.enabled, loadConfiguration: async () => f.configuration });
  const scope = { ...f.scope, operationId: videoOperation }, options = { ...scope, operation: "sections", competitorScriptId: null };
  return { ...f, ctx, service, scope, options, runtimes };
}
describe("video public service uses real private repository and runtime protocol fixture", () => {
  it("disabled options are truthful and never run a provider", async () => {
    const f = setup(); f.control.enabled = false;
    const result = await f.service.options(f.ctx, f.options);
    expect(result).toMatchObject({ available: false, reasonCode: "EXECUTION_DISABLED", maxCostCents: null, legacyTasks: "original_legacy_protocol_no_configuration_overlay" });
    expect(f.state.jobs).toHaveLength(0); expect(f.providerContexts).toHaveLength(0);
  });
  it("explicit start reserves only, replay is same UUID and does not re-resolve changed configuration", async () => {
    const f = setup(), original = await f.submitted();
    f.configuration.config.enabled = false;
    const view = await f.service.start(f.ctx, original.input);
    expect(view.state).toBe("queued"); expect(view.runId).toBe(original.run.runId); expect(f.state.jobs).toHaveLength(1);
    expect(f.providerContexts).toHaveLength(0);
    await expect(f.service.start(f.ctx, { ...original.input, maxCostCents: 101 })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("flag-off original UUID check/cancel stay usable without configuration/model", async () => {
    const f = setup(); await f.submitted(); f.control.enabled = false;
    expect((await f.service.check(f.ctx, f.scope)).state).toBe("queued");
    expect((await f.service.cancel(f.ctx, f.scope)).state).toBe("canceled");
    expect(f.providerContexts).toHaveLength(0);
  });
  it("explicit null or changed workspace never falls back and never reads storage", async () => {
    const f = setup();
    for (const workspaceId of [null, 8]) await expect(f.service.check({ ...f.ctx, workspaceId }, f.scope)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.calls).toHaveLength(0);
    expect((await f.service.check({ ...f.ctx, workspaceId: undefined }, f.scope)).state).toBe("not_found");
  });
  it("history exposes only exact-scope metadata and does not read full source/config input", async () => {
    const f = setup(); await f.submitted();
    const result = await f.service.history(f.ctx, { expectedWorkspaceId: 7, projectId: 8, videoScriptId: 9 });
    expect(result.operations[0]).toMatchObject({ operationId: videoOperation, operation: "sections", competitorScriptId: null, state: "queued" });
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_SAVED_RULE");
    const query = f.calls.find(call => call.sql.includes("AS logicalState"))!;
    expect(query.sql).not.toContain("input,NULL) AS input");
    expect(query.sql).toContain("JSON_EXTRACT(input,'$.request')");
  });
  it("unknown provider outcome remains same UUID and cannot be auto-started again", async () => {
    const f = setup(); await f.submitted(); f.control.modelThrows = true;
    const process = createVideoWorkflowProcessor({ repository: f.repository, runtimes: f.runtimes, enabled: () => f.control.enabled, loadConfiguration: async () => f.configuration });
    const hint = { id: 101, workspaceId: 7, userId: 3, projectId: 8, videoScriptId: 9, operationId: videoOperation };
    await process(hint); await process(hint);
    expect((await f.service.check(f.ctx, f.scope)).state).toBe("outcome_unknown"); expect(f.providerContexts).toHaveLength(1);
  });
  it("apply ACK loss is sanitized while same UUID check recovers the committed receipt", async () => {
    const f = setup(); await f.submitted();
    await createVideoWorkflowProcessor({ repository: f.repository, runtimes: f.runtimes, enabled: () => f.control.enabled, loadConfiguration: async () => f.configuration })({ id: 101, workspaceId: 7, userId: 3, projectId: 8, videoScriptId: 9, operationId: videoOperation });
    const view = await f.service.check(f.ctx, f.scope);
    f.control.ackLostOn = "INSERT INTO emperor_agent_events";
    const input = { ...f.scope, operationId: videoApplyOperation, runOperationId: videoOperation, expectedSourceHash: view.sourceHash, expectedResultHash: view.resultHash, replaceConfirmed: true, confirmHumanReview: true };
    await expect(f.service.apply(f.ctx, input)).rejects.toMatchObject({ message: "VIDEO_WORKFLOW_OUTCOME_UNVERIFIED" });
    f.control.enabled = false;
    const receipt = await f.service.applyCheck(f.ctx, { ...f.scope, operationId: videoApplyOperation, runOperationId: videoOperation });
    expect(receipt.status).toBe("committed"); expect(receipt.version).toBe(2); expect(f.providerContexts).toHaveLength(1);
  });
});
