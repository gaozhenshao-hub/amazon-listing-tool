import { describe, expect, it } from "vitest";
import * as aiOsSchema from "../drizzle/schema/ai_os";
import * as authSchema from "../drizzle/schema/auth";
import * as projectSchema from "../drizzle/schema/project";
import * as relations from "../drizzle/relations";
import * as dbCompat from "./db";
import {
  ARCHIVE_POLICIES,
  DATABASE_DOMAINS,
  INDEX_BASELINES,
  SOFT_FOREIGN_KEYS,
  getDatabaseGovernanceSnapshot,
  buildArchiveCandidateSql,
  buildSoftForeignKeyAuditSql,
  listArchivePoliciesByDomain,
  listDomainTables,
  listIndexBaselinesByDomain,
} from "./repositories/dbGovernance";
import * as aiJobRepository from "./repositories/ai_os";
import * as projectRepository from "./repositories/project";

describe("database governance v1", () => {
  it("defines the canonical database domains", () => {
    expect(DATABASE_DOMAINS.map((domain) => domain.slug)).toEqual([
      "auth",
      "project",
      "listing",
      "image",
      "ads",
      "ops",
      "ai_os",
    ]);
    expect(listDomainTables("ai_os")).toContain("ai_jobs");
    expect(listDomainTables("project")).toContain("projects");
  });

  it("keeps core repositories callable from direct and compatibility exports", () => {
    expect(typeof projectRepository.createProject).toBe("function");
    expect(typeof projectRepository.getAllProjects).toBe("function");
    expect(typeof projectRepository.deleteProject).toBe("function");
    expect(typeof aiJobRepository.createAiJob).toBe("function");
    expect(typeof aiJobRepository.createAiJobDeadLetter).toBe("function");
    expect(typeof dbCompat.createProject).toBe("function");
    expect(typeof dbCompat.createAiJob).toBe("function");
    expect(typeof dbCompat.withDbTransaction).toBe("function");
  });

  it("exposes schema domain modules and relations", () => {
    expect(authSchema.users).toBeDefined();
    expect(projectSchema.projects).toBeDefined();
    expect(projectSchema.projectFiles).toBeDefined();
    expect(aiOsSchema.aiJobs).toBeDefined();
    expect(aiOsSchema.emperorAgentRuns).toBeDefined();
    expect(relations.projectsRelations).toBeDefined();
    expect(relations.emperorAgentRunsRelations).toBeDefined();
    expect(relations.emperorAgentArtifactsRelations).toBeDefined();
  });

  it("tracks soft foreign keys for the core ownership graph", () => {
    expect(SOFT_FOREIGN_KEYS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "projects", column: "userId", referencesTable: "users" }),
        expect.objectContaining({ table: "listings", column: "projectId", referencesTable: "projects" }),
        expect.objectContaining({ table: "ai_jobs", column: "projectId", referencesTable: "projects" }),
        expect.objectContaining({ table: "emperor_agent_checkpoints", column: "runId", referencesTable: "emperor_agent_runs" }),
      ]),
    );
    expect(buildSoftForeignKeyAuditSql(SOFT_FOREIGN_KEYS[0])).toContain("LEFT JOIN `users` parent");
  });

  it("defines index baselines for ownership, status, and time filters", () => {
    const indexedFields = new Set(INDEX_BASELINES.flatMap((baseline) => baseline.fields));
    expect(Array.from(indexedFields)).toEqual(expect.arrayContaining(["userId", "projectId", "status", "createdAt"]));
    expect(listIndexBaselinesByDomain("ads").map((baseline) => baseline.fields.join(","))).toContain(
      "user_id,report_date,product_id",
    );
    expect(listIndexBaselinesByDomain("ai_os").map((baseline) => baseline.indexName)).toContain(
      "idx_agent_runs_user_status_created",
    );
  });

  it("defines archive policies for high-growth tables", () => {
    expect(ARCHIVE_POLICIES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "ai_jobs", timeField: "createdAt" }),
        expect.objectContaining({ table: "emperor_agent_events", timeField: "createdAt" }),
        expect.objectContaining({ table: "ad_daily_search_term_reports", timeField: "report_date" }),
        expect.objectContaining({ table: "lingxing_product_weekly", timeField: "week_start_date" }),
      ]),
    );
    expect(listArchivePoliciesByDomain("ai_os").length).toBeGreaterThanOrEqual(3);
    expect(buildArchiveCandidateSql(ARCHIVE_POLICIES[0], "'2026-01-01'")).toContain("archiveCandidateCount");
  });

  it("returns a complete governance snapshot", () => {
    expect(getDatabaseGovernanceSnapshot()).toMatchObject({
      domains: DATABASE_DOMAINS,
      softForeignKeys: SOFT_FOREIGN_KEYS,
      indexBaselines: INDEX_BASELINES,
      archivePolicies: ARCHIVE_POLICIES,
    });
  });
});
