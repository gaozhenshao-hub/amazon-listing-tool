import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(import.meta.dirname, "PreviewPage.tsx"), "utf8");

describe("Listing预览人审与出库隔离", () => {
  it("不再通过浏览器本地生成未经审核的CSV/报告，也不切换旧Artifact当前指针", () => {
    expect(source).not.toContain("createObjectURL");
    expect(source).not.toContain("trpc.report.generateReport");
    expect(source).not.toContain("BusinessArtifactVersionPicker");
    expect(source).toContain("直接下载报告/CSV与旧产物指针选版已暂停");
  });

  it("旧五点仅可查看；编辑入口指向事实/核心/候选人审工作台，不写原Listing", () => {
    expect(source).not.toContain("handleSaveSingleBullet");
    expect(source).not.toContain("handleSaveBulletPointsRaw");
    expect(source).not.toContain("confirmPreview.mutate");
    expect(source).toContain('setLocation("/listing/generate")');
  });

  it("恢复只枚举已确认完整快照，先取服务端CAS预览，再只提交签名令牌", () => {
    expect(source).toContain("listGovernedCompleteRestoreSnapshots.useQuery");
    expect(source).toContain("previewGovernedCompleteRestore.useQuery");
    expect(source).toContain("restoreGovernedCompleteSnapshot.useMutation");
    expect(source).toContain("governedRestoreMutation.mutate({ restoreToken })");
    expect(source).not.toContain("rollbackToVersion");
    expect(source).not.toContain("rollbackMutation");
    expect(source).not.toContain("rollbackConfirmId");
  });

  it("恢复预览显式呈现全字段影响、版本差异，并在失败或刷新时清除陈旧令牌", () => {
    expect(source).toContain("COMPLETE_RESTORE_FIELD_GROUPS");
    expect(source).toContain("英文 Listing");
    expect(source).toContain("中文 Listing");
    expect(source).toContain("图片建议");
    expect(source).toContain("QA 与审核状态");
    expect(source).toContain("服务端检测到的版本差异");
    expect(source).toContain("clearGovernedRestorePreview();");
    expect(source).toContain("isGovernedRestorePreviewExpired");
    expect(source).toContain("没有可恢复的已确认完整快照");
  });
});
