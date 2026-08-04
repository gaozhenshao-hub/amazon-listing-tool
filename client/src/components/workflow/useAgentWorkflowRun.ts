import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { WorkflowRunDetailLike } from "./types";

export function useAgentWorkflowRun(runId?: string | null) {
  const hasRun = !!runId;

  const runQuery = trpc.emperor.agents.getRun.useQuery(
    { runId: runId || "" },
    {
      enabled: hasRun,
      refetchInterval: (query) => {
        const detail = query.state.data as WorkflowRunDetailLike | undefined;
        const runStatus = detail?.run?.status;
        const hasActiveNode = (detail?.checkpoints || []).some((checkpoint) =>
          checkpoint.status === "running" || checkpoint.status === "ready",
        );
        return runStatus === "running" || hasActiveNode ? 2500 : false;
      },
    },
  );

  const refetch = () => runQuery.refetch();

  const executeNode = trpc.emperor.agents.executeNode.useMutation({
    onSuccess: () => {
      toast.success("节点已开始执行");
      refetch();
    },
    onError: (error) => toast.error(`执行失败: ${error.message}`),
  });

  const scheduleRun = trpc.emperor.agents.scheduleRun.useMutation({
    onSuccess: () => {
      toast.success("工作流已推进");
      refetch();
    },
    onError: (error) => toast.error(`推进失败: ${error.message}`),
  });

  const rerunNode = trpc.emperor.agents.rerunNode.useMutation({
    onSuccess: () => {
      toast.success("节点已重跑");
      refetch();
    },
    onError: (error) => toast.error(`重跑失败: ${error.message}`),
  });

  const updateDraft = trpc.emperor.agents.updateNodeDraft.useMutation({
    onSuccess: () => {
      toast.success("草稿已保存");
      refetch();
    },
    onError: (error) => toast.error(`保存失败: ${error.message}`),
  });

  const confirmNode = trpc.emperor.agents.confirmNode.useMutation({
    onSuccess: () => {
      toast.success("节点已确认锁定");
      refetch();
    },
    onError: (error) => toast.error(`确认失败: ${error.message}`),
  });

  const pauseRun = trpc.emperor.agents.pauseRun.useMutation({
    onSuccess: () => {
      toast.success("工作流已暂停");
      refetch();
    },
    onError: (error) => toast.error(`暂停失败: ${error.message}`),
  });

  const resumeRun = trpc.emperor.agents.resumeRun.useMutation({
    onSuccess: () => {
      toast.success("工作流已恢复");
      refetch();
    },
    onError: (error) => toast.error(`恢复失败: ${error.message}`),
  });

  const cancelRun = trpc.emperor.agents.cancelRun.useMutation({
    onSuccess: () => {
      toast.success("工作流已取消");
      refetch();
    },
    onError: (error) => toast.error(`取消失败: ${error.message}`),
  });

  const detail = runQuery.data as WorkflowRunDetailLike | undefined;

  return {
    detail,
    run: detail?.run,
    checkpoints: detail?.checkpoints || [],
    artifacts: detail?.artifacts || [],
    events: detail?.events || [],
    isLoading: runQuery.isLoading,
    isFetching: runQuery.isFetching,
    refetch,
    actions: {
      executeNode,
      scheduleRun,
      rerunNode,
      updateDraft,
      confirmNode,
      pauseRun,
      resumeRun,
      cancelRun,
    },
  };
}
