import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import ProjectSelector from "@/components/ProjectSelector";
import { useProject } from "@/contexts/ProjectContext";
import {
  AlertTriangle,
  BarChart3,
  Key,
  MessageSquare,
  Star,
  DollarSign,
  TrendingUp,
  ArrowUpDown,
  CheckCircle2,
  XCircle,
  Minus,
  Package,
  Sparkles,
  Loader2,
  Copy,
  Check,
  FilePenLine,
  LockKeyhole,
  Save,
  UnlockKeyhole,
  X,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { MERGED_READONLY_FEATURES_ENABLED } from "@/lib/mergedReadOnlyFeatures";
import { SellingPointSourceEvidence } from "./listing/SellingPointSourceEvidence";
import { MERGED_LISTING_WORKFLOW_ENABLED } from "@/lib/mergedListingWorkflow";
import ListingStages from "./listing/ListingStages";
import CompetitorStudyComparison from "./listing/CompetitorStudyComparison";
import CompetitorResearchJobs from "./listing/CompetitorResearchJobs";
import { competitorStudy, matchesComparisonSelection, type CompetitorStudyRecord } from "./listing/competitorStudyModel";

// Type for parsed analysis data
interface ParsedAnalysis {
  id: number;
  asin: string;
  title: string;
  brand: string;
  price: string;
  rating: string;
  reviewCount: string;
  bulletPoints: string[];
  keywords: {
    core: Array<{ keyword: string } | string>;
    longTail: Array<{ keyword: string } | string>;
    traffic: Array<{ keyword: string } | string>;
  } | null;
  reviewAnalysis: {
    painPoints: Array<{ issue: string; frequency?: string; severity?: string }>;
    itchPoints: Array<{ desire: string; importance?: string }>;
    delightPoints: Array<{ feature: string; impact?: string }>;
  } | null;
  rawData: any;
  isManual: boolean;
}

interface ComparisonSellingPointRow {
  id: string;
  theme: string;
  competitorPoints: Array<{
    analysisId: number;
    asin: string;
    bulletIndex: number;
    text: string;
  }>;
  aiRecommendation: string;
  humanNote: string;
  selected: boolean;
}

interface ComparisonReport {
  id: number;
  projectId: number;
  selectionKey: string;
  analysisIds: number[];
  analyzedAsins: string[];
  aiSummary: string;
  summary: string;
  sellingPointRows: ComparisonSellingPointRow[];
  status: "draft" | "confirmed";
  version: number;
  confirmedAt: Date | string | null;
  reportRevision?: string;
  sourceHash?: string;
}
const reportToken = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const reportHasTokens = (value: ComparisonReport | null): value is ComparisonReport & { reportRevision: string; sourceHash: string } => !!value && reportToken(value.reportRevision) && reportToken(value.sourceHash);

function parseJson(str: string | null): any {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

function getKeywordText(k: any): string {
  return typeof k === "string" ? k : k?.keyword || k?.term || String(k);
}

function parseAnalysis(analysis: any): ParsedAnalysis {
  const keywords = parseJson(analysis.keywords);
  const reviewAnalysis = parseJson(analysis.reviewAnalysis);
  const rawData = parseJson(analysis.rawData);
  const bulletPoints = parseJson(analysis.bulletPoints) || [];

  return {
    id: analysis.id,
    asin: analysis.asin,
    title: analysis.title || "未知标题",
    brand: rawData?.scrapedData?.brand || rawData?.brand || "-",
    price: analysis.price || "-",
    rating: analysis.rating || "-",
    reviewCount: analysis.reviewCount || rawData?.scrapedData?.reviewCount?.toString() || "-",
    bulletPoints,
    keywords,
    reviewAnalysis,
    rawData,
    isManual: rawData?.manualInput === true,
  };
}

// Color palette for ASIN badges
const ASIN_COLORS = [
  "bg-blue-100 text-blue-800 border-blue-200",
  "bg-emerald-100 text-emerald-800 border-emerald-200",
  "bg-purple-100 text-purple-800 border-purple-200",
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-rose-100 text-rose-800 border-rose-200",
  "bg-cyan-100 text-cyan-800 border-cyan-200",
  "bg-indigo-100 text-indigo-800 border-indigo-200",
  "bg-orange-100 text-orange-800 border-orange-200",
];

// AI Summary Section Component
function AISummarySection({
  selectedAnalyses,
  report,
  summaryDraft,
  isEditing,
  onSummaryChange,
  onGenerate,
  isGenerating,
  generationDisabled,
}: {
  selectedAnalyses: ParsedAnalysis[];
  report: ComparisonReport | null;
  summaryDraft: string;
  isEditing: boolean;
  onSummaryChange: (summary: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  generationDisabled: boolean;
}) {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    if (!summaryDraft) return;
    try {
      await navigator.clipboard.writeText(summaryDraft);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <div className="space-y-4">
      {/* Generate Button Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                AI 竞品对比总结
              </CardTitle>
              <CardDescription className="mt-1">
                基于已选的 {selectedAnalyses.length} 个竞品分析数据，AI将自动提炼关键差异、发现市场机会并生成优化建议
              </CardDescription>
            </div>
            <Button
              onClick={onGenerate}
              disabled={generationDisabled || isGenerating || selectedAnalyses.length < 2 || report?.status === "confirmed"}
              className="shrink-0"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  AI 分析中...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  {report ? "重新生成结构化对比" : "生成结构化对比"}
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        {isGenerating && (
          <CardContent className="pt-0">
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span>正在分析 {selectedAnalyses.length} 个竞品数据，提炼关键差异和优化建议...</span>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                <div className="bg-primary h-full rounded-full animate-pulse" style={{ width: "60%" }} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                {["分析价格与评分差异", "对比关键词覆盖", "提炼用户痛点机会"].map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                    {step}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Error Display */}
      {/* Summary Result */}
      {report && (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                分析报告
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {report.status === "confirmed" ? "已确认" : "待确认"} · 已分析 {selectedAnalyses.map(a => a.asin).join(", ")}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  className="h-7 text-xs"
                >
                  {isCopied ? (
                    <><Check className="h-3 w-3 mr-1" />已复制</>
                  ) : (
                    <><Copy className="h-3 w-3 mr-1" />复制报告</>
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4">
            {isEditing ? (
              <Textarea
                value={summaryDraft}
                onChange={event => onSummaryChange(event.target.value)}
                rows={18}
                className="min-h-[360px] resize-y font-mono text-sm leading-6"
                placeholder="编辑市场概览、关键差异、关键词机会、用户机会、卖点策略和行动清单"
              />
            ) : (
              <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-foreground/90 prose-strong:text-foreground prose-li:text-foreground/90 prose-table:text-sm">
                <Streamdown>{summaryDraft}</Streamdown>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!report && !isGenerating && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Sparkles className="h-8 w-8 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-sm">点击上方「生成AI总结」按钮，获取竞品差异分析报告</p>
            <p className="text-muted-foreground text-xs mt-1">报告将包含市场概览、关键差异、关键词机会、痛点分析和优化建议</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SellingPointMatrix({
  selectedAnalyses,
  rows,
  isEditing,
  onChange,
  colorIndexFor,
}: {
  selectedAnalyses: ParsedAnalysis[];
  rows: ComparisonSellingPointRow[];
  isEditing: boolean;
  onChange: (rows: ComparisonSellingPointRow[]) => void;
  colorIndexFor: (analysisId: number) => number;
}) {
  const updateRow = (rowIndex: number, patch: Partial<ComparisonSellingPointRow>) => {
    onChange(rows.map((row, index) => index === rowIndex ? { ...row, ...patch } : row));
  };

  const updatePoint = (rowIndex: number, analysisId: number, text: string) => {
    onChange(rows.map((row, index) => index !== rowIndex ? row : {
      ...row,
      competitorPoints: row.competitorPoints.map(point => (
        point.analysisId === analysisId ? { ...point, text } : point
      )),
    }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">同卖点语义对比</CardTitle>
        <CardDescription>
          AI 按卖点含义归并到同一行；在最右侧补充人工判断，并勾选需要传给 Listing 与图片建议的优秀点
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="w-full">
          <div style={{ minWidth: `${260 + selectedAnalyses.length * 300 + 320}px` }}>
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b">
                  <th className="sticky left-0 z-20 w-[260px] bg-card px-4 py-3 text-left font-medium text-muted-foreground">
                    卖点主题 / AI判断
                  </th>
                  {selectedAnalyses.map(analysis => (
                    <th key={analysis.id} className="w-[300px] px-4 py-3 text-left font-medium">
                      <Badge className={`border font-mono text-xs ${ASIN_COLORS[colorIndexFor(analysis.id) % ASIN_COLORS.length]}`}>
                        {analysis.asin}
                      </Badge>
                    </th>
                  ))}
                  <th className="sticky right-0 z-20 w-[320px] border-l bg-card px-4 py-3 text-left font-medium text-muted-foreground">
                    人工备注 / 优秀点确认
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={row.id} className="border-b align-top hover:bg-muted/20">
                    <td className="sticky left-0 z-10 bg-card px-4 py-4">
                      {isEditing ? (
                        <div className="space-y-2">
                          <Input
                            value={row.theme}
                            onChange={event => updateRow(rowIndex, { theme: event.target.value })}
                            aria-label={`第 ${rowIndex + 1} 行卖点主题`}
                          />
                          <Textarea
                            value={row.aiRecommendation}
                            onChange={event => updateRow(rowIndex, { aiRecommendation: event.target.value })}
                            rows={4}
                            className="resize-y text-xs"
                            placeholder="AI判断与表达建议"
                          />
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="font-semibold">{row.theme}</p>
                          <p className="text-xs leading-relaxed text-muted-foreground">{row.aiRecommendation || "暂无 AI 建议"}</p>
                        </div>
                      )}
                    </td>
                    {selectedAnalyses.map(analysis => {
                      const point = row.competitorPoints.find(item => item.analysisId === analysis.id);
                      return (
                        <td key={analysis.id} className="px-4 py-4">
                          {!point ? (
                            <span className="text-xs italic text-muted-foreground">该竞品未表达此卖点</span>
                          ) : (
                            <div className="space-y-2">
                              {isEditing ? (
                                <Textarea
                                  value={point.text}
                                  onChange={event => updatePoint(rowIndex, analysis.id, event.target.value)}
                                  rows={7}
                                  className="resize-y text-xs leading-5"
                                  aria-label={`${analysis.asin} 的 ${row.theme}`}
                                />
                              ) : (
                                <div>
                                  <p className="text-xs leading-relaxed">{point.text}</p>
                                  <span className="mt-2 inline-block text-[10px] text-muted-foreground">
                                    {MERGED_READONLY_FEATURES_ENABLED
                                      ? `对比文本 · ${point.text.length} 字符`
                                      : `原五点第 ${point.bulletIndex + 1} 条 · ${point.text.length} 字符`}
                                  </span>
                                </div>
                              )}
                              {MERGED_READONLY_FEATURES_ENABLED && (
                                <SellingPointSourceEvidence point={point} analysis={analysis} />
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="sticky right-0 z-10 border-l bg-card px-4 py-4">
                      <div className="space-y-3">
                        <label className="flex items-center gap-2 text-xs font-medium">
                          <Checkbox
                            checked={row.selected}
                            disabled={!isEditing}
                            onCheckedChange={checked => updateRow(rowIndex, { selected: checked === true })}
                          />
                          提取为优秀点
                        </label>
                        {isEditing ? (
                          <Textarea
                            value={row.humanNote}
                            onChange={event => updateRow(rowIndex, { humanNote: event.target.value })}
                            rows={6}
                            className="resize-y text-xs leading-5"
                            placeholder="写下值得借鉴的表达、数据证据、需规避的问题或本品差异化方向"
                          />
                        ) : (
                          <p className="min-h-16 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                            {row.humanNote || "暂无人工备注"}
                          </p>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export default function ComparisonPage() {
  const { selectedProjectId } = useProject();
  const auth = useAuth();
  const scopeKey = auth.user ? JSON.stringify([auth.user.id, auth.user.defaultWorkspaceId, auth.user.role, selectedProjectId]) : null;
  const boundary = useRef({ scopeKey, epoch: 0 }), shown = useRef<object | null>(null);
  if (boundary.current.scopeKey !== scopeKey) boundary.current = { scopeKey, epoch: boundary.current.epoch + 1 };
  const token = boundary.current;
  if (auth.error || !auth.user) { shown.current = null; return <p role="alert">请先确认登录状态，未读取竞品数据。</p>; }
  const { id, defaultWorkspaceId, role } = auth.user;
  if (!Number.isSafeInteger(id) || id <= 0 || typeof role !== "string" || !role.trim() || (defaultWorkspaceId !== null
    && (typeof defaultWorkspaceId !== "number" || !Number.isSafeInteger(defaultWorkspaceId) || defaultWorkspaceId <= 0))) {
    return <p role="alert">当前用户 / 工作区信息不完整，未读取竞品数据。</p>;
  }
  if (!selectedProjectId || !Number.isSafeInteger(selectedProjectId) || selectedProjectId <= 0) {
    return <div className="space-y-4">{MERGED_LISTING_WORKFLOW_ENABLED && <ListingStages />}<ProjectSelector /><p>请先在项目管理中创建并选择一个项目</p></div>;
  }
  // Remount all selection, drafts and callbacks; never reuse a project-only shared cache across users/workspaces.
  if (!auth.loading) shown.current = token;
  if (auth.loading && shown.current !== token) return <p role="status">正在确认登录状态…</p>;
  return <>{auth.loading && <p role="status">正在确认登录状态，当前草稿暂时保留…</p>}
    <div hidden={auth.loading}><OwnedComparisonPage key={`${scopeKey}:${token.epoch}`} selectedProjectId={selectedProjectId} workspaceId={defaultWorkspaceId} suspended={auth.loading} /></div></>;
}

function OwnedComparisonPage({ selectedProjectId, workspaceId, suspended }: { selectedProjectId: number; workspaceId: number | null; suspended: boolean }) {
  const client = trpc.useUtils().client;
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  // Research is not the legacy 2–8 record comparison-report selection.
  const [researchSelectedIds, setResearchSelectedIds] = useState<Set<number>>(new Set());
  const [report, setReport] = useState<ComparisonReport | null>(null);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [sellingPointRows, setSellingPointRows] = useState<ComparisonSellingPointRow[]>([]);
  const [isEditingReport, setIsEditingReport] = useState(false);
  const [analyses, setAnalyses] = useState<Awaited<ReturnType<typeof client.analysis.listByProject.query>>>();
  const [isLoading, setIsLoading] = useState(true), [readError, setReadError] = useState(false);
  const [readGeneration, setReadGeneration] = useState(0), [reportGeneration, setReportGeneration] = useState(0);
  const [comparisonReportQuery, setReportRead] = useState({ isFetching: false, isError: false });
  const [pendingReportAction, setPendingReportAction] = useState<string | null>(null);
  const [pendingStudyIds, setPendingStudyIds] = useState<Set<number>>(new Set());
  const [reportNeedsReview, setReportNeedsReview] = useState(false), [freshReport, setFreshReport] = useState<ComparisonReport | null>(null);
  const alive = useRef(false), selectionEpoch = useRef(0), draftRevision = useRef(0), dirty = useRef(false);
  const sourceEpoch = useRef(0);
  const adoptionDrafts = useRef(new Set<number>());
  const reportActionLock = useRef(false), studyLocks = useRef(new Set<number>());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(), sourceTicket = sourceEpoch.current; let current = true;
    setIsLoading(true); setReadError(false);
    void client.analysis.listByProject.query({ projectId: selectedProjectId, expectedWorkspaceId: workspaceId }, { signal: controller.signal }).then(rows => {
      if (current && alive.current && sourceTicket === sourceEpoch.current) setAnalyses(rows);
    }).catch(() => { if (current && alive.current) setReadError(true); })
      .finally(() => { if (current && alive.current) setIsLoading(false); });
    // Abort is best-effort; the current/alive guards also reject late responses when transport ignores it.
    return () => { current = false; controller.abort(); };
  }, [client, selectedProjectId, workspaceId, readGeneration]);

  const selectedAnalysisIds = useMemo(
    () => Array.from(selectedIds).sort((a, b) => a - b),
    [selectedIds],
  );
  const selectionKey = selectedAnalysisIds.join("-");
  const researchAnalysisIds = useMemo(() => Array.from(researchSelectedIds)
    .filter(id => analyses?.some(row => row.id === id)).sort((a, b) => a - b), [analyses, researchSelectedIds]);

  const applyReport = useCallback((nextReport: ComparisonReport | null, editing = false) => {
    dirty.current = false; draftRevision.current++;
    setReportNeedsReview(false); setFreshReport(null);
    setReport(nextReport);
    setSummaryDraft(nextReport?.summary || "");
    setSellingPointRows(nextReport?.sellingPointRows || []);
    setIsEditingReport(editing);
  }, []);

  useEffect(() => {
    if (selectedAnalysisIds.length < 2) return;
    const controller = new AbortController(), epoch = selectionEpoch.current, revision = draftRevision.current, sourceTicket = sourceEpoch.current;
    let current = true;
    setReportRead({ isFetching: true, isError: false });
    void client.analysis.getComparisonReport.query({ projectId: selectedProjectId, expectedWorkspaceId: workspaceId, analysisIds: selectedAnalysisIds }, { signal: controller.signal }).then(value => {
      if (!current || !alive.current || epoch !== selectionEpoch.current || sourceTicket !== sourceEpoch.current) return;
      if (value !== null && !matchesComparisonSelection(value, selectedProjectId, selectedAnalysisIds)) throw new Error("REPORT_SCOPE_MISMATCH");
      if (!dirty.current && !reportActionLock.current && revision === draftRevision.current) applyReport(value as ComparisonReport | null);
      else if (dirty.current && !reportActionLock.current) {
        setFreshReport(value as ComparisonReport | null); setReportNeedsReview(true);
      }
    }).catch(() => { if (current && alive.current && epoch === selectionEpoch.current) setReportRead({ isFetching: false, isError: true }); })
      .finally(() => { if (current && alive.current && epoch === selectionEpoch.current) setReportRead(previous => ({ ...previous, isFetching: false })); });
    return () => { current = false; controller.abort(); };
  }, [client, selectedProjectId, workspaceId, selectedAnalysisIds, selectionKey, reportGeneration, applyReport]);

  function changeSelection(next: Set<number>) {
    selectionEpoch.current++; reportActionLock.current = false;
    setPendingReportAction(null); setReportRead({ isFetching: false, isError: false });
    applyReport(null); setSelectedIds(next);
  }
  function editSummary(value: string) { dirty.current = true; draftRevision.current++; setSummaryDraft(value); }
  function editRows(value: ComparisonSellingPointRow[]) { dirty.current = true; draftRevision.current++; setSellingPointRows(value); }
  function beginEditing() { dirty.current = true; setIsEditingReport(true); }
  function salesSaved() {
    // This page owns its reads, rather than a project-only shared query cache.
    // Refresh actual sources and report CAS without replacing an edited report.
    sourceEpoch.current++; setReportNeedsReview(true); setFreshReport(null);
    setReadGeneration(value => value + 1); setReportGeneration(value => value + 1);
  }
  function changeResearchSelection(next: Set<number>) {
    if ([...adoptionDrafts.current].some(id => !next.has(id)) && !window.confirm("取消选择会丢弃该竞品未提交的人工采纳摘要；未决原请求编号仍保留。是否继续？")) return;
    setResearchSelectedIds(next);
  }
  async function runReportAction(kind: "generate" | "save" | "confirm" | "unlock") {
    if (reportActionLock.current || selectedAnalysisIds.length < 2 || (kind !== "generate" && !report)) return;
    if (kind === "generate" && (dirty.current || report?.status === "confirmed" || reportNeedsReview)) return;
    if (kind !== "generate" && (!reportHasTokens(report) || reportNeedsReview || comparisonReportQuery.isError || comparisonReportQuery.isFetching)) return;
    const epoch = selectionEpoch.current, revision = draftRevision.current, sourceTicket = sourceEpoch.current;
    reportActionLock.current = true; setPendingReportAction(kind);
    try {
      const input = { projectId: selectedProjectId, expectedWorkspaceId: workspaceId, reportId: report?.id ?? 0, summary: summaryDraft, sellingPointRows,
        expectedReportRevision: report?.reportRevision ?? "", expectedSourceHash: report?.sourceHash ?? "" };
      const value = kind === "generate" ? (await client.analysis.comparisonSummary.mutate({ projectId: selectedProjectId, expectedWorkspaceId: workspaceId, analysisIds: selectedAnalysisIds })).report
        : kind === "save" ? await client.analysis.updateComparisonReport.mutate(input)
          : kind === "confirm" ? await client.analysis.confirmComparisonReport.mutate(input)
            : await client.analysis.unlockComparisonReport.mutate({ projectId: selectedProjectId, expectedWorkspaceId: workspaceId, reportId: input.reportId,
              expectedReportRevision: input.expectedReportRevision, expectedSourceHash: input.expectedSourceHash });
      if (!alive.current || epoch !== selectionEpoch.current) return;
      if (sourceTicket !== sourceEpoch.current) { setReportNeedsReview(true); toast.info("期间销量来源已变化，原回执未覆盖草稿；请刷新并核对当前对比版本"); return; }
      if (!matchesComparisonSelection(value, selectedProjectId, selectedAnalysisIds) || !reportHasTokens(value as ComparisonReport)
        || (kind !== "generate" && (value?.id !== report?.id || value?.sourceHash !== input.expectedSourceHash))) throw new Error("REPORT_SCOPE_MISMATCH");
      if (revision === draftRevision.current) {
        applyReport(value as ComparisonReport, kind === "unlock");
        if (kind === "unlock") dirty.current = true;
      } else toast.info("请求已完成，期间编辑的本地草稿已保留，请核对后再保存");
      toast.success(kind === "generate" ? "结构化竞品对比已生成" : kind === "save" ? "竞品对比草稿已保存" : kind === "confirm" ? "竞品对比已确认并锁定" : "竞品对比已解锁");
    } catch (error) {
      if (alive.current && epoch === selectionEpoch.current) {
        setReportNeedsReview(true); setFreshReport(null);
        toast.error("对比操作未确认完成", { description: "草稿已保留，请刷新并核对范围、来源和版本；系统不会自动重试。" });
      }
    } finally {
      if (alive.current && epoch === selectionEpoch.current) { reportActionLock.current = false; setPendingReportAction(null); }
    }
  }
  const reportMutationPending = pendingReportAction !== null;
  const reportReviewDisabled = reportMutationPending || reportNeedsReview || comparisonReportQuery.isFetching || comparisonReportQuery.isError || !reportHasTokens(report);
  const updateReportMutation = { isPending: pendingReportAction === "save" };
  const confirmReportMutation = { isPending: pendingReportAction === "confirm" };
  const unlockReportMutation = { isPending: pendingReportAction === "unlock" };
  const saveReport = () => { void runReportAction("save"); };
  const confirmReport = () => { void runReportAction("confirm"); };
  async function reviewStudy(analysis: CompetitorStudyRecord, action: "confirm" | "unlock") {
    const current = analyses?.find(row => row.id === analysis.id && row.asin === analysis.asin);
    if (!current || !researchSelectedIds.has(current.id) || studyLocks.current.has(current.id)) return;
    const study = competitorStudy(current);
    if (action === "confirm" ? !study.canConfirm : !study.canUnlock) return;
    if (typeof current.revision !== "string" || !/^[a-f0-9]{64}$/u.test(current.revision)) {
      toast.error("竞品版本信息不完整，请刷新后再操作"); return;
    }
    studyLocks.current.add(current.id); setPendingStudyIds(new Set(studyLocks.current));
    try {
      const input = { projectId: selectedProjectId, analysisId: current.id, expectedWorkspaceId: workspaceId, expectedRevision: current.revision };
      if (action === "confirm") await client.analysis.confirmSummary.mutate({ ...input, summary: study.summary });
      else await client.analysis.unlockSummary.mutate(input);
      if (alive.current) setReadGeneration(value => value + 1);
    } catch (error) {
      if (alive.current) toast.error("摘要操作未完成", { description: error instanceof Error ? error.message : "请刷新核对，系统不会自动重试" });
    } finally { studyLocks.current.delete(current.id); if (alive.current) setPendingStudyIds(new Set(studyLocks.current)); }
  }

  // Parse selected analyses
  const selectedAnalyses = useMemo(() => {
    if (!analyses) return [];
    return analyses
      .filter(a => selectedIds.has(a.id))
      .map(parseAnalysis);
  }, [analyses, selectedIds]);

  // Toggle selection
  const toggleSelection = (id: number) => {
      const next = new Set(selectedIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= 8) return; // Max 8 items
        next.add(id);
      }
      changeSelection(next);
  };

  // Select all / deselect all
  const toggleAll = () => {
    if (!analyses) return;
    if (selectedIds.size === analyses.length || selectedIds.size >= 8) {
      changeSelection(new Set());
    } else {
      changeSelection(new Set(analyses.slice(0, 8).map(a => a.id)));
    }
  };

  // Compute shared and unique keywords
  const keywordComparison = useMemo(() => {
    if (selectedAnalyses.length < 2) return null;

    const allKeywordSets = selectedAnalyses.map(a => {
      const kws = new Set<string>();
      if (a.keywords) {
        (a.keywords.core || []).forEach((k: any) => kws.add(getKeywordText(k).toLowerCase()));
        (a.keywords.longTail || []).forEach((k: any) => kws.add(getKeywordText(k).toLowerCase()));
        (a.keywords.traffic || []).forEach((k: any) => kws.add(getKeywordText(k).toLowerCase()));
      }
      return kws;
    });

    // Shared: in ALL selected
    const shared = new Set<string>();
    if (allKeywordSets.length > 0) {
      Array.from(allKeywordSets[0]).forEach(kw => {
        if (allKeywordSets.every(set => set.has(kw))) {
          shared.add(kw);
        }
      });
    }

    // Unique per ASIN
    const uniquePerAsin = selectedAnalyses.map((a, idx) => {
      const unique = new Set<string>();
      Array.from(allKeywordSets[idx]).forEach(kw => {
        const inOthers = allKeywordSets.some((set, j) => j !== idx && set.has(kw));
        if (!inOthers) unique.add(kw);
      });
      return { asin: a.asin, keywords: unique };
    });

    return { shared, uniquePerAsin };
  }, [selectedAnalyses]);

  // Compute pain points comparison
  const painPointComparison = useMemo(() => {
    if (selectedAnalyses.length < 2) return null;

    const allPainPoints = new Map<string, Set<string>>();
    selectedAnalyses.forEach(a => {
      if (a.reviewAnalysis?.painPoints) {
        a.reviewAnalysis.painPoints.forEach(p => {
          const key = p.issue.toLowerCase().trim();
          if (!allPainPoints.has(key)) allPainPoints.set(key, new Set());
          allPainPoints.get(key)!.add(a.asin);
        });
      }
    });

    // Sort by frequency (how many ASINs share the pain point)
    const sorted = Array.from(allPainPoints.entries())
      .sort((a, b) => b[1].size - a[1].size);

    return sorted;
  }, [selectedAnalyses]);

  return (
    <div className="space-y-6">
      {MERGED_LISTING_WORKFLOW_ENABLED && <ListingStages />}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">竞品对比</h1>
          <p className="text-muted-foreground mt-1">
            选择多个已分析的ASIN进行并排比较，发现竞品差异和机会
          </p>
        </div>
        <div className="flex items-center gap-2"><Button variant="outline" onClick={() => { setReadGeneration(value => value + 1); setReportGeneration(value => value + 1); }}>刷新已保存研究</Button><ProjectSelector /></div>
      </div>

      {MERGED_LISTING_WORKFLOW_ENABLED && !isLoading && !readError && !!analyses?.length && <section aria-label="研究竞品选择" className="space-y-3 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">选择并排研究 ASIN</h2>
          <p className="text-xs text-muted-foreground">可选择任意多个已保存竞品。此范围用于下方资料分析与并排审阅，不改变旧结构化报告的 2–8 个选择或生成页已确认的范围。</p></div>
          <Button variant="outline" size="sm" onClick={() => changeResearchSelection(researchAnalysisIds.length === analyses.length ? new Set() : new Set(analyses.map(row => row.id)))}>
            {researchAnalysisIds.length === analyses.length ? "清空研究选择" : "选择全部研究竞品"}</Button></div>
        <p className="text-sm">研究已选 {researchAnalysisIds.length}/{analyses.length}</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{analyses.map(row => <label key={row.id} className="flex items-start gap-2 rounded border p-3 text-sm">
          <Checkbox aria-label={`研究选择 ${row.asin}`} checked={researchSelectedIds.has(row.id)} onCheckedChange={checked => {
            const next = new Set(researchSelectedIds); if (checked === true) next.add(row.id); else next.delete(row.id); changeResearchSelection(next);
          }} /><span><strong>{row.asin}</strong><span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">{row.title || "未保存标题"}</span></span>
        </label>)}</div>
      </section>}

      {MERGED_LISTING_WORKFLOW_ENABLED && <CompetitorResearchJobs projectId={selectedProjectId} workspaceId={workspaceId}
        analyses={!isLoading && !readError ? analyses || [] : []} selectedIds={researchAnalysisIds}
        onCompleted={() => setReadGeneration(value => value + 1)} />}

      {isLoading && <div className="space-y-4">{[1, 2].map(i => <Card key={i}><CardContent className="p-6"><div className="h-20 bg-muted animate-pulse rounded" /></CardContent></Card>)}</div>}
      <div hidden={isLoading}>
      {!selectedProjectId ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertTriangle className="h-8 w-8 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">请先在项目管理中创建并选择一个项目</p>
          </CardContent>
        </Card>
      ) : readError ? (
        <p role="alert">竞品读取失败，未将错误当作空数据；请刷新核对当前权限与项目。</p>
      ) : !analyses || analyses.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <BarChart3 className="h-8 w-8 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">暂无竞品分析数据</p>
            <p className="text-muted-foreground text-xs mt-1">请先在竞品分析页面分析至少2个ASIN</p>
          </CardContent>
        </Card>
      ) : analyses.length < 2 && !MERGED_LISTING_WORKFLOW_ENABLED ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <BarChart3 className="h-8 w-8 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">至少需要2个竞品分析结果才能进行对比</p>
            <p className="text-muted-foreground text-xs mt-1">当前有 {analyses.length} 个分析结果，请再分析更多ASIN</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* ASIN Selector */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ArrowUpDown className="h-4 w-4" />
                    选择对比ASIN
                  </CardTitle>
                  <CardDescription className="mt-1">
                    选择2-8个已分析的ASIN进行并排对比
                  </CardDescription>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">
                    已选 {selectedIds.size}/{Math.min(analyses.length, 8)}
                  </Badge>
                  <Button variant="outline" size="sm" onClick={toggleAll}>
                    {selectedIds.size > 0 ? "取消全选" : "全选"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {analyses.map((analysis, idx) => {
                  const isSelected = selectedIds.has(analysis.id);
                  const colorClass = ASIN_COLORS[idx % ASIN_COLORS.length];
                  const rawData = parseJson(analysis.rawData);
                  const isManual = rawData?.manualInput === true;

                  return (
                    <div
                      key={analysis.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border-2 transition-all cursor-pointer hover:shadow-sm ${
                        isSelected
                          ? "border-primary bg-primary/5 shadow-sm"
                          : "border-transparent bg-muted/30 hover:bg-muted/50"
                      }`}
                      onClick={() => toggleSelection(analysis.id)}
                    >
                      <Checkbox
                        aria-label={`选择 ${analysis.asin}`}
                        checked={isSelected}
                        onClick={event => event.stopPropagation()}
                        onCheckedChange={() => toggleSelection(analysis.id)}
                        className="mt-0.5 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={`font-mono text-xs border ${colorClass}`}>
                            {analysis.asin}
                          </Badge>
                          {isManual && (
                            <Badge variant="secondary" className="text-[10px] h-4 px-1">手动</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {analysis.title || "未知标题"}
                        </p>
                        <div className="flex items-center gap-3 mt-1.5">
                          {analysis.price && (
                            <span className="text-xs font-medium">{analysis.price}</span>
                          )}
                          {analysis.rating && (
                            <span className="text-xs flex items-center gap-0.5">
                              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                              {analysis.rating}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {MERGED_LISTING_WORKFLOW_ENABLED && <CompetitorStudyComparison
            projectId={selectedProjectId}
            analyses={analyses.filter(row => researchSelectedIds.has(row.id))}
            pendingIds={pendingStudyIds}
            onResearchCompleted={() => setReadGeneration(value => value + 1)}
            onSalesSaved={salesSaved}
            onAdopted={salesSaved}
            suspended={suspended || isLoading}
            onAdoptionDirtyChange={(id, dirty) => { if (dirty) adoptionDrafts.current.add(id); else adoptionDrafts.current.delete(id); }}
            onConfirm={analysis => { void reviewStudy(analysis, "confirm"); }}
            onUnlock={analysis => { void reviewStudy(analysis, "unlock"); }}
          />}
          {comparisonReportQuery.isError && <p role="alert">历史对比报告读取失败或范围不匹配；未覆盖本地草稿，请刷新核对。</p>}
          {dirty.current && <p role="status" className="text-sm text-amber-700">本地编辑中的报告已保留，刷新不会覆盖。切换所选竞品会离开此草稿。</p>}
          {report && !reportHasTokens(report) && <p role="alert">对比报告缺少可核验的版本／来源标识，仅供查看；请重新读取后再保存、确认或解锁。</p>}
          {reportNeedsReview && <p role="alert">销量来源或报告版本需要重新核对，当前对比草稿已保留，写入已暂停。</p>}
          {freshReport && reportHasTokens(freshReport) && <div className="space-y-2 rounded border p-3"><details><summary>查看重新读取的报告原文与版本</summary><p>v{freshReport.version} · {freshReport.status === "confirmed" ? "已确认" : "待确认"}</p><p className="whitespace-pre-wrap">{freshReport.summary}</p></details>
            <Button variant="outline" disabled={reportMutationPending || comparisonReportQuery.isFetching || comparisonReportQuery.isError} onClick={() => {
              if (reportActionLock.current) return; setReport(freshReport); setFreshReport(null); setReportNeedsReview(false); draftRevision.current++;
            }}>采用已读取对比版本，保留本地草稿</Button></div>}

          {/* Comparison Results */}
          {selectedAnalyses.length >= 2 && (
            <Tabs defaultValue="overview" className="space-y-4">
              {report && (
                <div className="flex flex-wrap items-center justify-between gap-3 border bg-card px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Badge variant={report.status === "confirmed" ? "default" : "secondary"} className="gap-1">
                      {report.status === "confirmed"
                        ? <LockKeyhole className="h-3 w-3" />
                        : <FilePenLine className="h-3 w-3" />}
                      {report.status === "confirmed" ? "已确认" : "待确认"} · v{report.version}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      已提取 {sellingPointRows.filter(row => row.selected).length} 个优秀点
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {report.status === "confirmed" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={reportReviewDisabled}
                        onClick={() => { void runReportAction("unlock"); }}
                      >
                        {unlockReportMutation.isPending
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <UnlockKeyhole className="h-4 w-4" />}
                        解锁编辑
                      </Button>
                    ) : isEditingReport ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={reportMutationPending}
                          onClick={() => { const stillNeedsReview = reportNeedsReview && !freshReport; applyReport(freshReport ?? report); setReportNeedsReview(stillNeedsReview); }}
                        >
                          <X className="h-4 w-4" />
                          取消
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={reportReviewDisabled || !summaryDraft.trim()}
                          onClick={saveReport}
                        >
                          {updateReportMutation.isPending
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Save className="h-4 w-4" />}
                          保存草稿
                        </Button>
                        <Button
                          size="sm"
                          disabled={reportReviewDisabled || !summaryDraft.trim()}
                          onClick={confirmReport}
                        >
                          {confirmReportMutation.isPending
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Check className="h-4 w-4" />}
                          确认并锁定
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" onClick={beginEditing}>
                          <FilePenLine className="h-4 w-4" />
                          编辑
                        </Button>
                        <Button size="sm" disabled={reportReviewDisabled} onClick={confirmReport}>
                          {confirmReportMutation.isPending
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <CheckCircle2 className="h-4 w-4" />}
                          确认结果
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
              <TabsList>
                <TabsTrigger value="overview">
                  <Package className="h-3.5 w-3.5 mr-1.5" />
                  基本信息
                </TabsTrigger>
                <TabsTrigger value="keywords">
                  <Key className="h-3.5 w-3.5 mr-1.5" />
                  关键词对比
                </TabsTrigger>
                <TabsTrigger value="reviews">
                  <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                  评论分析对比
                </TabsTrigger>
                <TabsTrigger value="bullets">
                  <TrendingUp className="h-3.5 w-3.5 mr-1.5" />
                  五点描述对比
                </TabsTrigger>
                <TabsTrigger value="ai-summary">
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                  AI智能总结
                </TabsTrigger>
              </TabsList>

              {/* Overview Tab */}
              <TabsContent value="overview">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">基本信息对比</CardTitle>
                    <CardDescription>
                      价格、评分、品牌、标题长度等基本指标的并排比较
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ScrollArea className="w-full">
                      <div className="min-w-[600px]">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left py-3 px-4 font-medium text-muted-foreground w-[140px] sticky left-0 bg-card z-10">
                                指标
                              </th>
                              {selectedAnalyses.map((a, idx) => (
                                <th key={a.id} className="text-left py-3 px-4 font-medium min-w-[180px]">
                                  <Badge className={`font-mono text-xs border ${ASIN_COLORS[analyses?.findIndex(x => x.id === a.id) ?? idx % ASIN_COLORS.length]}`}>
                                    {a.asin}
                                  </Badge>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {/* Title */}
                            <tr className="border-b hover:bg-muted/30">
                              <td className="py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-card z-10">标题</td>
                              {selectedAnalyses.map(a => (
                                <td key={a.id} className="py-3 px-4">
                                  <p className="text-xs leading-relaxed line-clamp-3">{a.title}</p>
                                  <span className={`text-[10px] mt-1 inline-block ${
                                    a.title.length >= 180 && a.title.length <= 200 ? "text-green-600" :
                                    a.title.length > 200 ? "text-red-600" : "text-amber-600"
                                  }`}>
                                    {a.title.length} 字符
                                  </span>
                                </td>
                              ))}
                            </tr>
                            {/* Brand */}
                            <tr className="border-b hover:bg-muted/30">
                              <td className="py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-card z-10">品牌</td>
                              {selectedAnalyses.map(a => (
                                <td key={a.id} className="py-3 px-4 font-medium">{a.brand}</td>
                              ))}
                            </tr>
                            {/* Price */}
                            <tr className="border-b hover:bg-muted/30">
                              <td className="py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-card z-10">
                                <div className="flex items-center gap-1.5">
                                  <DollarSign className="h-3.5 w-3.5" />
                                  价格
                                </div>
                              </td>
                              {selectedAnalyses.map(a => {
                                const prices = selectedAnalyses
                                  .map(x => parseFloat(x.price.replace(/[^0-9.]/g, "")))
                                  .filter(p => !isNaN(p));
                                const currentPrice = parseFloat(a.price.replace(/[^0-9.]/g, ""));
                                const minPrice = Math.min(...prices);
                                const maxPrice = Math.max(...prices);
                                const isLowest = !isNaN(currentPrice) && currentPrice === minPrice && prices.length > 1;
                                const isHighest = !isNaN(currentPrice) && currentPrice === maxPrice && prices.length > 1;

                                return (
                                  <td key={a.id} className="py-3 px-4">
                                    <span className={`font-semibold text-base ${
                                      isLowest ? "text-green-600" : isHighest ? "text-red-600" : ""
                                    }`}>
                                      {a.price}
                                    </span>
                                    {isLowest && <Badge variant="secondary" className="ml-2 text-[10px] h-4 px-1 bg-green-100 text-green-700">最低</Badge>}
                                    {isHighest && <Badge variant="secondary" className="ml-2 text-[10px] h-4 px-1 bg-red-100 text-red-700">最高</Badge>}
                                  </td>
                                );
                              })}
                            </tr>
                            {/* Rating */}
                            <tr className="border-b hover:bg-muted/30">
                              <td className="py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-card z-10">
                                <div className="flex items-center gap-1.5">
                                  <Star className="h-3.5 w-3.5" />
                                  评分
                                </div>
                              </td>
                              {selectedAnalyses.map(a => {
                                const ratings = selectedAnalyses
                                  .map(x => parseFloat(x.rating))
                                  .filter(r => !isNaN(r));
                                const currentRating = parseFloat(a.rating);
                                const maxRating = Math.max(...ratings);
                                const isBest = !isNaN(currentRating) && currentRating === maxRating && ratings.length > 1;

                                return (
                                  <td key={a.id} className="py-3 px-4">
                                    <div className="flex items-center gap-2">
                                      <div className="flex items-center gap-1">
                                        {[1, 2, 3, 4, 5].map(star => {
                                          const val = parseFloat(a.rating);
                                          return (
                                            <Star
                                              key={star}
                                              className={`h-3.5 w-3.5 ${
                                                !isNaN(val) && star <= Math.round(val)
                                                  ? "fill-amber-400 text-amber-400"
                                                  : "text-muted-foreground/30"
                                              }`}
                                            />
                                          );
                                        })}
                                      </div>
                                      <span className="font-semibold">{a.rating}</span>
                                      {isBest && <Badge variant="secondary" className="text-[10px] h-4 px-1 bg-amber-100 text-amber-700">最高</Badge>}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                            {/* Review Count */}
                            <tr className="border-b hover:bg-muted/30">
                              <td className="py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-card z-10">评论数</td>
                              {selectedAnalyses.map(a => (
                                <td key={a.id} className="py-3 px-4">{a.reviewCount}</td>
                              ))}
                            </tr>
                            {/* Bullet Points Count */}
                            <tr className="border-b hover:bg-muted/30">
                              <td className="py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-card z-10">五点数量</td>
                              {selectedAnalyses.map(a => (
                                <td key={a.id} className="py-3 px-4">{a.bulletPoints.length} 条</td>
                              ))}
                            </tr>
                            {/* Data Source */}
                            <tr className="hover:bg-muted/30">
                              <td className="py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-card z-10">数据来源</td>
                              {selectedAnalyses.map(a => (
                                <td key={a.id} className="py-3 px-4">
                                  <Badge variant={a.isManual ? "outline" : "secondary"} className="text-xs">
                                    {a.isManual ? "手动输入" : "自动爬取"}
                                  </Badge>
                                </td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Keywords Tab */}
              <TabsContent value="keywords">
                <div className="space-y-4">
                  {/* Shared Keywords */}
                  {keywordComparison && (
                    <>
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            共同关键词
                            <Badge variant="secondary" className="ml-1">{keywordComparison.shared.size}</Badge>
                          </CardTitle>
                          <CardDescription>
                            所有选中竞品都包含的关键词，代表品类核心词
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          {keywordComparison.shared.size > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {Array.from(keywordComparison.shared).map(kw => (
                                <Badge key={kw} variant="default" className="text-xs">
                                  {kw}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">未发现完全共同的关键词</p>
                          )}
                        </CardContent>
                      </Card>

                      {/* Unique Keywords per ASIN */}
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">
                            <XCircle className="h-4 w-4 text-blue-500" />
                            独有关键词
                          </CardTitle>
                          <CardDescription>
                            每个竞品独有的关键词，代表差异化卖点
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <div className="space-y-4">
                            {keywordComparison.uniquePerAsin.map((item, idx) => (
                              <div key={item.asin}>
                                <div className="flex items-center gap-2 mb-2">
                                  <Badge className={`font-mono text-xs border ${ASIN_COLORS[analyses?.findIndex(a => a.asin === item.asin) ?? idx % ASIN_COLORS.length]}`}>
                                    {item.asin}
                                  </Badge>
                                  <Badge variant="secondary" className="text-xs">{item.keywords.size} 个独有</Badge>
                                </div>
                                {item.keywords.size > 0 ? (
                                  <div className="flex flex-wrap gap-1.5 ml-2">
                                    {Array.from(item.keywords).map(kw => (
                                      <Badge key={kw} variant="outline" className="text-xs">
                                        {kw}
                                      </Badge>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-muted-foreground ml-2">无独有关键词</p>
                                )}
                                {idx < keywordComparison.uniquePerAsin.length - 1 && (
                                  <Separator className="mt-3" />
                                )}
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </>
                  )}

                  {/* Per-ASIN Keyword Breakdown */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">各竞品关键词详情</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="w-full">
                        <div className="min-w-[600px]">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b">
                                <th className="text-left py-3 px-4 font-medium text-muted-foreground w-[120px] sticky left-0 bg-card z-10">
                                  类型
                                </th>
                                {selectedAnalyses.map((a, idx) => (
                                  <th key={a.id} className="text-left py-3 px-4 font-medium min-w-[200px]">
                                    <Badge className={`font-mono text-xs border ${ASIN_COLORS[analyses?.findIndex(x => x.id === a.id) ?? idx % ASIN_COLORS.length]}`}>
                                      {a.asin}
                                    </Badge>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {/* Core Keywords */}
                              <tr className="border-b hover:bg-muted/30">
                                <td className="py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-card z-10">核心词</td>
                                {selectedAnalyses.map(a => (
                                  <td key={a.id} className="py-3 px-4">
                                    <div className="flex flex-wrap gap-1">
                                      {a.keywords?.core?.map((k: any, i: number) => (
                                        <Badge key={i} variant="default" className="text-[10px]">
                                          {getKeywordText(k)}
                                        </Badge>
                                      )) || <span className="text-xs text-muted-foreground">-</span>}
                                    </div>
                                  </td>
                                ))}
                              </tr>
                              {/* Long-tail Keywords */}
                              <tr className="border-b hover:bg-muted/30">
                                <td className="py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-card z-10">长尾词</td>
                                {selectedAnalyses.map(a => (
                                  <td key={a.id} className="py-3 px-4">
                                    <div className="flex flex-wrap gap-1">
                                      {a.keywords?.longTail?.map((k: any, i: number) => (
                                        <Badge key={i} variant="secondary" className="text-[10px]">
                                          {getKeywordText(k)}
                                        </Badge>
                                      )) || <span className="text-xs text-muted-foreground">-</span>}
                                    </div>
                                  </td>
                                ))}
                              </tr>
                              {/* Traffic Keywords */}
                              <tr className="hover:bg-muted/30">
                                <td className="py-3 px-4 font-medium text-muted-foreground sticky left-0 bg-card z-10">流量词</td>
                                {selectedAnalyses.map(a => (
                                  <td key={a.id} className="py-3 px-4">
                                    <div className="flex flex-wrap gap-1">
                                      {a.keywords?.traffic?.map((k: any, i: number) => (
                                        <Badge key={i} variant="outline" className="text-[10px]">
                                          {getKeywordText(k)}
                                        </Badge>
                                      )) || <span className="text-xs text-muted-foreground">-</span>}
                                    </div>
                                  </td>
                                ))}
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <ScrollBar orientation="horizontal" />
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* Reviews Tab */}
              <TabsContent value="reviews">
                <div className="space-y-4">
                  {/* Common Pain Points Matrix */}
                  {painPointComparison && painPointComparison.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-red-500" />
                          痛点交叉分析
                        </CardTitle>
                        <CardDescription>
                          显示各竞品共有的用户痛点，帮助发现品类通病和差异化机会
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ScrollArea className="w-full">
                          <div className="min-w-[500px]">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b">
                                  <th className="text-left py-2 px-3 font-medium text-muted-foreground">痛点</th>
                                  {selectedAnalyses.map((a, idx) => (
                                    <th key={a.id} className="text-center py-2 px-3 font-medium min-w-[80px]">
                                      <Badge className={`font-mono text-[10px] border ${ASIN_COLORS[analyses?.findIndex(x => x.id === a.id) ?? idx % ASIN_COLORS.length]}`}>
                                        {a.asin.slice(-4)}
                                      </Badge>
                                    </th>
                                  ))}
                                  <th className="text-center py-2 px-3 font-medium text-muted-foreground min-w-[60px]">频率</th>
                                </tr>
                              </thead>
                              <tbody>
                                {painPointComparison.slice(0, 15).map(([issue, asins]) => (
                                  <tr key={issue} className="border-b hover:bg-muted/30">
                                    <td className="py-2 px-3 text-xs max-w-[250px]">{issue}</td>
                                    {selectedAnalyses.map(a => (
                                      <td key={a.id} className="text-center py-2 px-3">
                                        {asins.has(a.asin) ? (
                                          <CheckCircle2 className="h-4 w-4 text-red-500 mx-auto" />
                                        ) : (
                                          <Minus className="h-4 w-4 text-muted-foreground/30 mx-auto" />
                                        )}
                                      </td>
                                    ))}
                                    <td className="text-center py-2 px-3">
                                      <Badge variant={asins.size === selectedAnalyses.length ? "destructive" : "secondary"} className="text-[10px]">
                                        {asins.size}/{selectedAnalyses.length}
                                      </Badge>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <ScrollBar orientation="horizontal" />
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  )}

                  {/* Per-ASIN Review Analysis */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">各竞品评论分析详情</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="w-full">
                        <div className="min-w-[600px]">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b">
                                <th className="text-left py-3 px-4 font-medium text-muted-foreground w-[100px] sticky left-0 bg-card z-10">
                                  类型
                                </th>
                                {selectedAnalyses.map((a, idx) => (
                                  <th key={a.id} className="text-left py-3 px-4 font-medium min-w-[220px]">
                                    <Badge className={`font-mono text-xs border ${ASIN_COLORS[analyses?.findIndex(x => x.id === a.id) ?? idx % ASIN_COLORS.length]}`}>
                                      {a.asin}
                                    </Badge>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {/* Pain Points */}
                              <tr className="border-b hover:bg-muted/30 align-top">
                                <td className="py-3 px-4 font-medium text-red-600 sticky left-0 bg-card z-10">
                                  <div className="flex items-center gap-1">
                                    <AlertTriangle className="h-3.5 w-3.5" />
                                    痛点
                                  </div>
                                </td>
                                {selectedAnalyses.map(a => (
                                  <td key={a.id} className="py-3 px-4">
                                    {a.reviewAnalysis?.painPoints?.length ? (
                                      <div className="space-y-1.5">
                                        {a.reviewAnalysis.painPoints.map((p, i) => (
                                          <div key={i} className="p-2 bg-red-50 rounded text-xs border border-red-100">
                                            <p className="font-medium text-red-800">{p.issue}</p>
                                            {p.severity && (
                                              <span className="text-[10px] text-red-600">严重度: {p.severity}</span>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">无数据</span>
                                    )}
                                  </td>
                                ))}
                              </tr>
                              {/* Itch Points */}
                              <tr className="border-b hover:bg-muted/30 align-top">
                                <td className="py-3 px-4 font-medium text-amber-600 sticky left-0 bg-card z-10">
                                  <div className="flex items-center gap-1">
                                    <TrendingUp className="h-3.5 w-3.5" />
                                    痒点
                                  </div>
                                </td>
                                {selectedAnalyses.map(a => (
                                  <td key={a.id} className="py-3 px-4">
                                    {a.reviewAnalysis?.itchPoints?.length ? (
                                      <div className="space-y-1.5">
                                        {a.reviewAnalysis.itchPoints.map((p, i) => (
                                          <div key={i} className="p-2 bg-amber-50 rounded text-xs border border-amber-100">
                                            <p className="font-medium text-amber-800">{p.desire}</p>
                                            {p.importance && (
                                              <span className="text-[10px] text-amber-600">重要性: {p.importance}</span>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">无数据</span>
                                    )}
                                  </td>
                                ))}
                              </tr>
                              {/* Delight Points */}
                              <tr className="hover:bg-muted/30 align-top">
                                <td className="py-3 px-4 font-medium text-green-600 sticky left-0 bg-card z-10">
                                  <div className="flex items-center gap-1">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    爽点
                                  </div>
                                </td>
                                {selectedAnalyses.map(a => (
                                  <td key={a.id} className="py-3 px-4">
                                    {a.reviewAnalysis?.delightPoints?.length ? (
                                      <div className="space-y-1.5">
                                        {a.reviewAnalysis.delightPoints.map((p, i) => (
                                          <div key={i} className="p-2 bg-green-50 rounded text-xs border border-green-100">
                                            <p className="font-medium text-green-800">{p.feature}</p>
                                            {p.impact && (
                                              <span className="text-[10px] text-green-600">影响: {p.impact}</span>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">无数据</span>
                                    )}
                                  </td>
                                ))}
                              </tr>
                            </tbody>
                          </table>
                        </div>
                        <ScrollBar orientation="horizontal" />
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* Bullet Points Tab */}
              <TabsContent value="bullets">
                {report ? (
                  <SellingPointMatrix
                    selectedAnalyses={selectedAnalyses}
                    rows={sellingPointRows}
                    isEditing={isEditingReport}
                    onChange={editRows}
                    colorIndexFor={analysisId => Math.max(0, analyses?.findIndex(item => item.id === analysisId) ?? 0)}
                  />
                ) : (
                  <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-14 text-center">
                      {comparisonReportQuery.isFetching
                        ? <Loader2 className="mb-3 h-7 w-7 animate-spin text-primary" />
                        : <Sparkles className="mb-3 h-7 w-7 text-muted-foreground" />}
                      <p className="text-sm font-medium">
                        {comparisonReportQuery.isFetching ? "正在读取历史对比报告" : "请先生成结构化竞品对比"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        AI 会按卖点语义归并同行，生成后可在本页填写人工备注并提取优秀点
                      </p>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* AI Summary Tab */}
              <TabsContent value="ai-summary">
                <AISummarySection
                  selectedAnalyses={selectedAnalyses}
                  report={report}
                  summaryDraft={summaryDraft}
                  isEditing={isEditingReport}
                  onSummaryChange={editSummary}
                  onGenerate={() => { void runReportAction("generate"); }}
                  isGenerating={pendingReportAction === "generate"}
                  generationDisabled={reportMutationPending || dirty.current || reportNeedsReview}
                />
              </TabsContent>
            </Tabs>
          )}

          {/* Prompt to select more */}
          {selectedIds.size > 0 && selectedIds.size < 2 && (
            <Card className="border-dashed border-amber-200 bg-amber-50/50">
              <CardContent className="flex items-center justify-center py-8">
                <p className="text-sm text-amber-700">
                  请再选择至少 <span className="font-bold">1</span> 个ASIN以开始对比分析
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
