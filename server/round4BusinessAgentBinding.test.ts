import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("round 4 business Agent binding", () => {

  it("runs all keyword capabilities as recoverable Emperor Skill jobs", () => {
    const job = read("server/domains/keyword/keywordGenerationJob.ts");
    const bridge = read("server/domains/keyword/keywordAgentBridge.ts");
    const router = read("server/routers/keywordAi.ts");
    const worker = read("server/_core/aiWorker.ts");

    for (const slug of [
      "keyword.traffic.classify",
      "keyword.semantic.filter",
      "keyword.scene.tag",
      "keyword.root.classify",
      "keyword.strategy.matrix",
      "keyword.listing.layout",
    ]) expect(job).toContain(slug);
    expect(job).toContain("runEmperorSkill<Record<string, any>>");
    expect(job).toContain("syncKeywordNodeQueued");
    expect(job).toContain("syncKeywordNodeWaitingHuman");
    expect(job).toContain("ensureCurrentJob");
    expect(bridge).toContain('businessJobStatus: "queued"');
    expect(router).toContain("listGenerationRuns");
    expect(router).toContain("confirmGenerationResult");
    expect(worker).toContain('domains/keyword/keywordGenerationJob');
  });
});
