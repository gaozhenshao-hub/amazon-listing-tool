import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { competitorAnalyses } from '../../../drizzle/schema/project';
import { requireDb } from '../../repositories/dbClient';
import * as repository from '../../repositories';
import { competitorView, readJson, translationTexts, COMPETITOR_PRESENTATION_SKILL, COMPETITOR_PRESENTATION_PROMPT, COMPETITOR_PRESENTATION_VERSION } from '../../../shared/competitorPresentation';
import { loadConfirmedSnapshotForConsumer } from '../acquisition/legacyConsumerProjection';
import { runEmperorSkill, safeParseSkillJSON } from '../ai_os/services/skillRunner';
import { startLegacyConsumerAgentRun, markLegacyConsumerAgentRunning, markLegacyConsumerAgentWaitingHuman, markLegacyConsumerAgentFailed } from '../acquisition/legacyConsumerAgent';
import { registerAiJobHandler, startRegisteredAiJob, getAiJobRun, updateAiJobProgress } from '../../services/aiJobRunner';
import { loadSupplementalReviews, mergeImportedReviews } from './supplementalReviews';

const finding = z.object({ text: z.string().min(1).max(2000), reviewIds: z.array(z.string()).min(1).max(20) });
export const ReviewReportSchema = z.object({ overview: z.string().min(1).max(3000), positives: z.array(finding).max(8), negatives: z.array(finding).max(8), unmetNeeds: z.array(finding).max(8), improvements: z.array(finding).max(8) });
const TranslationSchema = z.object({ translations: z.array(z.object({ id: z.number().int().nonnegative(), zh: z.string().min(1).max(20000) })).max(100) });

export function validateReviewEvidence(value: unknown, reviewIds: string[]) {
  const report = ReviewReportSchema.parse(value);
  const allowed = new Set(reviewIds);
  for (const point of [...report.positives, ...report.negatives, ...report.unmetNeeds, ...report.improvements]) {
    if (point.reviewIds.some(id => !allowed.has(id))) throw new Error('评论分析引用了不存在的评论');
    point.reviewIds = [...new Set(point.reviewIds)];
  }
  return report;
}
export function validateTranslations(value: unknown, ids: number[]) {
  const result = TranslationSchema.parse(value).translations;
  if (result.length !== ids.length || new Set(result.map(v => v.id)).size !== ids.length || result.some(v => !ids.includes(v.id))) throw new Error('中文翻译缺少条目或对应关系不正确');
  return result;
}

export async function hydrateCompetitorEvidence<T extends { asin: string; rawData: string | null }>(record: T, workspaceId: number) {
  const raw = readJson(record.rawData) || {};
  if (!raw.confirmedSnapshotId || (raw.research && raw.description !== undefined && raw.imageAssets)) return record;
  const db = await requireDb('competitor evidence');
  const snapshot = await loadConfirmedSnapshotForConsumer({ db, workspaceId, confirmedSnapshotId: raw.confirmedSnapshotId });
  if (snapshot.data.asin !== record.asin) throw new Error('竞品数据来源不匹配');
  return { ...record, rawData: JSON.stringify({ ...raw, imageAssets:snapshot.assets.map(a=>({role:a.role,storageKey:a.storageKey})), subtitle: snapshot.data.subtitle || null, brand: snapshot.data.brand, research: snapshot.data.research, description: snapshot.data.description }) };
}

function sourceFingerprint(record: any) {
  const raw = readJson(record.rawData) || {};
  const { presentation, presentationJobRunId, ...source } = raw;
  return createHash('sha256').update(JSON.stringify([record.title, record.bulletPoints, record.keywords, source])).digest('hex');
}

export function needsCompetitorPresentation(record: any) {
  const view = competitorView(record);
  return view.presentation?.version !== COMPETITOR_PRESENTATION_VERSION || view.presentation?.sourceFingerprint !== sourceFingerprint(record)
    || translationTexts(view).some(text => !view.presentation?.translations?.[text]);
}

export async function generateCompetitorPresentation(input: { analysisId: number; workspaceId: number; userId: number; projectId: number; signal?: AbortSignal; onProgress?: (n: number) => Promise<unknown> }) {
  const base = await repository.getCompetitorAnalysisById(input.analysisId);
  if (!base || base.projectId !== input.projectId) throw new Error('竞品分析不存在');
  const hydrated = await hydrateCompetitorEvidence(base, input.workspaceId);
  const view = competitorView(hydrated);
  const fingerprint = sourceFingerprint(base);
  if (!needsCompetitorPresentation(base)) return { analysisId: base.id, cached: true };
  const imported = readJson(base.rawData)?.supplementalReviewCount ? await loadSupplementalReviews(input.projectId,base.asin) : [];
  const reviews = mergeImportedReviews(view.research?.reviews || [], imported);
  const run = async <T>(context: string, validate: (content: string) => T) => (await runEmperorSkill({
    skillSlug: COMPETITOR_PRESENTATION_SKILL, userId: input.userId, workspaceId: input.workspaceId,
    fallbackModels: [], maxModelAttempts: 1, signal: input.signal,
    context, variables: { context }, legacySystemPrompt: COMPETITOR_PRESENTATION_PROMPT,
    migrationSource: 'server/domains/listing/competitorPresentation.ts', validate,
  })).parsed;
  const previous = view.presentation?.sourceFingerprint === fingerprint ? view.presentation : null;
  let reviewReport: z.infer<typeof ReviewReportSchema> | null = previous?.reviewAnalysisCompleted ? previous.reviewReport : null;
  if (!previous?.reviewAnalysisCompleted && reviews.length) {
    const reports: z.infer<typeof ReviewReportSchema>[] = [];
    for (let offset=0;offset<reviews.length;) {
      const batch:any[]=[];let chars=0;
      while(offset<reviews.length&&batch.length<80&&(chars+JSON.stringify(reviews[offset]).length<26000||!batch.length)){const r=reviews[offset++];batch.push(r);chars+=JSON.stringify(r).length;}
      reports.push(await run(JSON.stringify({mode:'reviews',asin:base.asin,reviews:batch}),content=>validateReviewEvidence(safeParseSkillJSON(content),batch.map(r=>r.id))));
      await input.onProgress?.(36+Math.round(3*offset/reviews.length));
    }
    while(reports.length>1){
      const next:typeof reports=[];
      for(let i=0;i<reports.length;i+=6){const batch=reports.slice(i,i+6);const ids=batch.flatMap(r=>[...r.positives,...r.negatives,...r.unmetNeeds,...r.improvements].flatMap(p=>p.reviewIds));next.push(await run(JSON.stringify({mode:'reviews',instruction:'合并评论分批分析，保留原评论证据ID，不虚构数量或比例。输出同样的评论分析结构。',reports:batch}),content=>validateReviewEvidence(safeParseSkillJSON(content),ids)));}
      reports.splice(0,reports.length,...next);
    }
    reviewReport=reports[0];
  }
  const translations: Record<string, string> = { ...previous?.translations };
  const db = await requireDb('save competitor presentation');
  const persist = async (complete: boolean) => {
    input.signal?.throwIfAborted();
    await db.transaction(async tx => {
    const [current] = await tx.select().from(competitorAnalyses).where(and(eq(competitorAnalyses.id, base.id), eq(competitorAnalyses.projectId, input.projectId))).for('update');
    if (!current || sourceFingerprint(current) !== fingerprint) throw new Error('竞品内容已更新，请重新生成翻译和评论分析');
    const raw = readJson(current.rawData) || {};
    const presentation = { version: complete ? COMPETITOR_PRESENTATION_VERSION : 0, reviewAnalysisCompleted: true, sourceFingerprint: fingerprint, generatedAt: new Date().toISOString(), translations, reviewReport, sampleCount: reviews.length };
    await tx.update(competitorAnalyses).set({
      rawData: JSON.stringify({ ...raw, presentation }),
      ...(reviewReport ? { reviewAnalysis: JSON.stringify({
        ...reviewReport, sampleCount: reviews.length, source: 'review_sample',
        painPoints: reviewReport.negatives.map(p => ({ issue: p.text, reviewIds: p.reviewIds })),
        itchPoints: reviewReport.unmetNeeds.map(p => ({ desire: p.text, reviewIds: p.reviewIds })),
        delightPoints: reviewReport.positives.map(p => ({ feature: p.text, reviewIds: p.reviewIds })),
      }) } : {}),
    }).where(eq(competitorAnalyses.id, base.id));
    });
  };
  await persist(false);
  await input.onProgress?.(40);
  const texts = translationTexts(view).filter(text => !translations[text]);
  // Save each translated batch so a timeout never discards completed analysis.
  for (let offset = 0; offset < texts.length;) {
    const entries: Array<{ id: number; text: string }> = [];
    let chars = 0;
    while (offset < texts.length && entries.length < 35 && (chars + texts[offset].length <= 7000 || entries.length === 0)) {
      entries.push({ id: offset, text: texts[offset] }); chars += texts[offset].length; offset++;
    }
    const translated = await run(JSON.stringify({ mode: 'translate', entries }), content => validateTranslations(safeParseSkillJSON(content), entries.map(e => e.id)));
    for (const item of translated) translations[texts[item.id]] = item.zh;
    await persist(false);
    await input.onProgress?.(40 + Math.round(45 * offset / Math.max(1, texts.length)));
  }
  await persist(true);
  return { analysisId: base.id, reviewCount: reviews.length, translatedCount: texts.length };
}

export async function startCompetitorPresentation(input: { analysisId: number; projectId: number; workspaceId: number; userId: number; retry?: boolean }) {
  const project = await repository.getProjectById(input.projectId, input.userId);
  if (!project || (project.workspaceId && project.workspaceId !== input.workspaceId)) throw new Error('项目不可访问');
  const db = await requireDb('start competitor presentation');
  return db.transaction(async tx => {
    const [record] = await tx.select().from(competitorAnalyses).where(and(eq(competitorAnalyses.id, input.analysisId), eq(competitorAnalyses.projectId, input.projectId))).for('update');
    if (!record) throw new Error('竞品分析不存在');
    const raw = readJson(record.rawData) || {};
    if (!needsCompetitorPresentation(record)) return { status: 'succeeded', runId: null };
    if (raw.presentationJobRunId) {
      const previous = await getAiJobRun(raw.presentationJobRunId);
      if (previous && (['queued', 'running'].includes(previous.status) || (['failed', 'canceled'].includes(previous.status) && !input.retry))) return { status: previous.status, runId: previous.runId };
    }
    const agent = await startLegacyConsumerAgentRun({ consumerType: 'project_competitor', businessId: input.projectId, workspaceId: input.workspaceId, userId: input.userId, confirmedSnapshotId: raw.confirmedSnapshotId, analysisId: record.id, asin: record.asin });
    const job = await startRegisteredAiJob({ kind: 'listing.competitor.presentation', module: 'listing', procedure: 'analysis.preparePresentation', userId: input.userId, workspaceId: input.workspaceId, projectId: input.projectId, skillSlug: COMPETITOR_PRESENTATION_SKILL,
      input: { ...input, agentRunId: agent.agentRunId, agentNodeId: agent.agentNodeId }, queueName: 'analysis', maxAttempts: 1, timeoutSeconds: 900 });
    await tx.update(competitorAnalyses).set({ rawData: JSON.stringify({ ...raw, presentationJobRunId: job.runId }) }).where(eq(competitorAnalyses.id, record.id));
    return { status: job.status, runId: job.runId };
  });
}

registerAiJobHandler({ id: 'competitor-bilingual-reviews-v1', match: job => job.kind === 'listing.competitor.presentation', handler: async (job, { signal }) => {
  const input = z.object({ analysisId: z.number().int().positive(), projectId: z.number().int().positive(), workspaceId: z.number().int().positive(), userId: z.number().int().positive(), agentRunId: z.string(), agentNodeId: z.string() }).parse(job.input);
  const agent = { consumerType: 'project_competitor' as const, agentRunId: input.agentRunId, aiJobRunId: job.runId, attempt: job.attempt };
  await markLegacyConsumerAgentRunning(agent);
  try {
    const output = await generateCompetitorPresentation({ ...input, signal, onProgress: n => updateAiJobProgress(job.runId, n) });
    await markLegacyConsumerAgentWaitingHuman({ ...agent, output });
    return output;
  } catch (error) { await markLegacyConsumerAgentFailed({ ...agent, finalAttempt: true, error }).catch(() => null); throw error; }
} });
