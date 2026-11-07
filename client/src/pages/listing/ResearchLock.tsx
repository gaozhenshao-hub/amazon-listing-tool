import { LockKeyhole, LockKeyholeOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { ResearchPage } from "@shared/researchCategories";
export function useResearchLock(
  projectId: number | null | undefined,
  page: ResearchPage
) {
  const utils = trpc.useUtils();
  const query = trpc.analysis.researchLocks.useQuery(
    { projectId: projectId || 0 },
    { enabled: !!projectId }
  );
  const mutation = trpc.analysis.setResearchLock.useMutation();
  return {
    locked: !!query.data?.[page],
    loading: query.isLoading,
    pending: mutation.isPending,
    toggle: async (
      beforeLock?: () => Promise<boolean>,
      after?: (revision: number) => void
    ) => {
      if (!projectId || query.isLoading) return;
      try {
        if (!query.data?.[page] && beforeLock && !(await beforeLock())) return;
        const result = await mutation.mutateAsync({
          projectId,
          page,
          locked: !query.data?.[page],
        });
        after?.(result.revision);
        await utils.analysis.researchLocks.invalidate({ projectId });
        await utils.analysis.getAggregation.invalidate({ projectId });
        toast.success(
          result.locked ? "已保存并锁定，可继续浏览" : "已进入编辑状态"
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "操作未完成");
      }
    },
  };
}
export function ResearchLockButton({
  state,
  beforeLock,
  onRevision,
}: {
  state: ReturnType<typeof useResearchLock>;
  beforeLock?: () => Promise<boolean>;
  onRevision?: (revision: number) => void;
}) {
  return (
    <PageLockButton
      locked={state.locked}
      pending={state.pending}
      loading={state.loading}
      onToggle={() => void state.toggle(beforeLock, onRevision)}
    />
  );
}

export function PageLockButton({
  locked,
  pending,
  loading,
  disabled,
  onToggle,
}: {
  locked: boolean;
  pending?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const Icon = locked ? LockKeyhole : LockKeyholeOpen;
  return (
    <Button
      variant="outline"
      aria-pressed={locked}
      title={locked ? "点击解锁" : "点击保存并锁定"}
      disabled={loading || pending || disabled}
      onClick={onToggle}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
      {loading
        ? "读取状态…"
        : pending
          ? "保存中…"
          : locked
            ? "已锁定，仅浏览"
            : "已解锁，可编辑"}
    </Button>
  );
}
