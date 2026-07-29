import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2,
  Wrench,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Database,
  Cpu,
  Plug,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DiagResult {
  name: string;
  status: "ok" | "warning" | "error";
  message: string;
  latencyMs?: number;
}

export default function EmperorDiagnostics() {
  const [results, setResults] = useState<DiagResult[]>([]);
  const [running, setRunning] = useState(false);

  const { data: healthData, isLoading: healthLoading, refetch } = trpc.emperor.diagnostics.health.useQuery();

  const handleRun = () => {
    setRunning(true);
    refetch().then((res) => {
      const checks = res.data?.checks || {};
      const mapped: DiagResult[] = Object.entries(checks).map(([name, v]: [string, any]) => ({
        name,
        status: v.status as "ok" | "warning" | "error",
        message: v.message || "",
        latencyMs: v.latencyMs,
      }));
      setResults(mapped);
      setRunning(false);
    }).catch(() => setRunning(false));
  };

  const getIcon = (status: string) => {
    if (status === "ok") return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    if (status === "warning") return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
    return <XCircle className="h-5 w-5 text-red-500" />;
  };

  const getStatusBadge = (status: string) => {
    if (status === "ok") return <Badge className="bg-green-500/10 text-green-600 border-green-200 border">正常</Badge>;
    if (status === "warning") return <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-200 border">警告</Badge>;
    return <Badge className="bg-red-500/10 text-red-600 border-red-200 border">异常</Badge>;
  };

  const overallStatus = results.length === 0 ? null
    : results.some(r => r.status === "error") ? "error"
    : results.some(r => r.status === "warning") ? "warning"
    : "ok";

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 overflow-auto h-[calc(100vh-56px)] max-w-3xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">诊断中心</h1>
            <p className="text-sm text-muted-foreground mt-1">检测系统各组件的健康状态</p>
          </div>
          <Button onClick={handleRun} disabled={running} className="gap-2">
            {running ? (
              <><Loader2 className="h-4 w-4 animate-spin" />诊断中...</>
            ) : (
              <><RefreshCw className="h-4 w-4" />运行诊断</>
            )}
          </Button>
        </div>

        {/* Overall status */}
        {overallStatus && (
          <Card className={cn(
            "border-2",
            overallStatus === "ok" ? "border-green-200 bg-green-50/50 dark:bg-green-950/20" :
            overallStatus === "warning" ? "border-yellow-200 bg-yellow-50/50 dark:bg-yellow-950/20" :
            "border-red-200 bg-red-50/50 dark:bg-red-950/20"
          )}>
            <CardContent className="pt-6 flex items-center gap-4">
              {getIcon(overallStatus)}
              <div>
                <p className="font-semibold">
                  {overallStatus === "ok" ? "系统运行正常" :
                   overallStatus === "warning" ? "存在潜在问题" : "检测到异常"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {results.filter(r => r.status === "ok").length}/{results.length} 项检测通过
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Diagnostic items */}
        {results.length > 0 ? (
          <div className="space-y-3">
            {results.map((r, idx) => (
              <Card key={idx}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start gap-3">
                    {getIcon(r.status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{r.name}</span>
                        {getStatusBadge(r.status)}
                        {r.latencyMs !== undefined && (
                          <span className="text-xs text-muted-foreground">{r.latencyMs}ms</span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{r.message}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !running ? (
          <Card>
            <CardContent className="pt-12 pb-12 flex flex-col items-center text-muted-foreground">
              <Wrench className="h-12 w-12 mb-4 opacity-20" />
              <p className="text-sm mb-1">点击"运行诊断"开始检测</p>
              <p className="text-xs opacity-70">将检测数据库、LLM 连通性、MCP 连接器等组件</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {["数据库连接", "LLM 服务", "MCP 连接器", "Skill 引擎"].map((name) => (
              <Card key={name}>
                <CardContent className="pt-4 pb-4 flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">正在检测 {name}...</span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
