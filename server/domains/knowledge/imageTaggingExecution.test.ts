import { describe, expect, it } from "vitest";
import { createImageTaggingTestFixture, taggingOperation, syntheticTaggingCandidate } from "./imageTagging.testFixture";
import { createImageTaggingExecution } from "./imageTaggingExecution";
import { createImageTaggingRuntime, type ImageTaggingPreparedStage } from "./imageTaggingRuntime";
import { configurationHash } from "../ai_os/services/assistantConversationSourcePrimitives";

async function fixture() {
  const f = createImageTaggingTestFixture(); await f.submitted();
  const control = { worker: true, providerCalls: 0, readCalls: 0, loadCalls: 0, prepared: null as ImageTaggingPreparedStage | null,
    beforeModel: null as (() => void | Promise<void>) | null, afterPaid: null as (() => void | Promise<void>) | null,
    beforeRead: null as (() => void | Promise<void>) | null, beforeConfiguration: null as (() => void | Promise<void>) | null,
    providerThrows: false, providerBadResult: false };
  const reports: string[] = [], runtime = createImageTaggingRuntime({ approvalResolver: async () => structuredClone(f.approval), credentialResolver: () => "SYNTHETIC_NOT_REAL",
    runSkill: async input => {
      const prepared = control.prepared; if (!prepared || !input.strictExecution || !input.validate) throw new Error("SYNTHETIC_NO_EXECUTION_BINDING");
      const runId = `synthetic-paid-${control.providerCalls}`;
      await input.strictExecution.beforeDispatch({ runId, stage: "image_tagging", requestHash: prepared.providerRequestHash,
        modelConfigurationHash: input.strictExecution.modelSnapshot.configurationHash, bindingHash: prepared.bindingHash, budget: prepared.budget });
      await control.beforeModel?.(); f.events.push("provider_called"); control.providerCalls++;
      if (control.providerThrows) throw new Error("SYNTHETIC_PROVIDER_SECRET_MUST_NOT_LEAK");
      const content = JSON.stringify(control.providerBadResult ? { invalid: true } : syntheticTaggingCandidate), parsed = input.validate(content);
      await control.afterPaid?.();
      return { runId, skillSlug: input.skillSlug, skillName: "Synthetic", skillVersion: "2", skillPromptHash: "a".repeat(16), skillManifestHash: "b".repeat(16),
        content, parsed, modelSlug: "synthetic-vision", provider: "custom", durationMs: 1, costCents: 1, inputTokens: 1, outputTokens: 1,
        fallbackCount: 0, executionPreset: "standard", governance: null, auditWarnings: [] };
    } });
  const actual = { prepareStage: async (...args: Parameters<typeof runtime.prepareStage>) => {
    control.prepared = await runtime.prepareStage(...args); return control.prepared;
  }, executeStage: runtime.executeStage };
  const controller = new AbortController(), process = createImageTaggingExecution({ repository: f.repository, runtime: actual,
    loadConfiguration: async () => { control.loadCalls++; await control.beforeConfiguration?.(); return structuredClone(f.configuration); },
    readImage: async image => { control.readCalls++; await control.beforeRead?.(); f.events.push("read_original_bytes"); return { originalBytes: f.bytes,
      evidence: { imageId: image.id, imageSetId: image.imageSetId, imageRevision: image.revisionHash, sourceUrlRef: image.imageUrl,
        contentHash: f.sha(f.bytes), byteSize: f.bytes.length, contentType: "image/png" } }; }, enabled: () => control.worker && f.control.enabled,
    report: state => { reports.push(state); } });
  const input = { identity: f.identity, operation: { ...f.scope, operationId: taggingOperation }, workerId: "worker", signal: controller.signal };
  return { ...f, controlExecution: control, reports, runtime, process, input, controller,
    check: () => f.repository.check(f.identity, { ...f.scope, operationId: taggingOperation }) };
}
describe("image tagging execution with real runtime, source capture and durable repository", () => {
  it("generates exactly once per pending image after dispatch ACK and saves candidates only", async () => {
    const f = await fixture(), before = structuredClone(f.state.images); await f.process(f.input);
    const run = (await f.check()).run!; expect(run.state).toBe("succeeded"); expect(run.stages.map(stage => stage.state)).toEqual(["candidate", "candidate"]);
    expect(f.controlExecution.providerCalls).toBe(2); expect(f.state.images).toEqual(before); expect(f.state.artifacts).toHaveLength(3);
    for (const at of f.events.flatMap((event, index) => event === "provider_called" ? [index] : [])) expect(f.events[at - 1]).toBe("commit_ack");
    await f.process(f.input); expect(f.controlExecution.providerCalls).toBe(2);
    expect(JSON.stringify(f.reports)).not.toMatch(/SECRET|PRIVATE|storage:|base64/u);
  });
  it("disabled entry never claims, reads pixels or invokes a model", async () => {
    const f = await fixture(); f.controlExecution.worker = false; await f.process(f.input);
    expect(f.controlExecution.providerCalls).toBe(0); expect(f.controlExecution.readCalls).toBe(0); expect((await f.check()).run?.state).toBe("queued");
  });
  it("a dispatch commit ACK loss makes no provider call and original UUID becomes unknown", async () => {
    const f = await fixture(); f.control.ackLostOn = "UPDATE ai_jobs SET";
    // First UPDATE is claim, so wait to inject ACK loss at the paid checkpoint.
    f.control.ackLostOn = ""; f.controlExecution.beforeConfiguration = () => { if (f.controlExecution.loadCalls === 2) f.control.ackLostOn = "UPDATE ai_jobs SET"; };
    await f.process(f.input); expect(f.controlExecution.providerCalls).toBe(0);
    expect((await f.check()).run?.state).toBe("unknown");
    await f.process(f.input); expect(f.controlExecution.providerCalls).toBe(0);
  });
  it("a candidate commit ACK loss preserves the immutable paid candidate and does not run failure", async () => {
    const f = await fixture(); f.controlExecution.afterPaid = () => { f.control.ackLostOn = "INSERT INTO ai_artifacts"; };
    await f.process(f.input);
    const run = (await f.check()).run!; expect(run.stages[0].state).toBe("candidate"); expect(f.state.artifacts).toHaveLength(2); expect(run.state).toBe("running");
    expect(f.controlExecution.providerCalls).toBe(1); expect(f.reports).toContain("outcome_unknown");
    f.control.now += 121; f.controlExecution.afterPaid = null; await f.process(f.input);
    expect((await f.check()).run?.state).toBe("succeeded"); expect(f.controlExecution.providerCalls).toBe(2); expect(f.state.artifacts).toHaveLength(3);
  });
  it("provider timeout or invalid paid output becomes unknown and never automatically re-fees", async () => {
    for (const invalid of [false, true]) {
      const f = await fixture(); f.controlExecution.providerThrows = !invalid; f.controlExecution.providerBadResult = invalid;
      await f.process(f.input); expect((await f.check()).run?.state).toBe("unknown"); expect(f.controlExecution.providerCalls).toBe(1);
      f.control.now += 121; await f.process(f.input); expect(f.controlExecution.providerCalls).toBe(1); expect(f.state.artifacts).toHaveLength(1);
    }
  });
  it("current configuration edit before dispatch stops spending and preserves old labels", async () => {
    const f = await fixture(), before = structuredClone(f.state.images);
    f.controlExecution.beforeConfiguration = () => { if (f.controlExecution.loadCalls === 2) { f.configuration.config.rules.push("CONCURRENT_CONFIGURATION_EDIT"); f.configuration.hash = configurationHash(f.configuration.config); } };
    await f.process(f.input); expect(f.controlExecution.providerCalls).toBe(0); expect(f.state.images).toEqual(before); expect((await f.check()).run?.state).toBe("failed");
  });
  it("source edit during original-byte fetch stops spending with no candidate", async () => {
    const f = await fixture(); f.controlExecution.beforeRead = () => { f.state.images[0].userEditedDimensionAnalysis = "CONCURRENT_HUMAN_EDIT"; };
    await f.process(f.input); expect(f.controlExecution.providerCalls).toBe(0); expect(f.state.artifacts).toHaveLength(1); expect((await f.check()).run?.state).toBe("failed");
  });
  it("paid reply survives gate closure and stop abort, but no next image is dispatched", async () => {
    for (const shutdown of ["gate", "abort"]) {
      const f = await fixture(); f.controlExecution.afterPaid = () => { if (shutdown === "gate") f.control.enabled = false; else f.controller.abort(); };
      await f.process(f.input);
      const run = (await f.check()).run!; expect(run.stages[0].state).toBe("candidate"); expect(f.controlExecution.providerCalls).toBe(1);
      expect(f.state.artifacts).toHaveLength(2); expect(run.stages[1].candidateHash).toBeNull();
    }
  });
  it("a paid reply can persist after configuration/source edits but explicit apply remains stale", async () => {
    const f = await fixture(); f.controlExecution.afterPaid = () => {
      f.configuration.config.rules.push("EDIT_AFTER_PAID"); f.configuration.hash = configurationHash(f.configuration.config);
      f.state.images[0].tagCategory = "HUMAN_EDIT_AFTER_PAID";
    };
    await f.process(f.input); const run = (await f.check()).run!;
    expect(run.stages[0].state).toBe("candidate"); expect(f.controlExecution.providerCalls).toBe(1); expect(f.state.images[0].tagCategory).toBe("HUMAN_EDIT_AFTER_PAID");
  });
  it("explicit cancel fences a model response that arrives after cancellation", async () => {
    const f = await fixture(); f.controlExecution.afterPaid = async () => { await f.repository.cancel(f.identity, f.input.operation); };
    await f.process(f.input); expect((await f.check()).run?.state).toBe("canceled"); expect(f.controlExecution.providerCalls).toBe(1); expect(f.state.artifacts).toHaveLength(1);
  });
  it("revoked current authority after payment prevents candidate persistence without leaking data", async () => {
    const f = await fixture(); f.controlExecution.afterPaid = () => { f.control.actorStatus = "disabled"; };
    await f.process(f.input); expect(f.controlExecution.providerCalls).toBe(1); expect(f.state.artifacts).toHaveLength(1); expect(f.reports).toContain("outcome_unknown");
  });
});
