import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { Filter, X, Calendar } from "lucide-react";

interface AdDeepFiltersProps {
  onFilter: (portfolios: string[], dateStart: string, dateEnd: string) => void;
  loading?: boolean;
  actionLabel?: string;
}

export default function AdDeepFilters({ onFilter, loading, actionLabel = "开始分析" }: AdDeepFiltersProps) {
  const [selectedPortfolios, setSelectedPortfolios] = useState<string[]>([]);
  const [dateStart, setDateStart] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  });
  const [dateEnd, setDateEnd] = useState(() => new Date().toISOString().split("T")[0]);

  const portfoliosQuery = trpc.adDailyReport.getDailyPortfolios.useQuery();
  const portfolios = portfoliosQuery.data || [];

  const togglePortfolio = (name: string) => {
    setSelectedPortfolios((prev) =>
      prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]
    );
  };

  const selectAll = () => setSelectedPortfolios([...portfolios]);
  const clearAll = () => setSelectedPortfolios([]);

  const handleSubmit = () => {
    if (selectedPortfolios.length === 0) {
      return;
    }
    onFilter(selectedPortfolios, dateStart, dateEnd);
  };

  return (
    <Card className="border-dashed">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Filter className="w-4 h-4" />
          筛选条件
        </div>
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-end">
          {/* Portfolio Selection */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">广告组合（多选）</label>
            <div className="border rounded-md p-2 max-h-[120px] overflow-y-auto space-y-1">
              {portfolios.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无数据，请先上传报告</p>
              ) : (
                <>
                  <div className="flex gap-2 mb-1">
                    <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={selectAll}>全选</Button>
                    <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearAll}>清空</Button>
                  </div>
                  {portfolios.map((p) => (
                    <label key={p} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5">
                      <Checkbox checked={selectedPortfolios.includes(p)} onCheckedChange={() => togglePortfolio(p)} />
                      <span className="truncate">{p || "(无组合名)"}</span>
                    </label>
                  ))}
                </>
              )}
            </div>
            {selectedPortfolios.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {selectedPortfolios.map((p) => (
                  <Badge key={p} variant="secondary" className="text-xs gap-1">
                    {p}
                    <X className="w-3 h-3 cursor-pointer" onClick={() => togglePortfolio(p)} />
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Date Range */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">开始日期</label>
            <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="w-[140px]" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">结束日期</label>
            <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="w-[140px]" />
          </div>

          {/* Action Button */}
          <Button onClick={handleSubmit} disabled={loading || selectedPortfolios.length === 0}>
            {loading ? "分析中..." : actionLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
