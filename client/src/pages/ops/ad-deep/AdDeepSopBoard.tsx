import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ClipboardList, CheckCircle, Clock, AlertTriangle, ArrowRight, RefreshCw } from "lucide-react";
import AdDeepFilters from "./AdDeepFilters";

const STATUS_COLORS: Record<string, string> = {
  "pending": "bg-gray-100 text-gray-700",
  "in_progress": "bg-blue-100 text-blue-700",
  "completed": "bg-green-100 text-green-700",
  "overdue": "bg-red-100 text-red-700",
};

const FREQUENCY_LABELS: Record<string, string> = {
  "daily": "每日",
  "weekly": "每周",
  "monthly": "每月",
};

export default function AdDeepSopBoard() {
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const generateMutation = trpc.adDeepAnalysis.generateSopTasks.useMutation();

  const handleGenerate = async (portfolios: string[], dateStart: string, dateEnd: string) => {
    setLoading(true);
    try {
      const res = await generateMutation.mutateAsync({ portfolioNames: portfolios, dateStart, dateEnd });
      setResult(res);
      toast.success(`生成 ${res.tasks?.length || 0} 个SOP任务`);
    } catch (err: any) {
      toast.error(`生成失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const toggleTask = (idx: number) => {
    if (result?.tasks) {
      const updated = [...result.tasks];
      updated[idx] = {
        ...updated[idx],
        status: updated[idx].status === "completed" ? "pending" : "completed",
      };
      setResult({ ...result, tasks: updated });
    }
  };

  const groupedTasks = result?.tasks?.reduce((acc: any, task: any) => {
    const freq = task.frequency || "daily";
    if (!acc[freq]) acc[freq] = [];
    acc[freq].push(task);
    return acc;
  }, {} as Record<string, any[]>) || {};

  return (
    <div className="space-y-6">
      <AdDeepFilters onFilter={handleGenerate} loading={loading} actionLabel="生成SOP任务" />

      {result && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-4 gap-3">
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">总任务数</p>
              <p className="text-2xl font-bold">{result.tasks?.length || 0}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">已完成</p>
              <p className="text-2xl font-bold text-green-600">{result.tasks?.filter((t: any) => t.status === "completed").length || 0}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">待执行</p>
              <p className="text-2xl font-bold text-blue-600">{result.tasks?.filter((t: any) => t.status === "pending").length || 0}</p>
            </CardContent></Card>
            <Card><CardContent className="p-3 text-center">
              <p className="text-xs text-muted-foreground">逾期</p>
              <p className="text-2xl font-bold text-red-600">{result.tasks?.filter((t: any) => t.status === "overdue").length || 0}</p>
            </CardContent></Card>
          </div>

          {/* Tasks by Frequency */}
          {Object.entries(groupedTasks).map(([freq, tasks]: [string, any]) => (
            <Card key={freq}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Clock className="w-4 h-4" />
                  {FREQUENCY_LABELS[freq] || freq}任务
                  <Badge variant="outline">{tasks.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {tasks.map((task: any, idx: number) => {
                  const globalIdx = result.tasks.indexOf(task);
                  return (
                    <div key={idx} className="flex items-start gap-3 border rounded-lg p-3 hover:bg-muted/30">
                      <Checkbox
                        checked={task.status === "completed"}
                        onCheckedChange={() => toggleTask(globalIdx)}
                        className="mt-0.5"
                      />
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-sm font-medium ${task.status === "completed" ? "line-through text-muted-foreground" : ""}`}>
                            {task.title}
                          </span>
                          <Badge className={STATUS_COLORS[task.status] || ""} variant="outline">
                            {task.status === "completed" ? "已完成" : task.status === "overdue" ? "逾期" : "待执行"}
                          </Badge>
                          {task.priority && (
                            <Badge className={task.priority === "high" ? "bg-red-100 text-red-700" : task.priority === "medium" ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700"}>
                              {task.priority === "high" ? "高优" : task.priority === "medium" ? "中优" : "低优"}
                            </Badge>
                          )}
                        </div>
                        {task.description && <p className="text-xs text-muted-foreground">{task.description}</p>}
                        {task.source_rule && <Badge variant="outline" className="text-xs">来源: {task.source_rule}</Badge>}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
