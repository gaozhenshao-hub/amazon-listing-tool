import { beforeEach, describe, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({ ensure:vi.fn(), detail:vi.fn(), analyses:vi.fn(), sql:vi.fn(), event:vi.fn(), running:vi.fn(), review:vi.fn(), confirmed:vi.fn(), release:vi.fn() }));
vi.mock('../../_core/leaderLock',()=>({MysqlLeaderLock:class { acquire=async()=>({acquired:true}); release=m.release; }}));
vi.mock('../../repositories',()=>({getCompetitorAnalysesByProject:m.analyses}));
vi.mock('../ai_os/services/businessManagedAgent',()=>({ensureBusinessManagedRun:m.ensure,markBusinessManagedNodeRunning:m.running,markBusinessManagedNodeWaitingHuman:m.review}));
vi.mock('../ai_os/services/agentRunner',()=>({getAgentRun:m.detail}));
vi.mock('../ai_os/services/agentRunner/checkpointStore',()=>({addEvent:m.event}));
vi.mock('../ai_os/routerContext',()=>({rawExecute:m.sql}));
vi.mock('./listingAgentBridge',()=>({LISTING_WORKFLOW_AGENT_SLUG:'listing.full.workflow',syncListingPreparationNodeConfirmed:m.confirmed}));
import { ensureCompetitorWorkflow, syncCompetitorWorkflow } from './competitorWorkflow';
describe('merged Listing competitor stage',()=>{
 beforeEach(()=>{vi.clearAllMocks();const detail={run:{runId:'full-1',agentSlug:'listing.full.workflow',projectId:1,workspaceId:2,userId:3},dag:{nodes:[{id:'N1'}]}};m.detail.mockResolvedValue(detail);m.ensure.mockResolvedValue({detail});m.analyses.mockResolvedValue([{id:1,asin:'A',summary:'a',summaryStatus:'draft'},{id:2,asin:'B',summary:'b',summaryStatus:'confirmed'}]);m.sql.mockResolvedValue([]);});
 it('joins the full project run, without creating a standalone competitor template',async()=>{expect(await ensureCompetitorWorkflow({businessId:1,workspaceId:2,userId:3})).toMatchObject({agentRunId:'full-1',agentNodeId:'N1'});expect(m.ensure).toHaveBeenCalledWith(expect.objectContaining({agentSlug:'listing.full.workflow',projectId:1,requireMutable:true}));});
 it('keeps every ASIN in the draft and never confirms unreviewed results',async()=>{await syncCompetitorWorkflow({agentRunId:'full-1',aiJobRunId:'job-a',phase:'review'});expect(m.review).toHaveBeenCalledWith(expect.objectContaining({nodeId:'N1',output:expect.arrayContaining([expect.objectContaining({asin:'A'}),expect.objectContaining({asin:'B'})])}));expect(m.confirmed).not.toHaveBeenCalled();expect(m.review.mock.calls[0][0].aiJobRunId).toBeUndefined();});
 it('keeps the shared stage running while another ASIN is active',async()=>{m.sql.mockResolvedValue([{runId:'job-b'}]);await syncCompetitorWorkflow({agentRunId:'full-1',aiJobRunId:'job-a',phase:'review'});expect(m.running).toHaveBeenCalled();expect(m.review).not.toHaveBeenCalled();});
 it('publishes confirmed results for downstream steps only after review',async()=>{m.analyses.mockResolvedValue([{id:1,asin:'A',summaryStatus:'confirmed'}]);await syncCompetitorWorkflow({agentRunId:'full-1'});expect(m.confirmed).toHaveBeenCalledWith(expect.objectContaining({agentRunId:'full-1',nodeId:'N1'}));});
 it('preserves compatibility for historical standalone runs',async()=>{m.detail.mockResolvedValue({run:{agentSlug:'listing.amazon.competitor-analysis'}});expect(await syncCompetitorWorkflow({agentRunId:'legacy'})).toBe(false);expect(m.review).not.toHaveBeenCalled();});
 it('releases the project lock on failure',async()=>{m.sql.mockRejectedValue(new Error('db'));await expect(syncCompetitorWorkflow({agentRunId:'full-1'})).rejects.toThrow('db');expect(m.release).toHaveBeenCalled();});
});
