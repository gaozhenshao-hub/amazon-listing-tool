import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import ProjectSelector from "@/components/ProjectSelector";
import { useProject } from "@/contexts/ProjectContext";
import {
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  TrendingUp,
  Target,
  RefreshCw,
  Loader2,
  ChevronRight,
  Lightbulb,
  Shield,
  Type,
  List,
  FileText,
  Key,
  Search,
  Gauge,
} from "lucide-react";
import { useMemo } from "react";

// Grade color mapping
function gradeColor(grade: string): string {
  if (grade === "A+" || grade === "A") return "text-emerald-600";
  if (grade === "B+" || grade === "B") return "text-blue-600";
  if (grade === "C") return "text-amber-600";
  if (grade === "D") return "text-orange-600";
  return "text-red-600";
}

function gradeBg(grade: string): string {
  if (grade === "A+" || grade === "A") return "bg-emerald-50 border-emerald-200";
  if (grade === "B+" || grade === "B") return "bg-blue-50 border-blue-200";
  if (grade === "C") return "bg-amber-50 border-amber-200";
  if (grade === "D") return "bg-orange-50 border-orange-200";
  return "bg-red-50 border-red-200";
}

function progressColor(percentage: number): string {
  if (percentage >= 85) return "bg-emerald-500";
  if (percentage >= 70) return "bg-blue-500";
  if (percentage >= 55) return "bg-amber-500";
  if (percentage >= 40) return "bg-orange-500";
  return "bg-red-500";
}

function severityIcon(severity: string) {
  if (severity === "critical") return <XCircle className="h-4 w-4 text-red-500 shrink-0" />;
  if (severity === "warning") return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />;
  return <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />;
}

function priorityBadge(priority: string) {
  if (priority === "high") return <Badge variant="destructive" className="text-xs">高优先</Badge>;
  if (priority === "medium") return <Badge variant="outline" className="text-xs border-amber-300 text-amber-700 bg-amber-50">中优先</Badge>;
  return <Badge variant="outline" className="text-xs">低优先</Badge>;
}

const dimensionIcons: Record<string, React.ReactNode> = {
  "Title Optimization": <Type className="h-5 w-5" />,
  "Bullet Points Quality": <List className="h-5 w-5" />,
  "Description Quality": <FileText className="h-5 w-5" />,
  "Search Terms Optimization": <Search className="h-5 w-5" />,
  "Keyword Coverage": <Key className="h-5 w-5" />,
  "Overall SEO": <Shield className="h-5 w-5" />,
};

export default function ScorePage() {
  const { selectedProjectId } = useProject();

  const scoreQuery = trpc.scoring.scoreListing.useQuery(
    { projectId: selectedProjectId! },
    { enabled: !!selectedProjectId }
  );

  const score = scoreQuery.data;

  // Radar chart data for SVG
  const radarData = useMemo(() => {
    if (!score?.dimensions) return [];
    return score.dimensions.map((d, i) => ({
      name: d.nameCn,
      percentage: d.percentage,
      angle: (Math.PI * 2 * i) / score.dimensions.length - Math.PI / 2,
    }));
  }, [score]);

  // SVG radar chart points
  const radarPoints = useMemo(() => {
    if (radarData.length === 0) return "";
    const cx = 150, cy = 150, r = 120;
    return radarData.map(d => {
      const x = cx + (d.percentage / 100) * r * Math.cos(d.angle);
      const y = cy + (d.percentage / 100) * r * Math.sin(d.angle);
      return `${x},${y}`;
    }).join(" ");
  }, [radarData]);

  // Grid lines for radar
  const gridLevels = [25, 50, 75, 100];

  return (
    <div className="container max-w-7xl py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-amber-100 to-orange-100">
            <BarChart3 className="h-6 w-6 text-amber-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Listing 评分</h1>
            <p className="text-sm text-muted-foreground">基于A9算法规则的智能评分与优化建议</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ProjectSelector />
          {selectedProjectId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => scoreQuery.refetch()}
              disabled={scoreQuery.isFetching}
            >
              {scoreQuery.isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              刷新评分
            </Button>
          )}
        </div>
      </div>

      {!selectedProjectId && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Target className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">请先选择一个项目</p>
            <p className="text-sm">选择项目后将自动评估Listing质量</p>
          </CardContent>
        </Card>
      )}

      {selectedProjectId && scoreQuery.isLoading && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-amber-600 mb-4" />
            <p className="text-muted-foreground">正在评估Listing质量...</p>
          </CardContent>
        </Card>
      )}

      {selectedProjectId && !scoreQuery.isLoading && !score && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <FileText className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">暂无Listing数据</p>
            <p className="text-sm">请先在「Listing生成」页面生成内容后再查看评分</p>
          </CardContent>
        </Card>
      )}

      {score && (
        <>
          {/* Overall Score Card */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Score Circle */}
            <Card className={`border-2 ${gradeBg(score.grade)}`}>
              <CardContent className="flex flex-col items-center justify-center py-8">
                <div className="relative w-40 h-40 mb-4">
                  <svg viewBox="0 0 120 120" className="w-full h-full">
                    {/* Background circle */}
                    <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="8" className="text-gray-200" />
                    {/* Score arc */}
                    <circle
                      cx="60" cy="60" r="52"
                      fill="none"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={`${(score.percentage / 100) * 327} 327`}
                      strokeDashoffset="0"
                      transform="rotate(-90 60 60)"
                      className={score.percentage >= 85 ? "stroke-emerald-500" : score.percentage >= 70 ? "stroke-blue-500" : score.percentage >= 55 ? "stroke-amber-500" : "stroke-red-500"}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-4xl font-bold ${gradeColor(score.grade)}`}>{score.percentage}</span>
                    <span className="text-xs text-muted-foreground">/ 100</span>
                  </div>
                </div>
                <div className={`text-3xl font-bold ${gradeColor(score.grade)}`}>{score.grade}</div>
                <p className="text-sm text-muted-foreground mt-1">
                  {score.totalScore}/{score.maxScore} 分
                </p>
              </CardContent>
            </Card>

            {/* Radar Chart */}
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Gauge className="h-4 w-4" />
                  六维评分雷达图
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center">
                  <svg viewBox="0 0 300 300" className="w-full max-w-[320px] h-auto">
                    {/* Grid */}
                    {gridLevels.map(level => {
                      const points = radarData.map(d => {
                        const x = 150 + (level / 100) * 120 * Math.cos(d.angle);
                        const y = 150 + (level / 100) * 120 * Math.sin(d.angle);
                        return `${x},${y}`;
                      }).join(" ");
                      return (
                        <polygon
                          key={level}
                          points={points}
                          fill="none"
                          stroke="#e5e7eb"
                          strokeWidth="1"
                        />
                      );
                    })}
                    {/* Axis lines */}
                    {radarData.map((d, i) => (
                      <line
                        key={i}
                        x1="150" y1="150"
                        x2={150 + 120 * Math.cos(d.angle)}
                        y2={150 + 120 * Math.sin(d.angle)}
                        stroke="#e5e7eb"
                        strokeWidth="1"
                      />
                    ))}
                    {/* Data polygon */}
                    {radarPoints && (
                      <polygon
                        points={radarPoints}
                        fill="rgba(217, 119, 6, 0.15)"
                        stroke="rgb(217, 119, 6)"
                        strokeWidth="2"
                      />
                    )}
                    {/* Data points */}
                    {radarData.map((d, i) => {
                      const x = 150 + (d.percentage / 100) * 120 * Math.cos(d.angle);
                      const y = 150 + (d.percentage / 100) * 120 * Math.sin(d.angle);
                      return (
                        <circle key={i} cx={x} cy={y} r="4" fill="rgb(217, 119, 6)" stroke="white" strokeWidth="2" />
                      );
                    })}
                    {/* Labels */}
                    {radarData.map((d, i) => {
                      const labelR = 140;
                      const x = 150 + labelR * Math.cos(d.angle);
                      const y = 150 + labelR * Math.sin(d.angle);
                      return (
                        <text
                          key={i}
                          x={x} y={y}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          className="text-[11px] fill-gray-600"
                        >
                          {d.name}
                        </text>
                      );
                    })}
                  </svg>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tabs: Dimensions / Suggestions */}
          <Tabs defaultValue="dimensions" className="w-full">
            <TabsList className="grid w-full grid-cols-2 max-w-md">
              <TabsTrigger value="dimensions">评分详情</TabsTrigger>
              <TabsTrigger value="suggestions">
                优化建议
                {score.suggestions.length > 0 && (
                  <Badge variant="secondary" className="ml-2 text-xs">{score.suggestions.length}</Badge>
                )}
              </TabsTrigger>
            </TabsList>

            {/* Dimensions Tab */}
            <TabsContent value="dimensions" className="space-y-4 mt-4">
              {score.dimensions.map((dim, idx) => (
                <Card key={idx}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${gradeBg(dim.grade)}`}>
                          {dimensionIcons[dim.name] || <BarChart3 className="h-5 w-5" />}
                        </div>
                        <div>
                          <CardTitle className="text-base">{dim.nameCn}</CardTitle>
                          <CardDescription className="text-xs">{dim.name}</CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className={`text-2xl font-bold ${gradeColor(dim.grade)}`}>{dim.score}/{dim.maxScore}</div>
                          <div className="text-xs text-muted-foreground">{dim.percentage}%</div>
                        </div>
                        <div className={`text-xl font-bold ${gradeColor(dim.grade)}`}>{dim.grade}</div>
                      </div>
                    </div>
                    <div className="mt-2">
                      <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${progressColor(dim.percentage)}`}
                          style={{ width: `${dim.percentage}%` }}
                        />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-2">
                      {dim.details.map((detail, dIdx) => (
                        <div
                          key={dIdx}
                          className={`flex items-start gap-3 p-3 rounded-lg ${
                            detail.passed ? "bg-emerald-50/50" : detail.severity === "critical" ? "bg-red-50/50" : "bg-amber-50/50"
                          }`}
                        >
                          {severityIcon(detail.passed ? "info" : detail.severity)}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium">{detail.ruleCn}</span>
                              <span className="text-xs text-muted-foreground shrink-0">{detail.score}/{detail.maxScore}分</span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{detail.messageCn}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            {/* Suggestions Tab */}
            <TabsContent value="suggestions" className="space-y-4 mt-4">
              {score.suggestions.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <CheckCircle2 className="h-12 w-12 text-emerald-500 mb-4" />
                    <p className="text-lg font-medium text-emerald-700">Listing质量优秀！</p>
                    <p className="text-sm text-muted-foreground">所有评分维度均已达标，暂无优化建议</p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* Summary */}
                  <Card className="bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200">
                    <CardContent className="py-4">
                      <div className="flex items-center gap-3">
                        <Lightbulb className="h-5 w-5 text-amber-600" />
                        <div>
                          <p className="text-sm font-medium text-amber-800">
                            共 {score.suggestions.length} 条优化建议
                          </p>
                          <p className="text-xs text-amber-600">
                            其中 {score.suggestions.filter(s => s.priority === "high").length} 条高优先，
                            {score.suggestions.filter(s => s.priority === "medium").length} 条中优先，
                            {score.suggestions.filter(s => s.priority === "low").length} 条低优先
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Suggestion list */}
                  {score.suggestions.map((sug, idx) => (
                    <Card key={idx} className="hover:shadow-md transition-shadow">
                      <CardContent className="py-4">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5">
                            {sug.priority === "high" ? (
                              <div className="p-1.5 rounded-full bg-red-100">
                                <TrendingUp className="h-4 w-4 text-red-600" />
                              </div>
                            ) : sug.priority === "medium" ? (
                              <div className="p-1.5 rounded-full bg-amber-100">
                                <TrendingUp className="h-4 w-4 text-amber-600" />
                              </div>
                            ) : (
                              <div className="p-1.5 rounded-full bg-blue-100">
                                <TrendingUp className="h-4 w-4 text-blue-600" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              {priorityBadge(sug.priority)}
                              <Badge variant="outline" className="text-xs">{sug.dimensionCn}</Badge>
                            </div>
                            <p className="text-sm font-medium">{sug.suggestionCn}</p>
                            <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                              <ChevronRight className="h-3 w-3 mt-0.5 shrink-0" />
                              <span>{sug.impactCn}</span>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
