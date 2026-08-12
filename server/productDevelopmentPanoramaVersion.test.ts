import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("模块一竞品全景确认版本", () => {
  const schema = read("drizzle/schema/project.ts");
  const panoramaRouter = read("server/routers/devPanorama.ts");
  const projectRouter = read("server/routers/devProject.ts");
  const stageGating = read("server/domains/product_development/analysis/stageGating.ts");
  const taggingRouter = read("server/routers/devTagging.ts");

  it("持久化独立的全景确认版本并由状态表指向当前版本", () => {
    expect(schema).toContain('mysqlTable("dev_panorama_versions"');
    expect(schema).toContain('currentVersionId: int("currentVersionId")');
    expect(panoramaRouter).toContain("devPanoramaVersions");
    expect(panoramaRouter).toContain("currentVersionId: versionId");
    expect(panoramaRouter).toContain("status: \"superseded\"");
  });

  it("锁定态展示与下载均消费冻结快照，而非实时 ASIN 数据", () => {
    expect(panoramaRouter).toContain("status?.confirmed === 1 && status.currentVersionId");
    expect(panoramaRouter).toContain("snapshot && Array.isArray(snapshot.products)");
    expect(panoramaRouter).toContain("const currentVersionId = statusRows[0]?.confirmed === 1");
  });

  it("上传、确认数据和人工编辑会使旧的全景确认版本失效", () => {
    expect(projectRouter).toContain("async function invalidatePanoramaConfirmation");
    expect(projectRouter.match(/await invalidatePanoramaConfirmation\(input\.projectId\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(panoramaRouter).toContain("confirmed: 0, confirmedAt: null");
  });

  it("市场分析阶段只接受具备 currentVersionId 的冻结全景表", () => {
    expect(stageGating).toContain("rows[0].confirmed === 1 && Boolean(rows[0].currentVersionId)");
    expect(stageGating).toContain("竞品全景分析表未确认");
  });

  it("属性标注重新生成、确认和解锁会使旧的全景冻结版本失效", () => {
    expect(taggingRouter).toContain("async function invalidatePanoramaConfirmation");
    expect(taggingRouter.match(/invalidatePanoramaConfirmation\(/g)?.length).toBeGreaterThanOrEqual(5);
  });
});
