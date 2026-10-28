import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const dbSource = readFileSync(new URL("./kbDb.ts", import.meta.url), "utf8");
const imagesSource = readFileSync(new URL("./routers/kbImages.ts", import.meta.url), "utf8");
const procedureSource = readFileSync(new URL("./domains/ai_os/workspaceScopedProcedure.ts", import.meta.url), "utf8");
describe("retained image knowledge workspace boundary", () => {
  it("authorizes image browsing, tagging and imports before resolver execution", () => {
    for (const name of ["listSets", "getSet", "listAllImages", "importByAsin", "taggingStart", "taggingApply"]) {
      expect(imagesSource).toContain(`${name}: workspaceScopedProcedure("knowledge")`);
    }
    expect(procedureSource).toContain("当前用户尚未绑定工作空间");
    expect(procedureSource).toContain("assertResourceAction");
  });
  it("keeps shared images in the requested workspace and excludes private drafts", () => {
    expect(dbSource).toContain("const workspace = eq(kbImageSets.workspaceId, workspaceId)");
    expect(dbSource).toContain('const shared = and(eq(kbImageSets.status, "confirmed"), ne(kbImageSets.visibility, "private"))');
    expect(dbSource).toContain("return and(workspace, or(eq(kbImageSets.userId, userId), shared))");
  });
});
