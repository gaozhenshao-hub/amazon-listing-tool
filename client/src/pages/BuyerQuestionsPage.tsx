import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useProject } from "@/contexts/ProjectContext";
import ProjectSelector from "@/components/ProjectSelector";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  HelpCircle,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Search,
  Upload,
  Brain,
  BarChart3,
  Filter,
  Loader2,
  ArrowUpDown,
} from "lucide-react";

const SOURCE_LABELS: Record<string, string> = {
  ad_search_term: "广告搜索词",
  sp_prompts: "SP Prompts",
  qa_section: "QA模块",
  competitor_review: "竞品评论",
  manual: "手动添加",
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-red-100 text-red-700 border-red-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-green-100 text-green-700 border-green-200",
};

const CATEGORY_OPTIONS = [
  "functionality", "size", "material", "compatibility",
  "usage_scenario", "safety", "durability", "value", "other",
];

const CATEGORY_LABELS: Record<string, string> = {
  functionality: "功能",
  size: "尺寸",
  material: "材质",
  compatibility: "兼容性",
  usage_scenario: "使用场景",
  safety: "安全性",
  durability: "耐用性",
  value: "性价比",
  other: "其他",
};

export default function BuyerQuestionsPage() {
  const { selectedProjectId } = useProject();
  const [filterSource, setFilterSource] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showExtractDialog, setShowExtractDialog] = useState(false);
  const [newQuestion, setNewQuestion] = useState({ question: "", questionCn: "", category: "other", priority: "medium" as const });
  const [searchTermsInput, setSearchTermsInput] = useState("");
  const [productContext, setProductContext] = useState("");

  // Queries
  const { data: questions = [], isLoading, refetch } = trpc.buyerQuestions.list.useQuery(
    {
      projectId: selectedProjectId!,
      ...(filterSource !== "all" ? { source: filterSource as any } : {}),
      ...(filterStatus !== "all" ? { status: filterStatus as any } : {}),
    },
    { enabled: !!selectedProjectId }
  );

  const { data: stats } = trpc.buyerQuestions.getCoverageStats.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  // Mutations
  const addQuestion = trpc.buyerQuestions.add.useMutation({
    onSuccess: () => { toast.success("问题已添加"); refetch(); setShowAddDialog(false); setNewQuestion({ question: "", questionCn: "", category: "other", priority: "medium" }); },
    onError: (err) => toast.error("添加失败: " + err.message),
  });

  const deleteQuestion = trpc.buyerQuestions.delete.useMutation({
    onSuccess: () => { toast.success("已删除"); refetch(); },
    onError: (err) => toast.error("删除失败: " + err.message),
  });

  const updateQuestion = trpc.buyerQuestions.update.useMutation({
    onSuccess: () => { refetch(); },
    onError: (err) => toast.error("更新失败: " + err.message),
  });

  const extractFromSearchTerms = trpc.buyerQuestions.extractFromSearchTerms.useMutation({
    onSuccess: (data) => {
      toast.success(`AI已提取 ${data.extracted} 个买家问题`);
      refetch();
      setShowExtractDialog(false);
      setSearchTermsInput("");
    },
    onError: (err) => toast.error("提取失败: " + err.message),
  });

  const checkCoverage = trpc.buyerQuestions.checkCoverage.useMutation({
    onSuccess: (data) => {
      toast.success(`覆盖检查完成：${data.covered} 已覆盖 / ${data.uncovered} 未覆盖`);
      refetch();
    },
    onError: (err) => toast.error("检查失败: " + err.message),
  });

  // Filtered questions
  const filteredQuestions = useMemo(() => {
    if (!searchQuery.trim()) return questions;
    const q = searchQuery.toLowerCase();
    return questions.filter((item: any) =>
      item.question?.toLowerCase().includes(q) ||
      item.questionCn?.toLowerCase().includes(q) ||
      item.category?.toLowerCase().includes(q)
    );
  }, [questions, searchQuery]);

  // Handle extract from search terms
  const handleExtract = () => {
    if (!selectedProjectId) return;
    const terms = searchTermsInput.split("\n").map(t => t.trim()).filter(Boolean);
    if (terms.length === 0) { toast.error("请输入搜索词"); return; }
    extractFromSearchTerms.mutate({
      projectId: selectedProjectId,
      searchTerms: terms,
      productContext: productContext || undefined,
    });
  };

  // Handle coverage check
  const handleCheckCoverage = () => {
    if (!selectedProjectId) return;
    checkCoverage.mutate({
      projectId: selectedProjectId,
      bulletPoints: "", // Will be fetched from active listing in backend
      description: "",
    });
  };

  if (!selectedProjectId) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center text-muted-foreground">
          <HelpCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">请先选择一个项目</p>
          <p className="text-sm mt-1 mb-4">选择项目后可管理买家问题库</p>
          <ProjectSelector />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <HelpCircle className="h-6 w-6 text-blue-600" />
              买家问题库
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              收集和管理买家常见问题，确保Listing内容覆盖所有关键疑问
            </p>
          </div>
          <ProjectSelector />
        </div>
        <div className="flex gap-2">
          <Dialog open={showExtractDialog} onOpenChange={setShowExtractDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Brain className="h-4 w-4 mr-1" />
                AI提取问题
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>从搜索词中AI提取买家问题</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <label className="text-sm font-medium">产品简述（可选）</label>
                  <Input
                    placeholder="例如：儿童水彩画笔套装，12色"
                    value={productContext}
                    onChange={(e) => setProductContext(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">搜索词列表（每行一个）</label>
                  <Textarea
                    placeholder="粘贴广告搜索词报告中的搜索词，每行一个&#10;例如：&#10;watercolor paint set for kids&#10;is watercolor paint washable&#10;best paint for 3 year old"
                    value={searchTermsInput}
                    onChange={(e) => setSearchTermsInput(e.target.value)}
                    rows={10}
                    className="mt-1 font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    支持最多200个搜索词，AI将识别其中的疑问类、比较类、场景类词
                  </p>
                </div>
                <Button
                  onClick={handleExtract}
                  disabled={extractFromSearchTerms.isPending || !searchTermsInput.trim()}
                  className="w-full"
                >
                  {extractFromSearchTerms.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />AI分析中...</>
                  ) : (
                    <><Brain className="h-4 w-4 mr-2" />开始提取</>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Button variant="outline" size="sm" onClick={handleCheckCoverage} disabled={checkCoverage.isPending}>
            {checkCoverage.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
            覆盖度检查
          </Button>

          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                手动添加
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>添加买家问题</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <label className="text-sm font-medium">问题（英文）</label>
                  <Textarea
                    placeholder="What size is this product?"
                    value={newQuestion.question}
                    onChange={(e) => setNewQuestion({ ...newQuestion, question: e.target.value })}
                    rows={2}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">中文翻译（可选）</label>
                  <Input
                    placeholder="这个产品是什么尺寸？"
                    value={newQuestion.questionCn}
                    onChange={(e) => setNewQuestion({ ...newQuestion, questionCn: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">分类</label>
                    <Select value={newQuestion.category} onValueChange={(v) => setNewQuestion({ ...newQuestion, category: v })}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORY_OPTIONS.map(c => (
                          <SelectItem key={c} value={c}>{CATEGORY_LABELS[c] || c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">优先级</label>
                    <Select value={newQuestion.priority} onValueChange={(v: any) => setNewQuestion({ ...newQuestion, priority: v })}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="high">高</SelectItem>
                        <SelectItem value="medium">中</SelectItem>
                        <SelectItem value="low">低</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button
                  onClick={() => {
                    if (!newQuestion.question.trim()) { toast.error("请输入问题"); return; }
                    addQuestion.mutate({
                      projectId: selectedProjectId!,
                      question: newQuestion.question,
                      questionCn: newQuestion.questionCn || undefined,
                      category: newQuestion.category,
                      priority: newQuestion.priority,
                      source: "manual",
                    });
                  }}
                  disabled={addQuestion.isPending}
                  className="w-full"
                >
                  {addQuestion.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                  添加问题
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100">
                  <HelpCircle className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">总问题数</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-100">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.covered}</p>
                  <p className="text-xs text-muted-foreground">已覆盖</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-100">
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.active}</p>
                  <p className="text-xs text-muted-foreground">待覆盖</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-100">
                  <XCircle className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.highPriorityUncovered}</p>
                  <p className="text-xs text-muted-foreground">高优未覆盖</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Coverage Progress */}
      {stats && stats.total > 0 && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">问题覆盖率</span>
              <span className="text-sm font-bold text-blue-600">
                {Math.round((stats.covered / stats.total) * 100)}%
              </span>
            </div>
            <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-green-500 rounded-full transition-all"
                style={{ width: `${(stats.covered / stats.total) * 100}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {stats.covered} / {stats.total} 个问题已在Listing中得到回答
            </p>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索问题..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterSource} onValueChange={setFilterSource}>
          <SelectTrigger className="w-[140px]">
            <Filter className="h-3.5 w-3.5 mr-1" />
            <SelectValue placeholder="来源" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部来源</SelectItem>
            <SelectItem value="ad_search_term">广告搜索词</SelectItem>
            <SelectItem value="sp_prompts">SP Prompts</SelectItem>
            <SelectItem value="qa_section">QA模块</SelectItem>
            <SelectItem value="competitor_review">竞品评论</SelectItem>
            <SelectItem value="manual">手动添加</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="active">待覆盖</SelectItem>
            <SelectItem value="covered">已覆盖</SelectItem>
            <SelectItem value="dismissed">已忽略</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Questions List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredQuestions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <HelpCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <p className="text-lg font-medium text-muted-foreground">暂无买家问题</p>
            <p className="text-sm text-muted-foreground mt-1">
              点击"AI提取问题"从搜索词中自动识别，或手动添加
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredQuestions.map((q: any) => (
            <Card key={q.id} className={`transition-all ${q.status === "covered" ? "opacity-60" : ""}`}>
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-3">
                  {/* Status icon */}
                  <div className="mt-0.5">
                    {q.status === "covered" ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : q.priority === "high" ? (
                      <AlertTriangle className="h-5 w-5 text-red-500" />
                    ) : (
                      <HelpCircle className="h-5 w-5 text-amber-500" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-relaxed">{q.question}</p>
                    {q.questionCn && (
                      <p className="text-xs text-muted-foreground mt-0.5">{q.questionCn}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <Badge variant="outline" className="text-[10px]">
                        {SOURCE_LABELS[q.source] || q.source}
                      </Badge>
                      {q.category && (
                        <Badge variant="outline" className="text-[10px]">
                          {CATEGORY_LABELS[q.category] || q.category}
                        </Badge>
                      )}
                      <Badge variant="outline" className={`text-[10px] ${PRIORITY_COLORS[q.priority]}`}>
                        {q.priority === "high" ? "高优" : q.priority === "medium" ? "中" : "低"}
                      </Badge>
                      {q.frequency > 1 && (
                        <Badge variant="secondary" className="text-[10px]">
                          频次: {q.frequency}
                        </Badge>
                      )}
                      {q.coveredInBullet === 1 && (
                        <Badge className="text-[10px] bg-green-100 text-green-700">Bullet✓</Badge>
                      )}
                      {q.coveredInDescription === 1 && (
                        <Badge className="text-[10px] bg-blue-100 text-blue-700">Description✓</Badge>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    {q.status === "active" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => updateQuestion.mutate({ id: q.id, status: "dismissed" })}
                        title="忽略此问题"
                      >
                        <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    )}
                    {q.status === "dismissed" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => updateQuestion.mutate({ id: q.id, status: "active" })}
                        title="恢复此问题"
                      >
                        <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        if (confirm("确定删除此问题？")) {
                          deleteQuestion.mutate({ id: q.id });
                        }
                      }}
                      title="删除"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-red-400" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
