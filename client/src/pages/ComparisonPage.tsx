import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useProject } from "@/contexts/ProjectContext";
import ProjectSelector from "@/components/ProjectSelector";
import { toast } from "sonner";
import ListingStages from "./listing/ListingStages";
import CompetitorStudyColumn from "./listing/CompetitorStudyColumn";
import { readJson } from "@shared/competitorPresentation";
import { competitorRichSlots } from "./listing/competitorLayout";

export default function ComparisonPage() {
  const { selectedProjectId } = useProject();
  const [busy, setBusy] = useState(false);
  const query = trpc.analysis.listByProject.useQuery({ projectId: selectedProjectId! }, {
    enabled: !!selectedProjectId,
    refetchInterval: q => q.state.data?.some(r => ["queued", "running"].includes(r.presentationJob?.status || "") ||
            ["queued", "running"].includes(r.videoJob?.status || "")) ? 5000 : false,
  });
  const analyze = trpc.analysis.analyzeCollected.useMutation();
  const aggregate = trpc.analysis.getAggregation.useQuery({projectId:selectedProjectId!},{enabled:!!selectedProjectId});
  const mark = trpc.analysis.markCompetitor.useMutation();
  const utils = trpc.useUtils();
  const all = query.data || [];
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); await query.refetch(); }
    catch (error) { toast.error(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }
  async function reanalyze(row: (typeof all)[number]) {
    if (!selectedProjectId) return;
    await act(async () => {
      await analyze.mutateAsync({ projectId: selectedProjectId, analysisId: row.id,
      });
      toast.success(`${row.asin} 已提交重新分析`);
    });
  }
  const rowCounts=all.reduce((counts,row)=>{
    const raw=readJson(row.rawData)||{}, assets=raw.imageAssets||[];
    const gallery=assets.filter((a:any)=>["main", "secondary"].includes(a.role)&&a.url).length+((raw.videos||[]).some((v:any)=>v.role=== "main")?1:0);
    return {gallery:Math.max(counts.gallery,gallery),bullets:Math.max(counts.bullets,(readJson(row.bulletPoints)||[]).length),aplus:Math.max(counts.aplus,competitorRichSlots(raw.sourceLayout,assets, "aplus").length),brand:Math.max(counts.brand,competitorRichSlots(raw.sourceLayout,assets, "brand_story").length),
      };
  },{gallery:0,bullets:0,aplus:0,brand:0});
  return (
    <div className="min-w-0 space-y-5">
    <ListingStages />
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
          <h1 className="text-2xl font-bold">Listing 对比及分析</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            所有已采集的竞品并排显示，可横向滚动对比。
          </p>
        </div>
      <ProjectSelector />
    </header>
    {query.error && <p role="alert">{query.error.message}</p>}
    {!selectedProjectId ? (
        <p>请先选择项目。</p>
      ) : !all.length && !query.isLoading ? (
        <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          请先在 Listing 抓取中采集竞品。
        </p>
      ) : (
        <div className="overflow-x-auto pb-4">
          <div className="grid gap-x-4" style={{ gridTemplateColumns: `repeat(${all.length}, minmax(${all.length === 1 ? "0" : "900px"}, 1fr))`,
            }}>
        {all.map((row,index) => (
              <CompetitorStudyColumn key={row.id} projectId={selectedProjectId} record={row} busy={busy || mark.isPending} rowCounts={rowCounts} columnIndex={index} onReanalyze={()=>reanalyze(row)}
          marks={aggregate.data?.data.marks.find(item=>item.analysisId===row.id)}
          onMark={async change=>{try{const result=await mark.mutateAsync({projectId:selectedProjectId,analysisId:row.id,change,
                    });utils.analysis.getAggregation.setData({projectId:selectedProjectId},result);}catch(error){toast.error(error instanceof Error?error.message:"保存标记失败");throw error;}}} />))}
      </div>
        </div>
      )}
  </div>
  );
}
