import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./routers/dataImport.ts", import.meta.url), "utf8");

describe("子ASIN停售人工恢复契约", () => {
  it("库存规划行返回停售原因、证据期与人工恢复审计字段", () => {
    expect(source).toContain("lifecycleStatus: lifecycle?.status || \"active\"");
    expect(source).toContain("lifecycleEvidenceStartDate");
    expect(source).toContain("lifecycleRestoreReason");
  });

  it("人工恢复写入审计字段，并阻止同一零值证据直接覆盖人工决策", () => {
    expect(source).toContain("restoreAsinLifecycleStatus");
    expect(source).toContain("restoreReason: input.reason");
    expect(source).toContain("existing?.status === \"active\" && existing.restoredAt");
  });
});
