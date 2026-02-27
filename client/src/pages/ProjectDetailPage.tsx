import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Save, Search, Image, Sparkles, FileText } from "lucide-react";
import { useState, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = parseInt(params.id || "0", 10);
  const [, setLocation] = useLocation();

  const { data: project, isLoading } = trpc.project.getById.useQuery(
    { id: projectId },
    { enabled: projectId > 0 }
  );

  const [formData, setFormData] = useState({
    name: "",
    brand: "",
    productName: "",
    category: "",
    targetMarket: "US",
    productFeatures: "",
    productSpecs: "",
  });

  useEffect(() => {
    if (project) {
      setFormData({
        name: project.name || "",
        brand: project.brand || "",
        productName: project.productName || "",
        category: project.category || "",
        targetMarket: project.targetMarket || "US",
        productFeatures: project.productFeatures || "",
        productSpecs: project.productSpecs || "",
      });
    }
  }, [project]);

  const utils = trpc.useUtils();
  const updateProject = trpc.project.update.useMutation({
    onSuccess: () => {
      utils.project.getById.invalidate({ id: projectId });
      utils.project.list.invalidate();
      toast.success("项目信息已更新");
    },
    onError: (err) => toast.error("更新失败: " + err.message),
  });

  const handleSave = () => {
    updateProject.mutate({
      id: projectId,
      ...formData,
      productFeatures: formData.productFeatures || undefined,
      productSpecs: formData.productSpecs || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-muted-foreground mb-4">项目未找到</p>
        <Button variant="outline" onClick={() => setLocation("/")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          返回项目列表
        </Button>
      </div>
    );
  }

  const statusMap: Record<string, string> = {
    draft: "草稿",
    analyzing: "分析中",
    generating: "生成中",
    completed: "已完成",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
            <Badge variant="secondary">{statusMap[project.status] || project.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {project.brand ? `${project.brand} · ` : ""}{project.productName || ""}
          </p>
        </div>
      </div>

      <Tabs defaultValue="info" className="space-y-4">
        <TabsList>
          <TabsTrigger value="info">产品信息</TabsTrigger>
          <TabsTrigger value="workflow">工作流程</TabsTrigger>
        </TabsList>

        <TabsContent value="info">
          <Card>
            <CardHeader>
              <CardTitle>产品基本信息</CardTitle>
              <CardDescription>完善产品信息有助于生成更精准的Listing内容</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>项目名称</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>品牌名称</Label>
                  <Input
                    value={formData.brand}
                    onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>产品名称</Label>
                  <Input
                    value={formData.productName}
                    onChange={(e) => setFormData({ ...formData, productName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>产品类目</Label>
                  <Input
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>目标市场</Label>
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
              </div>
              <div className="space-y-2">
                <Label>产品卖点（每行一个）</Label>
                <Textarea
                  rows={5}
                  placeholder="每行输入一个产品卖点..."
                  value={formData.productFeatures}
                  onChange={(e) => setFormData({ ...formData, productFeatures: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>产品规格</Label>
                <Textarea
                  rows={4}
                  placeholder="输入产品规格信息..."
                  value={formData.productSpecs}
                  onChange={(e) => setFormData({ ...formData, productSpecs: e.target.value })}
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={updateProject.isPending}>
                  <Save className="h-4 w-4 mr-2" />
                  {updateProject.isPending ? "保存中..." : "保存信息"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="workflow">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card
              className="cursor-pointer hover:shadow-md transition-all group"
              onClick={() => setLocation("/analysis")}
            >
              <CardContent className="p-6 flex items-start gap-4">
                <div className="h-12 w-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0 group-hover:bg-blue-100 transition-colors">
                  <Search className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">步骤1: 竞品分析</h3>
                  <p className="text-sm text-muted-foreground">
                    输入竞品ASIN，分析标题、五点、评论，提取关键词和用户洞察
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card
              className="cursor-pointer hover:shadow-md transition-all group"
              onClick={() => setLocation("/image-analysis")}
            >
              <CardContent className="p-6 flex items-start gap-4">
                <div className="h-12 w-12 rounded-xl bg-purple-50 flex items-center justify-center shrink-0 group-hover:bg-purple-100 transition-colors">
                  <Image className="h-6 w-6 text-purple-600" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">步骤2: 图片识别（可选）</h3>
                  <p className="text-sm text-muted-foreground">
                    上传产品图片，AI自动识别产品特征、材质、卖点等信息
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card
              className="cursor-pointer hover:shadow-md transition-all group"
              onClick={() => setLocation("/generate")}
            >
              <CardContent className="p-6 flex items-start gap-4">
                <div className="h-12 w-12 rounded-xl bg-amber-50 flex items-center justify-center shrink-0 group-hover:bg-amber-100 transition-colors">
                  <Sparkles className="h-6 w-6 text-amber-600" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">步骤3: 生成Listing</h3>
                  <p className="text-sm text-muted-foreground">
                    一键生成标题、五点、描述、关键词和图片建议
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card
              className="cursor-pointer hover:shadow-md transition-all group"
              onClick={() => setLocation("/preview")}
            >
              <CardContent className="p-6 flex items-start gap-4">
                <div className="h-12 w-12 rounded-xl bg-green-50 flex items-center justify-center shrink-0 group-hover:bg-green-100 transition-colors">
                  <FileText className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">步骤4: 预览与编辑</h3>
                  <p className="text-sm text-muted-foreground">
                    预览生成结果，手动编辑调整，确认最终Listing内容
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
