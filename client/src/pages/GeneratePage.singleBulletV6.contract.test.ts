import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./GeneratePage.tsx", import.meta.url), "utf8");
const skillLibrary = readFileSync(new URL("./emperor/EmperorSkillLibrary.tsx", import.meta.url), "utf8");
const editingRouter = readFileSync(new URL("../../../server/domains/listing/routers/editing.ts", import.meta.url), "utf8");

function between(start: string, end: string) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}

describe("卖点精雕v6前端人审和自检状态", () => {
  it("生成后保留人工确认；已确认卖点不被晚到任务覆盖", () => {
    expect(source).toContain('if (confirmedBullets[idx]) continue;');
    expect(source).toContain('实际生成 Skill：listing.bullet.step.generate v7');
    expect(source).toContain('if (!latestBulletsRef.current[idx] || bulletFingerprint(latestBulletsRef.current[idx]) !== bulletFingerprint(job.output))');
    expect(source).toContain('requestedBulletFingerprints.current.set(job.runId, requestedFingerprint)');
    expect(source).toContain('requestedFingerprint !== undefined && bulletFingerprint(latestBulletsRef.current[idx]) !== requestedFingerprint');
    expect(source).toContain('JSON.stringify(jobInput.sellingPoint) !== JSON.stringify(sellingPointCores[idx])');
  });
  it("人工编辑、重新优化和候选切换清理旧自检并撤销旧确认", () => {
    const edit = between("const handleSaveEditBullet", "const handleResetStepBullet");
    expect(edit).toContain("checkListScores: undefined");
    expect(edit).toContain("qualityAudit: undefined");
    expect(edit).toContain("keywordsUsed: []");
    expect(edit).toContain("replaceBulletDraft(idx,");
    expect(edit).toContain("setConfirmedBullets");
    const optimize = between("const handleOptimizeBullet", "const handleSaveEditBullet");
    expect(optimize).toContain("aiSemanticRelations: undefined");
    expect(optimize).toContain("replaceBulletDraft(idx, next)");
    expect(optimize).toContain("setConfirmedBullets");
    expect(source).toContain("latestBulletsRef.current = updated;\n    setGeneratedBullets(updated);");
    expect(source).toContain("setConfirmedBullets(prev => ({ ...prev, [idx]: false })); }}");
  });
  it("持久化评分绑定内容指纹，晚到自检结果不覆盖当前编辑", () => {
    expect(source).toContain('fingerprint: bulletFingerprint(bullet)');
    expect(source).toContain('(scores as any).fingerprint === bulletFingerprint(updated[Number(idx)])');
    expect(source).toContain("bulletFingerprint(latestBulletsRef.current[idx]) !== bulletFingerprint(bullet)");
    expect(source).toContain("evidenceUsed: bullet.evidenceUsed || []");
    expect(source).toContain("persistChecklistScores(updated);");
    expect(source).toContain("checklistSaveQueue.current = checklistSaveQueue.current.then");
  });
  it("显示与字符数同一分隔符，优化候选仅接受服务端v6合同", () => {
    expect(source).toContain('{" "}\n                                      <span className="text-muted-foreground">{generatedBullets[idx].fullText}');
    expect(source).toContain("generatedBullets[idx].keywordsUsed.map");
    expect(source).not.toContain("generatedBullets[idx].incorporatedKeywords.map");
    expect(editingRouter).toContain('skillSlug: "listing.bullet.step.generate"');
    expect(editingRouter).toContain("validateSingleBulletQuality(parsed, validationInput");
    expect(editingRouter).not.toContain('skillSlug: "listing.bullet.refine"');
  });
  it("Skill库准确区分手动试写与分步骤权威Skill", () => {
    expect(skillLibrary).toContain("手动单条试写（不驱动分步骤工作流）");
    expect(skillLibrary).toContain("分步骤卖点精雕工作流的实际生成 Skill");
  });
  it("显示实际模型和回退次数，旧记录不臆测Astra且人工修改有标识", () => {
    expect(source).toContain("本候选来源模型：${generatedBullets[idx].executionAudit.modelSlug}");
    expect(source).toContain('generatedBullets[idx].executionAudit.fallbackCount ?? "未记录"');
    expect(source).toContain("旧数据不推断为 GPT-6 Astra");
    expect(source).toContain("manuallyEdited: true");
  });
  it("确认核心前要求清除示例事实，重新编辑时旧草案仍可查看但不能确认", () => {
    expect(source).toContain("const safety = sanitizeSelectedSellingPoint(sellingPointCores?.[idx])");
    expect(source).toContain("!safety.canGenerate || safety.excludedFields.length > 0");
    expect(source).toContain("const handleReopenCore = (idx: number) =>");
    expect(source).toContain("staleSource: true");
    expect(source).toContain("(prev[idx] || []).map(candidate => ({ ...candidate, staleSource: true }))");
    expect(source).toContain("disabled={!!candidate.staleSource}");
    expect(source).toContain(".filter(candidate => !candidate.staleSource)");
    expect(source).toContain("generatedBullets[idx]?.staleSource");
    expect(source).toContain("coreBinding(idx)");
    expect(source).toContain("readOnlyHistory");
    expect(source).toContain("staleSource: !!latestBulletsRef.current[idx]?.staleSource");
    expect(source).toContain("if (current.staleSource) { toast.error");
    expect(source).toContain("const requestedCoreRevision = coreRevisionRef.current");
    expect(source).toContain("requestedCoreRevision !== coreRevisionRef.current || latestBulletsRef.current[idx]?.staleSource");
    expect(source).toContain('role="alert"');
  });
});
