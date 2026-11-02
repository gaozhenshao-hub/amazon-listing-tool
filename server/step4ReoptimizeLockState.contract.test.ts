import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

describe("Step4单图优化锁定状态契约", () => {
  it("在单图优化回写前清除未确认会话的历史逐图锁定标记", () => {
    const referencesRouter = fs.readFileSync(path.join(root, "server/domains/image/routers/references.ts"), "utf8");
    expect(referencesRouter).toContain('import { clearStep4ReferenceLocks } from "../step4ReferenceLockState"');
    expect(referencesRouter).toContain("const updatedRefs = clearStep4ReferenceLocks(imageRefs)");
    expect(referencesRouter).toContain("step4Confirmed: 0");
    expect(referencesRouter).toContain("compositionRefNote: input.compositionRefNote?.trim() || existingRef?.compositionRefNote");
    expect(referencesRouter).toContain("effectRefNote: input.effectRefNote?.trim() || existingRef?.effectRefNote");
  });
});
