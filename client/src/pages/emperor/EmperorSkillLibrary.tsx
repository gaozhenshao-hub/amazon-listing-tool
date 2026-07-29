import { useState, useMemo, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Play,
  Loader2,
  ChevronRight,
  Sparkles,
  Clock,
  Tag,
  Cpu,
  CheckCircle2,
  XCircle,
  Copy,
  RefreshCw,
  BrainCircuit,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Streamdown } from "streamdown";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Skill {
  id: number;
  slug: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  model: string;
  status: string;
  runCount: number;
  avgDuration: number;
}

interface RunResult {
  runId: string;
  content: string;
  status: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  error?: string;
}

// ─── Category color map ───────────────────────────────────────────────────────
const CATEGORY_COLORS: Record<string, string> = {
  "Listing优化": "bg-blue-500/10 text-blue-600 border-blue-200",
  "广告优化": "bg-orange-500/10 text-orange-600 border-orange-200",
  "竞品分析": "bg-purple-500/10 text-purple-600 border-purple-200",
  "关键词": "bg-green-500/10 text-green-600 border-green-200",
  "运营策略": "bg-indigo-500/10 text-indigo-600 border-indigo-200",
  "产品开发": "bg-pink-500/10 text-pink-600 border-pink-200",
  "数据分析": "bg-cyan-500/10 text-cyan-600 border-cyan-200",
  "客服售后": "bg-yellow-500/10 text-yellow-600 border-yellow-200",
  "内容创作": "bg-rose-500/10 text-rose-600 border-rose-200",
  "通用": "bg-gray-500/10 text-gray-600 border-gray-200",
};

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || "bg-gray-500/10 text-gray-600 border-gray-200";
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function EmperorSkillLibrary() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [context, setContext] = useState("");
  const [emphasis, setEmphasis] = useState("");
  const [modelOverride, setModelOverride] = useState<string>("default");
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  // Fetch skills
  const { data: skillsData, isLoading: skillsLoading } = trpc.emperor.skills.list.useQuery({
    category: selectedCategory === "all" ? "" : (selectedCategory || ""),
    search: searchQuery || "",
    page: 1,
    pageSize: 200,
  });

  // Fetch model providers
  const { data: modelsData } = trpc.emperor.models.list.useQuery();

  // Run skill mutation
  const runMutation = trpc.emperor.run.run.useMutation({
    onSuccess: (data) => {
      setRunResult(data as RunResult);
      setIsRunning(false);
    },
    onError: (err: any) => {
      setRunResult({
        runId: "",
        content: "",
        status: "error",
        durationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        error: err.message,
      });
      setIsRunning(false);
      toast.error("运行失败: " + err.message);
    },
  });

  const skills: Skill[] = (skillsData?.skills || []) as Skill[];
  const categories = useMemo(() => {
    const cats = new Set(skills.map((s) => s.category).filter(Boolean));
    return Array.from(cats).sort();
  }, [skills]);

  const availableModels = useMemo(() => {
    const providers = (modelsData || []) as Array<{ isActive: boolean; modelId: string; displayName: string; provider: string }>;
    const modelList: { value: string; label: string }[] = [
      { value: "default", label: "默认模型（Skill 配置）" },
    ];
    for (const p of providers) {
      if (p.isActive) {
        modelList.push({ value: p.modelId, label: `${p.displayName || p.modelId} (${p.provider})` });
      }
    }
    return modelList;
  }, [modelsData]);

  const handleRun = () => {
    if (!selectedSkill) return;
    setIsRunning(true);
    setRunResult(null);
    runMutation.mutate({
      skillSlug: selectedSkill.slug,
      context,
      emphasis,
      modelOverride: modelOverride === "default" ? undefined : modelOverride,
    });
  };

  const handleCopyOutput = () => {
    if (runResult?.content) {
      navigator.clipboard.writeText(runResult.content);
      toast.success("已复制到剪贴板");
    }
  };

  // Auto-scroll output
  useEffect(() => {
    if (runResult && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [runResult]);

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100vh-56px)] overflow-hidden bg-background">
        {/* ── Left: Category tree (200px) ── */}
        <div className="w-[200px] flex-shrink-0 border-r bg-muted/30 flex flex-col">
          <div className="p-3 border-b">
            <div className="flex items-center gap-2 mb-1">
              <BrainCircuit className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Skill 库</span>
            </div>
            <p className="text-xs text-muted-foreground">{skills.length} 个技能</p>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-0.5">
              <button
                onClick={() => setSelectedCategory("all")}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
                  selectedCategory === "all"
                    ? "bg-primary text-primary-foreground font-medium"
                    : "hover:bg-accent text-muted-foreground hover:text-foreground"
                )}
              >
                全部分类
                <span className="float-right text-xs opacity-60">{skills.length}</span>
              </button>
              {categories.map((cat) => {
                const count = skills.filter((s) => s.category === cat).length;
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
                      selectedCategory === cat
                        ? "bg-primary text-primary-foreground font-medium"
                        : "hover:bg-accent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span className="truncate block pr-6">{cat}</span>
                    <span className="float-right text-xs opacity-60">{count}</span>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* ── Middle: Skill card list ── */}
        <div className="flex-1 flex flex-col min-w-0 border-r">
          {/* Search bar */}
          <div className="p-3 border-b bg-background">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索 Skill 名称或描述..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-sm"
              />
            </div>
          </div>

          {/* Skill list */}
          <ScrollArea className="flex-1">
            {skillsLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : skills.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Sparkles className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm">暂无匹配的 Skill</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {skills.map((skill) => (
                  <button
                    key={skill.id}
                    onClick={() => {
                      setSelectedSkill(skill);
                      setRunResult(null);
                    }}
                    className={cn(
                      "w-full text-left p-3 rounded-lg border transition-all hover:shadow-sm",
                      selectedSkill?.id === skill.id
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-transparent hover:border-border hover:bg-accent/50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm truncate">{skill.name}</span>
                          {selectedSkill?.id === skill.id && (
                            <ChevronRight className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                          {skill.description}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <Badge
                            variant="outline"
                            className={cn("text-xs px-1.5 py-0 border", getCategoryColor(skill.category))}
                          >
                            {skill.category}
                          </Badge>
                          {skill.runCount > 0 && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Zap className="h-3 w-3" />
                              {skill.runCount}次
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* ── Right: Run panel ── */}
        <div className="w-[480px] flex-shrink-0 flex flex-col bg-background">
          {selectedSkill ? (
            <>
              {/* Skill header */}
              <div className="p-4 border-b">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-base leading-tight mb-1">{selectedSkill.name}</h2>
                    <p className="text-sm text-muted-foreground leading-relaxed">{selectedSkill.description}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn("text-xs flex-shrink-0 border", getCategoryColor(selectedSkill.category))}
                  >
                    {selectedSkill.category}
                  </Badge>
                </div>
                {selectedSkill.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {selectedSkill.tags.map((tag) => (
                      <span key={tag} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Tag className="h-3 w-3" />
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Input area */}
              <div className="p-4 border-b space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    上下文内容 <span className="text-muted-foreground/60">（粘贴需要分析的文本、数据等）</span>
                  </label>
                  <Textarea
                    placeholder="粘贴 Listing 文案、广告数据、竞品信息等..."
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    className="min-h-[100px] text-sm resize-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    重点强调 <span className="text-muted-foreground/60">（可选，补充特殊要求）</span>
                  </label>
                  <Input
                    placeholder="例如：重点关注价格竞争力..."
                    value={emphasis}
                    onChange={(e) => setEmphasis(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    模型选择
                  </label>
                  <Select value={modelOverride} onValueChange={setModelOverride}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.map((m) => (
                        <SelectItem key={m.value} value={m.value} className="text-sm">
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleRun}
                  disabled={isRunning}
                  className="w-full gap-2"
                  size="sm"
                >
                  {isRunning ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      AI 正在分析...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      运行 Skill
                    </>
                  )}
                </Button>
              </div>

              {/* Output area */}
              <div className="flex-1 flex flex-col min-h-0">
                {runResult ? (
                  <>
                    {/* Result header */}
                    <div className="px-4 py-2 border-b flex items-center justify-between bg-muted/30">
                      <div className="flex items-center gap-3">
                        {runResult.status === "success" ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                        <span className="text-xs text-muted-foreground">
                          {runResult.runId.slice(0, 8)}
                        </span>
                        {runResult.durationMs > 0 && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {(runResult.durationMs / 1000).toFixed(1)}s
                          </span>
                        )}
                        {runResult.inputTokens > 0 && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Cpu className="h-3 w-3" />
                            {runResult.inputTokens + runResult.outputTokens} tokens
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={handleCopyOutput}
                          title="复制输出"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => {
                            setRunResult(null);
                            handleRun();
                          }}
                          title="重新运行"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Result content */}
                    <div ref={outputRef} className="flex-1 overflow-auto p-4">
                      {runResult.status === "error" ? (
                        <div className="text-sm text-red-500 bg-red-50 dark:bg-red-950/20 rounded-lg p-3">
                          {runResult.error}
                        </div>
                      ) : (
                        <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
                          <Streamdown>{runResult.content}</Streamdown>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
                    <div className="w-16 h-16 rounded-2xl bg-primary/5 flex items-center justify-center mb-4">
                      <Sparkles className="h-8 w-8 text-primary/40" />
                    </div>
                    <p className="text-sm font-medium mb-1">准备就绪</p>
                    <p className="text-xs text-center leading-relaxed opacity-70">
                      填写上下文内容后点击"运行 Skill"
                      <br />
                      AI 将基于 {selectedSkill.name} 进行分析
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center mb-6">
                <BrainCircuit className="h-10 w-10 text-primary/50" />
              </div>
              <h3 className="font-semibold text-base mb-2 text-foreground">皇帝 · AI 能力中台</h3>
              <p className="text-sm text-center leading-relaxed max-w-xs">
                从左侧选择一个 Skill，输入上下文内容后即可运行 AI 分析
              </p>
              <div className="mt-6 grid grid-cols-2 gap-3 w-full max-w-xs">
                <div className="text-center p-3 rounded-xl bg-muted/50">
                  <p className="text-2xl font-bold text-primary">{skills.length}</p>
                  <p className="text-xs text-muted-foreground mt-1">AI 技能</p>
                </div>
                <div className="text-center p-3 rounded-xl bg-muted/50">
                  <p className="text-2xl font-bold text-primary">{categories.length}</p>
                  <p className="text-xs text-muted-foreground mt-1">技能分类</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
