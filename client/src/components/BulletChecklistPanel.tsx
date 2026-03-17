import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  ClipboardCheck,
  ShieldCheck,
} from "lucide-react";

// ─── 15 Dimensions Definition ─────────────────────────────────────
const CHECKLIST_DIMENSIONS = [
  { key: "readability", code: "B1", label: "可读性", labelEn: "Readability", description: "无语法错误，逻辑通顺，符合北美用户阅读习惯" },
  { key: "formatting", code: "B2", label: "文字/数字/标点", labelEn: "Formatting", description: "数字用阿拉伯数字，大小写统一，标点符号合理" },
  { key: "layout", code: "B3", label: "排版", labelEn: "Layout", description: "字数及格式样统一" },
  { key: "sellingPointFocus", code: "B4", label: "卖点顺序", labelEn: "Selling Point Focus", description: "一条一个核心卖点，表达清晰" },
  { key: "subtitle", code: "B5", label: "小标题", labelEn: "Subtitle", description: "小标题简短清晰，帮助用户归纳总结卖点" },
  { key: "fabe", code: "B6", label: "FABE法则", labelEn: "FABE Method", description: "对每个卖点进行FABE思考列，提炼用户最关心和最切中利益的点" },
  { key: "structured", code: "B7", label: "结构化格式", labelEn: "Structured Format", description: "卖点+解答，采用结构化格式，信息一目了然" },
  { key: "psychology", code: "B8", label: "用户心理学", labelEn: "User Psychology", description: "符合大众用户心理学，如厌恶损失、从众心理" },
  { key: "faqCoverage", code: "B9", label: "常见问题覆盖", labelEn: "FAQ Coverage", description: "通过评论、Q&A、品牌分析识别高频问题并在卖点中回答" },
  { key: "quantifiedData", code: "B10", label: "数据对比", labelEn: "Quantified Data", description: "使用量化数据，如'轻30%'、'充电快2倍'" },
  { key: "scenes", code: "B11", label: "场景融入", labelEn: "Scene Integration", description: "自然融入使用场景，如'办公室'、'旅行'、'健身房'" },
  { key: "trustSignals", code: "B12", label: "信任背书", labelEn: "Trust Signals", description: "符合大众用户心理学，如厌恶损失、从众心理" },
  { key: "warranty", code: "B13", label: "质保与售后", labelEn: "Warranty & Quality", description: "包含数据背书或权威背书，如'FCC认证'" },
  { key: "trafficKeywords", code: "B14", label: "流量词", labelEn: "Traffic Keywords", description: "定期更新ARA排名快速上升的相关长尾词" },
  { key: "aiReadability", code: "B15", label: "AI语义关系", labelEn: "AI-Friendly Structure", description: "自然体现4种语义关系(用途/能力/定义/因果)，帮助Rufus/COSMO理解" },
] as const;

type CheckListScores = Record<string, { pass: boolean; notes: string }>;

interface BulletChecklistPanelProps {
  checkListScores?: CheckListScores;
  bulletIndex: number;
  aiSemanticRelations?: Record<string, string | null>;
}

export default function BulletChecklistPanel({
  checkListScores,
  bulletIndex,
  aiSemanticRelations,
}: BulletChecklistPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!checkListScores) return null;

  const passCount = CHECKLIST_DIMENSIONS.filter(
    (d) => checkListScores[d.key]?.pass
  ).length;
  const totalCount = CHECKLIST_DIMENSIONS.length;
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
            Check List 自检
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
            {CHECKLIST_DIMENSIONS.map((d) => (
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
              卖点 #{bulletIndex + 1} — 15维度质量自检
            </span>
            <div className="flex gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" /> 通过 {passCount}
              </span>
              <span className="flex items-center gap-1">
                <XCircle className="h-3 w-3 text-red-400" /> 待优化 {totalCount - passCount}
              </span>
            </div>
          </div>

          {/* Dimension Grid */}
          <div className="divide-y">
            {CHECKLIST_DIMENSIONS.map((dim) => {
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
                        {passed ? "✓ " : "✗ "}{notes}
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

          {/* AI Semantic Relations Section */}
          {aiSemanticRelations && (
            <div className="px-3 py-2 bg-blue-50/50 border-t">
              <div className="text-[10px] font-medium text-blue-700 mb-1.5">
                B15 语义关系覆盖
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {[
                  { key: "purpose", label: "用途关系", icon: "🎯" },
                  { key: "capability", label: "能力关系", icon: "⚡" },
                  { key: "identity", label: "定义关系", icon: "📌" },
                  { key: "causation", label: "因果关系", icon: "🔗" },
                ].map(({ key, label, icon }) => {
                  const val = aiSemanticRelations[key];
                  return (
                    <div key={key} className="flex items-start gap-1 text-[10px]">
                      <span>{icon}</span>
                      <div>
                        <span className={`font-medium ${val ? "text-blue-700" : "text-gray-400"}`}>
                          {label}:
                        </span>{" "}
                        {val ? (
                          <span className="text-blue-600 italic">"{val}"</span>
                        ) : (
                          <span className="text-gray-400">未覆盖</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer Summary */}
          <div className={`px-3 py-2 border-t text-[10px] ${allPassed ? "bg-green-50" : "bg-amber-50"}`}>
            {allPassed ? (
              <span className="text-green-700 font-medium">
                ✅ 全部15维度通过 — 此卖点质量优秀
              </span>
            ) : (
              <span className="text-amber-700">
                ⚠️ 有 {totalCount - passCount} 项未通过 — 建议编辑优化后重新生成，或手动调整对应内容
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
