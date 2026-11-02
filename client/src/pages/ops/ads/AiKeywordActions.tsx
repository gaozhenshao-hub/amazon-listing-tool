import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Sparkles, Loader2, Download, XCircle, Plus, Edit3,
  ChevronDown, ChevronRight, AlertTriangle, CheckCircle2,
} from "lucide-react";

interface AiKeywordActionsProps {
  searchTerms: any[];
  targetAcos?: number;
  onClose?: () => void;
}

export default function AiKeywordActions({ searchTerms, targetAcos = 25, onClose }: AiKeywordActionsProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [selectedNeg, setSelectedNeg] = useState<Set<number>>(new Set());
  const [selectedAdd, setSelectedAdd] = useState<Set<number>>(new Set());
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showNeg, setShowNeg] = useState(true);
  const [showAdd, setShowAdd] = useState(true);

  const generateMutation = trpc.adAnalysis.aiGenerateNegativeAndAddKeywords.useMutation();

  const handleGenerate = async () => {
    if (searchTerms.length === 0) {
      toast.error("没有可分析的搜索词数据");
      return;
    }
    setIsGenerating(true);
    try {
      const res = await generateMutation.mutateAsync({
        searchTerms: searchTerms.slice(0, 200),
        targetAcos,
        mode: 'both',
      });
      setResult(res);
      // Auto-select all
      setSelectedNeg(new Set((res.negative_keywords || []).map((_: any, i: number) => i)));
      setSelectedAdd(new Set((res.add_keywords || []).map((_: any, i: number) => i)));
      toast.success(`AI建议生成完成：${res.negative_keywords?.length || 0}个否定词，${res.add_keywords?.length || 0}个加词建议`);
    } catch (err: any) {
      toast.error(`生成失败: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const exportNegativeCsv = () => {
    if (!result?.negative_keywords) return;
    const selected = result.negative_keywords.filter((_: any, i: number) => selectedNeg.has(i));
    if (selected.length === 0) {
      toast.error("请先勾选要导出的否定词");
      return;
    }
    const headers = ["Keyword", "Match Type", "Reason", "Priority", "Est. Monthly Save ($)"];
    const rows = selected.map((k: any) => [
      `"${k.term}"`, k.match_type, `"${k.reason}"`, k.priority, k.estimated_save?.toFixed(2) || "0",
    ]);
    const csv = [headers.join(","), ...rows.map((r: any) => r.join(","))].join("\n");
    downloadCsv(csv, "否定词列表");
  };

  const exportAddCsv = () => {
    if (!result?.add_keywords) return;
    const selected = result.add_keywords.filter((_: any, i: number) => selectedAdd.has(i));
    if (selected.length === 0) {
      toast.error("请先勾选要导出的加词建议");
      return;
    }
    const headers = ["Keyword", "Match Type", "Suggested Bid ($)", "Reason", "Priority", "Expected ACoS (%)"];
    const rows = selected.map((k: any) => [
      `"${k.term}"`, k.match_type, k.suggested_bid?.toFixed(2) || "0", `"${k.reason}"`, k.priority, k.expected_acos?.toFixed(1) || "0",
    ]);
    const csv = [headers.join(","), ...rows.map((r: any) => r.join(","))].join("\n");
    downloadCsv(csv, "加词建议列表");
  };

  const downloadCsv = (csv: string, name: string) => {
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${name}导出成功`);
  };

  const toggleAllNeg = () => {
    if (selectedNeg.size === (result?.negative_keywords?.length || 0)) {
      setSelectedNeg(new Set());
    } else {
      setSelectedNeg(new Set((result?.negative_keywords || []).map((_: any, i: number) => i)));
    }
  };

  const toggleAllAdd = () => {
    if (selectedAdd.size === (result?.add_keywords?.length || 0)) {
      setSelectedAdd(new Set());
    } else {
      setSelectedAdd(new Set((result?.add_keywords || []).map((_: any, i: number) => i)));
    }
  };

  const priorityColor = (p: string) => {
    if (p === 'P0') return 'bg-red-50 text-red-700 border-red-200';
    if (p === 'P1') return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-gray-50 text-gray-600 border-gray-200';
  };

  return (
    <Card className="border-2 border-blue-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-600" />
            AI操作建议：否定词 & 加词列表
          </CardTitle>
          <div className="flex items-center gap-2">
            {!result && (
              <Button
                size="sm"
                className="h-8 text-xs gap-1 bg-blue-600 hover:bg-blue-700"
                onClick={handleGenerate}
                disabled={isGenerating || searchTerms.length === 0}
              >
                {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {isGenerating ? "AI分析中..." : "一键生成建议"}
              </Button>
            )}
            {result && (
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={handleGenerate} disabled={isGenerating}>
                {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                重新生成
              </Button>
            )}
            {onClose && (
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
                <XCircle className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
        {!result && (
          <p className="text-xs text-gray-500 mt-1">
            基于搜索词12分类结果，AI将自动识别需要否定的低效词和值得投放的高效词，生成可直接导入广告后台的操作列表。
            当前共{searchTerms.length}个搜索词待分析，目标ACoS: {targetAcos}%
          </p>
        )}
      </CardHeader>

      {result && (
        <CardContent className="space-y-4">
          {/* Summary */}
          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
            <p className="text-xs text-blue-800">{result.summary}</p>
            <div className="flex gap-4 mt-2 text-xs text-blue-600">
              <span>分析词数: {result.stats?.totalTermsAnalyzed || 0}</span>
              <span>否定词候选: {result.stats?.negCandidates || 0}</span>
              <span>加词候选: {result.stats?.addCandidates || 0}</span>
            </div>
          </div>

          {/* Negative Keywords Section */}
          <div>
            <div
              className="flex items-center justify-between cursor-pointer p-2 rounded-lg hover:bg-gray-50"
              onClick={() => setShowNeg(!showNeg)}
            >
              <div className="flex items-center gap-2">
                {showNeg ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <XCircle className="w-4 h-4 text-red-600" />
                <span className="text-sm font-medium">否定词列表</span>
                <Badge variant="secondary" className="text-[10px]">{result.negative_keywords?.length || 0}个</Badge>
                <Badge variant="outline" className="text-[10px] text-blue-600">已选{selectedNeg.size}个</Badge>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={(e) => { e.stopPropagation(); exportNegativeCsv(); }}>
                <Download className="w-3 h-3" />导出否定词
              </Button>
            </div>
            {showNeg && result.negative_keywords?.length > 0 && (
              <div className="mt-2 border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-red-50/50 border-b">
                      <th className="p-2 w-8">
                        <Checkbox checked={selectedNeg.size === result.negative_keywords.length} onCheckedChange={toggleAllNeg} />
                      </th>
                      <th className="text-left p-2 font-medium">搜索词</th>
                      <th className="text-center p-2 font-medium">否定类型</th>
                      <th className="text-left p-2 font-medium">原因</th>
                      <th className="text-center p-2 font-medium">优先级</th>
                      <th className="text-right p-2 font-medium">预估月节省</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.negative_keywords.map((k: any, i: number) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-red-50/30">
                        <td className="p-2">
                          <Checkbox
                            checked={selectedNeg.has(i)}
                            onCheckedChange={() => {
                              const next = new Set(selectedNeg);
                              next.has(i) ? next.delete(i) : next.add(i);
                              setSelectedNeg(next);
                            }}
                          />
                        </td>
                        <td className="p-2 font-mono font-medium">{k.term}</td>
                        <td className="p-2 text-center">
                          <Badge variant="outline" className={`text-[10px] ${k.match_type === 'exact' ? 'border-red-300 text-red-700' : 'border-orange-300 text-orange-700'}`}>
                            {k.match_type === 'exact' ? '精准否定' : '词组否定'}
                          </Badge>
                        </td>
                        <td className="p-2 text-gray-600 max-w-[200px]">{k.reason}</td>
                        <td className="p-2 text-center">
                          <Badge variant="outline" className={`text-[10px] ${priorityColor(k.priority)}`}>{k.priority}</Badge>
                        </td>
                        <td className="p-2 text-right text-red-600 font-medium">${k.estimated_save?.toFixed(2) || '0'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Add Keywords Section */}
          <div>
            <div
              className="flex items-center justify-between cursor-pointer p-2 rounded-lg hover:bg-gray-50"
              onClick={() => setShowAdd(!showAdd)}
            >
              <div className="flex items-center gap-2">
                {showAdd ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <Plus className="w-4 h-4 text-emerald-600" />
                <span className="text-sm font-medium">加词建议列表</span>
                <Badge variant="secondary" className="text-[10px]">{result.add_keywords?.length || 0}个</Badge>
                <Badge variant="outline" className="text-[10px] text-blue-600">已选{selectedAdd.size}个</Badge>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={(e) => { e.stopPropagation(); exportAddCsv(); }}>
                <Download className="w-3 h-3" />导出加词建议
              </Button>
            </div>
            {showAdd && result.add_keywords?.length > 0 && (
              <div className="mt-2 border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-emerald-50/50 border-b">
                      <th className="p-2 w-8">
                        <Checkbox checked={selectedAdd.size === result.add_keywords.length} onCheckedChange={toggleAllAdd} />
                      </th>
                      <th className="text-left p-2 font-medium">搜索词</th>
                      <th className="text-center p-2 font-medium">匹配类型</th>
                      <th className="text-right p-2 font-medium">建议竞价</th>
                      <th className="text-left p-2 font-medium">原因</th>
                      <th className="text-center p-2 font-medium">优先级</th>
                      <th className="text-right p-2 font-medium">预估ACoS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.add_keywords.map((k: any, i: number) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-emerald-50/30">
                        <td className="p-2">
                          <Checkbox
                            checked={selectedAdd.has(i)}
                            onCheckedChange={() => {
                              const next = new Set(selectedAdd);
                              next.has(i) ? next.delete(i) : next.add(i);
                              setSelectedAdd(next);
                            }}
                          />
                        </td>
                        <td className="p-2 font-mono font-medium">{k.term}</td>
                        <td className="p-2 text-center">
                          <Badge variant="outline" className={`text-[10px] ${
                            k.match_type === 'exact' ? 'border-blue-300 text-blue-700' :
                            k.match_type === 'phrase' ? 'border-teal-300 text-teal-700' :
                            'border-gray-300 text-gray-700'
                          }`}>
                            {k.match_type === 'exact' ? '精准' : k.match_type === 'phrase' ? '词组' : '广泛'}
                          </Badge>
                        </td>
                        <td className="p-2 text-right font-medium text-blue-600">${k.suggested_bid?.toFixed(2) || '0'}</td>
                        <td className="p-2 text-gray-600 max-w-[200px]">{k.reason}</td>
                        <td className="p-2 text-center">
                          <Badge variant="outline" className={`text-[10px] ${priorityColor(k.priority)}`}>{k.priority}</Badge>
                        </td>
                        <td className="p-2 text-right">
                          <span className={`font-medium ${(k.expected_acos || 0) <= 25 ? 'text-emerald-600' : (k.expected_acos || 0) <= 40 ? 'text-amber-600' : 'text-red-600'}`}>
                            {k.expected_acos?.toFixed(1) || '0'}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
