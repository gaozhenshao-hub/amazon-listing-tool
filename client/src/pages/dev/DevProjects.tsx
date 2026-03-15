import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useLocation } from "wouter";
import {
  FolderOpen,
  PlusCircle,
  Search,
  Trash2,
  ArrowRight,
  Calendar,
  Globe,
  BarChart3,
  Rocket,
  CheckCircle2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const statusOptions = [
  { value: "all", label: "全部状态" },
  { value: "draft", label: "草稿" },
  { value: "data_collection", label: "数据采集" },
  { value: "analyzing", label: "分析中" },
  { value: "scoring", label: "评分中" },
  { value: "completed", label: "已完成" },
  { value: "archived", label: "已归档" },
];

const phaseOptions = [
  { value: "all", label: "全部阶段" },
  { value: "market_analysis", label: "市场分析" },
  { value: "project_execution", label: "项目落地" },
];

const statusLabel: Record<string, { text: string; color: string }> = {
  draft: { text: "草稿", color: "bg-gray-500/10 text-gray-600" },
  data_collection: { text: "数据采集", color: "bg-blue-500/10 text-blue-600" },
  analyzing: { text: "分析中", color: "bg-amber-500/10 text-amber-600" },
  scoring: { text: "评分中", color: "bg-purple-500/10 text-purple-600" },
  completed: { text: "已完成", color: "bg-emerald-500/10 text-emerald-600" },
  archived: { text: "已归档", color: "bg-gray-500/10 text-gray-500" },
};

const phaseLabel: Record<string, { text: string; icon: any; color: string }> = {
  market_analysis: { text: "市场分析", icon: BarChart3, color: "bg-blue-500/10 text-blue-700 border-blue-200" },
  project_execution: { text: "项目落地", icon: Rocket, color: "bg-emerald-500/10 text-emerald-700 border-emerald-200" },
};

export default function DevProjects() {
  const [, setLocation] = useLocation();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const { data: projects, isLoading } = trpc.devProject.list.useQuery();
  const utils = trpc.useUtils();

  const deleteMutation = trpc.devProject.delete.useMutation({
    onSuccess: () => {
      utils.devProject.list.invalidate();
      utils.devProject.stats.invalidate();
      toast.success("项目已删除");
      setDeleteId(null);
    },
  });

  const filtered = useMemo(() => {
    if (!projects) return [];
    return projects.filter(p => {
      const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.keywords ?? "").toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === "all" || p.status === statusFilter;
      const projectPhase = (p as any).phase || "market_analysis";
      const matchPhase = phaseFilter === "all" || projectPhase === phaseFilter;
      return matchSearch && matchStatus && matchPhase;
    });
  }, [projects, search, statusFilter, phaseFilter]);

  // Phase stats
  const phaseStats = useMemo(() => {
    if (!projects) return { total: 0, market_analysis: 0, project_execution: 0 };
    let ma = 0, pe = 0;
    projects.forEach(p => {
      const phase = (p as any).phase || "market_analysis";
      if (phase === "project_execution") pe++;
      else ma++;
    });
    return { total: projects.length, market_analysis: ma, project_execution: pe };
  }, [projects]);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">项目列表</h1>
        <Button onClick={() => setLocation("/dev/new-project")} className="gap-2">
          <PlusCircle className="h-4 w-4" />
          新建项目
        </Button>
      </div>

      {/* Phase Stats Cards */}
      {!isLoading && projects && projects.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Card className={`cursor-pointer transition-all ${phaseFilter === "all" ? "ring-2 ring-primary" : "hover:shadow-md"}`}
            onClick={() => setPhaseFilter("all")}>
            <CardContent className="p-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <FolderOpen className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">全部项目</p>
                <p className="text-lg font-bold">{phaseStats.total}</p>
              </div>
            </CardContent>
          </Card>
          <Card className={`cursor-pointer transition-all ${phaseFilter === "market_analysis" ? "ring-2 ring-blue-500" : "hover:shadow-md"}`}
            onClick={() => setPhaseFilter(phaseFilter === "market_analysis" ? "all" : "market_analysis")}>
            <CardContent className="p-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <BarChart3 className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">市场分析阶段</p>
                <p className="text-lg font-bold text-blue-600">{phaseStats.market_analysis}</p>
              </div>
            </CardContent>
          </Card>
          <Card className={`cursor-pointer transition-all ${phaseFilter === "project_execution" ? "ring-2 ring-emerald-500" : "hover:shadow-md"}`}
            onClick={() => setPhaseFilter(phaseFilter === "project_execution" ? "all" : "project_execution")}>
            <CardContent className="p-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Rocket className="h-4 w-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">项目落地阶段</p>
                <p className="text-lg font-bold text-emerald-600">{phaseStats.project_execution}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索项目名称或关键词..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={phaseFilter} onValueChange={setPhaseFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {phaseOptions.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Project list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <FolderOpen className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-sm">{search || statusFilter !== "all" || phaseFilter !== "all" ? "没有匹配的项目" : "暂无项目，点击\"新建项目\"开始"}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(p => {
            const st = statusLabel[p.status] ?? { text: p.status, color: "" };
            const projectPhase = (p as any).phase || "market_analysis";
            const ph = phaseLabel[projectPhase] ?? phaseLabel.market_analysis;
            const PhaseIcon = ph.icon;
            const isApproved = !!(p as any).approvedAt;
            return (
              <Card
                key={p.id}
                className="cursor-pointer hover:shadow-md transition-all"
                onClick={() => setLocation(`/dev/project/${p.id}`)}
              >
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <FolderOpen className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold truncate">{p.name}</p>
                        {isApproved && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        {p.targetMarket && (
                          <span className="flex items-center gap-1">
                            <Globe className="h-3 w-3" />
                            {p.targetMarket}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(p.createdAt).toLocaleDateString()}
                        </span>
                        {p.description && (
                          <span className="truncate max-w-[200px]">{p.description}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Phase Badge */}
                    <Badge variant="outline" className={`text-xs gap-1 ${ph.color}`}>
                      <PhaseIcon className="h-3 w-3" />
                      {ph.text}
                    </Badge>
                    {/* Status Badge */}
                    <Badge variant="secondary" className={`text-xs ${st.color}`}>
                      {st.text}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={e => {
                        e.stopPropagation();
                        setDeleteId(p.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete confirmation */}
      <Dialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            删除后项目数据将无法恢复，确定要删除吗？
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>取消</Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteId && deleteMutation.mutate({ id: deleteId })}
            >
              {deleteMutation.isPending ? "删除中..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
