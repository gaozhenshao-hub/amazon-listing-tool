import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen, ArrowRight, FileSpreadsheet, Upload, BarChart3,
  CheckCircle2, AlertCircle, Database, TrendingUp, Package,
  ClipboardList, Target, RefreshCw,
} from "lucide-react";

interface ImportWizardTabProps {
  onNavigate: (tab: string) => void;
}

const IMPORT_STEPS = [
  {
    step: 1,
    title: "产品周度数据",
    description: "领星/赛狐产品表现Excel",
    tab: "upload",
    icon: Package,
    color: "blue",
    required: true,
    sources: ["领星ERP → 产品 → 产品表现 → 导出", "赛狐 → 产品分析 → ASIN列表 → 导出"],
    frequency: "每周一次（建议周一导入上周数据）",
    fields: "销量、销售额、利润、广告花费、退货率等",
  },
  {
    step: 2,
    title: "广告投放报表",
    description: "亚马逊广告后台SP/SB/SD报表",
    tab: "ad-report",
    icon: Target,
    color: "purple",
    required: true,
    sources: ["亚马逊广告后台 → 报告 → 创建报告", "选择SP/SB/SD投放报告 → 下载Excel"],
    frequency: "每周或每两周一次",
    fields: "Campaign、ACOS、花费、点击、转化等",
  },
  {
    step: 3,
    title: "每日深度数据",
    description: "广告每日分时段表现数据",
    tab: "daily-report",
    icon: TrendingUp,
    color: "green",
    required: false,
    sources: ["亚马逊广告后台 → 报告 → 每日投放报告", "按天下载CSV/Excel文件"],
    frequency: "按需（深度分析时导入）",
    fields: "每日花费、曝光、点击、订单、分时段数据",
  },
  {
    step: 4,
    title: "运营计划",
    description: "周度/月度运营目标与计划",
    tab: "ops-plan",
    icon: ClipboardList,
    color: "amber",
    required: false,
    sources: ["使用系统模板填写", "或从现有运营表格导入"],
    frequency: "每周/每月初",
    fields: "目标销量、预算、推广策略、库存计划",
  },
  {
    step: 5,
    title: "执行复盘",
    description: "运营执行结果与反思",
    tab: "review-import",
    icon: RefreshCw,
    color: "rose",
    required: false,
    sources: ["使用系统模板填写", "记录实际执行情况与偏差原因"],
    frequency: "每周末",
    fields: "实际完成情况、偏差分析、改进措施",
  },
];

const colorMap: Record<string, { bg: string; text: string; border: string; iconBg: string }> = {
  blue: { bg: "bg-blue-50 dark:bg-blue-950/20", text: "text-blue-700 dark:text-blue-300", border: "border-blue-200 dark:border-blue-800", iconBg: "bg-blue-100 dark:bg-blue-900/40" },
  purple: { bg: "bg-purple-50 dark:bg-purple-950/20", text: "text-purple-700 dark:text-purple-300", border: "border-purple-200 dark:border-purple-800", iconBg: "bg-purple-100 dark:bg-purple-900/40" },
  green: { bg: "bg-green-50 dark:bg-green-950/20", text: "text-green-700 dark:text-green-300", border: "border-green-200 dark:border-green-800", iconBg: "bg-green-100 dark:bg-green-900/40" },
  amber: { bg: "bg-amber-50 dark:bg-amber-950/20", text: "text-amber-700 dark:text-amber-300", border: "border-amber-200 dark:border-amber-800", iconBg: "bg-amber-100 dark:bg-amber-900/40" },
  rose: { bg: "bg-rose-50 dark:bg-rose-950/20", text: "text-rose-700 dark:text-rose-300", border: "border-rose-200 dark:border-rose-800", iconBg: "bg-rose-100 dark:bg-rose-900/40" },
};

export default function ImportWizardTab({ onNavigate }: ImportWizardTabProps) {
  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            数据导入向导
          </CardTitle>
          <CardDescription className="text-base">
            本系统所有业务数据通过Excel表格导入。按照以下流程依次导入数据，即可解锁全部AI分析功能。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
              <Database className="h-3 w-3 mr-1" /> 数据驱动
            </Badge>
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
              <BarChart3 className="h-3 w-3 mr-1" /> AI分析
            </Badge>
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
              <CheckCircle2 className="h-3 w-3 mr-1" /> 人工确认
            </Badge>
            <span className="text-sm text-muted-foreground ml-2">
              核心理念：AI是助手，人是决策者
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Import Flow Steps */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          数据导入流程（按优先级排序）
        </h3>

        <div className="grid gap-4">
          {IMPORT_STEPS.map((step, idx) => {
            const colors = colorMap[step.color];
            const Icon = step.icon;
            return (
              <Card key={step.step} className={`${colors.border} border transition-all hover:shadow-md`}>
                <CardContent className="pt-5 pb-5">
                  <div className="flex items-start gap-4">
                    {/* Step Number + Icon */}
                    <div className="flex flex-col items-center gap-1">
                      <div className={`h-10 w-10 rounded-xl ${colors.iconBg} flex items-center justify-center`}>
                        <Icon className={`h-5 w-5 ${colors.text}`} />
                      </div>
                      <span className="text-xs font-bold text-muted-foreground">步骤 {step.step}</span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold">{step.title}</h4>
                        {step.required ? (
                          <Badge variant="default" className="text-[10px] px-1.5 py-0">必需</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">可选</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mb-3">{step.description}</p>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">数据来源</p>
                          <ul className="space-y-0.5">
                            {step.sources.map((s, i) => (
                              <li key={i} className="text-xs text-foreground/80 flex items-start gap-1">
                                <span className="text-primary mt-0.5">•</span> {s}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">导入频率</p>
                          <p className="text-xs text-foreground/80">{step.frequency}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">关键字段</p>
                          <p className="text-xs text-foreground/80">{step.fields}</p>
                        </div>
                      </div>
                    </div>

                    {/* Action Button */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => onNavigate(step.tab)}
                    >
                      前往导入 <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </div>

                  {/* Connector arrow */}
                  {idx < IMPORT_STEPS.length - 1 && (
                    <div className="absolute -bottom-3 left-[27px] w-px h-3 bg-border" />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Tips Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-500" />
            导入须知
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-2">
              <p className="font-medium">文件格式要求</p>
              <ul className="space-y-1 text-muted-foreground">
                <li className="flex items-start gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                  支持 .xlsx 和 .xls 格式
                </li>
                <li className="flex items-start gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                  单文件最大 50MB
                </li>
                <li className="flex items-start gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                  系统自动识别领星/赛狐格式
                </li>
                <li className="flex items-start gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                  文件名建议包含日期范围
                </li>
              </ul>
            </div>
            <div className="space-y-2">
              <p className="font-medium">数据处理说明</p>
              <ul className="space-y-1 text-muted-foreground">
                <li className="flex items-start gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                  上传后先预览确认再导入
                </li>
                <li className="flex items-start gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                  相同周期数据会自动覆盖更新
                </li>
                <li className="flex items-start gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                  自动匹配运营负责人
                </li>
                <li className="flex items-start gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                  导入历史可随时查看和删除
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="flex items-center gap-3">
        <Button onClick={() => onNavigate("upload")} className="gap-2">
          <Upload className="h-4 w-4" />
          开始上传产品数据
        </Button>
        <Button variant="outline" onClick={() => onNavigate("history")} className="gap-2">
          <Database className="h-4 w-4" />
          查看导入历史
        </Button>
      </div>
    </div>
  );
}
