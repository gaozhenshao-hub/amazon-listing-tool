import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "client/src/pages/ImageWorkflowPage.tsx"), "utf8");

describe("Step5只读权限渲染契约", () => {
  it("使用与路由守卫一致的图片建议二级权限键", () => {
    expect(source).toContain('canEdit("listing", "listing_image_workflow")');
    expect(source).toContain('canDelete("listing", "listing_image_workflow")');
  });

  it("仅允许有编辑权限的会话展示生成、锁定、微调、上传和A+排序控件", () => {
    expect(source).toContain('canEditStep5 && enData && !isConfirmed && !isGenerating');
    expect(source).toContain('canEditStep5 && !isConfirmed && enData.mainImage');
    expect(source).toContain('draggable={canEditStep5 && !isConfirmed}');
    expect(source).toContain('canUpload={canEditStep5}');
  });

  it("将删除美工成品图片限制为删除权限，并让无上传权限的用户看到只读占位", () => {
    expect(source).toContain('{canRemove && (');
    expect(source).toContain('canRemove={canDeleteStep5}');
    expect(source).toContain('您拥有查看权限');
  });
});
