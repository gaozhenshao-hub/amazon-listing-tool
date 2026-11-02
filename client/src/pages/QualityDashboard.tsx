import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  ImageIcon,
  Languages,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type CoverageMetric = {
  denominatorCount: number;
  numeratorCount: number;
  ratio: number;
};

type QualityDashboardData = {
  listing: {
    factHumanConfirmation: CoverageMetric;
    coreHumanConfirmation: CoverageMetric;
    candidateHumanReview: CoverageMetric & { recordedDecisionCount: number };
  };
  image: {
    policyHumanReview: CoverageMetric;
    licenseEvidenceHumanReview: CoverageMetric;
  };
  operations: {
    totalRunCount: number;
    succeededRunCount: number;
    failedRunCount: number;
    activeRunCount: number;
    canceledRunCount: number;
    completedRunSuccessRatio: number;
  };
  americanEnglishHumanReview: {
    sampleCount: number;
    message: string;
  };
};

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

function MetricCard({
  title,
  metric,
  accentClass,
  accentTintClass,
  icon: Icon,
  description,
}: {
  title: string;
  metric: CoverageMetric;
  accentClass: string;
  accentTintClass: string;
  icon: typeof ClipboardCheck;
  description: string;
}) {
  return (
    <Card className="relative overflow-hidden">
      <div className={`absolute inset-x-0 top-0 h-1 ${accentClass}`} />
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardDescription>{title}</CardDescription>
            <CardTitle className="mt-2 text-3xl tabular-nums">{percent(metric.ratio)}</CardTitle>
          </div>
          <div className={`rounded-lg p-2.5 text-slate-800 ${accentTintClass}`}>
            <Icon className="size-5" aria-hidden="true" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${accentClass}`} style={{ width: `${Math.round(metric.ratio * 100)}%` }} />
        </div>
        <p className="text-sm text-muted-foreground">
          已人工处理 <span className="font-medium tabular-nums text-foreground">{metric.numeratorCount}</span> / {metric.denominatorCount}
        </p>
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function DashboardLoading() {
  return (
    <div className="space-y-6" aria-label="正在加载质量仪表盘">
      <div className="flex items-center justify-between">
        <div className="space-y-2"><Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-80" /></div>
        <Skeleton className="h-9 w-20" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton className="h-52" key={index} />)}
      </div>
      <div className="grid gap-6 xl:grid-cols-5">
        <Skeleton className="h-80 xl:col-span-3" />
        <Skeleton className="h-80 xl:col-span-2" />
      </div>
    </div>
  );
}

function NoRecordsState() {
  return (
    <Card>
      <CardContent className="py-12">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><BarChart3 /></EmptyMedia>
            <EmptyTitle>当前工作空间暂无可汇总记录</EmptyTitle>
            <EmptyDescription>仪表盘仅展示已有事实、卖点、图片审核和运行账本的汇总数量与比率；不会填充示例或假数据。</EmptyDescription>
            <EmptyDescription>美语质量人工审阅：样本不足，不能判断美语质量。</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </CardContent>
    </Card>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="py-12">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon"><AlertTriangle /></EmptyMedia>
            <EmptyTitle>无法读取质量仪表盘</EmptyTitle>
            <EmptyDescription>请检查工作空间访问权限或稍后重试。此页面仅读取汇总数据，不会更改任何 Listing、图片或运行记录。</EmptyDescription>
          </EmptyHeader>
          <Button variant="outline" onClick={onRetry}><RefreshCw className="mr-2 size-4" />重试</Button>
        </Empty>
      </CardContent>
    </Card>
  );
}

function hasNoRecords(data: QualityDashboardData) {
  return data.listing.factHumanConfirmation.denominatorCount === 0
    && data.listing.coreHumanConfirmation.denominatorCount === 0
    && data.listing.candidateHumanReview.denominatorCount === 0
    && data.image.policyHumanReview.denominatorCount === 0
    && data.image.licenseEvidenceHumanReview.denominatorCount === 0
    && data.operations.totalRunCount === 0;
}

function DashboardContent({ data }: { data: QualityDashboardData }) {
  const coverageData = [
    { name: "事实确认", value: Math.round(data.listing.factHumanConfirmation.ratio * 100), fill: "#2563eb" },
    { name: "核心确认", value: Math.round(data.listing.coreHumanConfirmation.ratio * 100), fill: "#7c3aed" },
    { name: "候选审阅", value: Math.round(data.listing.candidateHumanReview.ratio * 100), fill: "#0891b2" },
    { name: "图片策略", value: Math.round(data.image.policyHumanReview.ratio * 100), fill: "#d97706" },
    { name: "许可凭证", value: Math.round(data.image.licenseEvidenceHumanReview.ratio * 100), fill: "#059669" },
  ];
  const runData = [
    { name: "成功", value: data.operations.succeededRunCount, fill: "#10b981" },
    { name: "失败", value: data.operations.failedRunCount, fill: "#ef4444" },
    { name: "进行中", value: data.operations.activeRunCount, fill: "#f59e0b" },
    { name: "已取消", value: data.operations.canceledRunCount, fill: "#64748b" },
  ].filter(item => item.value > 0);

  return (
    <div className="space-y-6">
      <section aria-label="人工治理覆盖率" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="事实人工确认" metric={data.listing.factHumanConfirmation} accentClass="bg-blue-500" accentTintClass="bg-blue-100" icon={ShieldCheck} description="仅计入确认人和确认时间均存在的事实版本。" />
        <MetricCard title="卖点核心人工确认" metric={data.listing.coreHumanConfirmation} accentClass="bg-violet-500" accentTintClass="bg-violet-100" icon={CheckCircle2} description="仅计入具备人工确认留痕的卖点核心版本。" />
        <MetricCard title="候选人工审阅" metric={data.listing.candidateHumanReview} accentClass="bg-cyan-500" accentTintClass="bg-cyan-100" icon={ClipboardCheck} description={`已记录 ${data.listing.candidateHumanReview.recordedDecisionCount} 次有效人工决定。`} />
        <MetricCard title="图片策略人工审核" metric={data.image.policyHumanReview} accentClass="bg-amber-500" accentTintClass="bg-amber-100" icon={ImageIcon} description="仅计入已人工审核且具有终态的图片策略版本。" />
      </section>

      <section className="grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">治理覆盖率</CardTitle>
            <CardDescription>汇总记录的人工确认/审阅覆盖，不代表文案或视觉质量评分。</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={coverageData} layout="vertical" margin={{ left: 16, right: 24 }}>
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
                <YAxis type="category" dataKey="name" width={72} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value) => [`${value}%`, "覆盖率"]} cursor={{ fill: "#f8fafc" }} />
                <Bar dataKey="value" radius={[0, 5, 5, 0]}>{coverageData.map(item => <Cell key={item.name} fill={item.fill} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Emperor 运行状态</CardTitle>
            <CardDescription>旧运行账本的状态汇总，不作为人工质量评价。</CardDescription>
          </CardHeader>
          <CardContent className="flex h-72 items-center gap-4">
            {runData.length ? (
              <>
                <ResponsiveContainer width="55%" height="100%">
                  <PieChart>
                    <Pie data={runData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={3}>
                      {runData.map(item => <Cell key={item.name} fill={item.fill} />)}
                    </Pie>
                    <Tooltip formatter={(value) => [value, "运行数"]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="min-w-28 space-y-3 text-sm">
                  {runData.map(item => <div className="flex items-center justify-between gap-3" key={item.name}><span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ backgroundColor: item.fill }} />{item.name}</span><strong className="tabular-nums">{item.value}</strong></div>)}
                  <div className="border-t pt-3 text-muted-foreground">已结束运行成功率 <strong className="ml-1 text-foreground">{percent(data.operations.completedRunSuccessRatio)}</strong></div>
                </div>
              </>
            ) : <p className="w-full text-center text-sm text-muted-foreground">暂无运行状态记录</p>}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">图片许可凭证人工审核</CardTitle>
            <CardDescription>独立呈现可追溯许可凭证的审核覆盖。</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-6">
            <div><p className="text-4xl font-semibold tabular-nums">{percent(data.image.licenseEvidenceHumanReview.ratio)}</p><p className="mt-2 text-sm text-muted-foreground">已人工审核 {data.image.licenseEvidenceHumanReview.numeratorCount} / {data.image.licenseEvidenceHumanReview.denominatorCount}</p></div>
            <div className="rounded-xl bg-emerald-50 p-4 text-emerald-700"><ImageIcon className="size-7" aria-hidden="true" /></div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50/40">
          <CardHeader>
            <div className="flex items-center gap-2"><Languages className="size-5 text-amber-700" aria-hidden="true" /><CardTitle className="text-base">美语质量人工审阅</CardTitle><Badge variant="outline" className="border-amber-300 bg-white text-amber-800">不作推断</Badge></div>
            <CardDescription>Gate、AI 自评、运行成功状态均不等同于人审美语质量。</CardDescription>
          </CardHeader>
          <CardContent><p className="font-medium text-amber-950">{data.americanEnglishHumanReview.message}</p><p className="mt-2 text-sm text-amber-800">可用人工美语审阅样本：{data.americanEnglishHumanReview.sampleCount}</p></CardContent>
        </Card>
      </section>
    </div>
  );
}

export default function QualityDashboard() {
  const dashboardQuery = trpc.quality.dashboard.useQuery(undefined, { staleTime: 30_000 });
  const data: QualityDashboardData | undefined = dashboardQuery.data;

  return (
    <main className="container max-w-7xl space-y-6 py-6">
      <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-gradient-to-br from-slate-900 to-slate-700 p-3 text-white shadow-sm"><Sparkles className="size-6" aria-hidden="true" /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold tracking-tight">Listing 与图片质量仪表盘</h1><Badge variant="outline">只读统计</Badge></div>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">按当前认证工作空间汇总人工治理覆盖和运行状态。仅显示数量与比率，不显示商品文本、ASIN、链接、对象存储信息或个人标识。</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => dashboardQuery.refetch()} disabled={dashboardQuery.isFetching}>
          <RefreshCw className={`mr-2 size-4 ${dashboardQuery.isFetching ? "animate-spin" : ""}`} />刷新
        </Button>
      </header>

      {dashboardQuery.isLoading && <DashboardLoading />}
      {dashboardQuery.isError && <ErrorState onRetry={() => dashboardQuery.refetch()} />}
      {!dashboardQuery.isLoading && !dashboardQuery.isError && !data && <ErrorState onRetry={() => dashboardQuery.refetch()} />}
      {!dashboardQuery.isError && data && (hasNoRecords(data) ? <NoRecordsState /> : <DashboardContent data={data} />)}
    </main>
  );
}
