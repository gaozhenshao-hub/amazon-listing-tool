import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, FolderOpen, Trash2, ArrowRight, Package, Search, Sparkles } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "草稿", variant: "secondary" },
  analyzing: { label: "分析中", variant: "default" },
  generating: { label: "生成中", variant: "default" },
  completed: { label: "已完成", variant: "outline" },
};

export default function Home() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    brand: "",
    productName: "",
    category: "",
    targetMarket: "US",
    productFeatures: "",
    productSpecs: "",
  });

  const { data: projects, isLoading } = trpc.project.list.useQuery();
  const utils = trpc.useUtils();

  const createProject = trpc.project.create.useMutation({
    onSuccess: (newProject) => {
      utils.project.list.invalidate();
      setDialogOpen(false);
      setFormData({ name: "", brand: "", productName: "", category: "", targetMarket: "US", productFeatures: "", productSpecs: "" });
      toast.success("项目创建成功");
      setLocation(`/project/${newProject.id}`);
    },
    onError: (err) => {
      toast.error("创建失败: " + err.message);
    },
  });

  const deleteProject = trpc.project.delete.useMutation({
    onSuccess: () => {
      utils.project.list.invalidate();
      toast.success("项目已删除");
    },
    onError: (err) => {
      toast.error("删除失败: " + err.message);
    },
  });

  const handleCreate = () => {
    if (!formData.name.trim()) {
      toast.error("请输入项目名称");
      return;
    }
    createProject.mutate({
      ...formData,
      productFeatures: formData.productFeatures || undefined,
      productSpecs: formData.productSpecs || undefined,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">项目管理</h1>
          <p className="text-muted-foreground mt-1">
            {user?.name ? `欢迎回来，${user.name}` : "管理您的Amazon Listing项目"}
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              新建项目
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>创建新项目</DialogTitle>
              <DialogDescription>
                填写产品基本信息，开始创建Amazon Listing
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="name">项目名称 *</Label>
                <Input
                  id="name"
                  placeholder="例如：折叠桌Listing优化"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="brand">品牌名称</Label>
                  <Input
                    id="brand"
                    placeholder="您的品牌名"
                    value={formData.brand}
                    onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">产品类目</Label>
                  <Input
                    id="category"
                    placeholder="例如：家具/户外"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="productName">产品名称</Label>
                <Input
                  id="productName"
                  placeholder="例如：便携折叠桌"
                  value={formData.productName}
                  onChange={(e) => setFormData({ ...formData, productName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="targetMarket">目标市场</Label>
                <Select
                  value={formData.targetMarket}
                  onValueChange={(val) => setFormData({ ...formData, targetMarket: val })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="US">美国 (US)</SelectItem>
                    <SelectItem value="UK">英国 (UK)</SelectItem>
                    <SelectItem value="DE">德国 (DE)</SelectItem>
                    <SelectItem value="JP">日本 (JP)</SelectItem>
                    <SelectItem value="CA">加拿大 (CA)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="features">产品卖点（每行一个）</Label>
                <Textarea
                  id="features"
                  placeholder={"轻量化设计，仅重2kg\n一键折叠，3秒收纳\n承重150kg，稳固耐用"}
                  rows={4}
                  value={formData.productFeatures}
                  onChange={(e) => setFormData({ ...formData, productFeatures: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="specs">产品规格（JSON格式或自由文本）</Label>
                <Textarea
                  id="specs"
                  placeholder={'尺寸: 120x60x75cm\n材质: 铝合金\n颜色: 黑色/白色'}
                  rows={3}
                  value={formData.productSpecs}
                  onChange={(e) => setFormData({ ...formData, productSpecs: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleCreate} disabled={createProject.isPending}>
                {createProject.isPending ? "创建中..." : "创建项目"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
              <Package className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{projects?.length ?? 0}</p>
              <p className="text-xs text-muted-foreground">总项目数</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-chart-3/5 to-chart-3/10 border-chart-3/20">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-chart-3/15 flex items-center justify-center shrink-0">
              <Search className="h-5 w-5 text-chart-3" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {projects?.filter((p) => p.status === "analyzing").length ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">分析中</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-chart-1/5 to-chart-1/10 border-chart-1/20">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-chart-1/15 flex items-center justify-center shrink-0">
              <Sparkles className="h-5 w-5 text-chart-1" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {projects?.filter((p) => p.status === "completed").length ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">已完成</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Project List */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : !projects || projects.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <FolderOpen className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">还没有项目</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              创建您的第一个项目，开始使用AI生成高质量的Amazon Listing内容
            </p>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              创建第一个项目
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => {
            const status = statusMap[project.status] || statusMap.draft;
            return (
              <Card
                key={project.id}
                className="group hover:shadow-md transition-all cursor-pointer"
                onClick={() => setLocation(`/project/${project.id}`)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1 min-w-0 flex-1">
                      <CardTitle className="text-base truncate">
                        {project.name}
                      </CardTitle>
                      <CardDescription className="truncate">
                        {project.brand ? `${project.brand} · ` : ""}
                        {project.productName || "未设置产品名"}
                      </CardDescription>
                    </div>
                    <Badge variant={status.variant} className="shrink-0 ml-2">
                      {status.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{project.targetMarket || "US"}</span>
                      <span>·</span>
                      <span>{project.category || "未分类"}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm("确定要删除此项目吗？")) {
                            deleteProject.mutate({ id: project.id });
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    更新于 {new Date(project.updatedAt).toLocaleDateString("zh-CN")}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
