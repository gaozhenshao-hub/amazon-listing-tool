import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { AlertCircle, Bot, ChevronDown, ChevronUp, Loader2, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { WorkflowArtifactVersionPicker } from "./WorkflowArtifactVersionPicker";
import { WorkflowCheckpointControls } from "./WorkflowCheckpointControls";
import { WorkflowStatusBadge } from "./WorkflowStepProgress";
import { getListingAgentStep, type ListingAgentNodeContext } from "./listingAgentNavigation";
import { normalizeCheckpointStatus } from "./workflowUtils";
import { useAgentWorkflowRun } from "./useAgentWorkflowRun";

export function ListingAgentNodeWorkbench({
  context,
  children,
}: {
  context: ListingAgentNodeContext;
  children: ReactNode;
}) {
  const [, setLocation] = useLocation();
  const agentRun = useAgentWorkflowRun(context.runId);
  const step = getListingAgentStep(context.nodeId);
  const checkpoint = useMemo(
    () => agentRun.checkpoints.find((item) => item.nodeId === context.nodeId),
    [agentRun.checkpoints, context.nodeId],
  );
  const normalizedStatus = normalizeCheckpointStatus(checkpoint?.status);
  const [controlsOpen, setControlsOpen] = useState(
    normalizedStatus === "ready" || normalizedStatus === "waiting_human" || normalizedStatus === "failed",
  );

  useEffect(() => {
    if (normalizedStatus === "ready" || normalizedStatus === "waiting_human" || normalizedStatus === "failed") {
      setControlsOpen(true);
    }
  }, [normalizedStatus]);

  const returnToCanvas = () => {
    const params = new URLSearchParams({ agentRunId: context.runId });
    if (context.projectId) params.set("projectId", String(context.projectId));
    setLocation(`/listing/canvas?${params.toString()}`);
  };

  return (
    <>
      <section className="mb-5 border-y border-primary/20 bg-primary/5 px-3 py-3 md:px-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">{step?.label || context.nodeId}</span>
              {checkpoint?.status && <WorkflowStatusBadge checkpoint={checkpoint} />}
              <Badge variant="outline" className="max-w-[280px] truncate rounded-md text-xs">
                已关联执行记录
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              在当前业务页面检查和修改内容；执行记录、人工确认和产物版本由皇帝 AI OS 统一保存。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={returnToCanvas}>
              <Workflow className="h-4 w-4" />
              返回画布
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-expanded={controlsOpen}
              onClick={() => setControlsOpen((value) => !value)}
            >
              {controlsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              执行与版本
            </Button>
          </div>
        </div>

        <Collapsible open={controlsOpen} onOpenChange={setControlsOpen}>
          <CollapsibleContent className="pt-3">
            {agentRun.isLoading ? (
              <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在加载节点执行记录...
              </div>
            ) : checkpoint ? (
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
                <WorkflowCheckpointControls
                  runId={context.runId}
                  checkpoint={checkpoint}
                  executeNode={agentRun.actions.executeNode}
                  rerunNode={agentRun.actions.rerunNode}
                  updateDraft={agentRun.actions.updateDraft}
                  confirmNode={agentRun.actions.confirmNode}
                  allowSkip={step?.required === false}
                />
                <WorkflowArtifactVersionPicker
                  runId={context.runId}
                  nodeId={context.nodeId}
                  artifactKey={step?.artifactKey}
                />
              </div>
            ) : (
              <div className="flex items-start gap-2 py-3 text-sm text-muted-foreground">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                当前 Run 中没有找到该节点。请返回画布选择正确的 Run，或重新安装并启动 Listing Agent。
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </section>
      {children}
    </>
  );
}
