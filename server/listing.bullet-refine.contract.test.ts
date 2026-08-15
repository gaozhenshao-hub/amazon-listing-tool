import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editingRouter = readFileSync("server/domains/listing/routers/editing.ts", "utf8");
const generatePage = readFileSync("client/src/pages/GeneratePage.tsx", "utf8");

describe("卖点定向再次优化皇帝Skill契约", () => {
  it("服务端使用独立 listing.bullet.refine Skill 并拒绝原文候选", () => {
    expect(editingRouter).toContain("optimizeSingleBullet: protectedProcedure");
    expect(editingRouter).toContain('skillSlug: "listing.bullet.refine"');
    expect(editingRouter).toContain("currentBullet");
    expect(editingRouter).toContain("optimizationNote");
    expect(editingRouter).toContain("未产生与原文不同的候选");
  });

  it("前端再次优化调用专用接口并提交当前卖点与优化方向", () => {
    expect(generatePage).toContain("trpc.listing.optimizeSingleBullet.useMutation()");
    expect(generatePage).toContain("currentBullet: { subtitle: current.subtitle");
    expect(generatePage).toContain("optimizationNote: note");
  });
});
