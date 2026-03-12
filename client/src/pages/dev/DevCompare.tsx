import { Card, CardContent } from "@/components/ui/card";
import { GitCompare } from "lucide-react";

export default function DevCompare() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">产品对比</h1>
      <p className="text-muted-foreground text-sm">跨项目产品数据对比分析，支持多维度可视化比较</p>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <GitCompare className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm">选择两个或多个项目中的产品进行对比</p>
          <p className="text-xs mt-1">请先创建项目并导入产品数据</p>
        </CardContent>
      </Card>
    </div>
  );
}
