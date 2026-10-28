import { createHash } from "node:crypto";
import type {
  SkillDraftContent,
  SkillWorkbenchDraft,
} from "../../../../shared/skillWorkbench";

export const workbenchHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function assertWorkbenchRevision(
  draft: SkillWorkbenchDraft,
  revision: number
) {
  if (draft.revision !== revision)
    throw new Error("草稿已在其他窗口更新，请刷新后再操作。");
  if (draft.status === "running")
    throw new Error("上一次请求尚未完成，请查看运行记录，不要重复提交。");
  if (draft.status === "published")
    throw new Error("此草稿已经发布，请新建调教草稿。");
}
export function assertWorkbenchPublishable(
  draft: SkillWorkbenchDraft,
  currentBaseHash: string
) {
  if (draft.baseHash !== currentBaseHash)
    throw new Error("正式技能已更新，请基于新版本重新测试。");
  const hash = workbenchHash(draft.content);
  if (
    !draft.tests.some(
      test => !test.baseline && test.approved && test.promptHash === hash
    )
  ) {
    throw new Error("请先测试当前草稿，并确认至少一个结果符合要求。");
  }
}
/** Only prompt fields can be changed by a coaching response; tools and providers remain server-owned. */
export function candidateManifest(
  manifest: Record<string, unknown>,
  content: SkillDraftContent
) {
  return {
    ...manifest,
    implementation: {
      ...((manifest.implementation as Record<string, unknown>) ?? {}),
      ...content,
    },
  };
}
