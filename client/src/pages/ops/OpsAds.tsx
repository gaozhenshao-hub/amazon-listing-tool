import { useState, useMemo, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useMarketplace } from "@/contexts/MarketplaceContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from "recharts";
import { Input } from "@/components/ui/input";
import {
  Target, RefreshCw, Search, DollarSign,
  Eye, TrendingUp, Zap, BarChart3, Clock, XCircle, Activity, Crosshair,
  Package, Type, Gem, MessageSquare, Layers, Monitor,
  ChevronDown, ChevronRight, FolderOpen, Folder,
  ChevronLeft, ChevronsLeft, ChevronsRight, Filter, X,
} from "lucide-react";

// Sub-components
import SearchTermClassification from "./ads/SearchTermClassification";
import AdPlacementAnalysis from "./ads/AdPlacementAnalysis";
import HourlyBidStrategy from "./ads/HourlyBidStrategy";
import NegativeKeywords from "./ads/NegativeKeywords";
import AdDiagnostics from "./ads/AdDiagnostics";
import TargetingAnalysis from "./ads/TargetingAnalysis";
import WordFrequencyAnalysis from "./ads/WordFrequencyAnalysis";
import EffectiveSearchTerms from "./ads/EffectiveSearchTerms";
import DspAnalysis from "./ads/DspAnalysis";
import AdChatBot from "./ads/AdChatBot";
import CrossChannelAnalysis from "./ads/CrossChannelAnalysis";
import AsinAdSummary from "./ads/AsinAdSummary";
import BudgetAllocation from "./ads/BudgetAllocation";
import SearchTermTrend from "./ads/SearchTermTrend";
import BudgetTracker from "./ads/BudgetTracker";

const PIE_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#9ca3af", "#8b5cf6", "#06b6d4", "#f97316"];

// Safe division helpers to prevent NaN/Infinity
const safeDiv = (a: number, b: number, decimals = 2): number => {
  if (!b || !isFinite(a) || !isFinite(b)) return 0;
  const result = a / b;
  return isFinite(result) ? Math.round(result * Math.pow(10, decimals)) / Math.pow(10, decimals) : 0;
};
const safePct = (a: number, b: number): number => {
  const raw = safeDiv(a, b, 4) * 100;
  return Math.round(raw * 100) / 100;
};
const fmtPct = (v: number): string => {
  if (!isFinite(v) || isNaN(v)) return '0';
  return Math.round(v * 100) / 100 + '';
};

// Campaign info type for multi-select
interface SelectedCampaignInfo {
  id: string;
  name: string;
  type: string;
}

const LS_KEY_SELECTED = 'opsAds_selectedCampaigns';
const LS_KEY_PRIMARY = 'opsAds_primaryCampaignId';

function loadSavedSelection(): { campaigns: Map<string, SelectedCampaignInfo>; primaryId: string | null } {
  try {
    const raw = localStorage.getItem(LS_KEY_SELECTED);
    const primaryId = localStorage.getItem(LS_KEY_PRIMARY);
    if (raw) {
      const arr: SelectedCampaignInfo[] = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) {
        const map = new Map(arr.map(c => [c.id, c]));
        return { campaigns: map, primaryId: primaryId && map.has(primaryId) ? primaryId : arr[0].id };
      }
    }
  } catch { /* ignore */ }
  return { campaigns: new Map(), primaryId: null };
}

function saveSelection(campaigns: Map<string, SelectedCampaignInfo>, primaryId: string | null) {
  try {
    const arr = Array.from(campaigns.values());
    localStorage.setItem(LS_KEY_SELECTED, JSON.stringify(arr));
    localStorage.setItem(LS_KEY_PRIMARY, primaryId || '');
  } catch { /* ignore */ }
}

export default function OpsAds() {
  // Multi-select state: Map of campaignId -> campaign info (restored from localStorage)
  const [selectedCampaigns, setSelectedCampaigns] = useState<Map<string, SelectedCampaignInfo>>(() => loadSavedSelection().campaigns);
  // Primary campaign for sub-tab analysis (first selected or explicitly chosen)
  const [primaryCampaignId, setPrimaryCampaignId] = useState<string | null>(() => loadSavedSelection().primaryId);

  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 2);
    return d.toISOString().slice(0, 10);
  });
  // Support URL params for deep-linking: ?tab=search-terms&campaignId=xxx&campaignName=xxx
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('tab') || "overview";
  });
  const [deepLinkApplied, setDeepLinkApplied] = useState(false);
  const [expandedPortfolios, setExpandedPortfolios] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [adStateFilter, setAdStateFilter] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [dateMode, setDateMode] = useState<'single' | 'range'>('single');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 8);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 2);
    return d.toISOString().slice(0, 10);
  });
  const { marketplace } = useMarketplace();

  // Overview data - campaign summary with portfolio structure
  const queryParams = useMemo(() => {
    if (dateMode === 'range') {
      return { marketplace, adState: adStateFilter as any, startDate, endDate };
    }
    return { marketplace, adState: adStateFilter as any, reportDate: selectedDate };
  }, [marketplace, adStateFilter, dateMode, selectedDate, startDate, endDate]);
  const { data: campaignData, isLoading: campaignLoading, isFetching: campaignFetching, refetch: refetchCampaigns } = trpc.operations.getAdCampaigns.useQuery(queryParams);
  const dateRange = (campaignData as any)?.dateRange;
  const cacheInfo = (campaignData as any)?.cacheInfo;

  const campaigns = campaignData?.campaigns || [];
  const portfolios = (campaignData as any)?.portfolios || [];

  // Derived: selected campaign IDs as array
  const selectedCampaignIds = useMemo(() => Array.from(selectedCampaigns.keys()), [selectedCampaigns]);
  const selectedCount = selectedCampaignIds.length;

  // For backward compatibility: pass the primary campaign to sub-tabs
  const selectedCampaignId = primaryCampaignId;
  const selectedCampaignName = primaryCampaignId ? (selectedCampaigns.get(primaryCampaignId)?.name || "") : "";
  const selectedCampaignType = primaryCampaignId ? (selectedCampaigns.get(primaryCampaignId)?.type || "SP") : "SP";

  // Persist selection to localStorage whenever it changes
  useEffect(() => {
    saveSelection(selectedCampaigns, primaryCampaignId);
  }, [selectedCampaigns, primaryCampaignId]);

  // ASIN mapping warmup: silently trigger on mount to ensure product detail pages have mapping data
  const warmupMutation = trpc.adAnalysis.warmupAsinMapping.useMutation();
  useEffect(() => {
    warmupMutation.mutate({ marketplace }, {
      onSuccess: (res) => {
        if (res.status === 'refreshed') {
          console.log(`[AsinMapping] Warmup complete: ${res.asinCount} ASINs mapped`);
        }
      },
    });
  }, [marketplace]); // Re-warmup when marketplace changes

  // Auto-select a random campaign when data loads and no campaign is selected
  useEffect(() => {
    if (campaigns.length > 0 && selectedCampaigns.size === 0 && !deepLinkApplied) {
      const randomIndex = Math.floor(Math.random() * Math.min(campaigns.length, 10));
      const randomCampaign = campaigns[randomIndex] as any;
      if (randomCampaign) {
        const id = String(randomCampaign.campaign_id);
        const name = randomCampaign.name || randomCampaign.campaign_name || `Campaign ${randomCampaign.campaign_id}`;
        const type = mapCampaignTypeToAdType(randomCampaign.campaign_type);
        setSelectedCampaigns(new Map([[id, { id, name, type }]]));
        setPrimaryCampaignId(id);
      }
    }
  }, [campaigns]);

  // Deep-link: apply URL params to select a specific campaign and tab
  useEffect(() => {
    if (deepLinkApplied || campaigns.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const urlCampaignId = params.get('campaignId');
    const urlCampaignName = params.get('campaignName');
    if (urlCampaignId) {
      // Try to find the campaign in loaded data
      const found = campaigns.find((c: any) => String(c.campaign_id) === urlCampaignId) as any;
      const name = urlCampaignName || (found ? (found.name || found.campaign_name || `Campaign ${urlCampaignId}`) : `Campaign ${urlCampaignId}`);
      const type = found ? mapCampaignTypeToAdType(found.campaign_type) : 'SP';
      setSelectedCampaigns(new Map([[urlCampaignId, { id: urlCampaignId, name, type }]]));
      setPrimaryCampaignId(urlCampaignId);
      setDeepLinkApplied(true);
      // Clean URL params after applying
      const url = new URL(window.location.href);
      url.searchParams.delete('campaignId');
      url.searchParams.delete('campaignName');
      url.searchParams.delete('tab');
      window.history.replaceState({}, '', url.pathname);
    }
  }, [campaigns, deepLinkApplied]);

  // Build campaignNames map for multi-campaign search terms
  const selectedCampaignNames = useMemo(() => {
    const names: Record<string, string> = {};
    selectedCampaigns.forEach((info, id) => { names[id] = info.name; });
    return names;
  }, [selectedCampaigns]);

  // Toggle portfolio expansion
  const togglePortfolio = (pid: string) => {
    setExpandedPortfolios(prev => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  };

  // Map campaign_type to short ad type
  const mapCampaignTypeToAdType = (type?: string): string => {
    if (!type) return "SP";
    if (type === "sponsoredBrands" || type === "SB" || type.toLowerCase().includes("brand") || type.toLowerCase().includes("hsa")) return "SB";
    if (type === "sponsoredDisplay" || type === "SD" || type.toLowerCase().includes("display")) return "SD";
    return "SP";
  };

  // Toggle a single campaign selection
  const toggleCampaignSelection = useCallback((campaignId: string, campaignName: string, campaignType?: string) => {
    setSelectedCampaigns(prev => {
      const next = new Map(prev);
      if (next.has(campaignId)) {
        next.delete(campaignId);
        // If we removed the primary, pick the first remaining or null
        if (primaryCampaignId === campaignId) {
          const firstKey = next.keys().next().value;
          setPrimaryCampaignId(firstKey || null);
        }
      } else {
        next.set(campaignId, {
          id: campaignId,
          name: campaignName,
          type: mapCampaignTypeToAdType(campaignType),
        });
        // If nothing was primary, make this the primary
        if (!primaryCampaignId || !prev.has(primaryCampaignId)) {
          setPrimaryCampaignId(campaignId);
        }
      }
      return next;
    });
  }, [primaryCampaignId]);

  // Set a campaign as primary (for sub-tab analysis)
  const setPrimaryAndSelect = useCallback((campaignId: string, campaignName: string, campaignType?: string) => {
    const type = mapCampaignTypeToAdType(campaignType);
    setSelectedCampaigns(prev => {
      const next = new Map(prev);
      if (!next.has(campaignId)) {
        next.set(campaignId, { id: campaignId, name: campaignName, type });
      }
      return next;
    });
    setPrimaryCampaignId(campaignId);
  }, []);

  // Select all campaigns in a portfolio
  const togglePortfolioSelection = useCallback((portfolio: any) => {
    const portfolioCampaigns: any[] = portfolio.campaigns || [];
    const filteredCampaigns = portfolioCampaigns.filter((c: any) => {
      if (typeFilter !== "all" && (c.campaign_type || "SP") !== typeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        if (!(portfolio.name || "").toLowerCase().includes(q)) {
          if (!(c.campaign_name || "").toLowerCase().includes(q) && !String(c.campaign_id).includes(q)) return false;
        }
      }
      return true;
    });

    const allSelected = filteredCampaigns.every((c: any) => selectedCampaigns.has(String(c.campaign_id)));

    setSelectedCampaigns(prev => {
      const next = new Map(prev);
      if (allSelected) {
        // Deselect all in this portfolio
        filteredCampaigns.forEach((c: any) => next.delete(String(c.campaign_id)));
      } else {
        // Select all in this portfolio
        filteredCampaigns.forEach((c: any) => {
          const id = String(c.campaign_id);
          if (!next.has(id)) {
            next.set(id, {
              id,
              name: c.campaign_name || `Campaign ${c.campaign_id}`,
              type: mapCampaignTypeToAdType(c.campaign_type),
            });
          }
        });
      }
      // Update primary if needed
      if (!next.has(primaryCampaignId || "")) {
        const firstKey = next.keys().next().value;
        setPrimaryCampaignId(firstKey || null);
      }
      return next;
    });
  }, [selectedCampaigns, primaryCampaignId, typeFilter, searchQuery]);

  // Select all campaigns on current page
  const toggleSelectAllOnPage = useCallback(() => {
    const allCampaignsOnPage: any[] = [];
    paginatedPortfolios.forEach((p: any) => {
      const filteredCampaigns = (p.campaigns || []).filter((c: any) => {
        if (typeFilter !== "all" && (c.campaign_type || "SP") !== typeFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          if (!(p.name || "").toLowerCase().includes(q)) {
            if (!(c.campaign_name || "").toLowerCase().includes(q) && !String(c.campaign_id).includes(q)) return false;
          }
        }
        return true;
      });
      allCampaignsOnPage.push(...filteredCampaigns);
    });

    const allSelected = allCampaignsOnPage.length > 0 && allCampaignsOnPage.every((c: any) => selectedCampaigns.has(String(c.campaign_id)));

    setSelectedCampaigns(prev => {
      const next = new Map(prev);
      if (allSelected) {
        allCampaignsOnPage.forEach((c: any) => next.delete(String(c.campaign_id)));
      } else {
        allCampaignsOnPage.forEach((c: any) => {
          const id = String(c.campaign_id);
          if (!next.has(id)) {
            next.set(id, {
              id,
              name: c.campaign_name || `Campaign ${c.campaign_id}`,
              type: mapCampaignTypeToAdType(c.campaign_type),
            });
          }
        });
      }
      if (!next.has(primaryCampaignId || "")) {
        const firstKey = next.keys().next().value;
        setPrimaryCampaignId(firstKey || null);
      }
      return next;
    });
  }, [selectedCampaigns, primaryCampaignId, typeFilter, searchQuery]);

  // Clear all selections
  const clearAllSelections = useCallback(() => {
    setSelectedCampaigns(new Map());
    setPrimaryCampaignId(null);
  }, []);

  // Overview metrics
  const overviewMetrics = useMemo(() => {
    let impressions = 0, clicks = 0, cost = 0, sales = 0, orders = 0;
    campaigns.forEach((c: any) => {
      impressions += c.impressions || 0;
      clicks += c.clicks || 0;
      cost += c.spend || c.cost || 0;
      sales += c.sales || 0;
      orders += c.orders || 0;
    });
    return {
      impressions, clicks, cost, sales, orders,
      acos: safePct(cost, sales),
      ctr: safePct(clicks, impressions),
      cvr: safePct(orders, clicks),
      cpc: safeDiv(cost, clicks),
      roas: safeDiv(sales, cost),
    };
  }, [campaigns]);

  // Selected campaigns aggregated metrics
  const selectedMetrics = useMemo(() => {
    if (selectedCount === 0) return null;
    let impressions = 0, clicks = 0, cost = 0, sales = 0, orders = 0;
    campaigns.forEach((c: any) => {
      if (selectedCampaigns.has(String(c.campaign_id))) {
        impressions += c.impressions || 0;
        clicks += c.clicks || 0;
        cost += c.spend || c.cost || 0;
        sales += c.sales || 0;
        orders += c.orders || 0;
      }
    });
    return {
      impressions, clicks, cost, sales, orders,
      acos: safePct(cost, sales),
      ctr: safePct(clicks, impressions),
      cvr: safePct(orders, clicks),
      cpc: safeDiv(cost, clicks),
      roas: safeDiv(sales, cost),
    };
  }, [campaigns, selectedCampaigns, selectedCount]);

  // Filtered portfolios based on search and type filter
  const filteredPortfolios = useMemo(() => {
    let filtered = [...portfolios];
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter((p: any) => {
        if ((p.name || "").toLowerCase().includes(q)) return true;
        return p.campaigns?.some((c: any) =>
          (c.campaign_name || "").toLowerCase().includes(q) ||
          String(c.campaign_id).includes(q)
        );
      });
    }
    if (typeFilter !== "all") {
      filtered = filtered.filter((p: any) =>
        p.campaigns?.some((c: any) => (c.campaign_type || "SP") === typeFilter)
      );
    }
    return filtered;
  }, [portfolios, searchQuery, typeFilter]);

  // Pagination
  const totalFilteredPortfolios = filteredPortfolios.length;
  const totalPages = Math.max(1, Math.ceil(totalFilteredPortfolios / pageSize));
  const paginatedPortfolios = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredPortfolios.slice(start, start + pageSize);
  }, [filteredPortfolios, currentPage, pageSize]);

  // Reset page when search/filter/data changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, typeFilter, portfolios]);

  // Total campaigns in filtered view
  const filteredCampaignCount = useMemo(() => {
    return filteredPortfolios.reduce((sum: number, p: any) => sum + (p.campaignCount || 0), 0);
  }, [filteredPortfolios]);

  // Check if all campaigns on current page are selected
  const allOnPageSelected = useMemo(() => {
    const allCampaignsOnPage: any[] = [];
    paginatedPortfolios.forEach((p: any) => {
      const filteredCampaigns = (p.campaigns || []).filter((c: any) => {
        if (typeFilter !== "all" && (c.campaign_type || "SP") !== typeFilter) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          if (!(p.name || "").toLowerCase().includes(q)) {
            if (!(c.campaign_name || "").toLowerCase().includes(q) && !String(c.campaign_id).includes(q)) return false;
          }
        }
        return true;
      });
      allCampaignsOnPage.push(...filteredCampaigns);
    });
    return allCampaignsOnPage.length > 0 && allCampaignsOnPage.every((c: any) => selectedCampaigns.has(String(c.campaign_id)));
  }, [paginatedPortfolios, selectedCampaigns, typeFilter, searchQuery]);

  // Some on page selected (for indeterminate state)
  const someOnPageSelected = useMemo(() => {
    if (allOnPageSelected) return false;
    let found = false;
    paginatedPortfolios.forEach((p: any) => {
      (p.campaigns || []).forEach((c: any) => {
        if (selectedCampaigns.has(String(c.campaign_id))) found = true;
      });
    });
    return found;
  }, [paginatedPortfolios, selectedCampaigns, allOnPageSelected]);

  // Campaign type distribution
  const campaignTypeData = useMemo(() => {
    const typeMap: Record<string, number> = {};
    campaigns.forEach((c: any) => {
      const type = c.campaign_type || "SP";
      typeMap[type] = (typeMap[type] || 0) + (c.spend || c.cost || 0);
    });
    return Object.entries(typeMap).map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }));
  }, [campaigns]);

  // Portfolio spend chart data
  const portfolioChartData = useMemo(() => {
    return portfolios.slice(0, 10).map((p: any) => ({
      name: (p.name || "未分组").substring(0, 12),
      花费: Math.round((p.spend || 0) * 100) / 100,
      销售额: Math.round((p.sales || 0) * 100) / 100,
    }));
  }, [portfolios]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Target className="w-5 h-5 text-blue-600" />
            广告智能分析
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">以广告组合(Portfolio)+广告活动(Campaign)为核心维度的全方位广告数据分析</p>
          {campaignData && !campaignLoading && (
            <div className="flex items-center gap-1.5 mt-1">
              {(campaignData as any)?.isMock ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> 模拟数据
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> 领星API真实数据
                </span>
              )}
              {cacheInfo && (
                <span className="text-[10px] text-gray-400">
                  {cacheInfo.campaignListCached ? '(缓存)' : '(实时)'}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="flex rounded-md border overflow-hidden">
              <button
                onClick={() => setDateMode('single')}
                className={`px-2 py-1 text-xs transition-colors ${dateMode === 'single' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >单日</button>
              <button
                onClick={() => setDateMode('range')}
                className={`px-2 py-1 text-xs transition-colors ${dateMode === 'range' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >日期范围</button>
            </div>
            {dateMode === 'single' ? (
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="h-8 px-2 text-xs border rounded-md bg-white"
              />
            ) : (
              <div className="flex items-center gap-1">
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-8 px-2 text-xs border rounded-md bg-white" />
                <span className="text-xs text-gray-400">至</span>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-8 px-2 text-xs border rounded-md bg-white" />
              </div>
            )}
          </div>
          {dateRange && (
            <span className="text-[10px] text-gray-400">
              数据: {dateRange.start} ~ {dateRange.end}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => refetchCampaigns()}
            disabled={campaignFetching}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${campaignFetching ? "animate-spin" : ""}`} />
            刷新
          </Button>
          {cacheInfo && (
            <span className="text-[10px] text-gray-400">
              {cacheInfo.fromCache ? `缓存 ${cacheInfo.cacheAge}` : "实时"}
            </span>
          )}
        </div>
      </div>

      {/* Multi-select Floating Action Bar */}
      {selectedCount > 0 && (
        <div className="sticky top-0 z-20 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <Badge className="bg-blue-600 text-white text-xs px-2 py-0.5">
              已选 {selectedCount} 个活动
            </Badge>
            {selectedMetrics && (
              <div className="flex items-center gap-4 text-xs">
                <span className="text-gray-600">花费: <span className="font-medium text-red-600">${selectedMetrics.cost.toFixed(2)}</span></span>
                <span className="text-gray-600">销售: <span className="font-medium text-emerald-600">${selectedMetrics.sales.toFixed(2)}</span></span>
                <span className="text-gray-600">ACoS: <span className={`font-medium ${selectedMetrics.acos <= 25 ? "text-emerald-600" : selectedMetrics.acos <= 40 ? "text-amber-600" : "text-red-600"}`}>{selectedMetrics.acos.toFixed(2)}%</span></span>
                <span className="text-gray-600">ROAS: <span className="font-medium text-blue-600">{selectedMetrics.roas.toFixed(2)}x</span></span>
                <span className="text-gray-600">订单: <span className="font-medium">{selectedMetrics.orders}</span></span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Show selected campaign chips (max 3 visible) */}
            <div className="flex items-center gap-1 max-w-md overflow-hidden">
              {Array.from(selectedCampaigns.values()).slice(0, 3).map(c => (
                <Badge
                  key={c.id}
                  variant={c.id === primaryCampaignId ? "default" : "secondary"}
                  className={`text-[10px] px-1.5 cursor-pointer whitespace-nowrap ${c.id === primaryCampaignId ? "bg-blue-600" : ""}`}
                  onClick={() => setPrimaryAndSelect(c.id, c.name, c.type)}
                >
                  {c.name.length > 15 ? c.name.slice(0, 15) + "..." : c.name}
                  <X
                    className="w-3 h-3 ml-0.5 hover:text-red-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCampaignSelection(c.id, c.name, c.type);
                    }}
                  />
                </Badge>
              ))}
              {selectedCount > 3 && (
                <Badge variant="secondary" className="text-[10px] px-1.5">
                  +{selectedCount - 3}
                </Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-gray-500 hover:text-red-600"
              onClick={clearAllSelections}
            >
              <X className="w-3.5 h-3.5 mr-1" />
              清除选择
            </Button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1 bg-gray-100/50 p-1">
          <TabsTrigger value="overview" className="text-xs gap-1"><BarChart3 className="w-3 h-3" />总览</TabsTrigger>
          <TabsTrigger value="asin-summary" className="text-xs gap-1"><Package className="w-3 h-3" />ASIN汇总</TabsTrigger>
          <TabsTrigger value="search-terms" className="text-xs gap-1"><Search className="w-3 h-3" />搜索词分析</TabsTrigger>
          <TabsTrigger value="targeting" className="text-xs gap-1"><Crosshair className="w-3 h-3" />投放对象</TabsTrigger>
          <TabsTrigger value="placement" className="text-xs gap-1"><Monitor className="w-3 h-3" />广告位</TabsTrigger>
          <TabsTrigger value="hourly" className="text-xs gap-1"><Clock className="w-3 h-3" />分时策略</TabsTrigger>
          <TabsTrigger value="negative" className="text-xs gap-1"><XCircle className="w-3 h-3" />否定词</TabsTrigger>
          <TabsTrigger value="word-freq" className="text-xs gap-1"><Type className="w-3 h-3" />词频分析</TabsTrigger>
          <TabsTrigger value="effective-terms" className="text-xs gap-1"><Gem className="w-3 h-3" />有效词</TabsTrigger>
          <TabsTrigger value="budget" className="text-xs gap-1"><DollarSign className="w-3 h-3" />预算分配</TabsTrigger>
          <TabsTrigger value="budget-tracker" className="text-xs gap-1"><Clock className="w-3 h-3" />效果追踪</TabsTrigger>
          <TabsTrigger value="trend" className="text-xs gap-1"><Activity className="w-3 h-3" />趋势对比</TabsTrigger>
          <TabsTrigger value="diagnostics" className="text-xs gap-1"><Activity className="w-3 h-3" />诊断</TabsTrigger>
          <TabsTrigger value="dsp" className="text-xs gap-1"><Layers className="w-3 h-3" />DSP</TabsTrigger>
          <TabsTrigger value="cross-channel" className="text-xs gap-1"><TrendingUp className="w-3 h-3" />跨渠道</TabsTrigger>
          <TabsTrigger value="ai-bot" className="text-xs gap-1"><MessageSquare className="w-3.5 h-3.5" />AI助手</TabsTrigger>
        </TabsList>

        {/* Tab: Overview */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {campaignLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: "总花费", value: `$${overviewMetrics.cost.toFixed(2)}`, icon: DollarSign, color: "text-red-600", bg: "bg-red-50" },
                  { label: "总销售额", value: `$${overviewMetrics.sales.toFixed(2)}`, icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50" },
                  { label: "ACoS", value: `${overviewMetrics.acos.toFixed(2)}%`, icon: Target, color: overviewMetrics.acos <= 25 ? "text-emerald-600" : overviewMetrics.acos <= 40 ? "text-amber-600" : "text-red-600", bg: overviewMetrics.acos <= 25 ? "bg-emerald-50" : overviewMetrics.acos <= 40 ? "bg-amber-50" : "bg-red-50" },
                  { label: "ROAS", value: `${overviewMetrics.roas.toFixed(2)}x`, icon: Zap, color: "text-blue-600", bg: "bg-blue-50" },
                  { label: "总订单", value: overviewMetrics.orders.toLocaleString(), icon: Package, color: "text-purple-600", bg: "bg-purple-50" },
                ].map((kpi) => (
                  <Card key={kpi.label} className={`${kpi.bg} border-none`}>
                    <CardContent className="pt-4 pb-3 px-4">
                      <div className="flex items-center gap-2 mb-1">
                        <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
                        <span className="text-xs text-gray-600">{kpi.label}</span>
                      </div>
                      <p className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Secondary Metrics */}
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "总曝光", value: overviewMetrics.impressions.toLocaleString() },
                  { label: "总点击", value: overviewMetrics.clicks.toLocaleString() },
                  { label: "CTR", value: `${overviewMetrics.ctr.toFixed(2)}%` },
                  { label: "CVR", value: `${overviewMetrics.cvr.toFixed(2)}%` },
                ].map((m) => (
                  <Card key={m.label}>
                    <CardContent className="pt-3 pb-2.5 px-4">
                      <span className="text-xs text-gray-500">{m.label}</span>
                      <p className="text-lg font-semibold mt-0.5">{m.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Charts Row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Portfolio Spend Bar Chart */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">广告组合花费TOP10</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={portfolioChartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-20} textAnchor="end" height={50} />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip />
                          <Legend wrapperStyle={{ fontSize: "11px" }} />
                          <Bar dataKey="花费" fill="#ef4444" radius={[2, 2, 0, 0]} />
                          <Bar dataKey="销售额" fill="#10b981" radius={[2, 2, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                {/* Campaign Type Pie */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">广告类型花费分布</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={campaignTypeData}
                            cx="50%" cy="50%"
                            innerRadius={50} outerRadius={80}
                            dataKey="value"
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          >
                            {campaignTypeData.map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value: any) => `$${Number(value).toFixed(2)}`} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Portfolio + Campaign Two-Level Table */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FolderOpen className="w-4 h-4" />
                    广告组合 → 广告活动
                    <Badge variant="secondary" className="text-[10px] font-normal">
                      {searchQuery || typeFilter !== "all" ? `${totalFilteredPortfolios}/${portfolios.length}个组合, ${filteredCampaignCount}/${campaigns.length}个活动` : `${portfolios.length}个组合, ${campaigns.length}个活动`}
                    </Badge>
                    {selectedCount > 0 && (
                      <Badge className="bg-blue-600 text-white text-[10px] font-normal">
                        已选 {selectedCount} 个
                      </Badge>
                    )}
                  </CardTitle>
                  <p className="text-xs text-gray-500 mt-1">
                    勾选复选框可多选广告活动，点击活动名称可设为主分析对象（蓝色高亮）
                  </p>
                </CardHeader>

                {/* Search & Filter Toolbar */}
                <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-[200px] max-w-xs">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <Input
                      placeholder="搜索组合或活动名称..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 pl-8 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Filter className="w-3.5 h-3.5 text-gray-400" />
                    <div className="flex rounded-md border overflow-hidden">
                      {["all", "sponsoredProducts", "sponsoredBrands", "sponsoredDisplay"].map((t) => (
                        <button
                          key={t}
                          onClick={() => setTypeFilter(t)}
                          className={`px-2.5 py-1 text-xs transition-colors ${
                            typeFilter === t
                              ? "bg-blue-600 text-white"
                              : "bg-white text-gray-600 hover:bg-gray-50"
                          }`}
                        >
                          {t === "all" ? "全部" : t === "sponsoredProducts" ? "SP" : t === "sponsoredBrands" ? "SB" : "SD"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-400">状态</span>
                    <div className="flex rounded-md border overflow-hidden">
                      {["all", "enabled", "paused", "archived"].map((s) => (
                        <button
                          key={s}
                          onClick={() => setAdStateFilter(s)}
                          className={`px-2.5 py-1 text-xs transition-colors ${
                            adStateFilter === s
                              ? "bg-green-600 text-white"
                              : "bg-white text-gray-600 hover:bg-gray-50"
                          }`}
                        >
                          {s === "all" ? "全部" : s === "enabled" ? "启用" : s === "paused" ? "暂停" : "归档"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 ml-auto">
                    <span className="text-xs text-gray-500">每页</span>
                    <select
                      value={pageSize}
                      onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                      className="h-8 px-2 text-xs border rounded-md bg-white"
                    >
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                    <span className="text-xs text-gray-500">个组合</span>
                  </div>
                </div>

                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50/50">
                          <th className="p-2.5 w-8">
                            <Checkbox
                              checked={allOnPageSelected}
                              // @ts-ignore - indeterminate is valid HTML but not typed
                              data-state={someOnPageSelected ? "indeterminate" : allOnPageSelected ? "checked" : "unchecked"}
                              onCheckedChange={() => toggleSelectAllOnPage()}
                              className="mx-auto"
                            />
                          </th>
                          <th className="text-left p-2.5 font-medium text-gray-600 w-8"></th>
                          <th className="text-left p-2.5 font-medium text-gray-600">名称</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">活动数</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">曝光</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">点击</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">花费</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">销售额</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">订单</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">ACoS</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">ROAS</th>
                          <th className="text-right p-2.5 font-medium text-gray-600">CTR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedPortfolios.length === 0 ? (
                          <tr><td colSpan={12} className="text-center py-8 text-gray-400">
                            {searchQuery || typeFilter !== "all" ? "没有匹配的广告组合" : "暂无广告组合数据"}
                          </td></tr>
                        ) : (
                          paginatedPortfolios.map((p: any) => {
                            const isExpanded = expandedPortfolios.has(p.id);
                            return (
                              <PortfolioRow
                                key={p.id}
                                portfolio={p}
                                isExpanded={isExpanded}
                                onToggle={() => togglePortfolio(p.id)}
                                selectedCampaigns={selectedCampaigns}
                                primaryCampaignId={primaryCampaignId}
                                onToggleCampaign={toggleCampaignSelection}
                                onSetPrimary={setPrimaryAndSelect}
                                onTogglePortfolioSelection={togglePortfolioSelection}
                                typeFilter={typeFilter}
                                searchQuery={searchQuery}
                              />
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination Controls */}
                  {totalFilteredPortfolios > 0 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50/30">
                      <div className="text-xs text-gray-500">
                        显示第 {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, totalFilteredPortfolios)} 个组合，共 {totalFilteredPortfolios} 个
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={currentPage === 1} onClick={() => setCurrentPage(1)}>
                          <ChevronsLeft className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={currentPage === 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </Button>
                        <div className="flex items-center gap-1 px-2">
                          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                            let pageNum: number;
                            if (totalPages <= 5) {
                              pageNum = i + 1;
                            } else if (currentPage <= 3) {
                              pageNum = i + 1;
                            } else if (currentPage >= totalPages - 2) {
                              pageNum = totalPages - 4 + i;
                            } else {
                              pageNum = currentPage - 2 + i;
                            }
                            return (
                              <Button
                                key={pageNum}
                                variant={currentPage === pageNum ? "default" : "outline"}
                                size="sm"
                                className="h-7 w-7 p-0 text-xs"
                                onClick={() => setCurrentPage(pageNum)}
                              >
                                {pageNum}
                              </Button>
                            );
                          })}
                        </div>
                        <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={currentPage === totalPages} onClick={() => setCurrentPage(totalPages)}>
                          <ChevronsRight className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Tab: Search Term 12-Category */}
        <TabsContent value="search-terms" className="mt-4">
          <SearchTermClassification
            campaignId={selectedCampaignId}
            campaignIds={selectedCampaignIds}
            campaignNames={selectedCampaignNames}
            marketplace={marketplace}
            reportDate={selectedDate}
            startDate={dateMode === 'range' ? startDate : undefined}
            endDate={dateMode === 'range' ? endDate : undefined}
            defaultAdType={selectedCampaignType as any}
          />
        </TabsContent>

        {/* Tab: Targeting Analysis */}
        <TabsContent value="targeting" className="mt-4">
          <TargetingAnalysis
            campaignId={selectedCampaignId}
            campaignIds={selectedCampaignIds}
            marketplace={marketplace}
            reportDate={selectedDate}
            startDate={dateMode === 'range' ? startDate : undefined}
            endDate={dateMode === 'range' ? endDate : undefined}
            defaultAdType={selectedCampaignType as any}
          />
        </TabsContent>

        {/* Tab: Ad Placement */}
        <TabsContent value="placement" className="mt-4">
          <AdPlacementAnalysis
            campaignId={selectedCampaignId}
            campaignIds={selectedCampaignIds}
            marketplace={marketplace}
            reportDate={selectedDate}
            startDate={dateMode === 'range' ? startDate : undefined}
            endDate={dateMode === 'range' ? endDate : undefined}
            defaultAdType={selectedCampaignType as any}
          />
        </TabsContent>

        {/* Tab: Hourly Bid Strategy */}
        <TabsContent value="hourly" className="mt-4">
          <HourlyBidStrategy
            campaignId={selectedCampaignId}
            campaignIds={selectedCampaignIds}
            marketplace={marketplace}
            reportDate={selectedDate}
            startDate={dateMode === 'range' ? startDate : undefined}
            endDate={dateMode === 'range' ? endDate : undefined}
            defaultAdType={selectedCampaignType as any}
          />
        </TabsContent>

        {/* Tab: Negative Keywords */}
        <TabsContent value="negative" className="mt-4">
          <NegativeKeywords
            campaignId={selectedCampaignId}
            campaignIds={selectedCampaignIds}
            marketplace={marketplace}
            reportDate={selectedDate}
          />
        </TabsContent>

        {/* Tab: Word Frequency Analysis */}
        <TabsContent value="word-freq" className="mt-4">
          <WordFrequencyAnalysis
            campaignId={selectedCampaignId}
            campaignIds={selectedCampaignIds}
            marketplace={marketplace}
            reportDate={selectedDate}
          />
        </TabsContent>

        {/* Tab: Effective Search Terms */}
        <TabsContent value="effective-terms" className="mt-4">
          <EffectiveSearchTerms
            campaignId={selectedCampaignId}
            campaignIds={selectedCampaignIds}
            marketplace={marketplace}
            reportDate={selectedDate}
          />
        </TabsContent>

        {/* Tab: Ad Diagnostics */}
        <TabsContent value="diagnostics" className="mt-4">
          <AdDiagnostics
            campaignId={selectedCampaignId}
            campaignIds={selectedCampaignIds}
            marketplace={marketplace}
            reportDate={selectedDate}
          />
        </TabsContent>

        {/* Tab: DSP Analysis */}
        <TabsContent value="dsp" className="mt-4">
          <DspAnalysis
            marketplace={marketplace}
            reportDate={selectedDate}
          />
        </TabsContent>

        {/* Tab: Cross Channel Analysis */}
        <TabsContent value="cross-channel" className="mt-4">
          <CrossChannelAnalysis
            marketplace={marketplace}
            reportDate={selectedDate}
            startDate={dateMode === "range" ? startDate : selectedDate}
            endDate={dateMode === "range" ? endDate : selectedDate}
          />
        </TabsContent>

        {/* Tab: ASIN Ad Summary */}
        <TabsContent value="asin-summary" className="mt-4">
          <AsinAdSummary
            marketplace={marketplace}
            reportDate={selectedDate}
            startDate={dateMode === "range" ? startDate : undefined}
            endDate={dateMode === "range" ? endDate : undefined}
          />
        </TabsContent>

        {/* Tab: Budget Allocation */}
        <TabsContent value="budget" className="mt-4">
          <BudgetAllocation
            marketplace={marketplace}
            reportDate={selectedDate}
            startDate={dateMode === "range" ? startDate : undefined}
            endDate={dateMode === "range" ? endDate : undefined}
          />
        </TabsContent>

        {/* Tab: Budget Tracker */}
        <TabsContent value="budget-tracker" className="mt-4">
          <BudgetTracker marketplace={marketplace} />
        </TabsContent>

        {/* Tab: Search Term Trend */}
        <TabsContent value="trend" className="mt-4">
          <SearchTermTrend
            marketplace={marketplace}
            campaignId={selectedCampaignId || undefined}
            campaignIds={selectedCampaignIds.length > 0 ? selectedCampaignIds : undefined}
          />
        </TabsContent>

        {/* Tab: AI Ad ChatBot */}
        <TabsContent value="ai-bot" className="mt-4">
          <AdChatBot
            campaignId={selectedCampaignId}
            campaignIds={selectedCampaignIds}
            marketplace={marketplace}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Portfolio Row Component ─────────────────────────────────────
function PortfolioRow({ portfolio, isExpanded, onToggle, selectedCampaigns, primaryCampaignId, onToggleCampaign, onSetPrimary, onTogglePortfolioSelection, typeFilter = "all", searchQuery = "" }: {
  portfolio: any;
  isExpanded: boolean;
  onToggle: () => void;
  selectedCampaigns: Map<string, SelectedCampaignInfo>;
  primaryCampaignId: string | null;
  onToggleCampaign: (id: string, name: string, type?: string) => void;
  onSetPrimary: (id: string, name: string, type?: string) => void;
  onTogglePortfolioSelection: (portfolio: any) => void;
  typeFilter?: string;
  searchQuery?: string;
}) {
  const p = portfolio;
  const pAcos = isFinite(p.acos) ? p.acos : 0;
  const pRoas = isFinite(p.roas) ? p.roas : 0;
  const pCtr = isFinite(p.ctr) ? p.ctr : 0;
  const acosColor = pAcos <= 25 ? "text-emerald-600" : pAcos <= 40 ? "text-amber-600" : "text-red-600";

  // Filter campaigns for this portfolio
  const filteredCampaigns = useMemo(() => {
    return (p.campaigns || []).filter((c: any) => {
      if (typeFilter !== "all" && (c.campaign_type || "SP") !== typeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        if (!(p.name || "").toLowerCase().includes(q)) {
          if (!(c.campaign_name || "").toLowerCase().includes(q) && !String(c.campaign_id).includes(q)) return false;
        }
      }
      return true;
    });
  }, [p, typeFilter, searchQuery]);

  // Check if all campaigns in this portfolio are selected
  const allInPortfolioSelected = filteredCampaigns.length > 0 && filteredCampaigns.every((c: any) => selectedCampaigns.has(String(c.campaign_id)));
  const someInPortfolioSelected = !allInPortfolioSelected && filteredCampaigns.some((c: any) => selectedCampaigns.has(String(c.campaign_id)));

  return (
    <>
      {/* Portfolio Row */}
      <tr className="border-b bg-gray-50/30 hover:bg-gray-100/50 cursor-pointer font-medium">
        <td className="p-2.5" onClick={(e) => { e.stopPropagation(); onTogglePortfolioSelection(p); }}>
          <Checkbox
            checked={allInPortfolioSelected}
            data-state={someInPortfolioSelected ? "indeterminate" : allInPortfolioSelected ? "checked" : "unchecked"}
            onCheckedChange={() => onTogglePortfolioSelection(p)}
            className="mx-auto"
          />
        </td>
        <td className="p-2.5" onClick={onToggle}>
          {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
        </td>
        <td className="p-2.5" onClick={onToggle}>
          <div className="flex items-center gap-2">
            {isExpanded ? <FolderOpen className="w-4 h-4 text-amber-500" /> : <Folder className="w-4 h-4 text-amber-500" />}
            <span className="text-sm font-semibold">{p.name}</span>
            <Badge variant="secondary" className="text-[10px] px-1.5">{p.campaignCount}个活动</Badge>
          </div>
        </td>
        <td className="p-2.5 text-right text-xs" onClick={onToggle}>{p.campaignCount}</td>
        <td className="p-2.5 text-right text-xs" onClick={onToggle}>{(p.impressions || 0).toLocaleString()}</td>
        <td className="p-2.5 text-right text-xs" onClick={onToggle}>{(p.clicks || 0).toLocaleString()}</td>
        <td className="p-2.5 text-right text-xs text-red-600 font-medium" onClick={onToggle}>${(p.spend || 0).toFixed(2)}</td>
        <td className="p-2.5 text-right text-xs text-emerald-600 font-medium" onClick={onToggle}>${(p.sales || 0).toFixed(2)}</td>
        <td className="p-2.5 text-right text-xs" onClick={onToggle}>{p.orders || 0}</td>
        <td className="p-2.5 text-right text-xs" onClick={onToggle}>
          <span className={`font-medium ${acosColor}`}>{pAcos > 900 ? "∞" : `${fmtPct(pAcos)}%`}</span>
        </td>
        <td className="p-2.5 text-right text-xs font-medium text-blue-600" onClick={onToggle}>{pRoas}x</td>
        <td className="p-2.5 text-right text-xs" onClick={onToggle}>{fmtPct(pCtr)}%</td>
      </tr>

      {/* Campaign Rows (expanded) */}
      {isExpanded && filteredCampaigns.map((c: any) => {
        const campaignId = String(c.campaign_id);
        const isSelected = selectedCampaigns.has(campaignId);
        const isPrimary = primaryCampaignId === campaignId;
        const cAcos = safePct(c.spend || 0, c.sales || 0);
        const cRoas = safeDiv(c.sales || 0, c.spend || 0);
        const cCtr = safePct(c.clicks || 0, c.impressions || 0);
        const cAcosColor = cAcos <= 25 ? "text-emerald-600" : cAcos <= 40 ? "text-amber-600" : "text-red-600";

        return (
          <tr
            key={campaignId}
            className={`border-b hover:bg-blue-50/50 cursor-pointer transition-colors ${
              isPrimary ? "bg-blue-50 ring-1 ring-inset ring-blue-300" :
              isSelected ? "bg-blue-50/30" : ""
            }`}
          >
            <td className="p-2.5" onClick={(e) => { e.stopPropagation(); onToggleCampaign(campaignId, c.campaign_name, c.campaign_type); }}>
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => onToggleCampaign(campaignId, c.campaign_name, c.campaign_type)}
                className="mx-auto"
              />
            </td>
            <td className="p-2.5"></td>
            <td className="p-2.5 pl-10" onClick={() => onSetPrimary(campaignId, c.campaign_name, c.campaign_type)}>
              <div className="flex items-center gap-2">
                <span className="text-gray-300 text-xs">├</span>
                <span className={`text-xs ${isPrimary ? "font-semibold text-blue-700" : isSelected ? "font-medium text-blue-600" : ""}`}>
                  {c.campaign_name}
                </span>
                <Badge variant="outline" className="text-[10px] px-1">{c.campaign_type || "SP"}</Badge>
                {c.targeting_type && <Badge variant="secondary" className="text-[10px] px-1">{c.targeting_type}</Badge>}
                {isPrimary && <Badge className="text-[10px] px-1 bg-blue-600">主分析</Badge>}
                {isSelected && !isPrimary && <Badge variant="secondary" className="text-[10px] px-1 text-blue-600 border-blue-200">已选</Badge>}
              </div>
            </td>
            <td className="p-2.5 text-right text-xs text-gray-400">-</td>
            <td className="p-2.5 text-right text-xs">{(c.impressions || 0).toLocaleString()}</td>
            <td className="p-2.5 text-right text-xs">{(c.clicks || 0).toLocaleString()}</td>
            <td className="p-2.5 text-right text-xs text-red-600">${(c.spend || 0).toFixed(2)}</td>
            <td className="p-2.5 text-right text-xs text-emerald-600">${(c.sales || 0).toFixed(2)}</td>
            <td className="p-2.5 text-right text-xs">{c.orders || 0}</td>
            <td className="p-2.5 text-right text-xs">
              <span className={`font-medium ${cAcosColor}`}>{cAcos > 900 ? "∞" : `${fmtPct(cAcos)}%`}</span>
            </td>
            <td className="p-2.5 text-right text-xs font-medium text-blue-600">{cRoas.toFixed(2)}x</td>
            <td className="p-2.5 text-right text-xs">{fmtPct(cCtr)}%</td>
          </tr>
        );
      })}
    </>
  );
}
