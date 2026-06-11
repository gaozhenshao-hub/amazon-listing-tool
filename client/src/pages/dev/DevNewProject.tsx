import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocation } from "wouter";
import { ArrowLeft, Loader2, PlusCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export default function DevNewProject() {
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetMarket, setTargetMarket] = useState("US");
  const [platform, setPlatform] = useState("amazon");
  const [keywords, setKeywords] = useState("");

  const createMutation = trpc.devProject.create.useMutation({
    onSuccess: (data) => {
      toast.success("项目创建成功");
      setLocation(`/dev/project/${data.id}`);
    },
    onError: (err) => {
      toast.error(`创建失败: ${err.message}`);
    },
  });

  const handleCreate = () => {
    if (!name.trim()) {
      toast.error("请输入项目名称");
      return;
    }
    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      targetMarket,
      platform,
      keywords: keywords.trim() || undefined,
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => setLocation("/dev/projects")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-bold">新建产品开发项目</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">项目基本信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>项目名称 *</Label>
            <Input placeholder="例如：便携式蓝牙音箱" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>项目描述</Label>
            <Textarea placeholder="简要描述产品方向和目标..." value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>目标市场</Label>
              <Select value={targetMarket} onValueChange={setTargetMarket}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="US">美国 (US)</SelectItem>
                  <SelectItem value="UK">英国 (UK)</SelectItem>
                  <SelectItem value="DE">德国 (DE)</SelectItem>
                  <SelectItem value="JP">日本 (JP)</SelectItem>
                  <SelectItem value="CA">加拿大 (CA)</SelectItem>
                  <SelectItem value="FR">法国 (FR)</SelectItem>
                  <SelectItem value="IT">意大利 (IT)</SelectItem>
                  <SelectItem value="ES">西班牙 (ES)</SelectItem>
                  <SelectItem value="AU">澳大利亚 (AU)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>平台</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="amazon">Amazon</SelectItem>
                  <SelectItem value="walmart">Walmart</SelectItem>
                  <SelectItem value="shopify">Shopify</SelectItem>
                  <SelectItem value="temu">Temu</SelectItem>
                  <SelectItem value="other">其他</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>核心关键词</Label>
            <Textarea placeholder="每行一个关键词，用于后续竞品搜索和市场分析..." value={keywords} onChange={(e) => setKeywords(e.target.value)} rows={3} />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setLocation("/dev/projects")}>取消</Button>
            <Button
              onClick={handleCreate}
              disabled={createMutation.isPending || !name.trim()}
              className="gap-2"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PlusCircle className="h-4 w-4" />
              )}
              创建项目
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
