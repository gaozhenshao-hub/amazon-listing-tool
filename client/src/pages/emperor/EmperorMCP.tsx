import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2,
  Plug,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface MCPConnector {
  id: number;
  slug: string;
  name: string;
  description: string;
  connectionType: string;
  config: Record<string, unknown>;
  isActive: boolean;
}

export default function EmperorMCP() {
  const [selectedConnector, setSelectedConnector] = useState<MCPConnector | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<Partial<MCPConnector>>({});

  const { data, isLoading, refetch } = trpc.emperor.mcp.list.useQuery();
  const upsertMutation = trpc.emperor.mcp.upsert.useMutation({
    onSuccess: () => {
      toast.success("保存成功");
      setEditMode(false);
      refetch();
    },
    onError: (err: any) => toast.error("保存失败: " + err.message),
  });
  const deleteMutation = trpc.emperor.mcp.delete.useMutation({
    onSuccess: () => {
      toast.success("已删除");
      setSelectedConnector(null);
      refetch();
    },
    onError: (err: any) => toast.error("删除失败: " + err.message),
  });

  const connectors: MCPConnector[] = (data || []) as MCPConnector[];

  const handleEdit = (c: MCPConnector) => {
    setSelectedConnector(c);
    setEditData({ ...c });
    setEditMode(true);
  };

  const handleSave = () => {
    if (!selectedConnector) return;
    upsertMutation.mutate({
      slug: selectedConnector.slug,
      name: editData.name || selectedConnector.name,
      description: editData.description,
      connectionType: (editData.connectionType as any) || selectedConnector.connectionType as any,
      config: editData.config,
      isActive: editData.isActive ?? selectedConnector.isActive,
    });
  };

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100vh-56px)] overflow-hidden bg-background">
        {/* Left: Connector list */}
        <div className="w-[300px] flex-shrink-0 border-r flex flex-col">
          <div className="p-3 border-b flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-sm">MCP 连接器</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{connectors.length} 个连接器</p>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : connectors.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Plug className="h-8 w-8 mb-3 opacity-30" />
                <p className="text-sm">暂无 MCP 连接器</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {connectors.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setSelectedConnector(c); setEditMode(false); }}
                    className={cn(
                      "w-full text-left p-3 rounded-lg border transition-all",
                      selectedConnector?.id === c.id
                        ? "border-primary bg-primary/5"
                        : "border-transparent hover:border-border hover:bg-accent/50"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">{c.name}</span>
                      {c.isActive ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1">{c.description}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <Badge variant="outline" className="text-xs px-1.5 py-0">{c.connectionType}</Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Right: Connector detail */}
        <div className="flex-1 flex flex-col min-w-0 p-6">
          {selectedConnector ? (
            <div className="max-w-2xl space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">{selectedConnector.name}</h2>
                  <p className="text-sm text-muted-foreground mt-1">{selectedConnector.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => deleteMutation.mutate({ slug: selectedConnector.slug })}
                    disabled={deleteMutation.isPending}
                    className="gap-2 text-destructive hover:text-destructive"
                  >
                    <XCircle className="h-4 w-4" />
                    删除
                  </Button>
                  {!editMode && (
                    <Button size="sm" onClick={() => handleEdit(selectedConnector)}>
                      编辑配置
                    </Button>
                  )}
                </div>
              </div>

              {editMode ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">编辑配置</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">名称</label>
                      <Input
                        value={editData.name || ""}
                        onChange={(e) => setEditData(d => ({ ...d, name: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">配置（JSON）</label>
                      <Textarea
                        value={JSON.stringify(editData.config || {}, null, 2)}
                        onChange={(e) => {
                          try {
                            setEditData(d => ({ ...d, config: JSON.parse(e.target.value) }));
                          } catch { /* ignore parse errors */ }
                        }}
                        className="font-mono text-xs min-h-[100px]"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">启用</p>
                        <p className="text-xs text-muted-foreground">启用后 Skill 可以调用此连接器的工具</p>
                      </div>
                      <Switch
                        checked={editData.isActive ?? false}
                        onCheckedChange={(v) => setEditData(d => ({ ...d, isActive: v }))}
                      />
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button onClick={handleSave} disabled={upsertMutation.isPending} className="gap-2">
                        {upsertMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                        保存
                      </Button>
                      <Button variant="outline" onClick={() => setEditMode(false)}>取消</Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="pt-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">类型</p>
                        <Badge variant="outline" className="mt-1">{selectedConnector.connectionType}</Badge>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">状态</p>
                        <p className="font-medium mt-1 flex items-center gap-2">
                          {selectedConnector.isActive ? (
                            <><CheckCircle2 className="h-4 w-4 text-green-500" /> 已启用</>
                          ) : (
                            <><XCircle className="h-4 w-4 text-muted-foreground" /> 已禁用</>
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Slug</p>
                        <p className="font-medium text-sm mt-1">{selectedConnector.slug}</p>
                      </div>
                    </div>
                    {selectedConnector.config && Object.keys(selectedConnector.config).length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-2">配置</p>
                        <pre className="text-xs bg-muted rounded-lg p-3 overflow-auto max-h-40">
                          {JSON.stringify(selectedConnector.config, null, 2)}
                        </pre>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <Plug className="h-12 w-12 mb-4 opacity-20" />
              <p className="text-sm">从左侧选择一个 MCP 连接器</p>
              <p className="text-xs mt-2 opacity-60">MCP 连接器允许 Skill 调用外部工具和服务</p>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
