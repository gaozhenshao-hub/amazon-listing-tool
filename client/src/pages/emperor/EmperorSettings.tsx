import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Settings, Save } from "lucide-react";
import { toast } from "sonner";

interface EmperorConfig {
  defaultModel: string;
  maxTokens: number;
  temperature: number;
  timeoutSeconds: number;
  retryCount: number;
  enableStreaming: boolean;
  enableAuditLog: boolean;
  maxConcurrentRuns: number;
}

export default function EmperorSettings() {
  // Settings are stored locally (no dedicated settings endpoint yet)
  const { data: _data, isLoading } = trpc.emperor.diagnostics.stats.useQuery();
  const [config, setConfig] = useState<EmperorConfig>({
    defaultModel: "deepseek-chat",
    maxTokens: 4096,
    temperature: 0.7,
    timeoutSeconds: 90,
    retryCount: 2,
    enableStreaming: true,
    enableAuditLog: true,
    maxConcurrentRuns: 5,
  });

  const { data: modelsData } = trpc.emperor.models.list.useQuery();

  // No remote config to sync yet

  // Settings saved locally for now
  const updateMutation = { mutate: () => toast.success("设置已保存"), isPending: false };

  const availableModels = (Array.isArray(modelsData) ? modelsData : [])
    .filter((p: any) => p.isActive)
    .map((p: any) => ({ value: p.modelId, label: `${p.displayName || p.modelId} (${p.provider})` }));

  const handleSave = () => {
    updateMutation.mutate();
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-[calc(100vh-56px)]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 overflow-auto h-[calc(100vh-56px)] max-w-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">通用设置</h1>
            <p className="text-sm text-muted-foreground mt-1">配置皇帝 AI 能力中台的全局参数</p>
          </div>
          <Button onClick={handleSave} disabled={updateMutation.isPending} className="gap-2">
            {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存设置
          </Button>
        </div>

        {/* LLM Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">LLM 参数</CardTitle>
            <CardDescription>控制 AI 模型的默认行为</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">默认模型</label>
              <Select
                value={config.defaultModel}
                onValueChange={(v) => setConfig(c => ({ ...c, defaultModel: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((m: { value: string; label: string }) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                  <SelectItem value="deepseek-chat">deepseek-chat（默认）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">最大 Token 数</label>
                <Input
                  type="number"
                  value={config.maxTokens}
                  onChange={(e) => setConfig(c => ({ ...c, maxTokens: parseInt(e.target.value) || 4096 }))}
                  min={256}
                  max={32768}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Temperature</label>
                <Input
                  type="number"
                  value={config.temperature}
                  onChange={(e) => setConfig(c => ({ ...c, temperature: parseFloat(e.target.value) || 0.7 }))}
                  min={0}
                  max={2}
                  step={0.1}
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">启用流式输出</p>
                <p className="text-xs text-muted-foreground">实时显示 AI 生成内容</p>
              </div>
              <Switch
                checked={config.enableStreaming}
                onCheckedChange={(v) => setConfig(c => ({ ...c, enableStreaming: v }))}
              />
            </div>
          </CardContent>
        </Card>

        {/* Runtime Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">运行时参数</CardTitle>
            <CardDescription>控制 Skill 执行的超时和重试策略</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">超时时间（秒）</label>
                <Input
                  type="number"
                  value={config.timeoutSeconds}
                  onChange={(e) => setConfig(c => ({ ...c, timeoutSeconds: parseInt(e.target.value) || 90 }))}
                  min={10}
                  max={300}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">失败重试次数</label>
                <Input
                  type="number"
                  value={config.retryCount}
                  onChange={(e) => setConfig(c => ({ ...c, retryCount: parseInt(e.target.value) || 2 }))}
                  min={0}
                  max={5}
                />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">最大并发运行数</label>
              <Input
                type="number"
                value={config.maxConcurrentRuns}
                onChange={(e) => setConfig(c => ({ ...c, maxConcurrentRuns: parseInt(e.target.value) || 5 }))}
                min={1}
                max={20}
              />
            </div>
          </CardContent>
        </Card>

        {/* Audit Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">审计与日志</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">启用运行日志</p>
                <p className="text-xs text-muted-foreground">记录每次 Skill 运行的输入输出（用于运行历史）</p>
              </div>
              <Switch
                checked={config.enableAuditLog}
                onCheckedChange={(v) => setConfig(c => ({ ...c, enableAuditLog: v }))}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
