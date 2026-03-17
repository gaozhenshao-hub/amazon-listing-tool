import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import LockedContentBar from "@/components/LockedContentBar";
import {
  Sparkles,
  Loader2,
  Check,
  CheckCircle2,
  Pencil,
  RotateCcw,
  Search,
  AlertCircle,
} from "lucide-react";

interface StepSearchTermsProps {
  projectId: number;
  emphasis: string;
  locked?: boolean;
  onLock?: () => void;
  onUnlock?: () => void;
  onComplete: () => void;
}

export default function StepSearchTerms({ projectId, emphasis, locked, onLock, onUnlock, onComplete }: StepSearchTermsProps) {
  const [searchTerms, setSearchTerms] = useState("");
  const [categories, setCategories] = useState<any[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [generated, setGenerated] = useState(false);

  const generateSearchTerms = trpc.listing.generateSearchTerms.useMutation({
    onSuccess: (data: any) => {
      try {
        const content = data.searchTerms || data;
        let text = "";
        let cats: any[] = [];
        if (typeof content === "string") {
          try {
            const parsed = JSON.parse(content);
            text = parsed.searchTerms || parsed.terms || parsed.text || content;
            cats = parsed.categories || [];
          } catch {
            text = content;
          }
        } else if (content.searchTerms) {
          text = content.searchTerms;
          cats = content.categories || [];
        } else if (content.terms) {
          text = content.terms;
          cats = content.categories || [];
        } else {
          text = JSON.stringify(content);
        }
        setSearchTerms(typeof text === "string" ? text : JSON.stringify(text));
        setCategories(cats);
        setGenerated(true);
        toast.success("搜索词已生成");
      } catch {
        const text = typeof data === "string" ? data : JSON.stringify(data);
        setSearchTerms(text);
        setGenerated(true);
        toast.success("搜索词已生成");
      }
    },
    onError: (err) => toast.error("搜索词生成失败: " + err.message),
  });

  const updateListing = trpc.listing.updateByProject.useMutation({
    onSuccess: () => {
      toast.success("搜索词已保存并锁定");
      setConfirmed(true);
      onLock?.();
      onComplete();
    },
    onError: (err) => toast.error("保存失败: " + err.message),
  });

  const handleGenerate = () => {
    generateSearchTerms.mutate({
      projectId,
      emphasis: emphasis.trim() || undefined,
    });
  };

  const handleConfirm = () => {
    if (!searchTerms.trim()) {
      toast.error("搜索词不能为空");
      return;
    }
    updateListing.mutate({
      projectId,
      field: "searchTerms",
      value: searchTerms,
    });
  };

  const handleUnlock = () => {
    setConfirmed(false);
    onUnlock?.();
  };

  // Calculate byte count (Amazon uses bytes, not characters)
  const byteCount = new TextEncoder().encode(searchTerms).length;
  const maxBytes = 250;
  const inRange = byteCount <= maxBytes;

  // Locked state
  if (locked && confirmed) {
    return (
      <Card className="border-2 border-green-300 bg-green-50/30 dark:border-green-800 dark:bg-green-950/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5 text-orange-600" />
            Step 4: 后台搜索词
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <LockedContentBar
            locked={true}
            label="搜索词"
            onUnlock={handleUnlock}
            info={`${byteCount}/${maxBytes} 字节 · 已同步到预览页`}
          />
          <p className="text-sm text-green-800 dark:text-green-300 font-mono pl-2 line-clamp-2">{searchTerms}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5 text-orange-600" />
          Step 4: 后台搜索词
        </CardTitle>
        <CardDescription>
          AI生成后台Search Terms → 编辑优化 → 确认保存（250字节限制）
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Rules */}
        <div className="flex items-start gap-2 p-3 rounded-lg bg-orange-50/50 border border-orange-200">
          <AlertCircle className="h-4 w-4 text-orange-600 shrink-0 mt-0.5" />
          <div className="text-xs text-orange-700 space-y-1">
            <p><strong>亚马逊Search Terms规则：</strong></p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>总长度不超过 <strong>250字节</strong></li>
              <li>不要重复标题中已有的关键词</li>
              <li>用空格分隔，不需要逗号</li>
              <li>不要使用品牌名、ASIN、竞品名</li>
              <li>优先放入标题和卖点未覆盖的长尾词</li>
            </ul>
          </div>
        </div>

        {/* Generate button */}
        {!confirmed && (
          <Button
            className="w-full"
            onClick={handleGenerate}
            disabled={generateSearchTerms.isPending}
          >
            {generateSearchTerms.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />正在生成搜索词...</>
            ) : generated ? (
              <><RotateCcw className="h-4 w-4 mr-2" />重新生成搜索词</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-2" />AI生成搜索词</>
            )}
          </Button>
        )}

        {generateSearchTerms.isPending && (
          <p className="text-xs text-muted-foreground text-center">
            AI正在基于关键词策略矩阵生成搜索词，自动排除标题已用词...
          </p>
        )}

        {/* Search terms editor */}
        {generated && !confirmed && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">后台搜索词</h3>
              <Badge
                variant={inRange ? "default" : "destructive"}
                className={`text-xs ${inRange ? "bg-green-600" : "bg-red-500"}`}
              >
                {byteCount} / {maxBytes} 字节 {inRange ? "✓" : "超出限制"}
              </Badge>
            </div>

            <Textarea
              value={searchTerms}
              onChange={(e) => setSearchTerms(e.target.value)}
              rows={4}
              className="text-sm font-mono resize-none"
              placeholder="关键词用空格分隔..."
            />

            {/* Category tags */}
            {categories.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">分类标签:</p>
                <div className="flex gap-1 flex-wrap">
                  {categories.map((cat: any, idx: number) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      {typeof cat === "string" ? cat : cat.category || cat.name || JSON.stringify(cat)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                className="bg-orange-600 hover:bg-orange-700"
                onClick={handleConfirm}
                disabled={updateListing.isPending || !inRange}
              >
                {updateListing.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />保存中...</>
                ) : (
                  <><Check className="h-4 w-4 mr-2" />确认并锁定搜索词</>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Confirmed but not yet locked */}
        {confirmed && !locked && (
          <div className="p-4 rounded-lg border-2 border-green-300 bg-green-50/50">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <span className="text-sm font-semibold text-green-800">搜索词已确认</span>
            </div>
            <p className="text-sm text-green-700 font-mono">{searchTerms}</p>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="secondary" className="text-xs">{byteCount} / {maxBytes} 字节</Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmed(false)}
              >
                <Pencil className="h-3.5 w-3.5 mr-1" />重新编辑
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
