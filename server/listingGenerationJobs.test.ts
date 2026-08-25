import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const jobService = read("server/domains/listing/services/generationJob.ts");
const bridge = read("server/domains/listing/listingAgentBridge.ts");
const businessAgent = read("server/domains/ai_os/services/businessManagedAgent.ts");
const jobRouter = read("server/domains/listing/routers/jobControl.ts");
const editingRouter = read("server/domains/listing/routers/editing.ts");
const generationRouter = read("server/domains/listing/routers/generation.ts");
const worker = read("server/_core/aiWorker.ts");
const generatePage = read("client/src/pages/GeneratePage.tsx");
const titlePage = read("client/src/pages/listing/StepTitle.tsx");
const descriptionPage = read("client/src/pages/listing/StepDescription.tsx");
const searchTermsPage = read("client/src/pages/listing/StepSearchTerms.tsx");
const qaPage = read("client/src/pages/listing/StepQA.tsx");

describe("Listing generation job lifecycle", () => {
  it("runs every main generation capability as a recoverable Emperor Skill job", () => {
    for (const operation of ["sellingPoints", "singleBullet", "bullets", "title", "description", "searchTerms", "qa", "batch"]) {
      expect(jobService).toContain(`"${operation}"`);
    }
    for (const slug of [
      "listing.sellingpoints.generate",
      "listing.bullets.generate",
      "listing.bullet.step.generate",
      "listing.title.generate",
      "listing.description.generate",
      "listing.searchterms.generate",
      "listing.qa.generate",
    ]) {
      expect(jobService).toContain(slug);
    }
    expect(jobService).toContain("runEmperorSkill<any>");
    expect(jobService).toContain('singleBullet: { nodeKey: "singleBullet", skillSlug: "listing.bullet.step.generate"');
    expect(jobService).toContain("validateSingleBulletQuality");
    expect(jobService).toContain("上次逐条卖点质量门禁未通过");
    expect(jobService).toContain("recoverable: true");
    expect(worker).toContain('domains/listing/services/generationJob');
  });

  it("binds queued, running, progress, retry, cancellation and review states to checkpoints", () => {
    expect(jobService).toContain("syncListingNodeJobQueued");
    expect(jobService).toContain("syncListingNodeJobRunning");
    expect(jobService).toContain("syncListingNodeJobWaitingHuman");
    expect(jobService).toContain("syncListingNodeJobFailed");
    expect(bridge).toContain('businessJobStatus: "queued"');
    expect(bridge).toContain('businessJobStatus: "running"');
    expect(jobService).toContain('failureKind: "cancel"');
    expect(bridge).toContain("finalAttempt");
  });

  it("protects nodes from late jobs and reads only confirmed current upstream artifacts", () => {
    expect(jobService).toContain("latestJobStillOwnsNode");
    expect(jobService).toContain("latest?.runId === job.runId");
    expect(jobService).toContain('artifact.status !== "final"');
    expect(jobService).toContain("!artifact.isCurrent");
    expect(businessAgent).toContain("currentCheckpoint.aiJobRunId");
    expect(businessAgent).toContain("currentCheckpoint.aiJobRunId !== input.aiJobRunId");
    expect(jobService).toContain('checkpoint?.status === "confirmed"');
  });

  it("hydrates N0-N5 and maps G1-G5 to the same Listing Agent run", () => {
    for (const nodeId of ["N0", "N1", "N2", "N3", "N4", "N5"]) {
      expect(jobService).toContain(`nodeId: "${nodeId}"`);
    }
    for (const [key, nodeId] of Object.entries({ sellingPoints: "G1", title: "G2", description: "G3", searchTerms: "G4", qa: "G5" })) {
      expect(bridge).toContain(`"${key}": "${nodeId}"`);
    }
    expect(jobRouter).toContain("ensureListingAgentRun");
    expect(jobRouter).toContain("syncListingPreparationNodes");
  });
});

describe("Listing human review and compatibility routes", () => {
  it("creates draft artifact versions for edits and final versions for locks", () => {
    expect(editingRouter).toContain("syncListingNodeDraft");
    expect(editingRouter).toContain("userEdit: stepOutput(step)");
    expect(bridge).toContain("markBusinessManagedNodeDraft");
    expect(bridge).toContain("markBusinessManagedNodeConfirmed");
    expect(bridge).toContain("resetNodeIds: descendantNodeIds");
  });

  it("keeps legacy procedure names but routes them into the shared job service", () => {
    expect(generationRouter).toContain("startListingJobForContext");
    expect(editingRouter).toContain("startListingJobForContext");
    expect(generationRouter).toContain('queueListingJob(ctx, input, "batch", "G1")');
    expect(editingRouter).toContain('queueEditingJob(ctx, input, "qa")');
  });

  it("restores and controls jobs from every Listing generation page", () => {
    expect(generatePage).toContain("useListingGenerationJob");
    for (const page of [titlePage, descriptionPage, searchTermsPage, qaPage]) {
      expect(page).toContain("useListingGenerationJob");
      expect(page).toContain("ListingGenerationJobStatus");
    }
  });
});
