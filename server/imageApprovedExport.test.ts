import { describe, expect, it } from "vitest";
import type { ImageWorkflowSession } from "../drizzle/schema/image";
import { requireApprovedImageSession, requireImageDeliverableAccess } from "./domains/image/services/imageApprovedExport";
import { buildFullPlanContent } from "../client/src/pages/imageWorkflow/exportContent";

function approved(): ImageWorkflowSession {
  return {
    id: 81,
    projectId: 51,
    step0Confirmed: 1, step0AiResult: JSON.stringify({ summary: "research" }), step0UserEdit: null,
    step1Confirmed: 1, step1UserEdit: JSON.stringify({ coreSellingPoints: [{ point: "tested" }] }),
    step2Confirmed: 1, step2UserEdit: JSON.stringify({ images: [{ imageLabel: "main" }] }),
    step3Confirmed: 1, step3UserEdit: JSON.stringify({ selectedStyles: [{ name: "studio" }] }),
    step4Confirmed: 1, step4UserEdit: JSON.stringify({ imageReferences: [{ compositionRefImageUrl: "https://unverified.test/reference.png", designNotes: "Research reference" }] }),
    step5Confirmed: 1, step5UserEdit: JSON.stringify({ mainImage: { title: "approved" }, secondaryImages: [] }),
    step5AiResult: JSON.stringify({ mainImage: { title: "unconfirmed AI draft" } }),
    step5DesignerUploads: "[]",
    step6Confirmed: 1, step6UserEdit: JSON.stringify({ prompts: [{ target: "main", englishPrompt: "approved" }] }),
  } as ImageWorkflowSession;
}

describe("图片成果导出服务端资格合同", () => {
  it.each(["user", "admin", "designer", "ops_manager"]) ("%s不得调用下载接口", (role) => {
    expect(() => requireImageDeliverableAccess({ role, workspaceId: 7, project: { workspaceId: 7 } }))
      .toThrow("仅超级管理员");
  });

  it("超管只能导出当前授权工作空间的项目", () => {
    expect(() => requireImageDeliverableAccess({ role: "super_admin", workspaceId: 7, project: { workspaceId: 8 } }))
      .toThrow("当前已授权工作空间");
    expect(() => requireImageDeliverableAccess({ role: "super_admin", workspaceId: 7, project: { workspaceId: 7 } }))
      .not.toThrow();
  });

  it.each([0, 1, 2, 3, 4, 5, 6])("完整成果缺Step %i确认时拒绝", (step) => {
    const session = approved() as unknown as Record<string, unknown>;
    session[`step${step}Confirmed`] = 0;
    expect(() => requireApprovedImageSession(session as ImageWorkflowSession, "complete"))
      .toThrow(`Step ${step}`);
  });

  it("完整方案始终受Step0–6人审约束，Step6缺失时不降级为旧Step5导出", () => {
    const missingStep6 = { ...approved(), step6Confirmed: 0 };
    expect(() => requireApprovedImageSession(missingStep6, "complete")).toThrow("Step 6");
    expect(requireApprovedImageSession(approved(), "complete").step5UserEdit).toContain("approved");
  });

  it("无确认正文不能回退到AI草稿或旧优化候选", () => {
    const session = { ...approved(), step5UserEdit: null, step5OptimizedResult: JSON.stringify({ mainImage: { title: "draft" } }) };
    expect(() => requireApprovedImageSession(session, "complete")).toThrow("Step 5");
    const corrupted = { ...approved(), step4UserEdit: "{broken" };
    expect(() => requireApprovedImageSession(corrupted, "complete")).toThrow("Step 4");
  });

  it("未分类设计师图片不能随已确认方案作为我方素材导出", () => {
    const session = { ...approved(), step5DesignerUploads: JSON.stringify([{ imageUrl: "https://unknown.test/copied.png" }]) };
    expect(() => requireApprovedImageSession(session, "complete")).toThrow("来源与用途");
  });

  it("已确认Step0兼容无单独编辑；批准包剥离AI草稿与旧裸参考图并转义注入文本", () => {
    const session = approved();
    session.step2UserEdit = JSON.stringify({ images: [{ imageLabel: "<script>bad()</script>" }] });
    const result = requireApprovedImageSession(session, "complete");
    expect(result.step0UserEdit).toContain("research");
    expect(result.step5AiResult).toBeUndefined();
    expect(result.step4UserEdit).not.toContain("https://unverified.test");
    expect(result.step2UserEdit).toContain("&lt;script&gt;");
  });
  it("已批准成果的HTML下载不会执行注入文本，也不会把正常连接符二次转义", () => {
    const session = approved();
    session.step1UserEdit = JSON.stringify({ coreSellingPoints: [{ point: '<img src=x onerror="bad()"> & clarity' }] });
    const safe = requireApprovedImageSession(session, "complete");
    const html = buildFullPlanContent(safe);
    expect(html).not.toContain('<img src=x onerror="bad()">');
    expect(html).toContain('&lt;img src=x onerror=&quot;bad()&quot;&gt; &amp; clarity');
    expect(html).not.toContain('&amp;amp; clarity');
  });
});
