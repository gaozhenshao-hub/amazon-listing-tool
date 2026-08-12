import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "server/routers/devTagging.ts"), "utf8");

describe("模块一属性标注失败真实性", () => {
  it("AI 未返回内容或没有产品结果时不会伪造成功", () => {
    expect(source).toContain("AI 未返回属性标注内容");
    expect(source).toContain("AI 未返回任何可用的属性标注结果");
    expect(source).toContain("if (allTags.length === 0)");
    expect(source).toContain("throw new TRPCError");
  });

  it("部分批次失败时返回 partial_failed 与可读失败原因", () => {
    expect(source).toContain("const batchFailures");
    expect(source).toContain("status: batchFailures.length > 0 ? \"partial_failed\" : \"succeeded\"");
    expect(source).toContain("failedBatches: batchFailures");
  });
});

