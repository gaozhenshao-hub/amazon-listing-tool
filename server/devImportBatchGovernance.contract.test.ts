import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const routerSource = readFileSync(new URL("./routers/devProject.ts", import.meta.url), "utf8");
const repositorySource = readFileSync(new URL("./domains/product_development/repositories/legacyDevRepository.ts", import.meta.url), "utf8");
const migrationSource = readFileSync(new URL("../drizzle/0149_dev_import_batch_governance.sql", import.meta.url), "utf8");

describe("模块一导入批次治理契约", () => {
  it("提供校验、应用、批次列表和受控回滚入口", () => {
    for (const procedure of ["prepareImportBatch", "listImportBatches", "applyImportBatch", "rollbackImportBatch"]) expect(routerSource).toContain(procedure);
    expect(routerSource).toContain("已有后续批次生效，不能自动回滚");
  });

  it("应用前保存快照并从快照事务恢复产品或评论记录", () => {
    expect(routerSource).toContain("createDevImportApplySnapshot");
    expect(repositorySource).toContain("restoreDevImportSnapshot");
    expect(repositorySource).toContain("await db.transaction");
  });

  it("兼容既有批次状态并扩展批次校验字段和快照表", () => {
    expect(migrationSource).toContain("'draft','validated','confirmed','applying','applied'");
    expect(migrationSource).toContain("CREATE TABLE dev_import_apply_snapshots");
  });
});
