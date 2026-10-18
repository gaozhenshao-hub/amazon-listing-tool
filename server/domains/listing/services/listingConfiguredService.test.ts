import { describe, expect, it } from "vitest";
import type { TrpcContext } from "../../../_core/context";
import { createListingConfiguredService } from "./listingConfiguredService";
import { createListingConfiguredTestFixture, listingOperationId } from "./listingConfigured.testFixture";
import { listingConfiguredOperationScope } from "./listingConfiguredRepository";
const context = (workspaceId: number | null | undefined = 7) => ({ user: { id: 3, defaultWorkspaceId: 7, role: "super_admin" }, workspaceId } as TrpcContext);
function fixture() { const f = createListingConfiguredTestFixture(); return { ...f, service: createListingConfiguredService({ repository: f.repository, runtime: f.runtime,
  loadConfiguration: async () => f.configuration, enabled: () => f.control.enabled }) }; }
describe("configured Listing service exact public scope / no implicit execution", () => {
  it("preview exposes safe source/cost/config/Skill pins, not prompt text, credentials or raw files", async () => {
    const f = fixture(), preview = await f.service.preview(context(), f.request);
    expect(preview).toMatchObject({ identity: f.identity, available: true, maxCalls: 3, maxCostCents: 300, configuration: { revision: 1 }, stages: [{ operation: "title", skillSlug: "listing.title.generate", maxQualityRepairs: 2 }] });
    expect(JSON.stringify(preview)).not.toMatch(/SYNTHETIC_SAVED_INSTRUCTIONS|SYNTHETIC_BINDING|SYNTHETIC_NOT_REAL|rawContent/u); expect(f.providerInputs).toHaveLength(0);
  });
  it("flags off disables new reservations while read/check/cancel continue", async () => {
    const f = fixture(); f.control.enabled = false; const preview = await f.service.preview(context(), f.request); expect(preview).toMatchObject({ available: false, reasonCode: "WRITES_DISABLED", stages: [] });
    const scope = listingConfiguredOperationScope(f.request); expect(await f.service.check(context(), scope)).toMatchObject({ state: "not_found" });
    expect(await f.service.cancel(context(), scope)).toMatchObject({ state: "canceled" }); expect(f.providerInputs).toHaveLength(0);
  });
  it.each([null, 8])("explicit workspace %s never falls back to the actor default", async workspaceId => {
    const f = fixture(); await expect(f.service.preview(context(workspaceId), f.request)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.calls).toHaveLength(0);
  });
  it("undefined context workspace keeps existing explicit default compatibility", async () => { const f = fixture(); expect((await f.service.preview(context(undefined), f.request)).identity).toEqual(f.identity); });
  it("fresh actor revocation is FORBIDDEN, not a stale candidate read", async () => { const f = fixture(); await f.submitted(); f.control.actorStatus = "disabled";
    await expect(f.service.check(context(), { ...f.scope, operationId: listingOperationId })).rejects.toMatchObject({ code: "FORBIDDEN" }); });
  it("start only schedules durable work; lost ACK keeps original UUID and returns no fabricated success", async () => {
    const f = fixture(), preview = await f.service.preview(context(), f.request); const input = { ...f.request, expectedSourceHash: preview.sourceHash, expectedRuntimeHash: preview.runtimeHash!, maxCostCents: preview.maxCostCents!, chargeConfirmed: true };
    f.control.ackLostOn = "INSERT INTO ai_jobs"; await expect(f.service.start(context(), input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "LISTING_CONFIGURED_OUTCOME_UNKNOWN_CHECK_SAME_UUID" });
    expect(await f.service.check(context(), listingConfiguredOperationScope(f.request))).toMatchObject({ state: "queued", operation: "title", runId: expect.any(String) }); expect(f.state.jobs).toHaveLength(1); expect(f.providerInputs).toHaveLength(0);
  });
  it("DB errors expose only fixed reason codes, never SQL/host/private source", async () => {
    const f = fixture(); f.control.failWrite = "INSERT INTO ai_jobs"; const preview = await f.service.preview(context(), f.request);
    await expect(f.service.start(context(), { ...f.request, expectedSourceHash: preview.sourceHash, expectedRuntimeHash: preview.runtimeHash!, maxCostCents: preview.maxCostCents!, chargeConfirmed: true })).rejects.toMatchObject({ message: "LISTING_CONFIGURED_OUTCOME_UNKNOWN_CHECK_SAME_UUID" });
  });
});
