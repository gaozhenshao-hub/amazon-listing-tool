import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../../_core/context";
import { createImageTaggingService } from "./imageTaggingService";
import { createImageTaggingTestFixture, taggingOperation, taggingApplyOperation } from "./imageTagging.testFixture";
import { ImageTaggingRepositoryError } from "./imageTaggingRepository";

function fixture() {
  const f = createImageTaggingTestFixture(), ctx = { user: { id: 3, defaultWorkspaceId: 7, role: "super_admin" }, workspaceId: 7 } as TrpcContext;
  const images = { preview: vi.fn(async () => "https://example.test/short-preview") };
  const service = createImageTaggingService({ repository: f.repository, runtime: f.runtime,
    loadConfiguration: async () => f.configuration, images, enabled: () => f.control.enabled });
  const input = { ...f.scope, operationId: taggingOperation, mode: "missing" as const };
  return { ...f, ctx, service, images, input };
}
describe("image tagging actual business service", () => {
  it("previews full source and actual approved budget without dispatching or writing", async () => {
    const f = fixture(), result = await f.service.preview(f.ctx, f.input);
    expect(result.capability).toEqual({ available: true, reasonCode: null });
    expect(result.images).toHaveLength(2); expect(result.budget).toMatchObject({ currency: "USD", maxCalls: 2, maxCostCentsTotal: 200 });
    expect(f.state.jobs).toHaveLength(0); expect(f.state.artifacts).toHaveLength(0);
  });
  it("keeps complete source readable when new model work is disabled", async () => {
    const f = fixture(); f.control.enabled = false;
    const result = await f.service.preview(f.ctx, f.input);
    expect(result.capability).toEqual({ available: false, reasonCode: "EXECUTION_DISABLED" }); expect(result.images).toHaveLength(2);
    expect(result.budget).toBeNull(); expect(result.runtimeHash).toBeNull();
  });
  it("preserves exact unavailable configuration reason without a fake zero budget", async () => {
    const f = fixture(), service = createImageTaggingService({ repository: f.repository, runtime: f.runtime,
      images: f.images, enabled: () => true, loadConfiguration: async () => { throw new ImageTaggingRepositoryError("CONFIGURATION_UNAVAILABLE"); } });
    const result = await service.preview(f.ctx, f.input); expect(result.capability.reasonCode).toBe("CONFIGURATION_UNAVAILABLE"); expect(result.budget).toBeNull();
  });
  it("never signs or returns an earlier source after the second transaction observes revoked read authority", async () => {
    const f = fixture();
    const preview = vi.spyOn(f.repository, "preview").mockImplementation(async () => { f.control.memberStatus = "disabled"; throw new ImageTaggingRepositoryError("ACCESS_DENIED"); });
    await expect(f.service.preview(f.ctx, f.input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(preview).toHaveBeenCalledTimes(1); expect(f.images.preview).not.toHaveBeenCalled();
  });
  it("retains KB-only inspection when the stricter Agent run permission is absent", async () => {
    const f = fixture(); f.control.agentDenied = true;
    const result = await f.service.preview(f.ctx, f.input);
    expect(result.capability).toEqual({ available: false, reasonCode: "ACCESS_DENIED" }); expect(result.images).toHaveLength(2); expect(f.state.jobs).toHaveLength(0);
  });
  it("starts once with a strictly narrowed operation read and never synchronously calls the provider", async () => {
    const f = fixture(), preview = await f.service.preview(f.ctx, f.input);
    const input = { ...f.input, expectedSourceHash: preview.sourceHash, expectedRuntimeHash: preview.runtimeHash!,
      maxCostCents: preview.budget!.maxCostCentsTotal, chargeConfirmed: true as const };
    const started = await f.service.start(f.ctx, input); expect(started.state).toBe("queued"); expect(started.images).toHaveLength(2);
    expect((await f.service.start(f.ctx, input)).runId).toBe(started.runId); expect(f.state.jobs).toHaveLength(1);
    const serialized = JSON.stringify(started); expect(serialized).not.toContain("SYNTHETIC_PRIVATE_RULE"); expect(serialized).not.toContain("storage://");
  });
  it("uses original-UUID check/cancel after an unknown start acknowledgment", async () => {
    const f = fixture(), { input } = await f.submitted();
    f.control.enabled = false;
    const operation = { ...f.scope, operationId: input.operationId };
    expect((await f.service.check(f.ctx, operation)).state).toBe("queued");
    expect((await f.service.cancel(f.ctx, operation)).state).toBe("canceled"); expect(f.state.jobs).toHaveLength(1);
  });
  it("prestart cancellation is visible as canceled rather than fabricated absent", async () => {
    const f = fixture(), operation = { ...f.scope, operationId: taggingOperation }; f.control.enabled = false;
    const result = await f.service.cancel(f.ctx, operation); expect(result.state).toBe("canceled"); expect(result.runId).toBeNull(); expect(result.images).toEqual([]);
  });
  it.each([null, 8])("does not fallback explicit changed/null workspace %s", async workspaceId => {
    const f = fixture(); await expect(f.service.preview({ ...f.ctx, workspaceId }, f.input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.images.preview).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0);
  });
  it("read-only status names actual external source change without changing the immutable job", async () => {
    const f = fixture(); await f.submitted(); f.state.images[0].userEditedDimensionAnalysis = "EXTERNAL_HUMAN_CHANGE";
    const result = await f.service.check(f.ctx, { ...f.scope, operationId: taggingOperation }); expect(result.sourceChanged).toBe(true);
    expect(result.currentSourceHash).not.toBe(result.sourceHash); expect(result.state).toBe("queued");
  });
  it("apply cancellation is independently fenced and metadata-only", async () => {
    const f = fixture(); f.control.enabled = false;
    const operation = { ...f.scope, operationId: taggingApplyOperation, runOperationId: taggingOperation };
    const canceled = await f.service.applyCancel(f.ctx, operation); expect(canceled.status).toBe("cancelled"); expect(canceled.appliedCount).toBeNull();
    expect(await f.service.applyCheck(f.ctx, operation)).toEqual(canceled); expect(f.state.images.every(image => image.tagsConfirmed === 0)).toBe(true);
  });
});
