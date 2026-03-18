/**
 * 同步管理与使用量统计页面
 * 
 * 包含：部署信息、同步状态、同步日志、使用量统计、远程使用量
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  RefreshCw, Server, Cloud, Activity, BarChart3,
  CheckCircle, XCircle, AlertTriangle, Clock, Wifi, WifiOff,
  ArrowUpDown, Users, Cpu, Database, Globe
} from "lucide-react";

// ===== 部署信息卡片 =====
function DeploymentInfoCard() {
  const { data, isLoading } = trpc.deploymentConfig.getDeploymentInfo.useQuery();

  if (isLoading) return <Card><CardContent className="p-6"><div className="animate-pulse h-20 bg-muted rounded" /></CardContent></Card>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Server className="h-5 w-5" /> 部署信息</CardTitle>
        <CardDescription>当前系统部署配置</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">公司名称</p>
            <p className="font-medium">{data?.companyName || "未配置"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">ERP类型</p>
            <Badge variant="outline">{data?.erpType || "未配置"}</Badge>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">实例ID</p>
            <p className="font-mono text-sm">{data?.instanceId || "未配置"}</p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">对端同步</p>
            {data?.peerSyncEnabled ? (
              <Badge className="bg-green-100 text-green-800"><Wifi className="h-3 w-3 mr-1" /> 已启用</Badge>
            ) : (
              <Badge variant="secondary"><WifiOff className="h-3 w-3 mr-1" /> 未启用</Badge>
            )}
          </div>
        </div>
        {data?.peerApiUrl && (
          <div className="mt-4 p-3 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground">对端API地址</p>
            <p className="font-mono text-sm">{data.peerApiUrl}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ===== 同步状态卡片 =====
function SyncStatusCard() {
  const { data, isLoading, refetch } = trpc.deploymentConfig.getSyncStatus.useQuery();
  const triggerSync = trpc.deploymentConfig.triggerSync.useMutation();
  const handleTriggerSync = async () => {
    try {
      const result = await triggerSync.mutateAsync();
      if (result.success) {
        toast.success("同步成功", { description: "知识库同步已完成" });
        refetch();
      } else {
        toast.error("同步失败", { description: result.error });
      }
    } catch {
      toast.error("同步出错", { description: "请检查网络连接和对端配置" });
    }
  };

  if (isLoading) return <Card><CardContent className="p-6"><div className="animate-pulse h-20 bg-muted rounded" /></CardContent></Card>;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Cloud className="h-5 w-5" /> 同步状态</CardTitle>
            <CardDescription>知识库P2P双向同步</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> 刷新
            </Button>
            <Button size="sm" onClick={handleTriggerSync} disabled={!data?.enabled || triggerSync.isPending}>
              <ArrowUpDown className="h-4 w-4 mr-1" />
              {triggerSync.isPending ? "同步中..." : "手动同步"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
            {data?.enabled ? <CheckCircle className="h-5 w-5 text-green-500" /> : <XCircle className="h-5 w-5 text-gray-400" />}
            <div>
              <p className="text-sm text-muted-foreground">同步状态</p>
              <p className="font-medium">{data?.enabled ? "已启用" : "未启用"}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
            <Clock className="h-5 w-5 text-blue-500" />
            <div>
              <p className="text-sm text-muted-foreground">最后同步</p>
              <p className="font-medium text-sm">
                {data?.lastSync ? new Date(data.lastSync).toLocaleString() : "从未同步"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
            <AlertTriangle className={`h-5 w-5 ${(data?.pendingConflicts || 0) > 0 ? "text-yellow-500" : "text-gray-400"}`} />
            <div>
              <p className="text-sm text-muted-foreground">待处理冲突</p>
              <p className="font-medium">{data?.pendingConflicts || 0}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
            <XCircle className={`h-5 w-5 ${(data?.failuresLast24h || 0) > 0 ? "text-red-500" : "text-gray-400"}`} />
            <div>
              <p className="text-sm text-muted-foreground">24h失败次数</p>
              <p className="font-medium">{data?.failuresLast24h || 0}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ===== 同步日志表格 =====
function SyncLogsTable() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = trpc.deploymentConfig.getSyncLogs.useQuery({ page, limit: 20 });

  const statusColors: Record<string, string> = {
    synced: "bg-green-100 text-green-800",
    pending: "bg-yellow-100 text-yellow-800",
    conflict: "bg-orange-100 text-orange-800",
    failed: "bg-red-100 text-red-800",
  };

  const statusLabels: Record<string, string> = {
    synced: "已同步",
    pending: "待处理",
    conflict: "冲突",
    failed: "失败",
  };

  const directionLabels: Record<string, string> = {
    push: "推送 →",
    pull: "← 拉取",
  };

  const typeLabels: Record<string, string> = {
    kb_product: "产品创意",
    kb_listing: "Listing文案",
    kb_image_set: "图片集",
    kb_video: "视频",
    kb_skill: "运营技能",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" /> 同步日志</CardTitle>
        <CardDescription>最近的知识库同步记录</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="animate-pulse space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-10 bg-muted rounded" />)}
          </div>
        ) : (data?.logs?.length || 0) === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Cloud className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>暂无同步记录</p>
            <p className="text-sm">配置对端同步后，同步日志将在此显示</p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>方向</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>资源ID</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.logs?.map((log: any) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <Badge variant="outline">{directionLabels[log.syncDirection] || log.syncDirection}</Badge>
                    </TableCell>
                    <TableCell>{typeLabels[log.resourceType] || log.resourceType}</TableCell>
                    <TableCell className="font-mono text-sm">{log.resourceId}</TableCell>
                    <TableCell>
                      <Badge className={statusColors[log.syncStatus] || ""}>{statusLabels[log.syncStatus] || log.syncStatus}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {log.syncedAt ? new Date(log.syncedAt).toLocaleString() : new Date(log.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {(data?.total || 0) > 20 && (
              <div className="flex justify-center gap-2 mt-4">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
                <span className="text-sm text-muted-foreground py-2">第 {page} 页 / 共 {Math.ceil((data?.total || 0) / 20)} 页</span>
                <Button variant="outline" size="sm" disabled={page >= Math.ceil((data?.total || 0) / 20)} onClick={() => setPage(p => p + 1)}>下一页</Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ===== 使用量统计卡片 =====
function UsageStatsCard() {
  const { data, isLoading } = trpc.deploymentConfig.getUsageStats.useQuery({
    period: "day",
  });

  if (isLoading) return <Card><CardContent className="p-6"><div className="animate-pulse h-40 bg-muted rounded" /></CardContent></Card>;

  const summary = data?.summary;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" /> 使用量统计</CardTitle>
        <CardDescription>近30天使用量汇总</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="text-center p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
            <Users className="h-6 w-6 mx-auto mb-2 text-blue-500" />
            <p className="text-2xl font-bold">{summary?.totalUsers || 0}</p>
            <p className="text-xs text-muted-foreground">总用户数</p>
          </div>
          <div className="text-center p-4 bg-green-50 dark:bg-green-950 rounded-lg">
            <Users className="h-6 w-6 mx-auto mb-2 text-green-500" />
            <p className="text-2xl font-bold">{summary?.activeUsers || 0}</p>
            <p className="text-xs text-muted-foreground">活跃用户</p>
          </div>
          <div className="text-center p-4 bg-purple-50 dark:bg-purple-950 rounded-lg">
            <Cpu className="h-6 w-6 mx-auto mb-2 text-purple-500" />
            <p className="text-2xl font-bold">{summary?.totalAiCalls || 0}</p>
            <p className="text-xs text-muted-foreground">AI调用次数</p>
          </div>
          <div className="text-center p-4 bg-orange-50 dark:bg-orange-950 rounded-lg">
            <Activity className="h-6 w-6 mx-auto mb-2 text-orange-500" />
            <p className="text-2xl font-bold">{formatNumber(summary?.totalTokens || 0)}</p>
            <p className="text-xs text-muted-foreground">Token消耗</p>
          </div>
          <div className="text-center p-4 bg-cyan-50 dark:bg-cyan-950 rounded-lg">
            <Globe className="h-6 w-6 mx-auto mb-2 text-cyan-500" />
            <p className="text-2xl font-bold">{summary?.totalApiCalls || 0}</p>
            <p className="text-xs text-muted-foreground">API调用次数</p>
          </div>
          <div className="text-center p-4 bg-rose-50 dark:bg-rose-950 rounded-lg">
            <Database className="h-6 w-6 mx-auto mb-2 text-rose-500" />
            <p className="text-2xl font-bold">{formatBytes(summary?.totalStorage || 0)}</p>
            <p className="text-xs text-muted-foreground">存储使用</p>
          </div>
        </div>

        {/* 每日使用量表格 */}
        {(data?.stats?.length || 0) > 0 && (
          <div className="mt-6">
            <h4 className="text-sm font-medium mb-3">每日明细</h4>
            <div className="max-h-64 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>日期</TableHead>
                    <TableHead className="text-right">AI调用</TableHead>
                    <TableHead className="text-right">Token</TableHead>
                    <TableHead className="text-right">API调用</TableHead>
                    <TableHead className="text-right">爬虫调用</TableHead>
                    <TableHead className="text-right">登录次数</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.stats?.map((stat: any) => (
                    <TableRow key={stat.id}>
                      <TableCell>{stat.statDate}</TableCell>
                      <TableCell className="text-right">{stat.aiCallCount || 0}</TableCell>
                      <TableCell className="text-right">{formatNumber(stat.aiTokensUsed || 0)}</TableCell>
                      <TableCell className="text-right">{stat.apiCallCount || 0}</TableCell>
                      <TableCell className="text-right">{stat.scraperCallCount || 0}</TableCell>
                      <TableCell className="text-right">{stat.loginCount || 0}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ===== 远程使用量卡片 =====
function RemoteUsageCard() {
  const { data, isLoading } = trpc.deploymentConfig.getRemoteUsageSnapshots.useQuery({});
  const reportUsage = trpc.deploymentConfig.reportUsage.useMutation();
  const handleReport = async () => {
    try {
      const result = await reportUsage.mutateAsync();
      if (result.success) {
        toast.success("上报成功", { description: "使用量数据已上报到对端" });
      } else {
        toast.error("上报失败", { description: result.error });
      }
    } catch {
      toast.error("上报出错");
    }
  };

  if (isLoading) return <Card><CardContent className="p-6"><div className="animate-pulse h-20 bg-muted rounded" /></CardContent></Card>;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Globe className="h-5 w-5" /> 远程使用量</CardTitle>
            <CardDescription>对端系统使用量快照</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={handleReport} disabled={reportUsage.isPending}>
            {reportUsage.isPending ? "上报中..." : "手动上报"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {(data?.snapshots?.length || 0) === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Globe className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>暂无远程使用量数据</p>
            <p className="text-sm">对端系统上报使用量后，数据将在此显示</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>实例</TableHead>
                <TableHead>日期</TableHead>
                <TableHead className="text-right">总用户</TableHead>
                <TableHead className="text-right">活跃用户</TableHead>
                <TableHead className="text-right">AI调用</TableHead>
                <TableHead className="text-right">API调用</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.snapshots?.map((snap: any) => (
                <TableRow key={snap.id}>
                  <TableCell className="font-medium">{snap.instanceName || snap.instanceId}</TableCell>
                  <TableCell>{snap.snapshotDate}</TableCell>
                  <TableCell className="text-right">{snap.totalUsers || 0}</TableCell>
                  <TableCell className="text-right">{snap.activeUsers || 0}</TableCell>
                  <TableCell className="text-right">{snap.aiCallCount || 0}</TableCell>
                  <TableCell className="text-right">{snap.apiCallCount || 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ===== 辅助函数 =====
function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

// ===== 主页面 =====
export default function SyncManagement() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">系统同步与监控</h1>
        <p className="text-muted-foreground">管理知识库同步、查看部署信息和使用量统计</p>
      </div>

      <Tabs defaultValue="sync" className="space-y-4">
        <TabsList>
          <TabsTrigger value="sync">同步管理</TabsTrigger>
          <TabsTrigger value="usage">使用量统计</TabsTrigger>
          <TabsTrigger value="deployment">部署信息</TabsTrigger>
        </TabsList>

        <TabsContent value="sync" className="space-y-4">
          <SyncStatusCard />
          <SyncLogsTable />
        </TabsContent>

        <TabsContent value="usage" className="space-y-4">
          <UsageStatsCard />
          <RemoteUsageCard />
        </TabsContent>

        <TabsContent value="deployment" className="space-y-4">
          <DeploymentInfoCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
