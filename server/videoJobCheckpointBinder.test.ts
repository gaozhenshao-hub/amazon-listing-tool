import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUSINESS_JOB_CHECKPOINT_STATUS_MAP } from "./domains/ai_os/services/businessJobCheckpointBinder";
import { listAiJobHandlerRegistrations } from "./domains/ai_os/services/jobRunner";
import "./domains/video/videoGenerationJob";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("video Job and Checkpoint binding", () => {
  it("uses the platform-wide lifecycle contract", () => {
    expect(BUSINESS_JOB_CHECKPOINT_STATUS_MAP).toEqual({
      queued: "running",
      running: "running",
      retrying: "running",
      succeeded: "waiting_human",
      confirmed: "confirmed",
      failed: "failed",
      canceled: "canceled",
    });
  });

  it("registers one recoverable worker for every video generation operation", () => {
    expect(listAiJobHandlerRegistrations()).toContainEqual({ id: "video-generation", recoverable: true });
    const source = read("./domains/video/videoGenerationJob.ts");
    for (const operation of [
      "competitor_analysis",
      "competitor_summary",
      "product_info",
      "sections",
      "subtopics",
      "shots",
      "edit_scripts",
    ]) expect(source).toContain(`\"${operation}\"`);
    expect(source).toContain("runEmperorSkill<Record<string, any>>");
    expect(source).toContain("legacySystemPrompt");
    expect(source).toContain("ensureCurrentVideoJob");
  });

  it("keeps the router asynchronous and the page restorable", () => {
    const router = read("./routers/videoScript.ts");
    const page = read("../client/src/pages/VideoScriptPage.tsx");
    const worker = read("./_core/aiWorker.ts");
    expect(router).not.toContain("invokeBusinessSkill");
    expect(router).toContain("queueVideoGenerationJob");
    expect(router).toContain("confirmVideoStage");
    expect(page).toContain("useVideoGenerationJob");
    expect(page).toContain('agentSlug="video.script.workflow"');
    expect(page).toContain("排队中");
    expect(worker).toContain('domains/video/videoGenerationJob');
  });

  it("migrates checkpoints to a true canceled state", () => {
    const migration = read("../drizzle/0135_video_job_checkpoint_binder.sql");
    const stateMachine = read("./domains/ai_os/services/agentStateMachine.ts");
    expect(migration).toContain("'canceled'");
    expect(migration).toContain("video.script.workflow");
    expect(stateMachine).toContain("async cancelNode");
    expect(stateMachine).toContain("SET status='canceled'");
  });
});
