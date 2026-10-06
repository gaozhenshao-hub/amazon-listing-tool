import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function ServiceDataUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <Card role="alert" className="border-amber-300 bg-amber-50/40 dark:bg-amber-950/10">
      <CardContent className="flex flex-col items-start gap-3 py-8 sm:flex-row sm:items-center">
        <AlertTriangle aria-hidden="true" className="h-6 w-6 shrink-0 text-amber-600" />
        <div className="flex-1">
          <p className="font-medium">售后业务数据暂不可用</p>
          <p className="mt-1 text-sm text-muted-foreground">
            当前尚无可用的受控售后数据来源。本页不能据此判断 Review、退货或邮件数量为零；请先接入并导入数据，再尝试刷新。
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" />重试加载
        </Button>
      </CardContent>
    </Card>
  );
}
