import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Diff, FileText, History, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import type { WorkflowArtifactLike } from "./types";
import { formatWorkflowDate, safeJsonText } from "./workflowUtils";

export function WorkflowArtifactVersionPicker({
  runId,
  nodeId,
  artifactKey,
  fallbackArtifacts,
  className,
}: {
  runId?: string | null;
  nodeId?: string | null;
  artifactKey?: string | null;
  fallbackArtifacts?: WorkflowArtifactLike[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<string>("");
  const [showDiff, setShowDiff] = useState(false);

  const canQuery = !!runId && !!nodeId;
  const artifactsQuery = trpc.emperor.agents.listArtifacts.useQuery(
    {
      runId: runId || "",
      nodeId: nodeId || undefined,
      artifactKey: artifactKey || undefined,
    },
    { enabled: open && canQuery },
  );

  const selectVersion = trpc.emperor.agents.selectArtifactVersion.useMutation({
    onSuccess: () => {
      toast.success("已选择下游输入版本");
      artifactsQuery.refetch();
    },
    onError: (error) => toast.error(`选择失败: ${error.message}`),
  });

  const rollbackVersion = trpc.emperor.agents.rollbackArtifactVersion.useMutation({
    onSuccess: () => {
      toast.success("已回滚产物版本");
      artifactsQuery.refetch();
    },
    onError: (error) => toast.error(`回滚失败: ${error.message}`),
  });

  const diffQuery = trpc.emperor.agents.diffArtifactVersions.useQuery(
    {
      runId: runId || "",
      nodeId: nodeId || "",
      artifactKey: artifactKey || "",
      targetVersion: selectedVersion ? Number(selectedVersion) : "current",
    },
    { enabled: open && showDiff && !!runId && !!nodeId && !!artifactKey },
  );

  const artifacts = useMemo(() => {
    const rows = ((artifactsQuery.data as WorkflowArtifactLike[] | undefined) || fallbackArtifacts || [])
      .filter((artifact) => !artifactKey || artifact.artifactKey === artifactKey)
      .slice()
      .sort((a, b) => Number(b.version || 0) - Number(a.version || 0));
    return rows;
  }, [artifactKey, artifactsQuery.data, fallbackArtifacts]);

  const current = artifacts.find((artifact) => !!artifact.isCurrent) || artifacts[0];
  const resolvedArtifactKey = artifactKey || current?.artifactKey || "";
  const selected = artifacts.find((artifact) => String(artifact.version) === selectedVersion) || current;

  if (!runId || !nodeId) return null;

  return (
    <div className={cn("rounded-lg border bg-background p-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <p className="truncate text-sm font-semibold">{resolvedArtifactKey || "节点产物"}</p>
            {current?.version && (
              <Badge variant="outline" className="rounded-md text-xs">
                v{current.version}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {current?.ref || current?.currentRef || "暂无可选版本"}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <History className="h-4 w-4" />
              版本
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>产物版本</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 md:grid-cols-[260px_1fr]">
              <div className="space-y-3">
                <Select value={selectedVersion} onValueChange={setSelectedVersion}>
                  <SelectTrigger>
                    <SelectValue placeholder={current?.version ? `当前 v${current.version}` : "选择版本"} />
                  </SelectTrigger>
                  <SelectContent>
                    {artifacts.map((artifact) => (
                      <SelectItem key={`${artifact.artifactKey}-${artifact.version}`} value={String(artifact.version)}>
                        v{artifact.version} {artifact.isCurrent ? "当前" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={!selected || !resolvedArtifactKey || selectVersion.isPending}
                    onClick={() =>
                      selectVersion.mutate({
                        runId,
                        nodeId,
                        artifactKey: resolvedArtifactKey,
                        version: Number(selected?.version),
                      })
                    }
                  >
                    {selectVersion.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    作为下游输入
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!selected || !resolvedArtifactKey || rollbackVersion.isPending}
                    onClick={() =>
                      rollbackVersion.mutate({
                        runId,
                        nodeId,
                        artifactKey: resolvedArtifactKey,
                        targetVersion: Number(selected?.version),
                      })
                    }
                  >
                    {rollbackVersion.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                    回滚
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!resolvedArtifactKey}
                    onClick={() => setShowDiff((value) => !value)}
                  >
                    <Diff className="h-4 w-4" />
                    Diff
                  </Button>
                </div>
                <Separator />
                <ScrollArea className="h-[300px] pr-3">
                  <div className="space-y-2">
                    {artifacts.map((artifact) => (
                      <button
                        key={`${artifact.artifactKey}-${artifact.version}-row`}
                        type="button"
                        onClick={() => setSelectedVersion(String(artifact.version))}
                        className={cn(
                          "w-full rounded-lg border p-3 text-left text-sm hover:bg-muted/60",
                          selected?.version === artifact.version && "border-primary bg-primary/5",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">v{artifact.version}</span>
                          {artifact.isCurrent && <Badge className="rounded-md text-xs">当前</Badge>}
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {formatWorkflowDate(artifact.createdAt || artifact.updatedAt)}
                        </p>
                      </button>
                    ))}
                    {!artifacts.length && <p className="py-8 text-center text-sm text-muted-foreground">暂无产物版本</p>}
                  </div>
                </ScrollArea>
              </div>
              <ScrollArea className="h-[420px] rounded-lg border bg-muted/30 p-3">
                {showDiff ? (
                  <pre className="whitespace-pre-wrap text-xs leading-relaxed">
                    {diffQuery.isLoading ? "加载 Diff..." : safeJsonText(diffQuery.data)}
                  </pre>
                ) : (
                  <pre className="whitespace-pre-wrap text-xs leading-relaxed">
                    {safeJsonText(selected?.content ?? selected?.metadata ?? {})}
                  </pre>
                )}
              </ScrollArea>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
