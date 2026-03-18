import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Loader2, PlusCircle, Link2, Upload, Video, CheckCircle, Edit3, Trash2, Sparkles, Search, Play, Clock, Tag, Zap, Timer } from "lucide-react";
import { toast } from "sonner";
import { TagEditor } from "@/components/TagEditor";
import { ScoreSlider } from "@/components/ScoreSlider";

const VIDEO_TAG_SUGGESTIONS = [
  "产品展示", "使用教程", "开箱视频", "对比测评", "场景演示",
  "品牌故事", "客户证言", "广告素材", "A+视频", "主图视频",
  "短视频", "长视频", "TikTok风格", "YouTube风格", "专业制作",
  "UGC风格", "动画制作", "实拍素材", "快节奏", "慢动作",
  "3C数码", "家居生活", "户外运动", "美妆个护", "母婴玩具",
];

export default function KBVideos() {
  const utils = trpc.useUtils();
  const { data: items, isLoading } = trpc.kbVideos.list.useQuery();
  const [showImport, setShowImport] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [asinInput, setAsinInput] = useState("");
  const [batchInput, setBatchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [editingAnalysis, setEditingAnalysis] = useState("");

  const { data: detail } = trpc.kbVideos.getById.useQuery({ id: detailId! }, { enabled: !!detailId });

  const importUrl = trpc.kbVideos.importByUrl.useMutation({
    onSuccess: () => { toast.success("已导入视频，AI正在分析..."); utils.kbVideos.list.invalidate(); setShowImport(false); setUrlInput(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const importAsin = trpc.kbVideos.importByAsin.useMutation({
    onSuccess: () => { toast.success("已导入ASIN视频，AI正在分析..."); utils.kbVideos.list.invalidate(); setShowImport(false); setAsinInput(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const batchImport = trpc.kbVideos.batchImportUrls.useMutation({
    onSuccess: (r: any) => { toast.success(`已导入 ${r.imported} 个视频`); utils.kbVideos.list.invalidate(); setShowImport(false); setBatchInput(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const [batchAsinInput, setBatchAsinInput] = useState("");
  const batchImportAsins = trpc.kbVideos.batchImportAsins.useMutation({
    onSuccess: (r: any) => { toast.success(`已导入 ${r.imported} 个ASIN视频`); utils.kbVideos.list.invalidate(); setShowImport(false); setBatchAsinInput(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const confirmMutation = trpc.kbVideos.confirmAnalysis.useMutation({
    onSuccess: () => { toast.success("已确认入库"); utils.kbVideos.list.invalidate(); utils.kbVideos.getById.invalidate({ id: detailId! }); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMutation = trpc.kbVideos.delete.useMutation({
    onSuccess: () => { toast.success("已删除"); utils.kbVideos.list.invalidate(); setDetailId(null); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateTagsMutation = trpc.kbVideos.updateTags?.useMutation?.({
    onSuccess: () => { toast.success("标签已更新"); utils.kbVideos.getById.invalidate({ id: detailId! }); utils.kbVideos.list.invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateScoreMutation = trpc.kbVideos.updateScore?.useMutation?.({
    onSuccess: () => { toast.success("评分已更新"); utils.kbVideos.getById.invalidate({ id: detailId! }); utils.kbVideos.list.invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });

  const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    crawling: { label: "爬取中", variant: "secondary" },
    transcribing: { label: "转写中", variant: "secondary" },
    analyzing: { label: "AI分析中", variant: "secondary" },
    pending_review: { label: "待确认", variant: "default" },
    confirmed: { label: "已入库", variant: "outline" },
  };

  const filtered = useMemo(() => {
    return (items as any[] || []).filter((item: any) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (item.title || "").toLowerCase().includes(q) || (item.asin || "").toLowerCase().includes(q) || (item.tags || "").toLowerCase().includes(q);
    });
  }, [items, searchQuery]);

  const getTags = (item: any): string[] => {
    const t = item.tags || "";
    return t.split(",").filter(Boolean).map((s: string) => s.trim());
  };

  const getGolden3s = (item: any) => {
    try {
      const analysis = JSON.parse(item.aiAnalysis || "{}");
      return analysis.golden3Seconds || analysis.goldenThreeSeconds || null;
    } catch { return null; }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Video className="h-6 w-6 text-red-500" />
            智能视频知识库
          </h1>
          <p className="text-muted-foreground text-sm mt-1">视频链接/ASIN导入，AI自动转写字幕并分析内容策略</p>
        </div>
        <Button onClick={() => setShowImport(true)} className="gap-2"><PlusCircle className="h-4 w-4" /> 导入视频</Button>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="搜索标题、ASIN、标签..." className="pl-9" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <Badge variant="secondary" className="h-9 px-3 flex items-center">{filtered.length} 个视频</Badge>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Video className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
            <p className="text-sm font-medium text-muted-foreground">暂无视频</p>
            <p className="text-xs text-muted-foreground mt-1">通过链接或ASIN导入视频，AI将自动转写并分析内容策略</p>
            <Button variant="outline" className="mt-4 gap-2" onClick={() => setShowImport(true)}><PlusCircle className="h-4 w-4" /> 导入第一个视频</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((item: any) => {
            const status = statusMap[item.status] || { label: item.status, variant: "secondary" as const };
            return (
              <Card key={item.id} className="cursor-pointer hover:shadow-md transition-all overflow-hidden" onClick={() => { setDetailId(item.id); setEditingAnalysis(""); }}>
                <div className="relative aspect-video bg-muted flex items-center justify-center">
                  {item.thumbnailUrl ? (
                    <img src={item.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Video className="h-10 w-10 text-muted-foreground/30" />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                    <div className="bg-black/50 rounded-full p-3"><Play className="h-6 w-6 text-white" /></div>
                  </div>
                  <Badge variant={status.variant} className="absolute top-2 right-2 text-xs">{status.label}</Badge>
                  {item.duration && (
                    <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {item.duration}
                    </div>
                  )}
                </div>
                <CardContent className="p-3">
                  <h3 className="font-medium text-sm line-clamp-2 mb-1">{item.title || "未命名视频"}</h3>
                  <div className="flex flex-wrap gap-1">
                    {item.asin && <Badge variant="outline" className="text-[10px] font-mono">{item.asin}</Badge>}
                    {item.videoType && <Badge variant="secondary" className="text-[10px]">{item.videoType}</Badge>}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Import Dialog */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>导入视频</DialogTitle></DialogHeader>
          <Tabs defaultValue="url">
            <TabsList className="w-full">
              <TabsTrigger value="url" className="flex-1 gap-1.5"><Link2 className="h-3.5 w-3.5" /> 链接导入</TabsTrigger>
              <TabsTrigger value="asin" className="flex-1 gap-1.5"><Upload className="h-3.5 w-3.5" /> ASIN导入</TabsTrigger>
              <TabsTrigger value="batch" className="flex-1 gap-1.5"><PlusCircle className="h-3.5 w-3.5" /> 批量链接</TabsTrigger>
              <TabsTrigger value="batchAsin" className="flex-1 gap-1.5"><PlusCircle className="h-3.5 w-3.5" /> 批量ASIN</TabsTrigger>
            </TabsList>
            <TabsContent value="url" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>输入视频链接</Label>
                <Textarea placeholder={"https://www.youtube.com/watch?v=...\nhttps://www.amazon.com/vdp/..."} value={urlInput} onChange={(e) => setUrlInput(e.target.value)} rows={4} />
                <p className="text-xs text-muted-foreground">支持YouTube、Amazon产品视频、TikTok等平台链接</p>
              </div>
              <Button onClick={() => importUrl.mutate({ videoUrl: urlInput })} disabled={importUrl.isPending || !urlInput} className="w-full gap-2">
                {importUrl.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Sparkles className="h-4 w-4" /> 导入并AI分析
              </Button>
            </TabsContent>
            <TabsContent value="asin" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>输入ASIN（自动采集产品视频）</Label>
                <Input placeholder="B0XXXXXXXXX" value={asinInput} onChange={(e) => setAsinInput(e.target.value)} className="font-mono" />
                <p className="text-xs text-muted-foreground">系统将自动爬取该ASIN的所有产品视频</p>
              </div>
              <Button onClick={() => importAsin.mutate({ asin: asinInput, videoUrl: `https://www.amazon.com/dp/${asinInput.trim()}` })} disabled={importAsin.isPending || !asinInput} className="w-full gap-2">
                {importAsin.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Sparkles className="h-4 w-4" /> 采集并AI分析
              </Button>
            </TabsContent>
            <TabsContent value="batch" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>批量输入视频链接（每行一个，最多20个）</Label>
                <Textarea placeholder={"https://youtube.com/watch?v=xxx\nhttps://youtube.com/watch?v=yyy"} value={batchInput} onChange={(e) => setBatchInput(e.target.value)} rows={6} className="text-sm" />
              </div>
              <Button onClick={() => {
                const urls = batchInput.split(/[\n]+/).map(s => s.trim()).filter(Boolean);
                if (urls.length === 0) return toast.error("请输入至少一个链接");
                batchImport.mutate({ videos: urls.map(u => ({ videoUrl: u })) });
              }} disabled={batchImport.isPending || !batchInput} className="w-full gap-2">
                {batchImport.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Sparkles className="h-4 w-4" /> 批量导入并AI分析
              </Button>
            </TabsContent>
            <TabsContent value="batchAsin" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>批量输入ASIN（每行一个，或逗号分隔，最多50个）</Label>
                <Textarea placeholder={"B0XXXXXXXXX\nB0YYYYYYYYY\nB0ZZZZZZZZZ"} value={batchAsinInput} onChange={(e) => setBatchAsinInput(e.target.value)} rows={6} className="font-mono text-sm" />
                <p className="text-xs text-muted-foreground">系统将自动采集每个ASIN的产品视频并进行AI分析</p>
              </div>
              <Button onClick={() => {
                const asins = batchAsinInput.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
                if (asins.length === 0) return toast.error("请输入至少一个ASIN");
                batchImportAsins.mutate({ asins });
              }} disabled={batchImportAsins.isPending || !batchAsinInput} className="w-full gap-2">
                {batchImportAsins.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Sparkles className="h-4 w-4" /> 批量采集并AI分析
              </Button>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detailId} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {detail ? (() => {
            const d = detail as any;
            const status = statusMap[d.status] || { label: d.status, variant: "secondary" as const };
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 flex-wrap">
                    <Video className="h-5 w-5 text-red-500" />
                    <span className="truncate">{d.title || "未命名视频"}</span>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {d.asin && <Badge variant="outline" className="font-mono">{d.asin}</Badge>}
                    {d.videoType && <Badge variant="secondary">{d.videoType}</Badge>}
                    {d.duration && <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {d.duration}</span>}
                    {d.sourceUrl && <a href={d.sourceUrl} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline truncate max-w-xs">原始链接</a>}
                  </div>
                  {/* Score Slider */}
                  <Card>
                    <CardContent className="pt-4 pb-3 px-4">
                      <ScoreSlider
                        value={d.overallScore || 50}
                        onChange={() => {}}
                        onSave={(val) => updateScoreMutation?.mutate?.({ id: d.id, score: val })}
                        min={1}
                        max={100}
                        label="视频综合评分"
                        disabled={!updateScoreMutation}
                      />
                    </CardContent>
                  </Card>

                  {/* Tag Editor */}
                  <Card>
                    <CardHeader className="pb-2 pt-3 px-4">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Tag className="h-4 w-4 text-red-500" />
                        标签管理
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      <TagEditor
                        tags={getTags(d)}
                        onChange={(newTags) => {
                          if (updateTagsMutation) {
                            updateTagsMutation.mutate({ id: d.id, tags: newTags.join(",") });
                          } else {
                            toast.info("标签更新功能即将上线");
                          }
                        }}
                        suggestions={VIDEO_TAG_SUGGESTIONS}
                        placeholder="添加标签（回车确认）..."
                      />
                    </CardContent>
                  </Card>

                  {/* Golden 3 Seconds Analysis */}
                  {(() => {
                    const g3s = getGolden3s(d);
                    if (!g3s) return null;
                    return (
                      <Card className="border-amber-200 bg-amber-50/30 dark:bg-amber-950/10 dark:border-amber-800">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <Timer className="h-4 w-4 text-amber-500" />
                            <span className="text-amber-700 dark:text-amber-400">黄金3秒分析</span>
                            <Zap className="h-3.5 w-3.5 text-amber-500" />
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm space-y-2">
                          {typeof g3s === "string" ? (
                            <p>{g3s}</p>
                          ) : (
                            <>
                              {g3s.hook && <p><strong>开场钩子:</strong> {g3s.hook}</p>}
                              {g3s.visualImpact && <p><strong>视觉冲击:</strong> {g3s.visualImpact}</p>}
                              {g3s.emotionalTrigger && <p><strong>情感触发:</strong> {g3s.emotionalTrigger}</p>}
                              {g3s.callToAction && <p><strong>行动号召:</strong> {g3s.callToAction}</p>}
                              {g3s.score && <p><strong>开场评分:</strong> <span className="text-amber-600 font-bold">{g3s.score}/10</span></p>}
                              {g3s.suggestion && <p className="text-muted-foreground italic border-l-2 border-amber-300 pl-3">{g3s.suggestion}</p>}
                            </>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })()}

                  {/* Transcription */}
                  {d.transcription && (
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">AI转写字幕</CardTitle></CardHeader>
                      <CardContent>
                        <div className="text-xs text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto">{d.transcription}</div>
                      </CardContent>
                    </Card>
                  )}
                  {/* AI Analysis */}
                  {d.aiAnalysis && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-red-500" /> AI内容分析
                          {d.status === "pending_review" && <Badge className="ml-auto text-xs">待确认</Badge>}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {editingAnalysis ? (
                          <Textarea rows={10} value={editingAnalysis} onChange={(e) => setEditingAnalysis(e.target.value)} className="text-xs" />
                        ) : (
                          <div className="text-sm whitespace-pre-wrap">{d.aiAnalysis}</div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                  <Separator />

                  <div className="flex gap-2 justify-end">
                    {d.status === "pending_review" && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setEditingAnalysis(editingAnalysis ? "" : (d.aiAnalysis || ""))} className="gap-1.5">
                          <Edit3 className="h-3.5 w-3.5" /> {editingAnalysis ? "取消编辑" : "编辑分析"}
                        </Button>
                        <Button size="sm" onClick={() => confirmMutation.mutate({ id: detailId!, editedAnalysis: editingAnalysis || undefined })} disabled={confirmMutation.isPending} className="gap-1.5">
                          {confirmMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                          确认入库
                        </Button>
                      </>
                    )}
                    <Button variant="destructive" size="sm" onClick={() => { if (confirm("确定删除？")) deleteMutation.mutate({ id: detailId! }); }} className="gap-1.5">
                      <Trash2 className="h-3.5 w-3.5" /> 删除
                    </Button>
                  </div>
                </div>
              </>
            );
          })() : (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
