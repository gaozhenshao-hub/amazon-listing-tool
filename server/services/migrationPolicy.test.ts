import { describe, expect, it } from "vitest";
import { canRepairFailedMigrationChecksum } from "./migrationPolicy.mjs";

describe("受控迁移失败修复门禁", () => {
  it("只允许显式重试的失败迁移替换校验和", () => {
    expect(canRepairFailedMigrationChecksum({ checksum: "old", status: "failed" }, "new", true)).toBe(true);
    expect(canRepairFailedMigrationChecksum({ checksum: "old", status: "failed" }, "new", false)).toBe(false);
  });

  it("成功、基线与中断迁移永远不可通过校验和替换", () => {
    expect(canRepairFailedMigrationChecksum({ checksum: "old", status: "succeeded" }, "new", true)).toBe(false);
    expect(canRepairFailedMigrationChecksum({ checksum: "old", status: "baselined" }, "new", true)).toBe(false);
    expect(canRepairFailedMigrationChecksum({ checksum: "old", status: "started" }, "new", true)).toBe(false);
  });
});
