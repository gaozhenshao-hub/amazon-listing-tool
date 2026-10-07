import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./repositories/ai_os/aiJobRepository.ts", import.meta.url), "utf8");
describe("Listing依赖的AI Job最新任务顺序", () => {
  it("时间戳并列时以自增ID倒序稳定打破并列", () => {
    const list = source.slice(source.indexOf("export async function listAiJobsForUser("), source.indexOf("export async function listRecoverableAiJobs("));
    expect(list).toContain(".orderBy(desc(aiJobs.createdAt), desc(aiJobs.id))");
  });
});
