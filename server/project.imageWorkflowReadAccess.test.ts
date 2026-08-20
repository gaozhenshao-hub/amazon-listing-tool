import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("图片建议项目选择权限", () => {
  it("将图片工作流映射到listing_image_workflow读取权限", () => {
    const shared = readFileSync(resolve(process.cwd(), "shared/const.ts"), "utf8");
    expect(shared).toContain("image_workflow: { moduleId: 'listing', subModuleId: 'listing_image_workflow' }");
  });

  it("允许图片建议只读角色列出同工作空间项目但不改变项目写入守卫", () => {
    const source = readFileSync(resolve(process.cwd(), "server/routers/project.ts"), "utf8");
    expect(source).toContain('resource: "image_workflow", action: "read", workspaceId');
    expect(source).toContain('if (!canReadProject && !canReadImageWorkflow)');
    expect(source).toContain('resource: "project", action: "create"');
    expect(source).toContain('resource: "project", action: "update"');
  });
});
