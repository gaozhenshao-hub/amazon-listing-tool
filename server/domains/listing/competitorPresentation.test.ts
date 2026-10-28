import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ run: vi.fn(), getRecord: vi.fn(), getProject: vi.fn(), db: vi.fn(), startJob: vi.fn(), getJob: vi.fn() }));
vi.mock('../ai_os/services/skillRunner', () => ({ runEmperorSkill: mocks.run, safeParseSkillJSON: JSON.parse }));
vi.mock('../../repositories', () => ({ getCompetitorAnalysisById: mocks.getRecord, getProjectById: mocks.getProject }));
vi.mock('../../repositories/dbClient', () => ({ requireDb: mocks.db }));
vi.mock('../../services/aiJobRunner', () => ({ registerAiJobHandler: vi.fn(), startRegisteredAiJob: mocks.startJob, getAiJobRun: mocks.getJob, updateAiJobProgress: vi.fn() }));
vi.mock('../acquisition/legacyConsumerAgent', () => ({ startLegacyConsumerAgentRun: vi.fn(), markLegacyConsumerAgentRunning: vi.fn(), markLegacyConsumerAgentWaitingHuman: vi.fn(), markLegacyConsumerAgentFailed: vi.fn() }));
import { generateCompetitorPresentation, startCompetitorPresentation, validateReviewEvidence, validateTranslations } from './competitorPresentation';
const emptyReport = { overview: '样本仅供参考', positives: [], negatives: [], unmetNeeds: [], improvements: [] };
describe('competitor review and translation pipeline', () => {
  beforeEach(() => vi.clearAllMocks());
  it('rejects invented review evidence and incomplete translation mappings', () => {
    expect(() => validateReviewEvidence({ ...emptyReport, positives: [{ text: 'Excellent', reviewIds: ['invented'] }] }, ['real'])).toThrow('不存在');
    expect(() => validateTranslations({ translations: [{ id: 0, zh: '译文' }, { id: 0, zh: '重复' }] }, [0, 1])).toThrow();
    expect(() => validateTranslations({ translations: [{ id: 0, zh: '译文' }] }, [0, 1])).toThrow();
  });
  it('saves actual review analysis plus bilingual text while preserving confirmed human summaries', async () => {
    const record = { id: 4, projectId: 1, asin: 'B000000001', title: 'Good item', summary: 'Human approved', summaryStatus: 'confirmed', rawData: JSON.stringify({ brand: 'Brand', research: { variants: [], reviews: [{ id: 'r1', title: 'Nice', body: 'Works well', rating: 5 }] } }) };
    mocks.getRecord.mockResolvedValue(record);
    let update: any;
    const tx: any = { select: () => ({ from: () => ({ where: () => ({ for: async () => [record] }) }) }), update: () => ({ set: (data: any) => { update = data; return { where: async () => {} }; } }) };
    mocks.db.mockResolvedValue({ transaction: (fn: any) => fn(tx) });
    mocks.run.mockImplementation(async args => { const data = JSON.parse(args.context); return { parsed: args.validate(JSON.stringify(data.mode === 'reviews' ? { ...emptyReport, positives: [{ text: '使用效果好', reviewIds: ['r1'] }] } : { translations: data.entries.map((e: any) => ({ id: e.id, zh: '中文译文' })) })) }; });
    await generateCompetitorPresentation({ analysisId: 4, projectId: 1, workspaceId: 1, userId: 2 });
    expect(JSON.parse(update.reviewAnalysis).sampleCount).toBe(1);
    expect(JSON.parse(update.rawData).presentation.translations['Works well']).toBe('中文译文');
    expect(update).not.toHaveProperty('summary');
    expect(update).not.toHaveProperty('summaryStatus');
  });
  it('denies another owner before starting a background job', async () => {
    mocks.getProject.mockResolvedValue(null);
    await expect(startCompetitorPresentation({ analysisId: 4, projectId: 1, workspaceId: 1, userId: 7 })).rejects.toThrow('不可访问');
    expect(mocks.startJob).not.toHaveBeenCalled();
  });
  it('returns the existing running task instead of queuing another on refresh', async () => {
    mocks.getProject.mockResolvedValue({ workspaceId: 1 });
    const record = { id: 4, projectId: 1, rawData: JSON.stringify({ presentationJobRunId: 'existing' }) };
    mocks.db.mockResolvedValue({ transaction: (fn: any) => fn({ select: () => ({ from: () => ({ where: () => ({ for: async () => [record] }) }) }) }) });
    mocks.getJob.mockResolvedValue({ runId: 'existing', status: 'running' });
    expect(await startCompetitorPresentation({ analysisId: 4, projectId: 1, workspaceId: 1, userId: 2, retry: true })).toEqual({ runId: 'existing', status: 'running' });
    expect(mocks.startJob).not.toHaveBeenCalled();
  });
  it('keeps completed review analysis if a translation request later fails', async () => {
    const record = { id: 4, projectId: 1, asin: 'B000000001', title: 'English title', rawData: JSON.stringify({ research: { variants: [], reviews: [{ id: 'r1', title: 'Nice', body: 'Works well', rating: 5 }] } }) };
    mocks.getRecord.mockResolvedValue(record);
    let update: any;
    const tx: any = { select: () => ({ from: () => ({ where: () => ({ for: async () => [record] }) }) }), update: () => ({ set: (data: any) => { update = data; return { where: async () => {} }; } }) };
    mocks.db.mockResolvedValue({ transaction: (fn: any) => fn(tx) });
    mocks.run.mockImplementation(async args => { if (JSON.parse(args.context).mode === 'translate') throw Error('provider timeout'); return { parsed: args.validate(JSON.stringify(emptyReport)) }; });
    await expect(generateCompetitorPresentation({ analysisId: 4, projectId: 1, workspaceId: 1, userId: 2 })).rejects.toThrow('provider timeout');
    expect(JSON.parse(update.rawData).presentation.reviewAnalysisCompleted).toBe(true);
    expect(JSON.parse(update.rawData).presentation.version).toBe(0);
    expect(JSON.parse(update.reviewAnalysis).sampleCount).toBe(1);
  });
});
