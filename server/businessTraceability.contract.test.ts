import { describe, expect, it } from "vitest";
import { buildBusinessResourceRef } from "./domains/ai_os/services/businessTraceability";

describe("跨模块业务追踪引用", () => {
  it("以稳定资源类型和版本构建可读引用", () => {
    expect(buildBusinessResourceRef({ workspaceId: 1, domain: "image", resourceType: "workflow_step", resourceId: "780001-step2", version: 4 }))
      .toBe("image:workflow_step:780001-step2:v4");
  });

  it("追踪查询服务保留工作空间作为强制输入", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./domains/ai_os/services/businessTraceability.ts", import.meta.url), "utf8"));
    expect(source).toContain("workspaceId: input.workspaceId");
    expect(source).toContain("listUnifiedArtifactVersions");
  });
});
