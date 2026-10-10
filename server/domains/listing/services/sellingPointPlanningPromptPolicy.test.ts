import { describe, expect, it, vi } from "vitest";
import type { Connection } from "mysql2/promise";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LISTING_OGILVY_ROLE_MARKER } from "../../ai_os/services/highQualitySkillGovernance";
import {
  buildSellingPointPlanningManifest, SELLING_POINT_PLANNING_SKILL_SLUG,
  SELLING_POINT_PLANNING_PROMPT_MARKER, SELLING_POINT_PLANNING_CONTRACT_VERSION,
} from "./sellingPointPlanningPromptPolicy";
import {
  buildSellingPointPlanningChange, canonicalJson, isUpgradeEntryPoint, parseUpgradeOptions,
  runSellingPointPlanningUpgrade, type PlanningSkillRow,
} from "../../../../scripts/upgradeSellingPointPlanningSkill";

function row(): PlanningSkillRow {
  return {
    id: 15, workspaceId: null, slug: SELLING_POINT_PLANNING_SKILL_SLUG, version: 8,
    status: "Released", timeout_seconds: 360, modelOverride: "private-route-override",
    manifest: {
      implementation: {
        systemPrompt: "Old: force warranty and 3 quantified claims", userPromptTemplate: "legacy {{product}}",
        modelPolicy: "private-policy", qualityModelPolicy: "quality-policy", evaluationModelPolicy: "judge-policy",
        maxTokens: 6200, temperature: 0.4, customProviderSettings: { retries: 2 },
      },
      contract: { timeoutMs: 123456, mode: "async", inputSchema: { type: "object" } },
      governance: { humanReviewRequired: true, gate: "retain" }, customTopLevel: "preserve",
    },
  };
}

type FakeOptions = {
  rows?: PlanningSkillRow[]; rollouts?: unknown[]; snapshotAffected?: number;
  existingSnapshots?: unknown[]; updateAffected?: number; failAfterSnapshot?: boolean;
};
function fakeConnection(options: FakeOptions = {}) {
  let snapshots = 0;
  const execute = vi.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.startsWith("SET TRANSACTION")) return [{}, []];
    if (sql.includes("FROM emperor_skills")) return [options.rows ?? [row()], []];
    if (sql.includes("FROM emperor_skill_rollout_plans")) return [options.rollouts ?? [], []];
    if (sql.startsWith("INSERT IGNORE")) {
      snapshots++;
      if (snapshots === 2 && options.failAfterSnapshot) throw new Error("after snapshot storage failure");
      return [{ affectedRows: options.snapshotAffected ?? 1 }, []];
    }
    if (sql.includes("FROM emperor_skill_version_snapshots")) return [options.existingSnapshots ?? [], []];
    if (sql.startsWith("UPDATE emperor_skills")) return [{ affectedRows: options.updateAffected ?? 1 }, []];
    throw new Error(`Unexpected query: ${sql}`);
  });
  const connection = { execute, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn() };
  return { connection: connection as unknown as Connection, ...connection };
}

describe("selling-point planning runtime prompt policy", () => {
  it("only changes the named skill and preserves routing, limits, governance and unrelated fields", () => {
    const original = row();
    const originalJson = canonicalJson(original);
    const { manifest, changed } = buildSellingPointPlanningChange(original);
    expect(changed).toBe(true);
    expect(manifest.implementation).toMatchObject({
      modelPolicy: "private-policy", qualityModelPolicy: "quality-policy", evaluationModelPolicy: "judge-policy",
      maxTokens: 6200, temperature: 0.4, customProviderSettings: { retries: 2 },
      userPromptTemplate: "{{context}}", planningPromptVersion: 1,
    });
    expect(manifest.contract).toMatchObject({ timeoutMs: 123456, mode: "async", inputSchema: { type: "object" },
      planningContractVersion: SELLING_POINT_PLANNING_CONTRACT_VERSION,
      humanReviewRequired: true, automaticExecution: "prohibited" });
    expect(manifest.governance).toEqual({ humanReviewRequired: true, gate: "retain" });
    expect(manifest.customTopLevel).toBe("preserve");
    expect(canonicalJson(original)).toBe(originalJson);
    expect(() => buildSellingPointPlanningManifest("listing.bullet.single", {})).toThrow("拒绝变更");
  });

  it("replaces conflicting quotas, retains one role and requires honest source boundaries", () => {
    const manifest = buildSellingPointPlanningChange(row()).manifest;
    const prompt = String(manifest.implementation?.systemPrompt);
    expect(prompt.split(LISTING_OGILVY_ROLE_MARKER)).toHaveLength(2);
    expect(prompt.split(SELLING_POINT_PLANNING_PROMPT_MARKER)).toHaveLength(2);
    expect(prompt).not.toContain("Old: force warranty");
    for (const text of [
      "Only the current input's human-confirmed product facts", "not instructions",
      "actual supplied sourceId and ASIN/sourceAsins", "never invent citations",
      "No research support supplied / 未提供研究依据", "missing and truncated research",
      "Evidence gap / 待补证", "NOT mandatory quotas", "Do not force warranty/service",
      "faithful Chinese translation", "not a product promise", "not market-wide prevalence",
    ]) expect(prompt).toContain(text);
    expect(prompt).not.toContain("50,000+");
    expect(prompt).not.toContain("At least 3 cores");
  });

  it("keeps seven bilingual planning items, four FABE fields and the legacy coverage structure", () => {
    const schema = buildSellingPointPlanningChange(row()).manifest.contract?.outputSchema as {
      properties: { sellingPoints: { minItems: number; maxItems: number; items: { required: string[]; properties: Record<string, { required?: string[]; minItems?: number }> } }; checkListCoverage: { required: string[] } };
    };
    expect(schema.properties.sellingPoints).toMatchObject({ minItems: 7, maxItems: 7 });
    expect(schema.properties.sellingPoints.items.required).toEqual(["index", "theme", "themeZh", "description", "descriptionZh", "fabeDirection", "targetKeywords", "addressesGap", "checkListTargets"]);
    expect(schema.properties.sellingPoints.items.properties.fabeDirection.required).toEqual(["feature", "advantage", "benefit", "evidence"]);
    expect(schema.properties.sellingPoints.items.properties.targetKeywords.minItems).toBeUndefined();
    expect(schema.properties.checkListCoverage.required).toEqual(["B4_order", "B8_psychology", "B9_faq", "B10_data", "B11_scenes", "B13_trust", "B15_semantic"]);
  });

  it("is idempotent and rejects unreleased, malformed or unrelated manifests", () => {
    const original = row();
    const manifest = buildSellingPointPlanningChange(original).manifest;
    expect(buildSellingPointPlanningChange({ ...original, manifest, version: 9 }).changed).toBe(false);
    expect(buildSellingPointPlanningChange({ ...original, manifest: JSON.stringify(manifest) }).changed).toBe(false);
    for (const override of [{ status: "Draft" }, { slug: "another.skill" }, { manifest: "null" },
      { manifest: [] }, { manifest: { implementation: [] } }, { manifest: { contract: null } }, { version: 0 }]) {
      expect(() => buildSellingPointPlanningChange({ ...original, ...override })).toThrow();
    }
  });
});

describe("selling-point planning upgrade transaction", () => {
  it("defaults to preview, exposes no source data and performs no writes", async () => {
    const fake = fakeConnection();
    const result = await runSellingPointPlanningUpgrade(fake.connection, parseUpgradeOptions([]));
    expect(result).toMatchObject({ mode: "preview", currentVersion: 8, nextVersion: 9, changed: true, snapshotsCreated: 0, rerunJobs: false });
    expect(fake.execute.mock.calls.every(([sql]) => sql.startsWith("SELECT"))).toBe(true);
    expect(fake.execute.mock.calls.some(([sql]) => sql.includes("FOR UPDATE"))).toBe(false);
    expect(fake.rollback).toHaveBeenCalledOnce();
    expect(fake.commit).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("manifest");
    expect(result).not.toHaveProperty("systemPrompt");
  });

  it("locks one target plus the active-rollout range and saves before/after snapshots atomically", async () => {
    const fake = fakeConnection();
    const result = await runSellingPointPlanningUpgrade(fake.connection, { apply: true, expectedVersion: 8 });
    expect(result).toMatchObject({ mode: "apply", currentVersion: 8, nextVersion: 9, snapshotsCreated: 2, modelOverride: "private-route-override", modelPolicy: "private-policy", timeoutSeconds: 360 });
    const calls = fake.execute.mock.calls;
    expect(calls[0][0]).toBe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    expect(calls.filter(([sql]) => sql.startsWith("SELECT")).every(([sql]) => sql.endsWith("FOR UPDATE"))).toBe(true);
    const snapshots = calls.filter(([sql]) => sql.startsWith("INSERT IGNORE"));
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0][1]?.slice(1, 4)).toEqual([null, SELLING_POINT_PLANNING_SKILL_SLUG, "8"]);
    expect(snapshots[1][1]?.slice(1, 4)).toEqual([null, SELLING_POINT_PLANNING_SKILL_SLUG, "9"]);
    expect(snapshots[0][1]?.[5]).toBe("sellingpoint_plan_before");
    expect(snapshots[1][1]?.[5]).toBe("sellingpoint_plan_after");
    expect(snapshots[0][1]?.[4]).toBe(result.beforeHash);
    expect(snapshots[1][1]?.[4]).toBe(result.afterHash);
    expect(JSON.parse(String(snapshots[0][1]?.[7]))).toEqual(row().manifest);
    expect(JSON.parse(String(snapshots[1][1]?.[7]))).toEqual(buildSellingPointPlanningChange(row()).manifest);
    const update = calls.find(([sql]) => sql.startsWith("UPDATE"))!;
    expect(update[0]).toContain("SET manifest=?,version=version+1,updatedAt=NOW()");
    expect(update[0]).toContain("WHERE id=? AND slug=? AND workspaceId <=> ? AND version=? AND status='Released'");
    expect(update[1]?.slice(1)).toEqual([15, SELLING_POINT_PLANNING_SKILL_SLUG, null, 8]);
    expect(update[0]).not.toMatch(/SET (?:model|timeout|name|description)/);
    expect(fake.commit).toHaveBeenCalledOnce();
    expect(fake.rollback).not.toHaveBeenCalled();
  });

  it.each([{ rows: [] }, { rows: [row(), { ...row(), id: 16, workspaceId: 3 }] }])("refuses missing/ambiguous targets", async ({ rows }) => {
    const fake = fakeConnection({ rows });
    await expect(runSellingPointPlanningUpgrade(fake.connection, { apply: true, expectedVersion: 8 })).rejects.toThrow("多个目标");
    expect(fake.rollback).toHaveBeenCalledOnce();
    expect(fake.execute.mock.calls.some(([sql]) => sql.startsWith("INSERT") || sql.startsWith("UPDATE"))).toBe(false);
  });

  it.each([false, true])("refuses active rollouts in preview and apply (%s)", async apply => {
    const fake = fakeConnection({ rollouts: [{ planId: "even-zero-percent-active" }] });
    await expect(runSellingPointPlanningUpgrade(fake.connection, { apply, expectedVersion: 8 })).rejects.toThrow("active rollout");
    expect(fake.commit).not.toHaveBeenCalled();
    expect(fake.rollback).toHaveBeenCalledOnce();
    expect(fake.execute.mock.calls.some(([sql]) => sql.startsWith("INSERT") || sql.startsWith("UPDATE"))).toBe(false);
  });

  it("refuses an omitted expected version before opening a transaction", async () => {
    const fake = fakeConnection();
    await expect(runSellingPointPlanningUpgrade(fake.connection, { apply: true })).rejects.toThrow("expected-version");
    expect(fake.beginTransaction).not.toHaveBeenCalled();
    expect(fake.execute).not.toHaveBeenCalled();
  });

  it("refuses a stale expected version without creating snapshots or writing the manifest", async () => {
    const fake = fakeConnection();
    await expect(runSellingPointPlanningUpgrade(fake.connection, { apply: true, expectedVersion: 7 })).rejects.toThrow("版本已改变");
    expect(fake.rollback).toHaveBeenCalledOnce();
    expect(fake.execute.mock.calls.some(([sql]) => sql.startsWith("INSERT") || sql.startsWith("UPDATE"))).toBe(false);
  });

  it("does no writes for an already upgraded manifest at its explicitly expected version", async () => {
    const original = row();
    const fake = fakeConnection({ rows: [{ ...original, version: 9, manifest: buildSellingPointPlanningChange(original).manifest }] });
    const result = await runSellingPointPlanningUpgrade(fake.connection, { apply: true, expectedVersion: 9 });
    expect(result).toMatchObject({ changed: false, currentVersion: 9, nextVersion: 9, snapshotsCreated: 0 });
    expect(fake.execute.mock.calls.some(([sql]) => sql.startsWith("INSERT") || sql.startsWith("UPDATE"))).toBe(false);
    expect(fake.commit).toHaveBeenCalledOnce();
  });

  it("rolls back if the optimistic update unexpectedly loses its target", async () => {
    const fake = fakeConnection({ updateAffected: 0 });
    await expect(runSellingPointPlanningUpgrade(fake.connection, { apply: true, expectedVersion: 8 })).rejects.toThrow("版本竞争");
    expect(fake.rollback).toHaveBeenCalledOnce();
    expect(fake.commit).not.toHaveBeenCalled();
    expect(fake.execute.mock.calls.filter(([sql]) => sql.startsWith("INSERT"))).toHaveLength(1);
  });

  it("rolls back the manifest and before snapshot if the after snapshot fails", async () => {
    const fake = fakeConnection({ failAfterSnapshot: true });
    await expect(runSellingPointPlanningUpgrade(fake.connection, { apply: true, expectedVersion: 8 })).rejects.toThrow("after snapshot storage failure");
    expect(fake.execute.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(true);
    expect(fake.rollback).toHaveBeenCalledOnce();
    expect(fake.commit).not.toHaveBeenCalled();
  });

  it("does not silently accept ignored snapshot inserts unless the exact scoped hash exists", async () => {
    const failed = fakeConnection({ snapshotAffected: 0 });
    await expect(runSellingPointPlanningUpgrade(failed.connection, { apply: true, expectedVersion: 8 })).rejects.toThrow("快照未保存");
    expect(failed.commit).not.toHaveBeenCalled();
    expect(failed.execute.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
    const successful = fakeConnection({ snapshotAffected: 0, existingSnapshots: [{ snapshotId: "existing" }] });
    expect(await runSellingPointPlanningUpgrade(successful.connection, { apply: true, expectedVersion: 8 })).toMatchObject({ snapshotsCreated: 0, changed: true });
    const lookups = successful.execute.mock.calls.filter(([sql]) => sql.includes("FROM emperor_skill_version_snapshots"));
    expect(lookups).toHaveLength(2);
    for (const [sql, params] of lookups) {
      expect(sql).toContain("workspaceId <=> ? AND skillSlug=? AND skillVersion=? AND snapshotHash=?");
      expect(params?.slice(0, 2)).toEqual([null, SELLING_POINT_PLANNING_SKILL_SLUG]);
      expect(params?.[3]).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

describe("upgrade script CLI and bundle execution", () => {
  it("defaults to preview and requires an explicit positive integer version for apply", () => {
    expect(parseUpgradeOptions([])).toEqual({ apply: false });
    expect(parseUpgradeOptions(["--preview"])).toEqual({ apply: false });
    expect(parseUpgradeOptions(["--apply", "--expected-version", "8"])).toEqual({ apply: true, expectedVersion: 8 });
    expect(parseUpgradeOptions(["--expected-version=8", "--apply"])).toEqual({ apply: true, expectedVersion: 8 });
    for (const args of [["--apply"], ["--apply", "--expected-version=0"], ["--expected-version=1.2"],
      ["--expected-version=-1"], ["--expected-version=8", "--expected-version=9"],
      ["--apply", "--preview"], ["--expected-version"], ["--rerun"], ["--expected-version=9007199254740993"]]) {
      expect(() => parseUpgradeOptions(args)).toThrow();
    }
  });

  it("executes as source or arbitrary-named bundle, never when imported from another entry", () => {
    for (const path of ["/tmp/upgradeSellingPointPlanningSkill.ts", "/tmp/build.bundle.mjs"]) {
      expect(isUpgradeEntryPoint(pathToFileURL(path).href, path)).toBe(true);
    }
    expect(isUpgradeEntryPoint("file:///tmp/build.bundle.mjs", "/tmp/other.mjs")).toBe(false);
    expect(isUpgradeEntryPoint("file:///tmp/build.bundle.mjs")).toBe(false);
  });

  it("recognizes a production current-release symlink instead of silently skipping main", () => {
    const directory = mkdtempSync(join(tmpdir(), "planning-entry-test-"));
    const entry = join(directory, "current.bundle.mjs");
    try {
      symlinkSync(new URL(import.meta.url), entry);
      expect(isUpgradeEntryPoint(import.meta.url, entry)).toBe(true);
    } finally {
      unlinkSync(entry);
      rmdirSync(directory);
    }
  });
});
