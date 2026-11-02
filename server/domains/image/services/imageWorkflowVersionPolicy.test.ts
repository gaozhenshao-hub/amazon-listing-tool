import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  IMAGE_WORKFLOW_STEPS,
  buildExportableImageWorkflowSnapshot,
  buildHumanConfirmedStageDraft,
  createImageWorkflowVersionPolicyService,
  immutableDigest,
  materializeImmutableStageSnapshot,
  type ImageAssetDependency,
  type ImageWorkflowVersionScope,
  type ImageWorkflowVersionStore,
  type SnapshotStateEvent,
  type StoredStageSnapshot,
} from "./imageWorkflowVersionPolicy";

const scope: ImageWorkflowVersionScope = { workspaceId: 7, projectId: 51, sessionId: 901 };
const hash = (letter: string) => letter.repeat(64);

function approvedAsset(overrides: Partial<ImageAssetDependency> = {}): ImageAssetDependency {
  return {
    assetId: "asset-controlled-1",
    purpose: "main-1 approved deliverable",
    allowedUse: "approved_deliverable",
    originKind: "own_product",
    reviewState: "approved",
    policyRevision: 3,
    policyHash: hash("a"),
    contentHash: hash("b"),
    contentReferences: ["https://controlled.example/main-1.png"],
    includedInExport: true,
    ...overrides,
  };
}

function makeSnapshot(step: (typeof IMAGE_WORKFLOW_STEPS)[number], prior: readonly StoredStageSnapshot[], input: {
  content?: unknown;
  contentRevision?: number;
  assets?: readonly ImageAssetDependency[];
} = {}): StoredStageSnapshot {
  const dependencies = prior.map(snapshot => ({
    step: snapshot.step,
    version: snapshot.version,
    snapshotDigest: snapshot.snapshotDigest,
  }));
  const draft = buildHumanConfirmedStageDraft({
    ...scope,
    step,
    content: input.content ?? { step, decision: `human-confirmed-${step}` },
    contentRevision: input.contentRevision ?? 1,
    contentOrigin: "human_confirmed",
    sourceConfirmed: true,
    assetDependencies: input.assets ?? [],
  }, dependencies);
  return { ...materializeImmutableStageSnapshot({
    draft,
    version: 1,
    confirmedBy: 17,
    confirmedAt: new Date("2026-10-07T00:00:00.000Z"),
  }), state: "confirmed" };
}

function confirmedSevenSteps() {
  const snapshots: StoredStageSnapshot[] = [];
  for (const step of IMAGE_WORKFLOW_STEPS) {
    const content = step === 4
      ? { step, reference: "https://controlled.example/main-1.png" }
      : { step, decision: `human-confirmed-${step}` };
    snapshots.push(makeSnapshot(step, snapshots, { content, assets: step === 4 ? [approvedAsset()] : [] }));
  }
  return snapshots;
}

type MemoryState = {
  revision: number;
  snapshots: StoredStageSnapshot[];
  events: SnapshotStateEvent[];
  lockedScopes: ImageWorkflowVersionScope[];
};

function memoryStore(state: MemoryState): ImageWorkflowVersionStore<object> {
  return {
    async transaction<T>(callback: (tx: object) => Promise<T>) { return callback({}); },
    async lockScope(_tx, lockedScope) { state.lockedScopes.push(lockedScope); },
    async getScopeRevision() { return state.revision; },
    async listSnapshots() { return state.snapshots.map(snapshot => ({ ...snapshot })); },
    async appendSnapshot(_tx, snapshot) { state.snapshots.push({ ...snapshot, state: "confirmed" }); },
    async appendStateEvents(_tx, events) {
      state.events.push(...events);
      for (const event of events) {
        const snapshot = state.snapshots.find(candidate => candidate.snapshotDigest === event.snapshotDigest);
        if (snapshot) snapshot.state = event.state;
      }
    },
    async advanceScopeRevision(_tx, input) {
      if (input.expectedRevision !== state.revision) return false;
      state.revision += 1;
      return true;
    },
  };
}

describe("image workflow Phase D version policy", () => {
  it("uses canonical immutable digests independent of JSON object-key order", () => {
    expect(immutableDigest({ second: [2, { z: true, a: null }], first: 1 }))
      .toBe(immutableDigest({ first: 1, second: [2, { a: null, z: true }] }));
  });

  it("keeps persisted dependency digests independent of transient actor and CAS metadata", () => {
    const persistedInput = {
      ...scope,
      step: 0 as const,
      content: { research: "human-confirmed" },
      contentRevision: 1,
      contentOrigin: "human_confirmed" as const,
      sourceConfirmed: true,
    };
    const confirmed = buildHumanConfirmedStageDraft({ ...persistedInput, actorId: 17, expectedScopeRevision: 8 } as any, []);
    const rehydrated = buildHumanConfirmedStageDraft(persistedInput, []);
    expect(confirmed.dependencyDigest).toBe(rehydrated.dependencyDigest);
  });

  it("refuses AI drafts, unreviewed assets, and legacy unclassified URLs before a confirmation snapshot exists", () => {
    expect(() => buildHumanConfirmedStageDraft({
      ...scope,
      step: 0,
      content: { summary: "draft" },
      contentRevision: 1,
      contentOrigin: "ai_draft",
      sourceConfirmed: false,
    }, [])).toThrow(/AI 草案未经人工确认/);

    expect(() => buildHumanConfirmedStageDraft({
      ...scope,
      step: 0,
      content: { summary: "human reviewed" },
      contentRevision: 1,
      contentOrigin: "human_confirmed",
      sourceConfirmed: true,
      assetDependencies: [approvedAsset({ originKind: "legacy_unclassified" })],
    }, [])).toThrow(/历史未分类/);

    expect(() => buildHumanConfirmedStageDraft({
      ...scope,
      step: 0,
      content: { summary: "human reviewed" },
      contentRevision: 1,
      contentOrigin: "human_confirmed",
      sourceConfirmed: true,
      assetDependencies: [approvedAsset({ reviewState: "pending_review" })],
    }, [])).toThrow(/未经人工批准/);
  });

  it("requires all current upstream versions before confirming each downstream stage", () => {
    expect(() => buildHumanConfirmedStageDraft({
      ...scope,
      step: 2,
      content: { outline: "human reviewed" },
      contentRevision: 1,
      contentOrigin: "human_confirmed",
      sourceConfirmed: true,
    }, [{ step: 0, version: 1, snapshotDigest: hash("c") }]))
      .toThrow(/Step 2 必须依赖全部已确认的上游 Step 0–1/);
  });

  it("keeps old confirmation immutable and invalidates downstream Step 1–6 after an upstream content version changes", async () => {
    const state: MemoryState = { revision: 0, snapshots: [], events: [], lockedScopes: [] };
    const service = createImageWorkflowVersionPolicyService(memoryStore(state));
    const confirm = (step: (typeof IMAGE_WORKFLOW_STEPS)[number], contentRevision: number, content: unknown) => service.confirmStage({
      ...scope,
      actorId: 17,
      expectedScopeRevision: state.revision,
      step,
      content,
      contentRevision,
      contentOrigin: "human_confirmed",
      sourceConfirmed: true,
    });

    await confirm(0, 1, { research: "approved v1" });
    await confirm(1, 1, { sellingPoints: "approved v1" });
    await confirm(2, 1, { outline: "approved v1" });
    const result = await confirm(0, 2, { research: "approved v2" });

    expect(result.invalidation).toMatchObject({
      changed: true,
      reason: "content_version_changed",
      supersedeSteps: [0],
      invalidateSteps: [1, 2],
    });
    expect(state.snapshots.filter(snapshot => snapshot.step === 0)).toHaveLength(2);
    expect(state.snapshots.find(snapshot => snapshot.step === 0 && snapshot.version === 1)?.state).toBe("superseded");
    expect(state.snapshots.find(snapshot => snapshot.step === 1)?.state).toBe("invalidated");
    expect(state.snapshots.find(snapshot => snapshot.step === 2)?.state).toBe("invalidated");
    expect(state.events.filter(event => event.state === "invalidated").map(event => event.reason))
      .toEqual(["content_version_changed", "content_version_changed"]);
  });

  it("invalidates confirmed downstream stages when the approved image-purpose policy version changes", async () => {
    const state: MemoryState = { revision: 0, snapshots: [], events: [], lockedScopes: [] };
    const service = createImageWorkflowVersionPolicyService(memoryStore(state));
    const confirm = (step: (typeof IMAGE_WORKFLOW_STEPS)[number], assets: readonly ImageAssetDependency[] = []) => service.confirmStage({
      ...scope,
      actorId: 17,
      expectedScopeRevision: state.revision,
      step,
      content: { step, decision: "human reviewed" },
      contentRevision: 1,
      contentOrigin: "human_confirmed",
      sourceConfirmed: true,
      assetDependencies: assets,
    });

    await confirm(0);
    await confirm(1, [approvedAsset({ allowedUse: "step4_reference", includedInExport: false })]);
    await confirm(2);
    const result = await confirm(1, [approvedAsset({
      allowedUse: "step4_reference",
      includedInExport: false,
      policyRevision: 4,
      policyHash: hash("c"),
    })]);

    expect(result.invalidation).toMatchObject({
      changed: true,
      reason: "image_purpose_version_changed",
      supersedeSteps: [1],
      invalidateSteps: [2],
    });
    expect(state.snapshots.find(snapshot => snapshot.step === 2)?.state).toBe("invalidated");
    expect(state.events[state.events.length - 1]).toMatchObject({ state: "invalidated", reason: "image_purpose_version_changed" });
  });

  it("fails stale compare-and-swap confirmation attempts and never accepts a cross-workspace row", async () => {
    const state: MemoryState = { revision: 0, snapshots: [], events: [], lockedScopes: [] };
    const service = createImageWorkflowVersionPolicyService(memoryStore(state));
    await service.confirmStage({
      ...scope,
      actorId: 17,
      expectedScopeRevision: 0,
      step: 0,
      content: { research: "approved" },
      contentRevision: 1,
      contentOrigin: "human_confirmed",
      sourceConfirmed: true,
    });
    await expect(service.confirmStage({
      ...scope,
      actorId: 17,
      expectedScopeRevision: 0,
      step: 1,
      content: { sellingPoints: "approved" },
      contentRevision: 1,
      contentOrigin: "human_confirmed",
      sourceConfirmed: true,
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(state.lockedScopes).toEqual([scope, scope]);

    expect(() => buildExportableImageWorkflowSnapshot({
      scope,
      snapshots: [{ ...makeSnapshot(0, []), workspaceId: 8 }],
    })).toThrow(/跨工作空间/);
  });

  it("builds a seven-section Step 0 plus Step 1–6 export manifest only from current human-confirmed snapshots", () => {
    const manifest = buildExportableImageWorkflowSnapshot({ scope, snapshots: confirmedSevenSteps() });
    expect(manifest.schema).toBe("image-workflow-approved-snapshot/1.0");
    expect(manifest.sections.map(section => section.step)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(manifest.sections[0].title).toBe("Step 0 竞品研究");
    expect(manifest.sections[6].title).toBe("Step 6 图片制作");
    expect(manifest.manifestDigest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("fails closed when a downstream confirmation is invalidated or an inline image lacks approved-deliverable identity", () => {
    const invalidated = confirmedSevenSteps();
    invalidated[5] = { ...invalidated[5], state: "invalidated" };
    expect(() => buildExportableImageWorkflowSnapshot({ scope, snapshots: invalidated }))
      .toThrow(/全部由人工确认且当前有效/);

    const unbound = confirmedSevenSteps();
    const rebuilt = makeSnapshot(4, unbound.slice(0, 4), {
      content: { reference: "https://unclassified.example/old-image.png" },
      assets: [approvedAsset()],
    });
    unbound[4] = rebuilt;
    expect(() => buildExportableImageWorkflowSnapshot({ scope, snapshots: unbound }))
      .toThrow(/未绑定受控/);
  });

  it("contains no provider/model path and migration draft remains additive and isolated", () => {
    const root = path.resolve(import.meta.dirname, "../../../..");
    const service = fs.readFileSync(path.join(root, "server/domains/image/services/imageWorkflowVersionPolicy.ts"), "utf8");
    const migration = fs.readFileSync(path.join(root, "drizzle/0206_image_workflow_version_snapshots.sql"), "utf8");
    expect(service).not.toMatch(/invokeLLM|callLLM|provider|fetch\(|axios|openai/iu);
    expect(service).toContain("AI 草案未经人工确认");
    expect(service).toContain("IMAGE_WORKFLOW_STEPS = [0, 1, 2, 3, 4, 5, 6]");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `image_workflow_version_scopes`");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `image_workflow_stage_snapshots`");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `image_workflow_snapshot_state_events`");
    expect(migration).not.toMatch(/^\s*(?:ALTER|DROP|INSERT|UPDATE|DELETE)\b/imu);
    expect(migration).not.toMatch(/\b(?:listing_|acquisition_|kb_|knowledge_)\w*/iu);
  });

  it("uses a TiDB-compatible derived latest-event join for version-state reads", () => {
    const root = path.resolve(import.meta.dirname, "../../../..");
    const service = fs.readFileSync(path.join(root, "server/domains/image/services/imageWorkflowVersionPolicy.ts"), "utf8");
    expect(service).toContain("MAX(id) AS latestEventId");
    expect(service).toContain("latestEvent.snapshotDigest = s.snapshotDigest");
    expect(service).not.toMatch(/ON\s+e\.id\s*=\s*\(\s*SELECT\s+latest\.id/iu);
  });
});
