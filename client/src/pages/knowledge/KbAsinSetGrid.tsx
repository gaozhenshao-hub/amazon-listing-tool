import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronDown, ChevronRight, Eye, Image as ImageIcon } from "lucide-react";
import { groupImageSets, type AsinSetGroupBy } from "./kbImageSetGrouping";

type StatusPresentation = {
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
};

interface KbAsinSetGridProps {
  sets: any[];
  groupBy: AsinSetGroupBy;
  statusMap: Record<string, StatusPresentation>;
  onOpen: (id: number) => void;
}

export function KbAsinSetGrid({
  sets,
  groupBy,
  statusMap,
  onOpen,
}: KbAsinSetGridProps) {
  const groups = useMemo(() => groupImageSets(sets, groupBy), [groupBy, sets]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (key: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-5">
      {groups.map((group) => {
        const collapsed = collapsedGroups.has(group.key);
        const statusLabel = groupBy === "status" ? statusMap[group.key]?.label || group.key : group.key;
        return (
          <section key={group.key} className="space-y-3">
            {groupBy !== "none" && (
              <button
                type="button"
                className="flex h-9 w-full items-center gap-2 border-b px-1 text-left hover:bg-muted/40"
                onClick={() => toggleGroup(group.key)}
              >
                {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                <span className="text-sm font-semibold">{statusLabel}</span>
                <Badge variant="secondary" className="h-5 rounded-sm text-[11px]">{group.items.length}</Badge>
              </button>
            )}
            {!collapsed && (
              <div
                className="grid justify-start gap-4 overflow-x-auto pb-1"
                style={{ gridTemplateColumns: "repeat(auto-fill, 312px)" }}
              >
                {group.items.map((set: any) => (
                  <AsinSetCard
                    key={set.id}
                    set={set}
                    status={statusMap[set.status] || { label: set.status, variant: "secondary" }}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function AsinSetCard({
  set,
  status,
  onOpen,
}: {
  set: any;
  status: StatusPresentation;
  onOpen: (id: number) => void;
}) {
  return (
    <Card
      className="group w-[312px] max-w-full cursor-pointer overflow-hidden rounded-md transition-shadow hover:shadow-md"
      onClick={() => onOpen(set.id)}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        <AsinThumbnailStrip thumbnailImages={set.thumbnailImages} />
        <div className="absolute right-2 top-2">
          <Badge variant={status.variant} className="rounded-sm text-[10px] shadow-sm">{status.label}</Badge>
        </div>
        <div className="absolute inset-x-0 bottom-0 flex items-center bg-black/55 px-3 py-2 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex items-center gap-1 text-xs font-medium text-white"><Eye className="h-3 w-3" /> 查看详情</span>
        </div>
      </div>
      <CardContent className="flex min-h-[158px] flex-col gap-2 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="outline" className="shrink-0 rounded-sm font-mono text-xs">{set.asin}</Badge>
          {set.brand && <span className="truncate text-[11px] text-muted-foreground">{set.brand}</span>}
          {set.overallScore != null && <span className="ml-auto shrink-0 text-xs font-medium text-primary">{set.overallScore}分</span>}
        </div>
        <h3 className="min-h-10 text-sm font-medium line-clamp-2">{set.productTitle || "未命名产品"}</h3>
        <SetMetadataTags set={set} />
      </CardContent>
    </Card>
  );
}

const COLOR_SWATCH: Record<string, string> = {
  红色: "#ef4444",
  绿色: "#22c55e",
  蓝色: "#3b82f6",
  黄色: "#eab308",
  橙色: "#f97316",
  紫色: "#a855f7",
  金色: "#d4a017",
  浅灰: "#cbd5e1",
  深灰: "#475569",
  浅棕: "#a16207",
  深棕: "#78350f",
  白色: "#ffffff",
  黑色: "#111827",
};

function SetMetadataTags({ set }: { set: any }) {
  const tags = [
    { label: "类目", value: set.setCategory || set.category, color: false },
    { label: "风格", value: set.setStyle, color: false },
    { label: "主色", value: set.setPrimaryColor, color: true },
    { label: "提亮", value: set.setAccentColor, color: true },
  ];

  return (
    <div className="mt-auto grid grid-cols-2 gap-1.5" aria-label="ASIN 集标签">
      {tags.map((tag) => (
        <div
          key={tag.label}
          className="flex min-w-0 items-center gap-1.5 rounded-sm bg-muted/70 px-2 py-1 text-[10px]"
          title={`${tag.label}：${tag.value || "未设置"}`}
        >
          <span className="shrink-0 text-muted-foreground">{tag.label}</span>
          {tag.color && tag.value && (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm border"
              style={{ backgroundColor: COLOR_SWATCH[tag.value] || "transparent" }}
            />
          )}
          <span className="truncate font-medium">{tag.value || "未设置"}</span>
        </div>
      ))}
    </div>
  );
}

function AsinThumbnailStrip({ thumbnailImages }: { thumbnailImages?: Array<{ id: number; imageUrl: string }> }) {
  const displayImages = (thumbnailImages || []).slice(0, 5);
  if (displayImages.length === 0) {
    return <div className="flex h-full w-full items-center justify-center"><ImageIcon className="h-8 w-8 text-muted-foreground/30" /></div>;
  }
  if (displayImages.length === 1) {
    return <img src={displayImages[0].imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />;
  }
  return (
    <div className="flex h-full gap-0.5">
      <div className="min-w-0 flex-1"><img src={displayImages[0].imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" /></div>
      <div className="flex w-[28%] flex-col gap-0.5">
        {displayImages.slice(1, 5).map((image) => (
          <div key={image.id} className="min-h-0 flex-1"><img src={image.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" /></div>
        ))}
      </div>
    </div>
  );
}
