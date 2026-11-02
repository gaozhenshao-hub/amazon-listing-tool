import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (name: string) => readFileSync(resolve(import.meta.dirname, `../client/src/pages/dev/${name}`), "utf8");

describe("产品开发专用导出：非超管只进行站内查看和编辑", () => {
  it("说明书PDF导出需超管身份，但预览按钮仍保留", () => {
    const code = source("ManualEditor.tsx");
    expect(code).toMatch(/user\?\.role === "super_admin" && <div className="border-t pt-4">/);
    expect(code).toContain("PDF导出（方便打印）");
    expect(code).toContain("预览ES");
  });
  it("全景CSV和标签CSV需超管身份，但普通成员仍可在线编辑及导入", () => {
    const panorama = source("PanoramaTable.tsx");
    expect(panorama).toMatch(/user\?\.role === "super_admin" && <Button[\s\S]*?exportMutation\.mutate\(\{ projectId \}\)/);
    const project = source("DevProjectDetail.tsx");
    expect(project).toMatch(/user\?\.role === "super_admin" && <Button[\s\S]*?devProjectTags\.exportTagsCsv/);
    expect(project).toContain("批量导入");
  });
});
