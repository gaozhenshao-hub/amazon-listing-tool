import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { PlusCircle, FolderOpen, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export default function DevProjectList() {
  const [, setLocation] = useLocation();
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">项目列表</h1>
        <Button onClick={() => setLocation("/dev/new-project")} className="gap-2">
          <PlusCircle className="h-4 w-4" />新建项目
        </Button>
      </div>
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="搜索项目..." className="pl-9" />
        </div>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <FolderOpen className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm">暂无项目</p>
          <Button variant="link" onClick={() => setLocation("/dev/new-project")} className="mt-2">创建第一个项目</Button>
        </CardContent>
      </Card>
    </div>
  );
}
