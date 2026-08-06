import { useEffect, useMemo, useState } from "react";
import { Check, History, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";

type ArtifactDomain = "listing" | "image" | "ads" | "video" | "agent" | "project" | "file" | "ops" | "tool" | "other";

export type BusinessArtifactScope = {
  domain: ArtifactDomain;
  artifactKey: string;
  sourceTable?: string | null;
  sourceRowId?: string | number | null;
  projectId?: number | null;
  runId?: string | null;
  nodeId?: string | null;
};

export function BusinessArtifactVersionPicker({
  scope,
  label = "产物版本",
  onVersionChanged,
}: {
  scope: BusinessArtifactScope | null;
  label?: string;
  onVersionChanged?: () => void;
}) {
  const utils = trpc.useUtils();
  const queryInput = scope ? { ...scope, limit: 100 } : null;
  const versionsQuery = trpc.emperor.artifacts.listVersions.useQuery(queryInput!, {
    enabled: Boolean(queryInput),
  });
  const versions = useMemo(() => (versionsQuery.data || []) as Array<any>, [versionsQuery.data]);
  const current = useMemo(() => versions.find((version) => Number(version.isCurrent) === 1), [versions]);
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    setSelectedId(current?.artifactId || versions[0]?.artifactId || "");
  }, [current?.artifactId, versions]);

  const refresh = async () => {
    if (queryInput) await utils.emperor.artifacts.listVersions.invalidate(queryInput);
    onVersionChanged?.();
  };
  const selectVersion = trpc.emperor.artifacts.selectVersion.useMutation({
    onSuccess: async (artifact) => {
      toast.success(`已选择 v${artifact?.version || ""}，下游重跑将使用此版本`);
      await refresh();
    },
    onError: (error) => toast.error(`版本选择失败：${error.message}`),
  });
  const rollback = trpc.emperor.artifacts.rollback.useMutation({
    onSuccess: async (artifact) => {
      toast.success(`已回滚到 v${artifact?.version || ""}`);
      await refresh();
    },
    onError: (error) => toast.error(`回滚失败：${error.message}`),
  });

  if (!scope || versions.length === 0) return null;
  const selected = versions.find((version) => version.artifactId === selectedId);

  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <History className="h-3.5 w-3.5" /> {label}
      </span>
      <Select value={selectedId} onValueChange={setSelectedId}>
        <SelectTrigger className="h-8 w-[190px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {versions.map((version) => (
            <SelectItem key={version.artifactId} value={version.artifactId}>
              v{version.version} · {Number(version.isCurrent) === 1 ? "当前确认" : version.status === "draft" ? "编辑草稿" : "历史确认"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 gap-1"
        disabled={!selected || selected.status === "draft" || selected.artifactId === current?.artifactId || selectVersion.isPending}
        onClick={() => selected && selectVersion.mutate({ artifactId: selected.artifactId })}
      >
        <Check className="h-3.5 w-3.5" /> 设为下游版本
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-8 w-8"
        title="回滚到上一个已确认版本"
        disabled={!current || rollback.isPending}
        onClick={() => rollback.mutate(scope)}
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
