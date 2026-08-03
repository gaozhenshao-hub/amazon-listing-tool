import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import {
  buildAiJobSnapshot,
  generateAiJobRunId,
  isActiveAiJob,
} from "./services/aiJobRunner";

describe("Generic AI Job infrastructure", () => {
  it("should expose ai_jobs schema fields", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.aiJobs).toBeDefined();
    expect(schema.aiJobs.runId).toBeDefined();
    expect(schema.aiJobs.kind).toBeDefined();
    expect(schema.aiJobs.module).toBeDefined();
    expect(schema.aiJobs.procedure).toBeDefined();
    expect(schema.aiJobs.status).toBeDefined();
    expect(schema.aiJobs.progress).toBeDefined();
    expect(schema.aiJobs.skillSlug).toBeDefined();
    expect(schema.aiJobs.input).toBeDefined();
    expect(schema.aiJobs.output).toBeDefined();
    expect(schema.aiJobs.errorMessage).toBeDefined();
  });

  it("should normalize run ids and active statuses", () => {
    const runId = generateAiJobRunId("image.workflow");
    expect(runId).toMatch(/^image_workflow_\d+_[a-z0-9]+$/);
    expect(isActiveAiJob("queued")).toBe(true);
    expect(isActiveAiJob("running")).toBe(true);
    expect(isActiveAiJob("succeeded")).toBe(false);
  });

  it("should build snapshots with parsed JSON payloads", () => {
    const now = new Date();
    const snapshot = buildAiJobSnapshot({
      id: 1,
      runId: "ai_1",
      kind: "listing.generateFiveSteps",
      module: "listing",
      procedure: "listingSkill.generateFiveSteps",
      status: "succeeded",
      progress: 100,
      userId: 7,
      projectId: 3,
      skillSlug: "listing.*",
      input: '{"context":"demo"}',
      output: '{"ok":true}',
      errorMessage: null,
      startedAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    } as any);

    expect(snapshot.input).toEqual({ context: "demo" });
    expect(snapshot.output).toEqual({ ok: true });
    expect(snapshot.status).toBe("succeeded");
  });

  it("should register aiJobs routes in the app router", () => {
    const procedures = (appRouter as any)._def.procedures;
    expect(procedures["aiJobs.get"]).toBeDefined();
    expect(procedures["aiJobs.startListingFiveSteps"]).toBeDefined();
    expect(procedures["aiJobs.startAdSearchTermAdvice"]).toBeDefined();
    expect(procedures["aiJobs.startOpsReplenishmentPlan"]).toBeDefined();
  });
});
