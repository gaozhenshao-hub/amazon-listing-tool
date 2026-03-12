import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2, PlusCircle, Search } from "lucide-react";

export default function DevSupplierLibrary() {
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">供应商库</h1>
          <p className="text-muted-foreground text-sm mt-1">管理全局供应商资源，支持评分和对比</p>
        </div>
        <Button className="gap-2"><PlusCircle className="h-4 w-4" />添加供应商</Button>
      </div>
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="搜索供应商..." className="pl-9" />
        </div>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Building2 className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm">暂无供应商数据</p>
          <p className="text-xs mt-1">添加供应商后可进行评分和对比</p>
        </CardContent>
      </Card>
    </div>
  );
}
