import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import ProjectSelector from "@/components/ProjectSelector";
import { useProject } from "@/contexts/ProjectContext";
import {
  Sparkles,
  ArrowRight,
  Loader2,
  AlertTriangle,
  AlertCircle,
  Tag,
  GitBranch,
  LayoutGrid,
  Search,
  Check,
  Megaphone,
  Target,
  RotateCcw,
  FileText,
  CheckCircle2,
  Plus,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronUp,
  Wand2,
  Download,
  Filter,
  X,
  ArrowUpDown,
  ChevronRight,
  Lock,
  Unlock,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import StepTitle from "./listing/StepTitle";
import StepDescription from "./listing/StepDescription";
import StepSearchTerms from "./listing/StepSearchTerms";
import StepQA from "./listing/StepQA";
import BulletChecklistPanel from "@/components/BulletChecklistPanel";
import LockedContentBar from "@/components/LockedContentBar";
import { CharCountBadge, GeneratingProgress } from "./listing/GenerationIndicators";
import { KeywordImportDialog } from "./listing/KeywordImportDialog";
import { ListingGenerationPreparationSummary } from "./listing/ListingGenerationPreparationSummary";
import { DistillationGuidancePicker, type DistillationBinding } from "@/components/workflow/DistillationGuidancePicker";
import { ListingPlanningPanel } from "@/components/workflow/ListingPlanningPanel";
import { FactReviewPanel } from "@/components/listing/FactReviewPanel";
import { CoreReviewPanel } from "@/components/listing/CoreReviewPanel";
import { CandidateReviewPanel } from "@/components/listing/CandidateReviewPanel";
import { factRevisionIdsForCore, findSuccessfulSellingPointPlan, hasCurrentConfirmedEvidence, sellingPointBuyerReason } from "./listing/reviewRecovery";
import { useSellingPointPlanRecovery } from "./listing/useSellingPointPlanRecovery";
import { SellingPointDirectionDetails, SellingPointPlanSummary } from "./listing/SellingPointPlanSummary";
import {
  ListingGenerationJobStatus,
  useListingGenerationJob,
} from "./listing/useListingGenerationJob";
import { LISTING_STEPS, ListingWorkflowNavigation } from "./listing/ListingWorkflowNavigation";
import { sanitizeSelectedSellingPoint } from "@shared/listingFactSafety";

function bulletFingerprint(bullet: { subtitle?: string; fullText?: string } | null | undefined) {
  return `${bullet?.subtitle || ""}\u0000${bullet?.fullText || ""}`;
}

export default function GeneratePage() {
  const { selectedProjectId } = useProject();
  const [, setLocation] = useLocation();
  // Free-text emphasis is not an evidence channel for fact-bound AI jobs.
  const emphasis = "";
  const [distillationBinding, setDistillationBinding] = useState<DistillationBinding>({ ledgerKey: null, skillSlugs: [] });

  // Step-by-step bullet generation state
  const sellingPointPlan = useSellingPointPlanRecovery(selectedProjectId);
  const { points: sellingPointCores, setPoints: setSellingPointCores, restore: restoreSellingPointPlan, settleUnsuccessfulAttempt } = sellingPointPlan;
  const coreRevisionRef = useRef(0);
  const [confirmedCores, setConfirmedCores] = useState<boolean[]>([]);
  const [coreFactSelection, setCoreFactSelection] = useState<Record<number, number[]>>({});
  const reviewedFactsQuery = trpc.listing.listReviewedFacts.useQuery({ projectId: selectedProjectId! }, { enabled: !!selectedProjectId });
  const reviewedCoresQuery = trpc.listing.listCurrentCores.useQuery({ projectId: selectedProjectId! }, { enabled: !!selectedProjectId });
  const reviewCoreMutation = trpc.listing.reviewCore.useMutation();
  const reviewUtils = trpc.useUtils();
  const confirmedFactIds = useMemo(() => new Set((reviewedFactsQuery.data || [])
    .filter((fact) => fact.status === "confirmed").map((fact) => fact.id)), [reviewedFactsQuery.data]);
  const factLabels = useMemo(() => Object.fromEntries((reviewedFactsQuery.data || [])
    .filter((fact) => fact.status === "confirmed")
    .map((fact) => [fact.id, `${fact.attributeKey}：${fact.value}`])), [reviewedFactsQuery.data]);
  const currentConfirmedCoreBindings = useMemo(() => (reviewedCoresQuery.data || []).filter((core) =>
    core.status === "confirmed" && hasCurrentConfirmedEvidence(core, confirmedFactIds)),
  [confirmedFactIds, reviewedCoresQuery.data]);
  // A restored card retains the exact server-reviewed reason until an operator
  // changes it. This prevents formatting the display fields from creating a
  // different core binding after refresh.
  const coreReason = sellingPointBuyerReason;
  const coreBinding = (idx: number) => reviewedCoresQuery.data?.find((item) =>
    item.sellingPointIndex === idx && item.status === "confirmed"
      && (!sellingPointCores?.[idx]?.serverCoreId || item.coreId === sellingPointCores[idx]?.serverCoreId)
      && item.buyerReason === coreReason(sellingPointCores?.[idx])
      && hasCurrentConfirmedEvidence(item, confirmedFactIds));
  const [generatedBullets, setGeneratedBullets] = useState<Record<number, any>>({});
  const latestBulletsRef = useRef<Record<number, any>>({});
  useEffect(() => { latestBulletsRef.current = generatedBullets; }, [generatedBullets]);
  const replaceBulletDraft = useCallback((idx: number, bullet: any) => {
    const updated = { ...latestBulletsRef.current, [idx]: bullet };
    latestBulletsRef.current = updated;
    setGeneratedBullets(updated);
  }, []);
  const [bulletCandidates, setBulletCandidates] = useState<Record<number, any[]>>({});
  const [bulletOptimizationNotes, setBulletOptimizationNotes] = useState<Record<number, string>>({});
  const [confirmedBullets, setConfirmedBullets] = useState<Record<number, boolean>>({});
  const [editingCore, setEditingCore] = useState<number | null>(null);
  useEffect(() => {
    if (!sellingPointCores?.length || !reviewedCoresQuery.data || reviewedFactsQuery.isLoading || reviewedFactsQuery.isError) return;
    setConfirmedCores((previous) => {
      const next = sellingPointCores.map((point, idx) => !point || editingCore === idx ? false : Boolean(
        reviewedCoresQuery.data.some((item) => item.sellingPointIndex === idx && item.status === "confirmed"
          && (!point.serverCoreId || item.coreId === point.serverCoreId)
          && item.buyerReason === coreReason(point)
          && hasCurrentConfirmedEvidence(item, confirmedFactIds))));
      return next.some((item, idx) => item !== previous[idx]) ? next : previous;
    });
  }, [confirmedFactIds, coreReason, editingCore, reviewedCoresQuery.data, reviewedFactsQuery.isError, reviewedFactsQuery.isLoading, sellingPointCores]);
  const [editingBullet, setEditingBullet] = useState<number | null>(null);
  const [editBulletData, setEditBulletData] = useState<{ subtitle: string; fullText: string }>({ subtitle: "", fullText: "" });
  const [stepBulletPhase, setStepBulletPhase] = useState<"idle" | "cores" | "bullets">("idle");
  const lastCoreProjectRef = useRef(selectedProjectId);
  const lastRecoveredPlanVersionRef = useRef(0);
  useEffect(() => {
    if (lastCoreProjectRef.current === selectedProjectId) return;
    lastCoreProjectRef.current = selectedProjectId;
    lastRecoveredPlanVersionRef.current = 0;
    coreRevisionRef.current += 1;
    setConfirmedCores([]);
    setCoreFactSelection({});
    setGeneratedBullets({});
    latestBulletsRef.current = {};
    setBulletCandidates({});
    setConfirmedBullets({});
    setEditingCore(null);
    setEditingBullet(null);
    setStepBulletPhase("idle");
  }, [selectedProjectId]);

  // Manual selling point addition state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCoreTheme, setNewCoreTheme] = useState("");
  const [newCoreThemeZh, setNewCoreThemeZh] = useState("");
  const [newCoreDescription, setNewCoreDescription] = useState("");

  // AI assist state for manual selling point
  const [aiAssistMode, setAiAssistMode] = useState(false);
  const [aiKeyword, setAiKeyword] = useState("");
  const [aiResult, setAiResult] = useState<any>(null);
  const [aiResultEditing, setAiResultEditing] = useState(false);

  // Locked mode fine-tuning state
  const [lockedFineTuneIdx, setLockedFineTuneIdx] = useState<number | null>(null);
  const [lockedFineTuneData, setLockedFineTuneData] = useState<{ subtitle: string; fullText: string }>({ subtitle: "", fullText: "" });
  const [showLockedAddForm, setShowLockedAddForm] = useState(false);
  const [lockedAddMode, setLockedAddMode] = useState<"ai" | "manual">("ai");
  const [lockedAddKeyword, setLockedAddKeyword] = useState("");
  const [lockedAiResult, setLockedAiResult] = useState<{ subtitle: string; fullText: string } | null>(null);
  const [lockedAddSubtitle, setLockedAddSubtitle] = useState("");
  const [lockedAddFullText, setLockedAddFullText] = useState("");

  // Lock state for each step (locked = confirmed + synced to preview)
  const [lockedSteps, setLockedSteps] = useState<Set<number>>(new Set());
  const lockedStepsInitialized = useRef(false);

  // Load locked steps from DB on mount
  const { data: activeListing } = trpc.listing.getActive.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );
  const updateLockedStepsMut = trpc.listing.updateLockedSteps.useMutation();
  const { mutateAsync: saveChecklistScores } = trpc.listing.saveChecklistScores.useMutation();
  const checklistSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const generatedBulletCount = Object.keys(generatedBullets).length;
  const persistChecklistScores = useCallback((bullets: Record<number, any>) => {
    if (!selectedProjectId) return;
    const scores: Record<number, any> = {};
    for (const [idx, bullet] of Object.entries(bullets)) {
      if (bullet?.checkListScores) {
        scores[Number(idx)] = {
          checkListScores: bullet.checkListScores,
          aiSemanticRelations: bullet.aiSemanticRelations || null,
          fingerprint: bulletFingerprint(bullet),
        };
      }
    }
    if (Object.keys(scores).length > 0) {
      const projectId = selectedProjectId;
      checklistSaveQueue.current = checklistSaveQueue.current.then(async () => {
        await saveChecklistScores({ projectId, scores: JSON.stringify(scores) });
      }).catch(() => {
        toast.error("卖点自检已完成，但评分保存失败；刷新前请重新自检");
      });
    }
  }, [saveChecklistScores, selectedProjectId]);

  // Initialize locked steps from DB
  useEffect(() => {
    if (activeListing?.lockedSteps && !lockedStepsInitialized.current) {
      try {
        const steps: number[] = JSON.parse(activeListing.lockedSteps);
        if (Array.isArray(steps) && steps.length > 0) {
          setLockedSteps(new Set(steps));
          setCompletedSteps(new Set(steps));
        }
        lockedStepsInitialized.current = true;
      } catch { /* ignore parse errors */ }
    }
  }, [activeListing?.lockedSteps]);

  // Initialize checklist scores from DB
  useEffect(() => {
    if (activeListing?.checklistScores && generatedBulletCount > 0) {
      try {
        const saved = JSON.parse(activeListing.checklistScores);
        if (saved && typeof saved === 'object') {
          setGeneratedBullets(prev => {
            const updated = { ...prev };
            let changed = false;
            for (const [idx, scores] of Object.entries(saved)) {
              if (updated[Number(idx)] && (scores as any).fingerprint === bulletFingerprint(updated[Number(idx)])) {
                if (updated[Number(idx)].checkListScores === (scores as any).checkListScores) continue;
                updated[Number(idx)] = {
                  ...updated[Number(idx)],
                  checkListScores: (scores as any).checkListScores || updated[Number(idx)].checkListScores,
                  aiSemanticRelations: (scores as any).aiSemanticRelations || updated[Number(idx)].aiSemanticRelations,
                };
                changed = true;
              }
            }
            return changed ? updated : prev;
          });
        }
      } catch { /* ignore parse errors */ }
    }
  }, [activeListing?.checklistScores, generatedBulletCount]);

  // All-locked redirect: show prompt when all 5 steps are locked
  const [showAllLockedDialog, setShowAllLockedDialog] = useState(false);
  const allLockedPromptShown = useRef(false);
  useEffect(() => {
    if (lockedSteps.size === 5 && !allLockedPromptShown.current) {
      allLockedPromptShown.current = true;
      setShowAllLockedDialog(true);
    }
  }, [lockedSteps.size]);

  // Checklist evaluation state
  const [evaluatingChecklist, setEvaluatingChecklist] = useState<Record<number, boolean>>({});
  const evaluateChecklist = trpc.listing.evaluateBulletChecklist.useMutation();

  // Step navigation state
  const [activeStep, setActiveStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  useEffect(() => {
    const nodeId = new URLSearchParams(window.location.search).get("nodeId");
    const nodeStepMap: Record<string, number> = { G1: 1, G2: 2, G3: 3, G4: 4, G5: 5 };
    if (nodeId && nodeStepMap[nodeId]) setActiveStep(nodeStepMap[nodeId]);
  }, []);

  // Sync activeStep -> URL nodeId via wouter (triggers DashboardLayout listingAgentNodeContext update)
  useEffect(() => {
    const stepNodeMap: Record<number, string> = { 1: "G1", 2: "G2", 3: "G3", 4: "G4", 5: "G5" };
    const targetNodeId = stepNodeMap[activeStep];
    if (!targetNodeId) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get("agentRunId")) return; // Only update if we're in agent-linked mode
    if (params.get("nodeId") === targetNodeId) return; // Already correct
    params.set("nodeId", targetNodeId);
    setLocation(`/listing/generate?${params.toString()}`, { replace: true });
  }, [activeStep, setLocation]);

  const handleStepComplete = (step: number) => {
    setCompletedSteps(prev => { const n = new Set(prev); n.add(step); return n; });
    // Auto-advance to next step
    if (step < 5) {
      setActiveStep(step + 1);
    }
  };

  // Keyword import dialog state
  const [showKeywordImport, setShowKeywordImport] = useState(false);
  const [kwSearchTerm, setKwSearchTerm] = useState("");
  const [kwFilterStrategy, setKwFilterStrategy] = useState<string>("all");
  const [kwFilterPlacement, setKwFilterPlacement] = useState<string>("all");
  const [kwSortOrder, setKwSortOrder] = useState<"none" | "asc" | "desc">("none");
  const [selectedKeywordIds, setSelectedKeywordIds] = useState<Set<number>>(new Set());

  const { data: project } = trpc.project.getById.useQuery(
    { id: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const { data: analyses } = trpc.analysis.listByProject.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const { data: fileSummary } = trpc.projectFile.getAnalysisSummary.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const { data: keywordStats } = trpc.keyword.stats.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  // Keyword list for import dialog (only fetch when dialog is open)
  const { data: allKeywords, isLoading: kwLoading } = trpc.keyword.list.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId && showKeywordImport }
  );

  // Calculate keyword analysis readiness
  const kwReadiness = (() => {
    if (!keywordStats || keywordStats.total === 0) return null;
    const hasSceneTags = (keywordStats.byStatus?.tagged || 0) + (keywordStats.byStatus?.finalized || 0) > 0;
    const hasStrategy = Object.keys(keywordStats.byStrategy || {}).length > 0;
    const hasRoots = Object.keys(keywordStats.byRoot || {}).length > 0;
    const taggedCount = (keywordStats.byStatus?.tagged || 0) + (keywordStats.byStatus?.finalized || 0);
    const steps = [
      { key: "import", label: "关键词导入", done: keywordStats.total > 0, icon: Search, count: keywordStats.total },
      { key: "scene", label: "场景打标", done: hasSceneTags, icon: Tag, count: taggedCount },
      { key: "root", label: "词根分类", done: hasRoots, icon: GitBranch, count: Object.values(keywordStats.byRoot || {}).reduce((a: number, b: number) => a + b, 0) },
      { key: "strategy", label: "策略矩阵", done: hasStrategy, icon: LayoutGrid, count: Object.values(keywordStats.byStrategy || {}).reduce((a: number, b: number) => a + b, 0) },
    ];
    const completedSteps = steps.filter(s => s.done).length;
    return { steps, completedSteps, total: steps.length, allDone: completedSteps === steps.length };
  })();

  // Step-by-step bullet jobs
  const sellingPointsJob = useListingGenerationJob({
    projectId: selectedProjectId || 0,
    nodeId: "G1",
    operation: "sellingPoints",
    scopeKey: "main",
    distillationBinding,
    onSucceeded: (data: any) => {
      // Normalize field name variants (backend may return selling_points / points / cores / themes)
      const points = data.sellingPoints ?? data.selling_points ?? data.points ?? data.bulletCores ?? data.cores ?? data.themes;
      if (Array.isArray(points) && points.length > 0) {
        // Recovery below waits for the review ledger and preserves reviewed
        // buying reasons instead of replaying an old draft over human edits.
        return;
      } else if ((data as any).raw || (data as any).parseError) {
        // Backend returned raw text (JSON parse failed)
        console.error("[generateCores] Backend JSON parse error:", (data as any).parseError, "\nRaw:", String((data as any).raw ?? "").slice(0, 200));
        toast.error("AI 返回格式异常，请重试。若持续失败请联系管理员。");
      } else {
        console.error("[generateCores] Unexpected response structure:", JSON.stringify(data).slice(0, 300));
        toast.error("生成结果格式异常，请重试");
      }
    },
  });

  useEffect(() => {
    if (!sellingPointCores || !sellingPointPlan.restorationVersion
      || lastRecoveredPlanVersionRef.current === sellingPointPlan.restorationVersion) return;
    lastRecoveredPlanVersionRef.current = sellingPointPlan.restorationVersion;
    setCoreFactSelection(Object.fromEntries(sellingPointCores.flatMap((point, index) => {
      const core = point && reviewedCoresQuery.data?.find((item) => item.coreId === point.serverCoreId);
      return core ? [[index, factRevisionIdsForCore(core)]] : [];
    })));
    setStepBulletPhase((current) => current === "idle" ? "cores" : current);
  }, [sellingPointCores, sellingPointPlan.restorationVersion, reviewedCoresQuery.data]);
  const startListingJob = trpc.listing.startGenerationJob.useMutation();
  const cancelListingJob = trpc.listing.cancelGenerationJob.useMutation();
  const handledBulletJobRuns = useRef(new Set<string>());
  const requestedBulletFingerprints = useRef(new Map<string, string>());
  const g1JobsQuery = trpc.listing.listGenerationRuns.useQuery(
    { projectId: selectedProjectId || 0, nodeId: "G1" },
    {
      enabled: !!selectedProjectId,
      refetchInterval: (query) => ((query.state.data as any[]) || []).some((job) => job.status === "queued" || job.status === "running") ? 2_000 : false,
    },
  );
  const g1Jobs = useMemo(() => (g1JobsQuery.data || []) as any[], [g1JobsQuery.data]);
  useEffect(() => {
    if (!selectedProjectId || sellingPointsJob.isLoadingRun || reviewedCoresQuery.isLoading
      || reviewedCoresQuery.isError || !reviewedCoresQuery.data) return;
    if (sellingPointPlan.awaitingNewRun && sellingPointsJob.run?.runId !== sellingPointPlan.ignoredRunId
      && ["failed", "canceled"].includes(sellingPointsJob.run?.status)) {
      settleUnsuccessfulAttempt(sellingPointsJob.run); return;
    }
    const run = findSuccessfulSellingPointPlan(sellingPointsJob.run,
      sellingPointPlan.awaitingNewRun ? [] : g1Jobs, selectedProjectId);
    // Prefer a saved complete plan to lossy core-only reconstruction. History
    // is already queried for bullet recovery; no extra endpoint is required.
    if (!run && g1JobsQuery.isLoading && !sellingPointPlan.awaitingNewRun) return;
    restoreSellingPointPlan(run?.runId || null, run?.output || null, reviewedCoresQuery.data);
  }, [selectedProjectId, sellingPointsJob.isLoadingRun, sellingPointsJob.run, reviewedCoresQuery.data,
    reviewedCoresQuery.isLoading, reviewedCoresQuery.isError, restoreSellingPointPlan,
    g1Jobs, g1JobsQuery.isLoading, sellingPointPlan.awaitingNewRun, sellingPointPlan.ignoredRunId, settleUnsuccessfulAttempt]);

  const latestSingleBulletJob = g1Jobs.find((job) => {
    const operation = (job.input as any)?.operation;
    return operation === "singleBullet";
  });
  const activeSingleBulletJob = latestSingleBulletJob
    && (latestSingleBulletJob.status === "queued" || latestSingleBulletJob.status === "running")
    ? latestSingleBulletJob
    : null;
  const singleBulletGenerating = startListingJob.isPending || Boolean(activeSingleBulletJob);

  useEffect(() => {
    const restoredScopes = new Set<string>();
    for (const job of g1Jobs) {
      if (job.status !== "succeeded" || !job.output || job.output.skipped || handledBulletJobRuns.current.has(job.runId)) continue;
      const jobInput = (job.input || {}) as any;
      if (jobInput.operation !== "singleBullet") continue;
      const scopeKey = String(jobInput.scopeKey || "");
      if (restoredScopes.has(scopeKey)) continue;
      restoredScopes.add(scopeKey);
      handledBulletJobRuns.current.add(job.runId);
      const requestedFingerprint = requestedBulletFingerprints.current.get(job.runId);
      requestedBulletFingerprints.current.delete(job.runId);
      if (scopeKey === "locked-add") {
        setLockedAiResult({
          subtitle: job.output.subtitle || jobInput.sellingPoint?.theme || "",
          fullText: job.output.fullText || jobInput.sellingPoint?.description || "",
        });
        continue;
      }
      const match = scopeKey.match(/^bullet-(\d+)$/);
      if (!match) continue;
      const idx = Number(match[1]);
      if (confirmedBullets[idx]) continue;
      if (!sellingPointCores?.[idx] || JSON.stringify(jobInput.sellingPoint) !== JSON.stringify(sellingPointCores[idx])) {
        toast.info(`卖点 ${idx + 1} 的核心已调整，旧任务结果仅保留在运行记录中，未覆盖当前草案`);
        continue;
      }
      if (requestedFingerprint !== undefined && bulletFingerprint(latestBulletsRef.current[idx]) !== requestedFingerprint) {
        toast.info(`卖点 ${idx + 1} 在生成期间已修改，后台结果未覆盖当前内容`);
        continue;
      }
      const initialBullets = { ...latestBulletsRef.current, [idx]: job.output };
      latestBulletsRef.current = initialBullets;
      setGeneratedBullets(initialBullets);
      toast.success(`卖点 ${idx + 1} 生成完成`);
      if (job.output.subtitle && job.output.fullText) {
        setEvaluatingChecklist((previous) => ({ ...previous, [idx]: true }));
        void evaluateChecklist.mutateAsync({
          subtitle: job.output.subtitle,
          fullText: job.output.fullText,
          bulletIndex: idx,
          evidenceUsed: job.output.evidenceUsed || [],
        }).then((checkResult) => {
          if (!latestBulletsRef.current[idx] || bulletFingerprint(latestBulletsRef.current[idx]) !== bulletFingerprint(job.output)) return;
          const updated = { ...latestBulletsRef.current, [idx]: { ...latestBulletsRef.current[idx],
            checkListScores: checkResult.checkListScores, aiSemanticRelations: checkResult.aiSemanticRelations } };
          latestBulletsRef.current = updated;
          setGeneratedBullets(updated);
          persistChecklistScores(updated);
        }).catch((error: unknown) => {
          toast.error(`卖点 ${idx + 1} 已生成，自检未完成；可在下方点击“重新自检”。${error instanceof Error ? ` ${error.message}` : ""}`);
        }).finally(() => {
          setEvaluatingChecklist((previous) => ({ ...previous, [idx]: false }));
        });
      }
    }
  }, [confirmedBullets, evaluateChecklist, g1Jobs, persistChecklistScores, sellingPointCores]);

  const handleGenerateCores = () => {
    if (!selectedProjectId) return;
    // 强制前置检查：产品属性表必须已上传
    if (!fileSummary?.productAttributes) {
      toast.error("请先在『数据文件』上传『产品属性表』，才能开始生成卖点", {
        action: {
          label: "前往上传",
          onClick: () => window.location.href = "/listing/data-files",
        },
        duration: 6000,
      });
      return;
    }
    coreRevisionRef.current += 1;
    sellingPointPlan.prepare(sellingPointsJob.run?.runId || null);
    setCoreFactSelection({});
    setConfirmedCores([]);
    setGeneratedBullets({});
    setConfirmedBullets({});
    setStepBulletPhase("idle");
    void sellingPointsJob.start({ emphasis: emphasis.trim() || undefined }).then((job) => {
      if (!job) settleUnsuccessfulAttempt();
    });
  };

  const handleConfirmCore = async (idx: number) => {
    if (!selectedProjectId || !sellingPointCores?.[idx]) return;
    const safety = sanitizeSelectedSellingPoint(sellingPointCores?.[idx]);
    if (!safety.canGenerate || safety.excludedFields.length > 0) {
      setEditingCore(idx);
      toast.error("请先删除或核实核心中的空白/示例字段，并填写真实产品事实后再确认");
      return;
    }
    const factIds = coreFactSelection[idx] || [];
    if (!factIds.length || reviewedFactsQuery.isLoading || reviewedFactsQuery.isError) {
      toast.error("请先在上方确认原始属性表中的本品事实，再勾选至少一条支持该卖点的证据");
      return;
    }
    const known = reviewedCoresQuery.data?.find((row) => row.coreId === sellingPointCores[idx]?.serverCoreId)
      || reviewedCoresQuery.data?.filter((row) => row.sellingPointIndex === idx && (row.status === "draft" || row.status === "confirmed"))
        .sort((a, b) => b.revision - a.revision || b.id - a.id)[0];
    try {
      sellingPointPlan.markDirty();
      await reviewCoreMutation.mutateAsync({ projectId: selectedProjectId,
        ...(known ? { coreId: known.coreId } : {}), sellingPointIndex: idx,
        buyerReason: coreReason(sellingPointCores[idx]), factRevisionIds: factIds,
        expectedRevision: known?.revision || 0, decision: "confirm" });
      await reviewUtils.listing.listCurrentCores.invalidate({ projectId: selectedProjectId });
      setConfirmedCores(prev => { const next = [...prev]; next[idx] = true; return next; });
      setEditingCore(null);
      toast.success("核心及所选产品事实已记录为人工确认版本");
    } catch (error: any) {
      toast.error(error?.message || "核心确认失败；当前未创建模型任务");
    }
  };

  const handleReopenCore = (idx: number) => {
    sellingPointPlan.markDirty();
    coreRevisionRef.current += 1;
    setConfirmedCores(prev => { const next = [...prev]; next[idx] = false; return next; });
    setConfirmedBullets(prev => ({ ...prev, [idx]: false }));
    setBulletCandidates(prev => ({ ...prev, [idx]: (prev[idx] || []).map(candidate => ({ ...candidate, staleSource: true })) }));
    if (latestBulletsRef.current[idx]) replaceBulletDraft(idx, { ...latestBulletsRef.current[idx], staleSource: true,
      checkListScores: undefined, aiSemanticRelations: undefined, qualityAudit: undefined });
    setEditingCore(idx);
  };

  const handleEditCore = (idx: number, field: string, value: any) => {
    if (!sellingPointCores) return;
    coreRevisionRef.current += 1;
    setSellingPointCores(prev => {
      if (!prev) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value, restoredBuyerReason: undefined };
      return next;
    });
  };

  const handleEditCoreFabe = (idx: number, fabeField: string, value: string) => {
    if (!sellingPointCores) return;
    coreRevisionRef.current += 1;
    setSellingPointCores(prev => {
      if (!prev) return prev;
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        restoredBuyerReason: undefined,
        fabeDirection: { ...next[idx].fabeDirection, [fabeField]: value },
      };
      return next;
    });
  };

  // AI expand keyword to FABE mutation
  const expandKeyword = trpc.listing.expandKeywordToFABE.useMutation({
    onSuccess: (data) => {
      setAiResult(data);
      setAiResultEditing(true);
      toast.success("AI已生成FABE卖点框架，请检查并确认");
    },
    onError: (err) => toast.error("AI生成失败: " + err.message),
  });

  const handleAiExpand = () => {
    if (!selectedProjectId || !aiKeyword.trim()) {
      toast.error("请输入关键词或主题");
      return;
    }
    expandKeyword.mutate({ projectId: selectedProjectId, keyword: aiKeyword.trim() });
  };

  const handleConfirmAiResult = () => {
    if (!sellingPointCores || !aiResult) return;
    if (sellingPointCores.length >= 9) {
      toast.error("最多支持9条卖点");
      return;
    }
    const newCore = {
      index: sellingPointCores.length + 1,
      theme: aiResult.theme,
      themeZh: aiResult.themeZh || "",
      description: aiResult.description || "",
      descriptionZh: aiResult.descriptionZh || "",
      fabeDirection: aiResult.fabeDirection || { feature: "", advantage: "", benefit: "", evidence: "" },
      targetKeywords: aiResult.targetKeywords || [],
      addressesGap: aiResult.addressesGap || "",
      isManual: true,
    };
    setSellingPointCores(prev => prev ? [...prev, newCore] : [newCore]);
    setConfirmedCores(prev => [...prev, false]);
    setAiResult(null);
    setAiKeyword("");
    setAiResultEditing(false);
    setShowAddForm(false);
    toast.success("已添加AI生成的卖点，请确认或继续编辑");
  };

  // Add manual selling point core (manual mode)
  const handleAddManualCore = () => {
    if (!sellingPointCores || !newCoreTheme.trim()) {
      toast.error("请填写卖点主题");
      return;
    }
    if (sellingPointCores.length >= 9) {
      toast.error("最多支持9条卖点");
      return;
    }
    const newCore = {
      index: sellingPointCores.length + 1,
      theme: newCoreTheme.trim(),
      themeZh: newCoreThemeZh.trim() || undefined,
      description: newCoreDescription.trim() || "User-defined selling point",
      descriptionZh: "",
      fabeDirection: {
        feature: "",
        advantage: "",
        benefit: "",
        evidence: "",
      },
      targetKeywords: [],
      addressesGap: "",
      isManual: true,
    };
    setSellingPointCores(prev => prev ? [...prev, newCore] : [newCore]);
    setConfirmedCores(prev => [...prev, false]);
    setNewCoreTheme("");
    setNewCoreThemeZh("");
    setNewCoreDescription("");
    setShowAddForm(false);
    setAiAssistMode(false);
    toast.success("已添加自定义卖点，请编辑并确认");
  };

  // Filtered and sorted keyword list for import dialog
  const filteredKeywords = useMemo(() => {
    if (!allKeywords) return [];
    const filtered = allKeywords.filter((kw: any) => {
      if (kw.isNegative === 1) return false;
      if (kwSearchTerm) {
        const search = kwSearchTerm.toLowerCase();
        const matchKeyword = kw.keyword?.toLowerCase().includes(search);
        const matchTranslation = kw.translationCn?.toLowerCase().includes(search);
        if (!matchKeyword && !matchTranslation) return false;
      }
      if (kwFilterStrategy !== "all" && kw.strategyCategory !== kwFilterStrategy) return false;
      if (kwFilterPlacement !== "all" && kw.listingPlacement !== kwFilterPlacement) return false;
      return true;
    });
    if (kwSortOrder === "asc") {
      filtered.sort((a: any, b: any) => (a.monthlySearchVolume ?? 0) - (b.monthlySearchVolume ?? 0));
    } else if (kwSortOrder === "desc") {
      filtered.sort((a: any, b: any) => (b.monthlySearchVolume ?? 0) - (a.monthlySearchVolume ?? 0));
    }
    return filtered;
  }, [allKeywords, kwSearchTerm, kwFilterStrategy, kwFilterPlacement, kwSortOrder]);

  const toggleKeywordSelection = (id: number) => {
    setSelectedKeywordIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    const allIds = filteredKeywords.map((kw: any) => kw.id);
    const allSelected = allIds.every((id: number) => selectedKeywordIds.has(id));
    if (allSelected) {
      setSelectedKeywordIds(prev => {
        const next = new Set(prev);
        allIds.forEach((id: number) => next.delete(id));
        return next;
      });
    } else {
      setSelectedKeywordIds(prev => {
        const next = new Set(prev);
        allIds.forEach((id: number) => next.add(id));
        return next;
      });
    }
  };

  const handleImportSelectedKeywords = () => {
    if (!allKeywords || selectedKeywordIds.size === 0) return;
    const selected = allKeywords.filter((kw: any) => selectedKeywordIds.has(kw.id));
    // Combine selected keywords into a single string for AI input
    const keywordText = selected.map((kw: any) => kw.keyword).join(", ");
    setAiKeyword(keywordText);
    setAiAssistMode(true);
    setShowAddForm(true);
    setShowKeywordImport(false);
    setSelectedKeywordIds(new Set());
    setKwSearchTerm("");
    setKwFilterStrategy("all");
    setKwFilterPlacement("all");
    toast.success(`已导入 ${selected.length} 个关键词，点击"AI生成FABE"开始生成`);
  };

  // Remove manual selling point core
  const handleRemoveCore = (idx: number) => {
    if (!sellingPointCores) return;
    const sp = sellingPointCores[idx];
    if (!sp.isManual) {
      toast.error("只能删除手动添加的卖点");
      return;
    }
    setSellingPointCores(prev => {
      if (!prev) return prev;
      const next = prev.filter((_, i) => i !== idx);
      // Re-index
      return next.map((item, i) => ({ ...item, index: i + 1 }));
    });
    setConfirmedCores(prev => prev.filter((_, i) => i !== idx).map((confirmed, i) => i < idx && confirmed));
    setCoreFactSelection(prev => Object.fromEntries(Object.entries(prev)
      .filter(([index]) => Number(index) < idx).map(([index, ids]) => [Number(index), ids])));
    // Clean up generated bullets
    const newBullets: Record<number, any> = {};
    const newConfirmed: Record<number, boolean> = {};
    Object.entries(generatedBullets).forEach(([key, val]) => {
      const k = Number(key);
      if (k < idx) { newBullets[k] = val; newConfirmed[k] = confirmedBullets[k] || false; }
      else if (k > idx) { newBullets[k - 1] = { ...val, staleSource: true }; newConfirmed[k - 1] = false; }
    });
    setGeneratedBullets(newBullets);
    setConfirmedBullets(newConfirmed);
  };

  const handleGenerateSingleBullet = async (idx: number) => {
    if (!selectedProjectId || !sellingPointCores) return;
    const approvedCore = confirmedCores[idx] ? coreBinding(idx) : null;
    if (!approvedCore) { toast.error("请先勾选已审事实并完成人工核心版本确认，旧本地确认不可用于新生成"); return; }
    const sp = sellingPointCores[idx];
    const safety = sanitizeSelectedSellingPoint(sp);
    if (!safety.canGenerate) { toast.error("卖点核心缺少真实产品事实；请先补充并确认"); return; }
    if (safety.excludedFields.length > 0) toast.info(`已排除 ${safety.excludedFields.length} 项示例/空白字段，请在生成后核对事实依据`);
    // Collect previously confirmed bullets
    const previousBullets = Object.entries(confirmedBullets)
      .filter(([, confirmed]) => confirmed)
      .map(([i]) => generatedBullets[Number(i)])
      .filter(Boolean)
      .map(b => ({ subtitle: b.subtitle || "", fullText: b.fullText || "" }));

    try {
      const requestedFingerprint = bulletFingerprint(latestBulletsRef.current[idx]);
      const job = await startListingJob.mutateAsync({
        projectId: selectedProjectId,
        nodeId: "G1",
        operation: "singleBullet",
        scopeKey: `bullet-${idx}`,
        sellingPoint: sp,
        coreRevisionId: approvedCore.id,
        coreInputHash: approvedCore.inputHash,
        previousBullets,
        emphasis: emphasis.trim() || undefined,
        ...(distillationBinding.ledgerKey || distillationBinding.skillSlugs?.length ? { distillationBinding } : {}),
      });
      requestedBulletFingerprints.current.set(job.runId, requestedFingerprint);
      await g1JobsQuery.refetch();
      toast.success(`卖点 ${idx + 1} 已进入后台队列`);
    } catch (error: any) {
      toast.error(`卖点生成失败: ${error?.message || "未知错误"}`);
    }
  };

  const optimizeBulletMut = trpc.listing.optimizeSingleBullet.useMutation();
  const handleOptimizeBullet = async (idx: number) => {
    const approvedCore = confirmedCores[idx] ? coreBinding(idx) : null;
    if (!approvedCore) { toast.error("当前卖点核心未绑定有效的人审事实版本，无法优化"); return; }
    const current = generatedBullets[idx];
    const requestedCoreRevision = coreRevisionRef.current;
    const candidates = (bulletCandidates[idx] || (current ? [current] : [])).filter(candidate => !candidate.staleSource);
    const note = bulletOptimizationNotes[idx]?.trim();
    if (!selectedProjectId || !sellingPointCores || !current) return;
    if (current.staleSource) { toast.error("核心已修改，请先重新生成；旧草案不能作为优化事实来源"); return; }
    if (candidates.length >= 4) { toast.error("每条卖点最多可再优化三次"); return; }
    if (!note) { toast.error("请填写优化方向"); return; }
    try {
      const previousBullets = Object.entries(confirmedBullets)
        .filter(([bulletIndex, confirmed]) => confirmed && Number(bulletIndex) !== idx)
        .map(([bulletIndex]) => generatedBullets[Number(bulletIndex)])
        .filter(Boolean)
        .map((bullet) => ({ subtitle: bullet.subtitle || "", fullText: bullet.fullText || "" }));
      const optimized = await optimizeBulletMut.mutateAsync({ projectId: selectedProjectId, sellingPoint: sellingPointCores[idx],
        coreRevisionId: approvedCore.id, coreInputHash: approvedCore.inputHash,
        currentBullet: { subtitle: current.subtitle || "", fullText: current.fullText || "" }, previousBullets, optimizationNote: note });
      if (requestedCoreRevision !== coreRevisionRef.current || latestBulletsRef.current[idx]?.staleSource
          || bulletFingerprint(latestBulletsRef.current[idx]) !== bulletFingerprint(current)) {
        toast.info("卖点核心或内容已更改，旧优化候选已丢弃；请按最新内容重新优化");
        return;
      }
      const next = { ...optimized, optimizationNote: note, manuallyEdited: false, checkListScores: undefined, aiSemanticRelations: undefined };
      setBulletCandidates(prev => ({ ...prev, [idx]: [...(prev[idx] || (current ? [current] : [])), next] }));
      replaceBulletDraft(idx, next);
      setConfirmedBullets(prev => ({ ...prev, [idx]: false }));
      setBulletOptimizationNotes(prev => ({ ...prev, [idx]: "" }));
      toast.success(`已新增优化候选 ${candidates.length + 1}/4`);
    } catch (error: any) { toast.error(`卖点优化失败: ${error?.message || "未知错误"}`); }
  };

  const handleStartEditBullet = (idx: number) => {
    const bullet = generatedBullets[idx];
    if (!bullet) return;
    setEditBulletData({ subtitle: bullet.subtitle || "", fullText: bullet.fullText || "" });
    setEditingBullet(idx);
  };

  const handleSaveEditBullet = (idx: number) => {
    replaceBulletDraft(idx, {
      ...latestBulletsRef.current[idx],
      subtitle: editBulletData.subtitle,
      fullText: editBulletData.fullText,
      evidenceUsed: [],
      keywordsUsed: [],
      distinctFromPrevious: undefined,
      qualityAudit: undefined,
      manuallyEdited: true,
      checkListScores: undefined,
      aiSemanticRelations: undefined,
      staleSource: !!latestBulletsRef.current[idx]?.staleSource,
      actualCharacterCount: (editBulletData.subtitle + " " + editBulletData.fullText).length,
      characterCount: (editBulletData.subtitle + " " + editBulletData.fullText).length,
    });
    setConfirmedBullets(prev => ({ ...prev, [idx]: false }));
    setEditingBullet(null);
    if (latestBulletsRef.current[idx]?.staleSource) toast.info("编辑已保留供参考，但旧核心草案仍不可确认；请按当前核心重新生成");
    else toast.success("卖点内容已更新");
  };

  const handleResetStepBullet = () => {
    coreRevisionRef.current += 1;
    sellingPointPlan.reset();
    setConfirmedCores([]);
    setGeneratedBullets({});
    setConfirmedBullets({});
    setStepBulletPhase("idle");
    setEditingCore(null);
    setEditingBullet(null);
    setShowAddForm(false);
  };

  // Legacy locked-step fine-tuning still references this mutation. The server
  // rejects unreviewed free-text writes; never report success optimistically.
  const syncBulletsMut = trpc.listing.syncBulletsFromSellingPoints.useMutation({
    onError: (error) => toast.error(`旧版自由文本同步不可用：${error.message}`),
  });

  // Run 15-dimension checklist evaluation for a bullet
  const handleRunChecklist = async (idx: number) => {
    const bullet = generatedBullets[idx];
    if (!bullet?.subtitle || !bullet?.fullText) return;
    setEvaluatingChecklist(prev => ({ ...prev, [idx]: true }));
    try {
      const result = await evaluateChecklist.mutateAsync({
        subtitle: bullet.subtitle,
        fullText: bullet.fullText,
        bulletIndex: idx,
        evidenceUsed: bullet.evidenceUsed || [],
      });
      if (bulletFingerprint(latestBulletsRef.current[idx]) !== bulletFingerprint(bullet)) return;
      const updated = { ...latestBulletsRef.current, [idx]: { ...latestBulletsRef.current[idx],
        checkListScores: result.checkListScores, aiSemanticRelations: result.aiSemanticRelations } };
      latestBulletsRef.current = updated;
      setGeneratedBullets(updated);
      persistChecklistScores(updated);
      toast.success(`卖点 ${idx + 1} 自检完成`);
    } catch (err: any) {
      toast.error(`自检失败: ${err.message}`);
    } finally {
      setEvaluatingChecklist(prev => ({ ...prev, [idx]: false }));
    }
  };

  const hasCompleteBulletChecklist = (scores: unknown) => {
    if (!scores || typeof scores !== "object") return false;
    const entries = Object.values(scores as Record<string, unknown>);
    return entries.length === 15 && entries.every((entry) => {
      const score = entry as { pass?: unknown; notes?: unknown } | null;
      return typeof score?.pass === "boolean" && typeof score?.notes === "string";
    });
  };

  // Batch checklist evaluation for all confirmed bullets
  const [batchChecklistRunning, setBatchChecklistRunning] = useState(false);
  const handleBatchChecklist = async () => {
    if (!sellingPointCores) return;
    setBatchChecklistRunning(true);
    let successCount = 0;
    for (let idx = 0; idx < sellingPointCores.length; idx++) {
      const bullet = latestBulletsRef.current[idx];
      if (!bullet?.subtitle || !bullet?.fullText) continue;
      if (hasCompleteBulletChecklist(bullet.checkListScores)) continue;
      setEvaluatingChecklist(prev => ({ ...prev, [idx]: true }));
      try {
        const result = await evaluateChecklist.mutateAsync({
          subtitle: bullet.subtitle,
          fullText: bullet.fullText,
          bulletIndex: idx,
          evidenceUsed: bullet.evidenceUsed || [],
        });
        if (bulletFingerprint(latestBulletsRef.current[idx]) !== bulletFingerprint(bullet)) continue;
        const nextBullets = {
          ...latestBulletsRef.current,
          [idx]: {
            ...latestBulletsRef.current[idx],
            checkListScores: result.checkListScores,
            aiSemanticRelations: result.aiSemanticRelations,
          },
        };
        setGeneratedBullets(nextBullets);
        latestBulletsRef.current = nextBullets;
        successCount++;
      } catch { /* continue with next */ }
      finally { setEvaluatingChecklist(prev => ({ ...prev, [idx]: false })); }
    }
    // Persist all scores to DB after batch
    persistChecklistScores(latestBulletsRef.current);
    setBatchChecklistRunning(false);
    toast.success(`批量自检完成，成功 ${successCount} 条`);
  };

  // Lock/Unlock helpers - persist to DB
  const handleLockStep = (step: number) => {
    setLockedSteps(prev => {
      const n = new Set(prev);
      n.add(step);
      // Persist to DB
      if (selectedProjectId) {
        updateLockedStepsMut.mutate({ projectId: selectedProjectId, lockedSteps: Array.from(n) });
      }
      return n;
    });
  };

  const handleUnlockStep = (step: number) => {
    setLockedSteps(prev => {
      const n = new Set(prev);
      n.delete(step);
      // Persist to DB
      if (selectedProjectId) {
        updateLockedStepsMut.mutate({ projectId: selectedProjectId, lockedSteps: Array.from(n) });
      }
      return n;
    });
    setCompletedSteps(prev => { const n = new Set(prev); n.delete(step); return n; });
  };

  const handleUnlockBullets = () => {
    handleUnlockStep(1);
    setLockedFineTuneIdx(null);
    setShowLockedAddForm(false);
    toast.info("卖点已解锁，可重新编辑");
  };

  // The legacy locked-mode keyword route does not carry a confirmed core revision.
  // Refuse before keyword expansion or any model call; the reviewed workflow is below.
  const handleLockedAiGenerate = () => {
    toast.info("此旧版扩写入口已停用。请解锁后先确认本品事实与卖点核心，再用逐条精雕生成。历史文案不会被覆盖。");
  };

  const allBulletsConfirmed = sellingPointCores
    ? sellingPointCores.some(Boolean) && sellingPointCores.every((point, i) => !point || confirmedBullets[i])
    : false;

  const confirmedBulletCount = Object.values(confirmedBullets).filter(Boolean).length;
  const totalCoresCount = sellingPointCores?.filter(Boolean).length || 0;
  const manualCoresCount = sellingPointCores?.filter((sp): sp is any => Boolean(sp?.isManual)).length || 0;
  const canAddMore = totalCoresCount < 9;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">智能Listing创建工作台</h1>
          <p className="text-muted-foreground mt-1">
            5步引导式Listing创建：AI生成 → 人工编辑 → 确认锁定 → 结果预览
          </p>
        </div>
        <ProjectSelector />
      </div>

      {!selectedProjectId ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <AlertTriangle className="h-8 w-8 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">请先在项目管理中创建并选择一个项目</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <DistillationGuidancePicker value={distillationBinding} onChange={setDistillationBinding} />
          <ListingPlanningPanel projectId={selectedProjectId} binding={distillationBinding} />
          {/* Step Progress Indicator */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1">
                {LISTING_STEPS.map((step, idx) => {
                  const StepIcon = step.icon;
                  const isActive = activeStep === step.id;
                  const isCompleted = completedSteps.has(step.id);
                  const isLocked = lockedSteps.has(step.id);
                  return (
                    <div key={step.id} className="flex items-center flex-1">
                      <button
                        onClick={() => setActiveStep(step.id)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all w-full justify-center ${
                          isActive
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : isLocked
                            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 hover:bg-green-200 ring-1 ring-green-400"
                            : isCompleted
                            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 hover:bg-green-200"
                            : "bg-muted/50 text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {isLocked ? (
                          <Lock className="h-4 w-4 shrink-0 text-green-600" />
                        ) : isCompleted && !isActive ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0" />
                        ) : (
                          <StepIcon className="h-4 w-4 shrink-0" />
                        )}
                        <span className="hidden sm:inline">{step.label}</span>
                        <span className="sm:hidden text-xs">{step.id}</span>
                        {isLocked && <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-green-50 text-green-600 border-green-300 hidden md:inline-flex">已锁定</Badge>}
                      </button>
                      {idx < LISTING_STEPS.length - 1 && (
                        <ChevronRight className={`h-4 w-4 mx-1 shrink-0 ${
                          isCompleted ? "text-green-500" : "text-muted-foreground/40"
                        }`} />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Progress value={(completedSteps.size / 5) * 100} className="h-1.5 flex-1" />
                <span className="text-xs text-muted-foreground">{completedSteps.size}/5 已完成</span>
              </div>
            </CardContent>
          </Card>
          {/* ===== Step 1: 卖点精雕 ===== */}
          {activeStep === 1 && (<>
          {/* Locked state for Step 1 - with fine-tuning support */}
          {lockedSteps.has(1) && (() => {
            // Try to get bullets from memory first, then from DB
            const savedBullets: { subtitle: string; fullText: string }[] = (() => {
              const memBullets = sellingPointCores?.map((_, idx) => {
                const bullet = generatedBullets[idx];
                if (bullet && confirmedBullets[idx]) return { subtitle: bullet.subtitle || "", fullText: bullet.fullText || "" };
                return null;
              }).filter(Boolean) as { subtitle: string; fullText: string }[] || [];
              if (memBullets.length > 0) return memBullets;
              if (activeListing?.bulletPoints) {
                try {
                  const parsed = JSON.parse(activeListing.bulletPoints);
                  if (Array.isArray(parsed)) {
                    return parsed.map((bp: any, i: number) => {
                      if (typeof bp === "string") {
                        const parts = bp.match(/^(\S+)\s+(.+)$/);
                        return parts ? { subtitle: parts[1], fullText: parts[2] } : { subtitle: `卖点 ${i + 1}`, fullText: bp };
                      }
                      if (typeof bp === "object" && bp !== null) {
                        return { subtitle: bp.subtitle || bp.title || `卖点 ${i + 1}`, fullText: bp.fullText || bp.text || bp.content || "" };
                      }
                      return { subtitle: `卖点 ${i + 1}`, fullText: String(bp) };
                    });
                  }
                } catch { /* ignore */ }
              }
              return [];
            })();
            return (
            <Card className="border-2 border-green-300 bg-green-50/30 dark:border-green-800 dark:bg-green-950/10">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between px-3 py-2 rounded-lg border-2 border-green-300 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20">
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4 text-green-600" />
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium text-green-800 dark:text-green-300">
                      卖点已确认并锁定
                    </span>
                    <Badge className="bg-green-600 text-white text-[10px] px-1.5">已同步</Badge>
                    <span className="text-xs text-green-600 dark:text-green-400">{savedBullets.length} 条卖点已同步到预览页</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] border-teal-400 text-teal-700 bg-teal-50">
                      <Pencil className="h-3 w-3 mr-1" />支持微调
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
                      onClick={handleUnlockBullets}
                    >
                      <Unlock className="h-3 w-3 mr-1" />完全解锁
                    </Button>
                  </div>
                </div>

                {Object.keys(bulletCandidates).length > 0 && (
                  <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3">
                    <div className="mb-2 flex items-center gap-2"><span className="text-xs font-medium text-violet-800">卖点优化候选记录</span><span className="text-[10px] text-muted-foreground">锁定仅影响同步版本，历史候选仍可查看</span></div>
                    <div className="space-y-2">
                      {Object.entries(bulletCandidates).map(([bulletIndex, candidates]) => (
                        <div key={bulletIndex} className="rounded border bg-white/70 p-2"><p className="mb-1 text-[11px] font-medium">卖点 {Number(bulletIndex) + 1}</p><div className="space-y-1">{(candidates as any[]).map((candidate, candidateIndex) => {
                          const locked = generatedBullets[Number(bulletIndex)] === candidate;
                          return <div key={candidateIndex} className={`rounded px-2 py-1 text-[11px] ${locked ? "border border-green-400 bg-green-50" : "bg-muted/50"}`}><span className="font-medium">候选 {candidateIndex + 1}</span>{locked && <Badge className="ml-2 bg-green-600 text-[9px]">已锁定并同步</Badge>}<span className="ml-2 text-muted-foreground">{candidate.optimizationNote || "初始生成"}</span></div>;
                        })}</div></div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fine-tunable bullet list */}
                <div className="space-y-2">
                  {savedBullets.map((bullet, idx) => (
                    <div key={idx} className={`rounded-lg border p-3 transition-all ${
                      lockedFineTuneIdx === idx
                        ? "border-teal-400 bg-teal-50/50 shadow-sm"
                        : "border-green-200 bg-white/60 hover:border-teal-300 hover:bg-teal-50/20"
                    }`}>
                      {lockedFineTuneIdx === idx ? (
                        /* Inline editing mode */
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge className="bg-teal-600 text-white text-[10px]">{idx + 1}</Badge>
                              <span className="text-xs font-medium text-teal-700">编辑模式</span>
                            </div>
                            <CharCountBadge
                              count={(lockedFineTuneData.subtitle + " " + lockedFineTuneData.fullText).length}
                              min={200}
                              max={280}
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">小标题 (Subtitle)</Label>
                            <Input
                              value={lockedFineTuneData.subtitle}
                              onChange={(e) => setLockedFineTuneData(prev => ({ ...prev, subtitle: e.target.value }))}
                              className="h-8 text-sm font-bold mt-1"
                              placeholder="例如: 【Premium Quality】"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">正文 (Full Text)</Label>
                            <Textarea
                              value={lockedFineTuneData.fullText}
                              onChange={(e) => setLockedFineTuneData(prev => ({ ...prev, fullText: e.target.value }))}
                              rows={3}
                              className="text-sm resize-none mt-1"
                              placeholder="卖点正文内容..."
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" className="bg-teal-600 hover:bg-teal-700" onClick={async () => {
                              // Save the fine-tuned bullet
                              const newBullets = [...savedBullets];
                              newBullets[idx] = { subtitle: lockedFineTuneData.subtitle, fullText: lockedFineTuneData.fullText };
                              if (!selectedProjectId) return;
                              try {
                                await syncBulletsMut.mutateAsync({ projectId: selectedProjectId, bullets: newBullets });
                                setLockedFineTuneIdx(null);
                                toast.success(`第 ${idx + 1} 条卖点已同步`);
                              } catch { /* onError already tells the operator; keep the editor open. */ }
                            }} disabled={syncBulletsMut.isPending}>
                              {syncBulletsMut.isPending ? (
                                <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />保存中...</>
                              ) : (
                                <><Check className="h-3.5 w-3.5 mr-1" />保存并同步</>
                              )}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setLockedFineTuneIdx(null)}>取消</Button>
                          </div>
                        </div>
                      ) : (
                        /* Read-only mode with edit trigger */
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 flex-1 min-w-0">
                            <Badge variant="outline" className="text-[10px] shrink-0 border-green-400 mt-0.5">{idx + 1}</Badge>
                            <div className="min-w-0">
                              <span className="font-medium text-sm text-green-800 dark:text-green-300">{bullet.subtitle}</span>
                              <p className="text-xs text-green-600 dark:text-green-400 mt-0.5 line-clamp-2">{bullet.fullText}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <CharCountBadge
                              count={(bullet.subtitle + " " + bullet.fullText).length}
                              min={200}
                              max={280}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-teal-600 hover:text-teal-800 hover:bg-teal-50"
                              onClick={() => {
                                setLockedFineTuneIdx(idx);
                                setLockedFineTuneData({ subtitle: bullet.subtitle, fullText: bullet.fullText });
                              }}
                            >
                              <Pencil className="h-3 w-3 mr-1" />微调
                            </Button>
                            {savedBullets.length > 5 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
                                onClick={async () => {
                                  const newBullets = savedBullets.filter((_, i) => i !== idx);
                                  if (selectedProjectId && newBullets.length >= 1) {
                                    try {
                                      await syncBulletsMut.mutateAsync({ projectId: selectedProjectId, bullets: newBullets });
                                      toast.success(`已删除第 ${idx + 1} 条卖点并同步`);
                                    } catch { /* Keep persisted content unchanged on refusal. */ }
                                  }
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {savedBullets.length === 0 && (
                    <p className="text-sm text-muted-foreground">卖点数据已同步到预览页（刷新后可在预览页查看完整内容）</p>
                  )}
                </div>

                {/* Add new bullet in locked mode */}
                {savedBullets.length < 9 && (
                  <div className="space-y-2">
                    {!showLockedAddForm ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full border-dashed border-teal-300 text-teal-700 hover:bg-teal-50"
                        onClick={() => setShowLockedAddForm(true)}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" />
                        新增卖点 ({savedBullets.length}/9)
                      </Button>
                    ) : (
                      <div className="rounded-lg border-2 border-dashed border-teal-300 p-4 bg-teal-50/30 space-y-3">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-medium text-teal-700 flex items-center gap-2">
                            <Plus className="h-4 w-4" />
                            新增卖点 (还可添加 {9 - savedBullets.length} 条)
                          </h4>
                          <div className="flex gap-1 bg-muted rounded-md p-0.5">
                            <button
                              className={`px-3 py-1 text-xs rounded transition-colors ${
                                lockedAddMode === "ai"
                                  ? "bg-background shadow-sm text-teal-700 font-medium"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                              onClick={() => setLockedAddMode("ai")}
                            >
                              <Wand2 className="h-3 w-3 inline mr-1" />AI辅助
                            </button>
                            <button
                              className={`px-3 py-1 text-xs rounded transition-colors ${
                                lockedAddMode === "manual"
                                  ? "bg-background shadow-sm text-teal-700 font-medium"
                                  : "text-muted-foreground hover:text-foreground"
                              }`}
                              onClick={() => setLockedAddMode("manual")}
                            >
                              <Pencil className="h-3 w-3 inline mr-1" />手动填写
                            </button>
                          </div>
                        </div>

                        {lockedAddMode === "ai" ? (
                          <div className="space-y-2">
                            <Label className="text-xs">输入关键词或卖点主题 <span className="text-red-500">*</span></Label>
                            <p className="text-xs text-muted-foreground">输入一个关键词或简短主题，AI将自动生成完整的Bullet Point</p>
                            <div className="flex gap-2">
                              <Input
                                placeholder="例如: waterproof, eco-friendly, easy assembly..."
                                value={lockedAddKeyword}
                                onChange={(e) => setLockedAddKeyword(e.target.value)}
                                className="h-9 text-sm flex-1"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && lockedAddKeyword.trim()) {
                                    handleLockedAiGenerate();
                                  }
                                }}
                              />
                              <Button
                                size="sm"
                                onClick={handleLockedAiGenerate}
                                disabled={!lockedAddKeyword.trim() || expandKeyword.isPending}
                                className="bg-teal-600 hover:bg-teal-700 h-9"
                              >
                                {expandKeyword.isPending ? (
                                  <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />生成中...</>
                                ) : (
                                  <><Wand2 className="h-3.5 w-3.5 mr-1" />AI生成</>
                                )}
                              </Button>
                            </div>
                            {lockedAiResult && (
                              <div className="space-y-2 rounded-lg border border-teal-200 bg-white/80 p-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Sparkles className="h-4 w-4 text-teal-600" />
                                    <span className="text-sm font-medium text-teal-700">AI生成结果</span>
                                  </div>
                                  <CharCountBadge
                                    count={(lockedAiResult.subtitle + " " + lockedAiResult.fullText).length}
                                    min={200}
                                    max={280}
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs text-muted-foreground">小标题</Label>
                                  <Input
                                    value={lockedAiResult.subtitle}
                                    onChange={(e) => setLockedAiResult((prev: any) => prev ? ({ ...prev, subtitle: e.target.value }) : prev)}
                                    className="h-8 text-sm font-bold mt-1"
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs text-muted-foreground">正文</Label>
                                  <Textarea
                                    value={lockedAiResult.fullText}
                                    onChange={(e) => setLockedAiResult((prev: any) => prev ? ({ ...prev, fullText: e.target.value }) : prev)}
                                    rows={3}
                                    className="text-sm resize-none mt-1"
                                  />
                                </div>
                                <div className="flex gap-2">
                                  <Button size="sm" className="bg-teal-600 hover:bg-teal-700" onClick={async () => {
                                    if (!lockedAiResult || !selectedProjectId) return;
                                    const newBullets = [...savedBullets, { subtitle: lockedAiResult.subtitle, fullText: lockedAiResult.fullText }];
                                    try {
                                      await syncBulletsMut.mutateAsync({ projectId: selectedProjectId, bullets: newBullets });
                                      setLockedAiResult(null);
                                      setLockedAddKeyword("");
                                      setShowLockedAddForm(false);
                                      toast.success("新卖点已添加并同步");
                                    } catch { /* Retain the AI draft for human review. */ }
                                  }} disabled={syncBulletsMut.isPending}>
                                    <Check className="h-3.5 w-3.5 mr-1" />确认添加并同步
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => { setLockedAiResult(null); setLockedAddKeyword(""); }}>
                                    <RotateCcw className="h-3 w-3 mr-1" />重新生成
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div>
                              <Label className="text-xs">小标题 (Subtitle) <span className="text-red-500">*</span></Label>
                              <Input
                                placeholder="例如: 【Premium Quality】"
                                value={lockedAddSubtitle}
                                onChange={(e) => setLockedAddSubtitle(e.target.value)}
                                className="h-8 text-sm mt-1"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">正文 (Full Text) <span className="text-red-500">*</span></Label>
                              <Textarea
                                placeholder="卖点正文内容..."
                                value={lockedAddFullText}
                                onChange={(e) => setLockedAddFullText(e.target.value)}
                                rows={3}
                                className="text-sm resize-none mt-1"
                              />
                            </div>
                            <div className="flex items-center justify-between">
                              <CharCountBadge
                                count={(lockedAddSubtitle + " " + lockedAddFullText).length}
                                min={200}
                                max={280}
                              />
                              <div className="flex gap-2">
                                <Button size="sm" className="bg-teal-600 hover:bg-teal-700" onClick={async () => {
                                  if (!lockedAddSubtitle.trim() || !lockedAddFullText.trim() || !selectedProjectId) return;
                                  const newBullets = [...savedBullets, { subtitle: lockedAddSubtitle, fullText: lockedAddFullText }];
                                  try {
                                    await syncBulletsMut.mutateAsync({ projectId: selectedProjectId, bullets: newBullets });
                                    setLockedAddSubtitle("");
                                    setLockedAddFullText("");
                                    setShowLockedAddForm(false);
                                    toast.success("新卖点已添加并同步");
                                  } catch { /* Keep input until a reviewed sync path is available. */ }
                                }} disabled={!lockedAddSubtitle.trim() || !lockedAddFullText.trim() || syncBulletsMut.isPending}>
                                  <Plus className="h-3.5 w-3.5 mr-1" />添加并同步
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => { setShowLockedAddForm(false); setLockedAddSubtitle(""); setLockedAddFullText(""); }}>取消</Button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Close button for AI mode */}
                        {lockedAddMode === "ai" && !lockedAiResult && (
                          <div className="flex justify-end">
                            <Button size="sm" variant="ghost" onClick={() => { setShowLockedAddForm(false); setLockedAddKeyword(""); }}>取消</Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
            );
          })()}
          {/* Unlocked Step 1 content */}
          {!lockedSteps.has(1) && (<>
          <ListingGenerationPreparationSummary
            project={project}
            analysisCount={analyses?.length || 0}
            fileSummary={fileSummary}
            kwReadiness={kwReadiness}
            onManageKeywords={() => setLocation("/listing/keywords")}
          />

          {/* Step-by-Step Bullet Crafting Section - Main Content */}
          <Card className="border-teal-200 bg-gradient-to-br from-teal-50/50 to-transparent dark:from-teal-950/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-teal-600" />
                分步卖点精雕
              </CardTitle>
              <CardDescription>
                AI生成卖点核心方向 → 事实与核心人工审核 → 逐条编辑并确认候选 → 查看全字段差异后人工同步
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">事实与核心审核（确认方向前必填，点击展开）</summary>
                <div className="mt-3 space-y-4">
              {selectedProjectId && <FactReviewPanel projectId={selectedProjectId} />}
              {selectedProjectId && <CoreReviewPanel projectId={selectedProjectId} />}
              {selectedProjectId && <section className="space-y-2" aria-label="已审核卖点候选恢复">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">已保存候选的人工审阅</h3>
                  <p className="text-xs text-slate-600">候选入口直接使用当前项目的服务端核心版本；刷新后无需重跑模型。核心或事实已失效的历史只供审计，不能错绑到当前核心。</p>
                </div>
                {reviewedCoresQuery.isLoading && <p className="text-xs text-slate-600">正在恢复已审核核心与候选入口…</p>}
                {reviewedCoresQuery.isError && <p role="alert" className="text-xs text-red-700">无法恢复候选入口：{reviewedCoresQuery.error.message}</p>}
                {!reviewedCoresQuery.isLoading && !reviewedCoresQuery.isError && currentConfirmedCoreBindings.length === 0 && <p className="text-xs text-slate-600">当前项目暂无仍有效且已确认的核心；请先审核事实并确认核心后再创建或继续审阅候选。</p>}
                {currentConfirmedCoreBindings.map((core) => <CandidateReviewPanel
                  key={`candidate-active-${selectedProjectId}-${core.id}`}
                  projectId={selectedProjectId}
                  coreRevisionId={core.id}
                  coreInputHash={core.inputHash}
                  factRevisionIds={factRevisionIdsForCore(core)}
                  factLabels={factLabels}
                />)}
                {!reviewedCoresQuery.isLoading && !reviewedCoresQuery.isError && <CandidateReviewPanel
                  key={`candidate-history-${selectedProjectId}`}
                  projectId={selectedProjectId}
                  factRevisionIds={[]}
                  factLabels={factLabels}
                  readOnlyHistory
                />}
              </section>}
                </div>
              </details>
              {/* Phase: Generate Cores */}
              {stepBulletPhase === "idle" && (
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={handleGenerateCores}
                  disabled={sellingPointsJob.isGenerating}
                >
                  {sellingPointsJob.isGenerating ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />正在分析卖点方向...</>
                  ) : (
                    <><Target className="h-4 w-4 mr-2" />Step 1: 生成7条卖点核心方向</>
                  )}
                </Button>
              )}

              <ListingGenerationJobStatus
                run={sellingPointsJob.run}
                isGenerating={sellingPointsJob.isGenerating}
                isCanceling={sellingPointsJob.isCanceling}
                onCancel={() => void sellingPointsJob.cancel()}
                onRetry={handleGenerateCores}
              />
              {latestSingleBulletJob && (
                <ListingGenerationJobStatus
                  run={latestSingleBulletJob}
                  isGenerating={singleBulletGenerating}
                  isCanceling={cancelListingJob.isPending}
                  onCancel={() => void cancelListingJob.mutateAsync({
                    projectId: selectedProjectId!,
                    nodeId: "G1",
                    scopeKey: String((latestSingleBulletJob.input as any)?.scopeKey || "main"),
                  }).then(() => g1JobsQuery.refetch())}
                  onRetry={() => {
                    const scopeKey = String((latestSingleBulletJob.input as any)?.scopeKey || "");
                    const match = scopeKey.match(/^bullet-(\d+)$/);
                    if (match) void handleGenerateSingleBullet(Number(match[1]));
                  }}
                />
              )}
              {sellingPointsJob.isGenerating && (
                <GeneratingProgress />
              )}

              {/* Phase: Confirm/Edit Cores */}
              {sellingPointCores && sellingPointCores.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">
                        卖点核心方向 ({confirmedCores.filter(Boolean).length}/{sellingPointCores.length} 已确认)
                        {manualCoresCount > 0 && (
                          <span className="text-xs text-muted-foreground ml-2">
                            (含 {manualCoresCount} 条手动添加)
                          </span>
                        )}
                      </h3>
                    </div>
                    <div className="flex items-center gap-2">
                      {canAddMore && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setShowKeywordImport(true);
                              setSelectedKeywordIds(new Set());
                            }}
                          >
                            <Download className="h-3.5 w-3.5 mr-1" />
                            从关键词导入
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setShowAddForm(!showAddForm)}>
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            手动添加 ({totalCoresCount}/9)
                          </Button>
                        </>
                      )}
                      <Button variant="ghost" size="sm" onClick={handleResetStepBullet}>
                        <RotateCcw className="h-3.5 w-3.5 mr-1" />重新生成
                      </Button>
                    </div>
                  </div>
                  <SellingPointPlanSummary metadata={sellingPointPlan.metadata} />

                  {/* Manual Add Form with AI Assist */}
                  {showAddForm && canAddMore && (
                    <div className="rounded-lg border-2 border-dashed border-teal-300 p-4 bg-teal-50/30 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-teal-700 flex items-center gap-2">
                          <Plus className="h-4 w-4" />
                          添加自定义卖点 (还可添加 {9 - totalCoresCount} 条)
                        </h4>
                        <div className="flex gap-1 bg-muted rounded-md p-0.5">
                          <button
                            className={`px-3 py-1 text-xs rounded transition-colors ${
                              aiAssistMode
                                ? "bg-background shadow-sm text-teal-700 font-medium"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                            onClick={() => { setAiAssistMode(true); setAiResult(null); }}
                          >
                            <Wand2 className="h-3 w-3 inline mr-1" />AI辅助
                          </button>
                          <button
                            className={`px-3 py-1 text-xs rounded transition-colors ${
                              !aiAssistMode
                                ? "bg-background shadow-sm text-teal-700 font-medium"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                            onClick={() => { setAiAssistMode(false); setAiResult(null); }}
                          >
                            <Pencil className="h-3 w-3 inline mr-1" />手动填写
                          </button>
                        </div>
                      </div>

                      {aiAssistMode ? (
                        <div className="space-y-3">
                          {/* AI Keyword Input */}
                          {!aiResult && (
                            <div className="space-y-2">
                              <Label className="text-xs">输入关键词或卖点主题 <span className="text-red-500">*</span></Label>
                              <p className="text-xs text-muted-foreground">输入一个关键词或简短主题，AI将自动扩展为完整的FABE格式卖点</p>
                              <div className="flex gap-2">
                                <Input
                                  placeholder="例如: waterproof, eco-friendly, easy assembly, 防水设计..."
                                  value={aiKeyword}
                                  onChange={(e) => setAiKeyword(e.target.value)}
                                  className="h-9 text-sm flex-1"
                                  onKeyDown={(e) => { if (e.key === "Enter" && aiKeyword.trim()) handleAiExpand(); }}
                                />
                                <Button
                                  size="sm"
                                  onClick={handleAiExpand}
                                  disabled={!aiKeyword.trim() || expandKeyword.isPending}
                                  className="bg-teal-600 hover:bg-teal-700 h-9"
                                >
                                  {expandKeyword.isPending ? (
                                    <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />AI生成中...</>
                                  ) : (
                                    <><Wand2 className="h-3.5 w-3.5 mr-1" />AI生成FABE</>
                                  )}
                                </Button>
                              </div>
                            </div>
                          )}

                          {/* AI Result Preview & Edit */}
                          {aiResult && (
                            <div className="space-y-3 rounded-lg border border-teal-200 bg-white/80 p-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <Sparkles className="h-4 w-4 text-teal-600" />
                                  <span className="text-sm font-medium text-teal-700">AI生成结果</span>
                                </div>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs"
                                  onClick={() => { setAiResult(null); }}
                                >
                                  <RotateCcw className="h-3 w-3 mr-1" />重新生成
                                </Button>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                <div>
                                  <Label className="text-xs text-muted-foreground">主题 (EN)</Label>
                                  <Input
                                    value={aiResult.theme}
                                    onChange={(e) => setAiResult((prev: any) => ({ ...prev, theme: e.target.value }))}
                                    className="h-8 text-sm font-medium"
                                  />
                                </div>
                                <div>
                                  <Label className="text-xs text-muted-foreground">主题 (CN)</Label>
                                  <Input
                                    value={aiResult.themeZh}
                                    onChange={(e) => setAiResult((prev: any) => ({ ...prev, themeZh: e.target.value }))}
                                    className="h-8 text-sm"
                                  />
                                </div>
                              </div>

                              <div>
                                <Label className="text-xs text-muted-foreground">描述</Label>
                                <Textarea
                                  value={aiResult.description}
                                  onChange={(e) => setAiResult((prev: any) => ({ ...prev, description: e.target.value }))}
                                  rows={2}
                                  className="text-sm resize-none"
                                />
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {["feature", "advantage", "benefit", "evidence"].map((field) => (
                                  <div key={field}>
                                    <Label className="text-xs text-muted-foreground">
                                      {field === "feature" ? "F - 特征" : field === "advantage" ? "A - 优势" : field === "benefit" ? "B - 利益" : "E - 证据"}
                                    </Label>
                                    <Textarea
                                      value={aiResult.fabeDirection?.[field] || ""}
                                      onChange={(e) => setAiResult((prev: any) => ({
                                        ...prev,
                                        fabeDirection: { ...prev.fabeDirection, [field]: e.target.value }
                                      }))}
                                      rows={2}
                                      className="text-xs resize-none"
                                    />
                                  </div>
                                ))}
                              </div>

                              {aiResult.targetKeywords?.length > 0 && (
                                <div>
                                  <Label className="text-xs text-muted-foreground">目标关键词</Label>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {aiResult.targetKeywords.map((kw: string, i: number) => (
                                      <Badge key={i} variant="secondary" className="text-xs">{kw}</Badge>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {aiResult.addressesGap && (
                                <div>
                                  <Label className="text-xs text-muted-foreground">解决的竞品缺口</Label>
                                  <p className="text-xs text-muted-foreground mt-0.5">{aiResult.addressesGap}</p>
                                </div>
                              )}

                              <div className="flex gap-2 pt-1">
                                <Button size="sm" onClick={handleConfirmAiResult} className="bg-teal-600 hover:bg-teal-700">
                                  <Check className="h-3.5 w-3.5 mr-1" />确认添加
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => { setAiResult(null); setAiKeyword(""); }}>取消</Button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        /* Manual Mode */
                        <div className="space-y-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <Label className="text-xs">卖点主题 (英文) <span className="text-red-500">*</span></Label>
                              <Input
                                placeholder="例如: Eco-Friendly Design"
                                value={newCoreTheme}
                                onChange={(e) => setNewCoreTheme(e.target.value)}
                                className="h-8 text-sm"
                              />
                            </div>
                            <div>
                              <Label className="text-xs">卖点主题 (中文)</Label>
                              <Input
                                placeholder="例如: 环保设计"
                                value={newCoreThemeZh}
                                onChange={(e) => setNewCoreThemeZh(e.target.value)}
                                className="h-8 text-sm"
                              />
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs">描述</Label>
                            <Textarea
                              placeholder="简要描述这条卖点应该传达什么信息..."
                              value={newCoreDescription}
                              onChange={(e) => setNewCoreDescription(e.target.value)}
                              rows={2}
                              className="text-sm resize-none"
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={handleAddManualCore} disabled={!newCoreTheme.trim()}>
                              <Plus className="h-3.5 w-3.5 mr-1" />添加
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>取消</Button>
                          </div>
                        </div>
                      )}

                      {/* Close button when in AI mode without result */}
                      {aiAssistMode && !aiResult && (
                        <div className="flex justify-end">
                          <Button size="sm" variant="ghost" onClick={() => { setShowAddForm(false); setAiAssistMode(false); setAiKeyword(""); }}>取消</Button>
                        </div>
                      )}
                    </div>
                  )}

                  {sellingPointCores.map((sp, idx) => {
                    if (!sp) return null;
                    const coreSafety = sanitizeSelectedSellingPoint(sp);
                    return (
                    <div key={idx} className={`rounded-lg border p-4 transition-all ${
                      confirmedCores[idx]
                        ? "border-green-300 bg-green-50/50 dark:border-green-800 dark:bg-green-950/20"
                        : sp.isManual
                        ? "border-teal-300 bg-teal-50/30"
                        : "border-muted"
                    }`}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={`text-xs ${sp.isManual ? "border-teal-400 text-teal-700" : ""}`}>
                            {idx + 1}
                            {sp.isManual && " (手动)"}
                          </Badge>
                          {editingCore === idx ? (
                            <Input
                              value={sp.theme}
                              onChange={(e) => handleEditCore(idx, "theme", e.target.value)}
                              className="h-7 text-sm font-medium w-48"
                            />
                          ) : (
                            <span className="text-sm font-semibold">{sp.theme}</span>
                          )}
                          {sp.themeZh && <span className="text-xs text-muted-foreground">({sp.themeZh})</span>}
                        </div>
                        <div className="flex items-center gap-1">
                          {!confirmedCores[idx] && (
                            <>
                              {sp.isManual && (
                                <Button variant="ghost" size="sm" className="h-7 px-2 text-red-500 hover:text-red-700" onClick={() => handleRemoveCore(idx)}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { sellingPointPlan.markDirty(); setEditingCore(editingCore === idx ? null : idx); }}>
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button variant="default" size="sm" className="h-7 px-3 bg-green-600 hover:bg-green-700" disabled={reviewCoreMutation.isPending || reviewedFactsQuery.isLoading || reviewedCoresQuery.isLoading} onClick={() => void handleConfirmCore(idx)}>
                                <Check className="h-3 w-3 mr-1" />确认事实与核心
                              </Button>
                            </>
                          )}
                          {confirmedCores[idx] && (
                            <>
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => handleReopenCore(idx)}>编辑核心</Button>
                              <Badge className={coreBinding(idx) ? "bg-green-600 text-white text-[10px]" : "bg-amber-600 text-white text-[10px]"}><CheckCircle2 className="h-3 w-3 mr-1" />{coreBinding(idx) ? `服务端已确认 v${coreBinding(idx)?.revision}` : "待绑定已审事实"}</Badge>
                            </>
                          )}
                        </div>
                      </div>

                      {(!coreSafety.canGenerate || coreSafety.excludedFields.length > 0) && (
                        <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900" role="alert">
                          空白或示例不是商品事实。{coreSafety.excludedFields.length > 0 ? `需核实：${coreSafety.excludedFields.join("、")}。` : ""}
                          {!coreSafety.canGenerate ? "当前缺少可用产品事实，无法生成。" : "请编辑并确认真实数据；模型不会使用这些字段。"}
                        </div>
                      )}

                      {!confirmedCores[idx] && <details className="mb-2 text-xs">
                        <summary className="cursor-pointer text-muted-foreground">确认前选择本品事实（必选，已选 {(coreFactSelection[idx] || []).length} 条）</summary>
                        <fieldset className="mt-2 rounded-md border border-slate-200 bg-white px-2 py-1.5">
                        <legend className="px-1 font-medium">选择本条卖点的已确认事实（必选）</legend>
                        {reviewedFactsQuery.isError && <p role="alert" className="text-red-700">事实账本读取失败，请刷新后重试</p>}
                        {!reviewedFactsQuery.data?.some((fact) => fact.status === "confirmed") && <p className="text-amber-800">暂无已确认的原始属性表事实；请先在上方审阅，再确认卖点核心。</p>}
                        <div className="max-h-28 space-y-1 overflow-auto">
                          {reviewedFactsQuery.data?.filter((fact) => fact.status === "confirmed").map((fact) => <label key={fact.id} className="flex gap-2 items-start">
                            <Checkbox checked={(coreFactSelection[idx] || []).includes(fact.id)} onCheckedChange={() => { sellingPointPlan.markDirty(); setCoreFactSelection((previous) => ({ ...previous,
                              [idx]: (previous[idx] || []).includes(fact.id) ? previous[idx].filter((id) => id !== fact.id) : [...(previous[idx] || []), fact.id],
                            })); }} />
                            <span>{fact.attributeKey}：{fact.value}</span>
                          </label>)}
                        </div>
                        </fieldset>
                      </details>}

                      {editingCore === idx ? (
                        <div className="space-y-2 mt-3">
                          <div>
                            <Label className="text-xs">描述</Label>
                            <Textarea
                              value={sp.description}
                              onChange={(e) => handleEditCore(idx, "description", e.target.value)}
                              rows={2}
                              className="text-xs resize-none"
                            />
                          </div>
                          {sp.fabeDirection && (
                            <div className="grid grid-cols-2 gap-2">
                              {["feature", "advantage", "benefit", "evidence"].map((f) => (
                                <div key={f}>
                                  <Label className="text-xs capitalize">{f}</Label>
                                  <Input
                                    value={sp.fabeDirection[f] || ""}
                                    onChange={(e) => handleEditCoreFabe(idx, f, e.target.value)}
                                    className="h-7 text-xs"
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                          {sp.targetKeywords?.length > 0 && (
                            <div>
                              <Label className="text-xs">目标关键词</Label>
                              <Input
                                value={sp.targetKeywords.join(", ")}
                                onChange={(e) => handleEditCore(idx, "targetKeywords", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
                                className="h-7 text-xs"
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        <SellingPointDirectionDetails point={sp} />
                      )}

                      {/* Single bullet generation for this core */}
                      {confirmedCores[idx] && (
                        <div className="mt-3 pt-3 border-t">
                          <p className="mb-2 text-[11px] text-muted-foreground">实际生成 Skill：listing.bullet.step.generate v7 · 奥美式买家价值 · 自然美式英语；示例值不作为事实，FABE 不作为固定句式。生成草案可编辑，确认后再同步。</p>
                          {generatedBullets[idx]?.staleSource && <p className="mb-2 text-xs text-amber-700" role="alert">核心曾重新编辑；保留的旧草案仅供参考，需重新生成或人工核实修改后再确认</p>}
                          {!generatedBullets[idx] ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full"
                              onClick={() => handleGenerateSingleBullet(idx)}
                              disabled={singleBulletGenerating}
                            >
                              {singleBulletGenerating ? (
                                <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />生成中...</>
                              ) : (
                                <><Sparkles className="h-3.5 w-3.5 mr-2" />生成第 {idx + 1} 条 Bullet Point</>
                              )}
                            </Button>
                          ) : (
                            <div className="space-y-2">
                              {editingBullet === idx ? (
                                <div className="p-3 rounded-lg bg-muted/30 border space-y-2">
                                  <div>
                                    <Label className="text-xs">小标题 (Subtitle)</Label>
                                    <Input
                                      value={editBulletData.subtitle}
                                      onChange={(e) => setEditBulletData(prev => ({ ...prev, subtitle: e.target.value }))}
                                      className="h-8 text-sm font-bold"
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-xs">正文 (Full Text)</Label>
                                    <Textarea
                                      value={editBulletData.fullText}
                                      onChange={(e) => setEditBulletData(prev => ({ ...prev, fullText: e.target.value }))}
                                      rows={3}
                                      className="text-sm resize-none"
                                    />
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <CharCountBadge
                                      count={(editBulletData.subtitle + " " + editBulletData.fullText).length}
                                      min={200}
                                      max={280}
                                    />
                                    <div className="flex gap-2">
                                      <Button size="sm" onClick={() => handleSaveEditBullet(idx)}>
                                        <Check className="h-3.5 w-3.5 mr-1" />保存
                                      </Button>
                                      <Button size="sm" variant="ghost" onClick={() => setEditingBullet(null)}>取消</Button>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="p-3 rounded-lg bg-muted/30 border">
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="text-sm flex-1">
                                      <span className="font-bold">{generatedBullets[idx].subtitle}</span>
                                      {" "}
                                      <span className="text-muted-foreground">{generatedBullets[idx].fullText}</span>
                                    </p>
                                    <CharCountBadge
                                      count={(generatedBullets[idx].subtitle + " " + generatedBullets[idx].fullText).length}
                                      min={200}
                                      max={280}
                                    />
                                  </div>
                                  <p className="mt-1 text-[11px] text-muted-foreground">
                                    {generatedBullets[idx].executionAudit?.modelSlug
                                      ? `本候选来源模型：${generatedBullets[idx].executionAudit.modelSlug} · ${generatedBullets[idx].executionAudit.executionPreset === "quality_first" ? "质量优先" : "标准路由"} · 回退 ${generatedBullets[idx].executionAudit.fallbackCount ?? "未记录"} 次${generatedBullets[idx].manuallyEdited ? " · 内容已人工修改，需重新自检" : ""}`
                                      : "本候选未记录实际模型；旧数据不推断为 GPT-6 Astra。"}
                                  </p>
                                  {generatedBullets[idx].fabeBreakdown && (
                                    <div className="grid grid-cols-2 gap-1 mt-2">
                                      {Object.entries(generatedBullets[idx].fabeBreakdown).map(([key, val]) => (
                                        val ? <div key={key} className="text-[10px] text-muted-foreground"><span className="font-medium uppercase">{key}:</span> {val as string}</div> : null
                                      ))}
                                    </div>
                                  )}
                                  {generatedBullets[idx].keywordsUsed?.length > 0 && (
                                    <div className="flex gap-1 flex-wrap mt-1.5">
                                      <span className="text-[10px] text-muted-foreground">已埋入:</span>
                                      {generatedBullets[idx].keywordsUsed.map((kw: string, j: number) => (
                                        <Badge key={j} variant="outline" className="text-[10px] bg-teal-50">{kw}</Badge>
                                      ))}
                                    </div>
                                  )}
                                  {/* 15-Dimension Check List Self-Assessment Panel */}
                                  <BulletChecklistPanel
                                    checkListScores={generatedBullets[idx].checkListScores}
                                    bulletIndex={idx}
                                    aiSemanticRelations={generatedBullets[idx].aiSemanticRelations}
                                    onRunCheck={() => handleRunChecklist(idx)}
                                    isRunningCheck={!!evaluatingChecklist[idx]}
                                  />
                                  <div className="mt-2 rounded-md border border-violet-200 bg-violet-50/50 p-2 space-y-2">
                                    <div className="flex items-center justify-between gap-2"><Label className="text-xs text-violet-800">再次优化（最多3次）</Label><span className="text-[10px] text-muted-foreground">当前核心候选 {Math.max(1, (bulletCandidates[idx] || []).filter(candidate => !candidate.staleSource).length)}/4</span></div>
                                    <div className="flex gap-2"><Input className="h-7 text-xs" placeholder="填写优化方向，例如：突出安装便利性、压缩冗余表达" value={bulletOptimizationNotes[idx] || ""} onChange={event => setBulletOptimizationNotes(prev => ({ ...prev, [idx]: event.target.value }))} /><Button size="sm" className="h-7 text-xs" variant="outline" onClick={() => handleOptimizeBullet(idx)} disabled={optimizeBulletMut.isPending || (bulletCandidates[idx] || [generatedBullets[idx]]).filter(candidate => !candidate.staleSource).length >= 4}>{optimizeBulletMut.isPending ? "优化中…" : "生成优化候选"}</Button></div>
                                    {(bulletCandidates[idx] || []).length > 0 && <div className="space-y-1">{bulletCandidates[idx].map((candidate, candidateIndex) => <button key={candidateIndex} disabled={!!candidate.staleSource} onClick={() => { if (candidate.staleSource) return; replaceBulletDraft(idx, { ...candidate, checkListScores: undefined, aiSemanticRelations: undefined }); setConfirmedBullets(prev => ({ ...prev, [idx]: false })); }} className={`w-full rounded border px-2 py-1 text-left text-[11px] ${candidate.staleSource ? "cursor-not-allowed border-amber-200 bg-amber-50 text-amber-700" : bulletFingerprint(generatedBullets[idx]) === bulletFingerprint(candidate) ? "border-violet-500 bg-white" : "border-transparent hover:border-violet-200"}`}>候选 {candidateIndex + 1}{candidate.staleSource ? " · 旧核心，仅供对照" : candidate.optimizationNote ? ` · ${candidate.optimizationNote}` : " · 初始生成"}</button>)}</div>}
                                  </div>
                                </div>
                              )}
                              <div className="flex gap-2">
                                {!confirmedBullets[idx] ? (
                                  <>
                                    <span className="self-center text-xs text-indigo-800">请在下方候选账本中完成人工确认</span>
                                    <Button size="sm" variant="outline" onClick={() => handleStartEditBullet(idx)}>
                                      <Pencil className="h-3.5 w-3.5 mr-1" />编辑
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => handleGenerateSingleBullet(idx)} disabled={singleBulletGenerating}>
                                      <RotateCcw className="h-3.5 w-3.5 mr-1" />重新生成
                                    </Button>
                                  </>
                                ) : (
                                  <Badge className="bg-green-600 text-white"><CheckCircle2 className="h-3 w-3 mr-1" />已确认</Badge>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ); })}

                  {/* Summary when all bullets confirmed */}
                  {allBulletsConfirmed && (
                    <div className="p-4 rounded-lg border-2 border-green-300 bg-green-50/50">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                        <span className="text-sm font-semibold text-green-800">全部 {totalCoresCount} 条卖点已确认</span>
                      </div>
                      <p className="text-xs text-amber-800 mb-3">旧浏览器确认仅用于本地展示；请在上方候选账本完成人审。正式同步需预览全字段变化，并以服务端版本冲突校验提交。</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button variant="outline" size="sm" onClick={handleBatchChecklist} disabled={batchChecklistRunning}>
                          {batchChecklistRunning ? (
                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" />批量自检中...</>
                          ) : (
                            <><CheckCircle2 className="h-4 w-4 mr-2" />一键全部自检</>
                          )}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setLocation("/listing/preview")}>
                          <FileText className="h-4 w-4 mr-2" />查看完整预览
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Partial sync option when some bullets are confirmed */}
                  {!allBulletsConfirmed && confirmedBulletCount > 0 && (
                    <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/30">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-amber-700">
                          已确认 {confirmedBulletCount}/{totalCoresCount} 条卖点
                          {confirmedBulletCount >= 5 && "（正式同步须通过服务端候选版本及Listing快照门禁）"}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          <KeywordImportDialog
            open={showKeywordImport}
            setOpen={setShowKeywordImport}
            searchTerm={kwSearchTerm}
            setSearchTerm={setKwSearchTerm}
            strategyFilter={kwFilterStrategy}
            setStrategyFilter={setKwFilterStrategy}
            placementFilter={kwFilterPlacement}
            setPlacementFilter={setKwFilterPlacement}
            sortOrder={kwSortOrder}
            setSortOrder={setKwSortOrder}
            loading={kwLoading}
            filteredKeywords={filteredKeywords}
            allKeywords={allKeywords}
            selectedIds={selectedKeywordIds}
            onToggle={toggleKeywordSelection}
            onToggleAll={handleSelectAllFiltered}
            onImport={handleImportSelectedKeywords}
          />
          </>)}{/* end unlocked Step 1 */}
          </>)}

          {/* ===== Step 2: 标题生成 ===== */}
          {activeStep === 2 && selectedProjectId && (
            <StepTitle
              projectId={selectedProjectId}
              emphasis={emphasis}
              locked={lockedSteps.has(2)}
              savedContent={activeListing?.title || null}
              savedItemHighlights={activeListing?.itemHighlights || null}
              onLock={() => handleLockStep(2)}
              onUnlock={() => { handleUnlockStep(2); toast.info("标题已解锁，可重新编辑"); }}
              onComplete={() => handleStepComplete(2)}
            />
          )}

          {/* ===== Step 3: 产品描述 ===== */}
          {activeStep === 3 && selectedProjectId && (
            <StepDescription
              projectId={selectedProjectId}
              emphasis={emphasis}
              locked={lockedSteps.has(3)}
              savedContent={activeListing?.description || null}
              onLock={() => handleLockStep(3)}
              onUnlock={() => { handleUnlockStep(3); toast.info("描述已解锁，可重新编辑"); }}
              onComplete={() => handleStepComplete(3)}
            />
          )}

          {/* ===== Step 4: 搜索词 ===== */}
          {activeStep === 4 && selectedProjectId && (
            <StepSearchTerms
              projectId={selectedProjectId}
              emphasis={emphasis}
              locked={lockedSteps.has(4)}
              savedContent={activeListing?.searchTerms || null}
              onLock={() => handleLockStep(4)}
              onUnlock={() => { handleUnlockStep(4); toast.info("搜索词已解锁，可重新编辑"); }}
              onComplete={() => handleStepComplete(4)}
            />
          )}

          {/* ===== Step 5: QA问答 ===== */}
          {activeStep === 5 && selectedProjectId && (
            <StepQA
              projectId={selectedProjectId}
              emphasis={emphasis}
              locked={lockedSteps.has(5)}
              savedContent={activeListing?.qaContent || null}
              onLock={() => handleLockStep(5)}
              onUnlock={() => { handleUnlockStep(5); toast.info("QA已解锁，可重新编辑"); }}
              onComplete={() => handleStepComplete(5)}
            />
          )}

          <ListingWorkflowNavigation
            activeStep={activeStep}
            completedCount={completedSteps.size}
            projectId={selectedProjectId}
            showAllLockedDialog={showAllLockedDialog}
            onActiveStepChange={setActiveStep}
            onDialogChange={setShowAllLockedDialog}
            onPreview={(projectId) => setLocation(`/listing/preview?project=${projectId}`)}
          />
        </div>
      )}
    </div>
  );
}
