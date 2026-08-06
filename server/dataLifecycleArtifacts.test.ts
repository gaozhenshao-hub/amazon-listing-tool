import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import * as aiOsSchema from "../drizzle/schema/ai_os";
import { buildStorageUri, parseStorageUri } from "./storage";
import {
  DATA_LIFECYCLE_POLICIES,
  buildLifecycleCandidateSql,
  createContentHash,
  shouldInlineArtifactContent,
} from "./domains/ai_os/services/artifactLifecycle";

const root = process.cwd();

function readRepoFile(repoPath: string) {
  return fs.readFileSync(path.join(root, repoPath), "utf8");
}

describe("data lifecycle and unified artifact system v1", () => {
  it("exports unified artifact, storage, and archive schema tables", () => {
    expect(aiOsSchema.aiArtifacts).toBeDefined();
    expect(aiOsSchema.aiArtifactSelectionEvents).toBeDefined();
    expect(aiOsSchema.aiArtifactConsumptions).toBeDefined();
    expect(aiOsSchema.aiStorageObjects).toBeDefined();
    expect(aiOsSchema.aiDataArchiveRuns).toBeDefined();
    expect(aiOsSchema.aiDataArchiveItems).toBeDefined();
  });

  it("ships the 0115 migration for artifact/storage indexes and lifecycle columns", () => {
    const migration = readRepoFile("drizzle/0115_data_lifecycle_artifacts_v1.sql");

    for (const table of [
      "ai_storage_objects",
      "ai_artifacts",
      "ai_data_archive_runs",
      "ai_data_archive_items",
    ]) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS \`${table}\``);
    }

    expect(migration).toContain("ALTER TABLE `projectFiles`");
    expect(migration).toContain("ADD COLUMN `rawStorageUri` text");
    expect(migration).toContain("ADD COLUMN `analysisArtifactId` varchar(80)");
    expect(migration).toContain("ALTER TABLE `ai_jobs`");
    expect(migration).toContain("ALTER TABLE `emperor_tool_runs`");
    expect(migration).toContain("ALTER TABLE `emperor_agent_events`");
    expect(migration).toContain("ALTER TABLE `emperor_ai_os_metrics`");
    expect(migration).toContain("INSERT IGNORE INTO `ai_artifacts`");
    expect(migration).toContain("idx_ai_artifacts_domain_source_current");
    expect(migration).toContain("idx_ai_jobs_lifecycle");
  });

  it("defines executable lifecycle policies for high-growth AI OS records", () => {
    expect(DATA_LIFECYCLE_POLICIES.map((policy) => policy.slug)).toEqual(
      expect.arrayContaining([
        "ai_jobs.completed",
        "tool_runs.completed",
        "agent_events.stream",
        "ai_os_metrics.detail",
        "project_files.uploads",
        "ai_artifacts.versions",
      ]),
    );
    const agentEvents = DATA_LIFECYCLE_POLICIES.find((policy) => policy.slug === "agent_events.stream")!;
    expect(agentEvents.archiveAfterDays).toBe(90);
    expect(buildLifecycleCandidateSql(agentEvents, "archive", "'2026-01-01'")).toContain("candidateCount");
    expect(buildLifecycleCandidateSql(agentEvents, "archive", "'2026-01-01'")).toContain("emperor_agent_events");
  });

  it("keeps artifact payloads hashable and storage-addressable", () => {
    expect(createContentHash({ a: 1 })).toBe(createContentHash({ a: 1 }));
    expect(shouldInlineArtifactContent("small payload")).toBe(true);
    expect(shouldInlineArtifactContent("x".repeat(20_000))).toBe(false);
    expect(buildStorageUri("/project-files/a.txt")).toBe("storage://forge/project-files/a.txt");
    expect(parseStorageUri("storage://forge/project-files/a.txt")).toEqual({
      provider: "forge",
      key: "project-files/a.txt",
    });
  });

  it("connects ProjectFile, Agent Artifact, and admin lifecycle routes to the new service", () => {
    const projectFileRouter = readRepoFile("server/routers/projectFile.ts");
    const agentRunner = readRepoFile("server/domains/ai_os/services/agentRunner/runtimeCore.ts");
    const observabilityRouter = readRepoFile("server/domains/ai_os/routers/observability.ts");
    const docs = readRepoFile("docs/data-lifecycle-artifacts-v1.md");

    expect(projectFileRouter).toContain("registerProjectFileArtifactBundle");
    expect(projectFileRouter).toContain("rawStorageUri");
    expect(projectFileRouter).toContain("analysisArtifactId");
    expect(agentRunner).toContain("registerAgentArtifactLifecycleIndex");
    expect(observabilityRouter).toContain("runLifecycleSweep");
    expect(docs).toContain("ai-artifact-scope://{base64url(scope)}@current");
  });
});
