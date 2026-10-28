import { MysqlLeaderLock } from '../../_core/leaderLock';
import * as repository from '../../repositories';
import { ensureBusinessManagedRun, markBusinessManagedNodeRunning, markBusinessManagedNodeWaitingHuman } from '../ai_os/services/businessManagedAgent';
import { getAgentRun } from '../ai_os/services/agentRunner';
import { addEvent } from '../ai_os/services/agentRunner/checkpointStore';
import { rawExecute } from '../ai_os/routerContext';
import { LISTING_WORKFLOW_AGENT_SLUG, syncListingPreparationNodeConfirmed } from './listingAgentBridge';
import { readJson } from '../../../shared/competitorPresentation';

async function locked<T>(workspaceId: number | null, projectId: number, work: () => Promise<T>) {
  const lock = new MysqlLeaderLock(`listing-competitors:${workspaceId}:${projectId}`, 'listing');
  try {
    if (!(await lock.acquire(15)).acquired) throw new Error('竞品流程正在更新，请稍后重试');
    return await work();
  } finally { await lock.release(); }
}

export async function ensureCompetitorWorkflow(input: { businessId: number; workspaceId: number | null; userId: number }) {
  return locked(input.workspaceId, input.businessId, async () => {
    const { detail } = await ensureBusinessManagedRun({ agentSlug: LISTING_WORKFLOW_AGENT_SLUG, projectId: input.businessId, workspaceId: input.workspaceId, userId: input.userId, requireMutable: true });
    const records=await repository.getCompetitorAnalysesByProject(input.businessId);
    if(records.length)await syncListingPreparationNodeConfirmed({agentRunId:detail.run.runId,nodeId:'C1',projectId:input.businessId,workspaceId:input.workspaceId,userId:input.userId,output:records.map(r=>({id:r.id,asin:r.asin,title:r.title,bulletPoints:r.bulletPoints,rawData:r.rawData}))});
    return { agentRunId: detail.run.runId, agentNodeId: 'N1', dag: detail.dag };
  });
}

export function competitorSnapshot(analyses: any[]) {
  return analyses.map(a => ({ id: a.id, asin: a.asin, summary: a.summary || a.aiSummary || '', summaryStatus: a.summaryStatus, reviewAnalysis: a.reviewAnalysis, rawData: a.rawData }));
}

// Individual ASIN jobs remain independently retryable. N1 owns the aggregate,
// never a single job id that could overwrite another competitor's result.
export async function syncCompetitorWorkflow(input: { agentRunId: string; aiJobRunId?: string; phase?: 'running' | 'review' | 'failed'; error?: unknown }) {
  const detail = await getAgentRun(input.agentRunId, undefined, true);
  if (detail.run.agentSlug !== LISTING_WORKFLOW_AGENT_SLUG) return false;
  const run = detail.run;
  await locked(run.workspaceId, run.projectId, async () => {
    if (input.aiJobRunId) await addEvent(run.runId, run.agentSlug, 'N1', `competitor.${input.phase}`, '竞品分析任务更新', { aiJobRunId: input.aiJobRunId, error: input.error instanceof Error ? input.error.message : undefined });
    const analyses = await repository.getCompetitorAnalysesByProject(run.projectId);
    const active = await rawExecute(`SELECT j.runId FROM ai_jobs j WHERE j.workspaceId <=> ? AND j.projectId=? AND j.kind IN ('amazon.consumer.project_competitor.analyze','listing.competitor.presentation') AND j.status IN ('queued','running') AND j.runId<>?
      AND COALESCE((SELECT e.eventType FROM emperor_agent_events e WHERE e.runId=? AND e.nodeId='N1' AND e.eventType IN ('competitor.running','competitor.review','competitor.failed') AND JSON_UNQUOTE(JSON_EXTRACT(e.payload,'$.aiJobRunId'))=j.runId ORDER BY e.id DESC LIMIT 1),'') NOT IN ('competitor.review','competitor.failed')`, [run.workspaceId, run.projectId, input.aiJobRunId || '', run.runId]);
    const common = { runId: run.runId, dag: detail.dag, nodeId: 'N1', userId: run.userId };
    if (input.phase === 'running' || active.length) {
      await markBusinessManagedNodeRunning({ ...common, metadata: { activeCompetitorJobs: active.length + (input.phase === 'running' ? 1 : 0) } });
    } else if (analyses.length && analyses.every(a => {const raw=readJson(a.rawData)||{};return a.summaryStatus === 'confirmed' && !raw.captureOnly && !raw.analysisStale;}) && input.phase !== 'failed') {
      await syncListingPreparationNodeConfirmed({ agentRunId: run.runId, projectId: run.projectId, workspaceId: run.workspaceId, userId: run.userId, nodeId: 'N1', output: competitorSnapshot(analyses) });
    } else {
      await markBusinessManagedNodeWaitingHuman({ ...common, output: competitorSnapshot(analyses), metadata: { failedJobRunId: input.phase === 'failed' ? input.aiJobRunId : null } });
    }
  });
  return true;
}
