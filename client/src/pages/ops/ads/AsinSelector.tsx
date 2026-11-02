import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Package, ChevronDown, X } from "lucide-react";

interface AsinSelectorProps {
  selectedAsin: string | null;
  onSelect: (asin: string | null) => void;
  marketplace?: string;
}

export default function AsinSelector({ selectedAsin, onSelect, marketplace }: AsinSelectorProps) {
  const [search, setSearch] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const { data, isLoading } = trpc.adAnalysis.getProductAsins.useQuery({ marketplace });
  const asins = data?.asins || [];

  const filtered = useMemo(() => {
    if (!search.trim()) return asins.slice(0, 50);
    const q = search.toLowerCase();
    return asins.filter((a: any) =>
      a.asin.toLowerCase().includes(q) ||
      (a.title || "").toLowerCase().includes(q) ||
      (a.sku || "").toLowerCase().includes(q)
    ).slice(0, 50);
  }, [asins, search]);

  const selectedItem = asins.find((a: any) => a.asin === selectedAsin);

  return (
    <div className="relative">
      {/* Selected ASIN Display */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 p-3 border rounded-lg hover:bg-gray-50 transition-colors text-left"
      >
        <Package className="w-5 h-5 text-blue-500 shrink-0" />
        {selectedItem ? (
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono font-medium text-sm">{selectedItem.asin}</span>
              <Badge variant="secondary" className="text-[10px]">{selectedItem.sku}</Badge>
            </div>
            <p className="text-xs text-gray-500 truncate mt-0.5">{selectedItem.title}</p>
          </div>
        ) : (
          <div className="flex-1">
            <span className="text-sm text-gray-500">
              {isLoading ? "加载ASIN列表..." : "选择ASIN进行分析（或查看全部）"}
            </span>
          </div>
        )}
        <div className="flex items-center gap-1">
          {selectedAsin && (
            <button
              onClick={(e) => { e.stopPropagation(); onSelect(null); }}
              className="p-1 hover:bg-gray-200 rounded"
            >
              <X className="w-3.5 h-3.5 text-gray-400" />
            </button>
          )}
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </div>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg max-h-80 overflow-hidden">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <Input
                placeholder="搜索ASIN / SKU / 标题..."
                className="pl-8 h-8 text-sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <div className="overflow-y-auto max-h-60">
            {/* All ASIN option */}
            <button
              onClick={() => { onSelect(null); setIsOpen(false); setSearch(""); }}
              className={`w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 text-left transition-colors ${
                !selectedAsin ? "bg-blue-50" : ""
              }`}
            >
              <Package className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-600">全部ASIN（汇总视图）</span>
            </button>
            {isLoading ? (
              <div className="p-3 space-y-2">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">未找到匹配的ASIN</div>
            ) : (
              filtered.map((item: any) => (
                <button
                  key={item.asin}
                  onClick={() => { onSelect(item.asin); setIsOpen(false); setSearch(""); }}
                  className={`w-full flex items-center gap-3 px-3 py-2 hover:bg-blue-50 text-left transition-colors ${
                    selectedAsin === item.asin ? "bg-blue-50" : ""
                  }`}
                >
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" className="w-8 h-8 rounded object-cover border" />
                  ) : (
                    <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center">
                      <Package className="w-4 h-4 text-gray-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-medium">{item.asin}</span>
                      {item.sku && <Badge variant="outline" className="text-[9px] h-4">{item.sku}</Badge>}
                    </div>
                    <p className="text-xs text-gray-500 truncate">{item.title || "未知产品"}</p>
                  </div>
                  {item.price > 0 && (
                    <span className="text-xs font-medium text-gray-600">${item.price}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Click outside to close */}
      {isOpen && (
        <div className="fixed inset-0 z-40" onClick={() => { setIsOpen(false); setSearch(""); }} />
      )}
    </div>
  );
}
