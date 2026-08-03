import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import {
  buildAiJobSnapshot,
  calculateAiJobRetryDelayMs,
  generateAiJobRunId,
  getAiJobRuntimeStatus,
  getAiJobWorkerId,
  getAvailableAiJobSlots,
  getMaxConcurrentAiJobs,
  isActiveAiJob,
  isAiJobSchedulingEnabled,
  listAiJobHandlerRegistrations,
  resolveAiJobHandler,
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
    expect(schema.aiJobs.priority).toBeDefined();
    expect(schema.aiJobs.queueName).toBeDefined();
    expect(schema.aiJobs.attempt).toBeDefined();
    expect(schema.aiJobs.maxAttempts).toBeDefined();
    expect(schema.aiJobs.timeoutSeconds).toBeDefined();
    expect(schema.aiJobs.skillSlug).toBeDefined();
    expect(schema.aiJobs.input).toBeDefined();
    expect(schema.aiJobs.output).toBeDefined();
    expect(schema.aiJobs.errorMessage).toBeDefined();
    expect(schema.aiJobs.nextRunAt).toBeDefined();
    expect(schema.aiJobs.leaseUntil).toBeDefined();
    expect(schema.aiJobs.lockedBy).toBeDefined();
    expect(schema.aiJobs.claimedAt).toBeDefined();
    expect(schema.aiJobs.lastHeartbeatAt).toBeDefined();
    expect(schema.aiJobs.deadLetterAt).toBeDefined();
    expect(schema.aiJobs.deadLetterReason).toBeDefined();
    expect(schema.aiJobWorkers).toBeDefined();
    expect(schema.aiJobDeadLetters).toBeDefined();
  });

  it("should normalize run ids and active statuses", () => {
    const runId = generateAiJobRunId("image.workflow");
    expect(runId).toMatch(/^image_workflow_\d+_[a-z0-9]+$/);
    expect(getAiJobWorkerId()).toMatch(/^web_\d+_[a-z0-9]+$/);
    expect(isAiJobSchedulingEnabled()).toBe(true);
    expect(getMaxConcurrentAiJobs()).toBeGreaterThanOrEqual(1);
    expect(getMaxConcurrentAiJobs()).toBeLessThanOrEqual(25);
    expect(getAvailableAiJobSlots()).toBeGreaterThanOrEqual(0);
    expect(calculateAiJobRetryDelayMs(1)).toBe(30000);
    expect(calculateAiJobRetryDelayMs(3)).toBe(120000);
    expect(calculateAiJobRetryDelayMs(9)).toBe(600000);
    expect(isActiveAiJob("queued")).toBe(true);
    expect(isActiveAiJob("running")).toBe(true);
    expect(isActiveAiJob("succeeded")).toBe(false);
    expect(isActiveAiJob("canceled")).toBe(false);

    const runtimeStatus = getAiJobRuntimeStatus();
    expect(runtimeStatus.workerId).toBe(getAiJobWorkerId());
    expect(runtimeStatus.role).toMatch(/^(web|worker)$/);
    expect(runtimeStatus.draining).toBe(false);
    expect(runtimeStatus.availableSlots).toBe(getAvailableAiJobSlots());
    expect(runtimeStatus.runningRunIds).toEqual(expect.any(Array));
    expect(runtimeStatus.pendingScheduleRunIds).toEqual(expect.any(Array));
    expect(runtimeStatus.registeredHandlers).toEqual(expect.any(Array));
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
    expect(snapshot.priority).toBe(0);
    expect(snapshot.queueName).toBe("default");
    expect(snapshot.attempt).toBe(0);
    expect(snapshot.maxAttempts).toBe(1);
    expect(snapshot.timeoutSeconds).toBe(600);
    expect(snapshot.claimedAt).toBeNull();
    expect(snapshot.leaseUntil).toBeNull();
    expect(snapshot.deadLetterAt).toBeNull();
    expect(snapshot.deadLetterReason).toBeNull();
  });

  it("should register recoverable handlers for migrated long AI jobs", () => {
    const handlers = listAiJobHandlerRegistrations().map((handler) => handler.id);
    expect(handlers).toContain("listing.generateFiveSteps");
    expect(handlers).toContain("listing.runStep");
    expect(handlers).toContain("ad.searchTermAdvice");
    expect(handlers).toContain("ops.replenishmentPlan");
    expect(handlers).toContain("imageWorkflow.step5FinalSuggestion");
    expect(handlers).toContain("emperorAgent.nodeSkill");

    const now = new Date();
    const handler = resolveAiJobHandler({
      runId: "ai_1",
      kind: "listing.generateFiveSteps",
      module: "listing",
      procedure: "listingSkill.generateFiveSteps",
      status: "queued",
      progress: 5,
      priority: 0,
      queueName: "default",
      attempt: 0,
      maxAttempts: 1,
      timeoutSeconds: 600,
      userId: 7,
      projectId: null,
      skillSlug: "listing.*",
      input: { context: "demo" },
      output: null,
      error: null,
      nextRunAt: null,
      leaseUntil: null,
      lockedBy: null,
      claimedAt: null,
      lastHeartbeatAt: null,
      deadLetterAt: null,
      deadLetterReason: null,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(handler).toBeTypeOf("function");
  });

  it("should register aiJobs routes in the app router", () => {
    const procedures = (appRouter as any)._def.procedures;
    expect(procedures["aiJobs.get"]).toBeDefined();
    expect(procedures["aiJobs.runtimeStatus"]).toBeDefined();
    expect(procedures["aiJobs.workerHealth"]).toBeDefined();
    expect(procedures["aiJobs.deadLetters"]).toBeDefined();
    expect(procedures["aiJobs.cancel"]).toBeDefined();
    expect(procedures["aiJobs.startListingFiveSteps"]).toBeDefined();
    expect(procedures["aiJobs.startAdSearchTermAdvice"]).toBeDefined();
    expect(procedures["aiJobs.startOpsReplenishmentPlan"]).toBeDefined();
  });
});
