import type * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ArrowRight, BarChart3, Brain, Check, Edit3, Loader2, Lock, Unlock, Play, RefreshCw, TrendingUp, DollarSign, Building2, MessageSquare, LayoutDashboard, Grid3X3, Sparkles } from "lucide-react";
import { Streamdown } from "streamdown";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ScatterChart, Scatter, ZAxis, LineChart, Line } from "recharts";
import { CHART_COLORS, DEV_ANALYSIS_STAGES as STAGES, type DevAnalysisStageKey as StageKey } from "./stageDefinitions";

/* ─── Generic Fallback ─── */
export function GenericResult({ result }: { result: any }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">分析结果</CardTitle></CardHeader>
      <CardContent>
        <pre className="text-xs bg-muted/50 p-4 rounded-lg overflow-auto max-h-[600px] whitespace-pre-wrap">
          {JSON.stringify(result, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}
