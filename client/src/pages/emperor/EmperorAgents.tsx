import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2,
  Network,
  Play,
  ChevronRight,
  RefreshCw,
  Zap,
  GitBranch,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Agent {
  id: number;
  name: string;
  description: string;
  steps: Array<{ skillSlug: string; skillName: string; order: number; condition?: string }>;
  enabled: boolean;
  runCount: number;
}

export default function EmperorAgents() {
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [context, setContext] = useState("");

  const { data, isLoading, refetch } = trpc.emperor.agents.list.useQuery();
  const runMutation = trpc.emperor.run.run.useMutation({
    onSuccess: () => {
      toast.success("Agent 运行完成，请在运行历史中查看结果");
      setRunningId(null);
    },
    onError: (err: any) => {
      toast.error("运行失败: " + err.message);
      setRunningId(null);
    },
  });

  const agents: Agent[] = (data || []) as Agent[];

  const handleRun = (agent: Agent) => {
    setRunningId(agent.id);
    runMutation.mutate({ skillSlug: (agent as any).slug || "unknown", context });
  };

  return (
    <DashboardLayout>
      <div className="flex h-[calc(100vh-56px)] overflow-hidden bg-background">
        {/* Left: Agent list */}
        <div className="w-[300px] flex-shrink-0 border-r flex flex-col">
          <div className="p-3 border-b flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-sm">Agent 编排</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{agents.length} 个 Agent</p>
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
            ) : agents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Network className="h-8 w-8 mb-3 opacity-30" />
                <p className="text-sm">暂无 Agent</p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => setSelectedAgent(agent)}
                    className={cn(
                      "w-full text-left p-3 rounded-lg border transition-all",
                      selectedAgent?.id === agent.id
                        ? "border-primary bg-primary/5"
                        : "border-transparent hover:border-border hover:bg-accent/50"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-sm">{agent.name}</span>
                      <ChevronRight className={cn("h-4 w-4 transition-opacity", selectedAgent?.id === agent.id ? "text-primary" : "opacity-0")} />
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{agent.description}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <Badge variant="outline" className="text-xs px-1.5 py-0">
                        <GitBranch className="h-3 w-3 mr-1" />
                        {(agent.steps || []).length} 步骤
                      </Badge>
                      {agent.runCount > 0 && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Zap className="h-3 w-3" />
                          {agent.runCount}次
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Right: Agent detail */}
        <div className="flex-1 flex flex-col min-w-0 p-6">
          {selectedAgent ? (
            <div className="max-w-2xl space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">{selectedAgent.name}</h2>
                  <p className="text-sm text-muted-foreground mt-1">{selectedAgent.description}</p>
                </div>
                <Button
                  onClick={() => handleRun(selectedAgent)}
                  disabled={runningId === selectedAgent.id}
                  className="gap-2"
                >
                  {runningId === selectedAgent.id ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />运行中...</>
                  ) : (
                    <><Play className="h-4 w-4" />运行 Agent</>
                  )}
                </Button>
              </div>

              {/* Steps visualization */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">执行步骤</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {(selectedAgent.steps || []).sort((a, b) => a.order - b.order).map((step, idx) => (
                      <div key={idx} className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                          {step.order}
                        </div>
                        <div className="flex-1 pt-0.5">
                          <p className="text-sm font-medium">{step.skillName || step.skillSlug}</p>
                          {step.condition && (
                            <p className="text-xs text-muted-foreground mt-0.5">条件: {step.condition}</p>
                          )}
                        </div>
                        {idx < (selectedAgent.steps || []).length - 1 && (
                          <div className="absolute ml-3.5 mt-7 h-3 w-px bg-border" />
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <Network className="h-12 w-12 mb-4 opacity-20" />
              <p className="text-sm">从左侧选择一个 Agent 查看详情</p>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
