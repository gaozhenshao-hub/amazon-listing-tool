import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../../../_core/context";
import { createImagePlanningService } from "./imagePlanningService";
import { createImagePlanningTestFixture, planningOperation, planningApplyOperation } from "./imagePlanning.testFixture";
const context = (patch: Record<string, unknown> = {}) => ({ user: { id: 3, defaultWorkspaceId: 7, role: "super_admin" }, workspaceId: 7, ...patch }) as TrpcContext;
function fixture() {
  const f = createImagePlanningTestFixture(), service = createImagePlanningService({ repository: f.repository, runtime: f.runtime, loadConfiguration: async () => f.configuration, enabled: () => f.control.enabled });
  return { ...f, service, input: { ...f.scope, operationId: planningOperation } };
}
describe("image planning public service bound to real repository fixture", () => {
  it("preview and start only prepare and enqueue, never invoke the provider in the HTTP request", async () => {
    const f = fixture(), preview = await f.service.preview(context(), f.input);
    expect(preview.capability.available).toBe(true); expect(f.state.jobs).toHaveLength(0);
    const run = await f.service.start(context(), { ...f.input, expectedSourceHash: preview.sourceHash, expectedRuntimeHash: preview.runtimeHash, maxCostCents: preview.maxCostCents, chargeConfirmed: true });
    expect(run.state).toBe("queued"); expect(run.scope).toEqual(f.input); expect(run.identity).toEqual(f.identity); expect(f.providerContexts).toHaveLength(0);
  });
  it.each([{ workspaceId: null }, { workspaceId: 8 }, { user: null }])("does not fall back to default workspace or read anything for invalid context %j", async patch => {
    const f = fixture(); await expect(f.service.preview(context(patch), f.input)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.calls).toHaveLength(0);
  });
  it("new writes off still allows original UUID reads and explicit cancellation, not silent resubmission", async () => {
    const f = fixture(); f.control.enabled = false;
    expect((await f.service.preview(context(), f.input)).capability).toEqual({ available: false, reasonCode: "EXECUTION_DISABLED" });
    expect((await f.service.check(context(), f.input)).state).toBe("not_found"); expect((await f.service.cancel(context(), f.input)).state).toBe("canceled");
    const apply = { ...f.scope, operationId: planningApplyOperation, runOperationId: planningOperation };
    expect((await f.service.applyCheck(context(), apply)).status).toBe("not_found"); expect((await f.service.applyCancel(context(), apply)).status).toBe("cancelled"); expect(f.providerContexts).toHaveLength(0);
  });
  it("foreign scope or revoked authorization cannot expose the previous private history", async () => {
    const f = fixture(); await f.submitted(); f.control.deny = true;
    await expect(f.service.history(context(), f.scope)).rejects.toMatchObject({ code: "FORBIDDEN" }); await expect(f.service.check(context(), f.input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("does not leak driver errors or credentials in a public failure", async () => {
    const f = fixture(); f.control.failWrite = "INSERT INTO ai_jobs"; const preview = await f.service.preview(context(), f.input);
    await expect(f.service.start(context(), { ...f.input, expectedSourceHash: preview.sourceHash, expectedRuntimeHash: preview.runtimeHash, maxCostCents: preview.maxCostCents, chargeConfirmed: true })).rejects.toMatchObject({ message: "IMAGE_PLANNING_OUTCOME_UNVERIFIED" });
    expect(f.state.jobs).toHaveLength(0);
  });
});
