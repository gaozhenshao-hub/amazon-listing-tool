import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  ClipboardCheck,
  ShieldCheck,
  Loader2,
  PlayCircle,
} from "lucide-react";

export interface ChecklistDimension {
  key: string;
  code: string;
  label: string;
  labelEn: string;
  description: string;
}

export type CheckListScores = Record<string, { pass: boolean; notes: string }>;

interface ChecklistPanelProps {
  /** The dimensions to evaluate against */
  dimensions: readonly ChecklistDimension[];
  /** AI evaluation results */
  checkListScores?: CheckListScores;
  /** Panel title, e.g. "标题10维度质量自检" */
  panelTitle: string;
  /** Short label for the collapsed bar, e.g. "10维度自检" */
  checkLabel?: string;
  /** Callback to trigger evaluation */
  onRunCheck?: () => void;
  /** Whether evaluation is in progress */
  isRunningCheck?: boolean;
}

export default function ChecklistPanel({
  dimensions,
  checkListScores,
  panelTitle,
  checkLabel,
  onRunCheck,
  isRunningCheck,
}: ChecklistPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const dimCount = dimensions.length;
  const label = checkLabel || `${dimCount}维度自检`;

  // When no checkListScores data, show a "Run Check" button
  if (!checkListScores) {
    return (
      <div className="mt-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (onRunCheck && !isRunningCheck) onRunCheck();
          }}
          disabled={isRunningCheck}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-dashed border-muted-foreground/30 text-xs transition-colors hover:bg-muted/50 hover:border-muted-foreground/50 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-2">
            {isRunningCheck ? (
              <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
            ) : (
              <ClipboardCheck className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="font-medium text-muted-foreground">
              {isRunningCheck ? `正在进行${label}...` : `Check List ${label}`}
            </span>
            {!isRunningCheck && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground border-muted-foreground/30">
                点击运行
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex gap-0.5">
              {dimensions.map((d) => (
                <div
                  key={d.key}
                  className="w-1.5 h-1.5 rounded-full bg-muted-foreground/20"
                  title={`${d.code} ${d.label}`}
                />
              ))}
            </div>
            {!isRunningCheck && <PlayCircle className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
        </button>
      </div>
    );
  }

  const passCount = dimensions.filter(
    (d) => checkListScores[d.key]?.pass
  ).length;
  const totalCount = dimCount;
  const allPassed = passCount === totalCount;
  const passRate = Math.round((passCount / totalCount) * 100);

  return (
    <div className="mt-2">
      {/* Collapsed Summary Bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition-colors ${
          allPassed
            ? "bg-green-50 border-green-200 hover:bg-green-100"
            : "bg-amber-50 border-amber-200 hover:bg-amber-100"
        }`}
      >
        <div className="flex items-center gap-2">
          <ClipboardCheck className={`h-3.5 w-3.5 ${allPassed ? "text-green-600" : "text-amber-600"}`} />
          <span className="font-medium">
            Check List {label}
          </span>
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 ${
              allPassed
                ? "bg-green-100 text-green-700 border-green-300"
                : "bg-amber-100 text-amber-700 border-amber-300"
            }`}
          >
            {passCount}/{totalCount} 通过 ({passRate}%)
          </Badge>
          {allPassed && (
            <ShieldCheck className="h-3.5 w-3.5 text-green-600" />
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Mini dots preview */}
          <div className="flex gap-0.5">
            {dimensions.map((d) => (
              <div
                key={d.key}
                className={`w-1.5 h-1.5 rounded-full ${
                  checkListScores[d.key]?.pass ? "bg-green-500" : "bg-red-400"
                }`}
                title={`${d.code} ${d.label}`}
              />
            ))}
          </div>
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded Panel */}
      {expanded && (
        <div className="mt-1.5 border rounded-lg overflow-hidden">
          {/* Header */}
          <div className="px-3 py-2 bg-muted/30 border-b flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {panelTitle}
            </span>
            <div className="flex gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" /> 通过 {passCount}
              </span>
              <span className="flex items-center gap-1">
                <XCircle className="h-3 w-3 text-red-400" /> 待优化 {totalCount - passCount}
              </span>
              {onRunCheck && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-[10px] text-blue-600 hover:text-blue-700"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onRunCheck && !isRunningCheck) onRunCheck();
                  }}
                  disabled={isRunningCheck}
                >
                  {isRunningCheck ? <Loader2 className="h-3 w-3 animate-spin" /> : "重新自检"}
                </Button>
              )}
            </div>
          </div>

          {/* Dimension Grid */}
          <div className="divide-y">
            {dimensions.map((dim) => {
              const score = checkListScores[dim.key];
              const passed = score?.pass ?? false;
              const notes = score?.notes || "";

              return (
                <div
                  key={dim.key}
                  className={`flex items-start gap-3 px-3 py-2 text-xs ${
                    !passed ? "bg-red-50/50" : ""
                  }`}
                >
                  {/* Checkbox (visual, read-only based on AI score) */}
                  <div className="pt-0.5">
                    <Checkbox
                      checked={passed}
                      disabled
                      className={
                        passed
                          ? "data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600"
                          : "border-red-300"
                      }
                    />
                  </div>

                  {/* Dimension Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className={`text-[9px] px-1 py-0 font-mono ${
                          passed
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-red-50 text-red-700 border-red-200"
                        }`}
                      >
                        {dim.code}
                      </Badge>
                      <span className="font-medium">{dim.label}</span>
                      <span className="text-muted-foreground">({dim.labelEn})</span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 leading-relaxed">
                      {dim.description}
                    </p>
                    {notes && (
                      <p className={`mt-1 text-[11px] leading-relaxed ${passed ? "text-green-700" : "text-red-600 font-medium"}`}>
                        {passed ? "\u2713 " : "\u2717 "}{notes}
                      </p>
                    )}
                  </div>

                  {/* Status Icon */}
                  <div className="pt-0.5 shrink-0">
                    {passed ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-400" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer Summary */}
          <div className={`px-3 py-2 border-t text-[10px] ${allPassed ? "bg-green-50" : "bg-amber-50"}`}>
            {allPassed ? (
              <span className="text-green-700 font-medium">
                {"\u2705"} 全部{totalCount}维度通过 - 质量优秀
              </span>
            ) : (
              <span className="text-amber-700">
                {"\u26a0\ufe0f"} 有 {totalCount - passCount} 项未通过 - 建议编辑优化后重新生成
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
