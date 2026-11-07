import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

/** The existing AI adjustment entry already includes translations; this is only the explicit retry control. */
export default function KnowledgeTranslationActions({
  kind,
  id,
  value,
  allowRetry = false,
}: {
  kind: "image" | "set";
  id: number;
  value: unknown;
  allowRetry?: boolean;
}) {
  const utils = trpc.useUtils();
  const retry = trpc.knowledgeAssets.retryTranslation.useMutation({
    onSuccess: () => {
      toast.success("已开始准备中文，完成后即可切换显示");
      void utils.kbImages.invalidate();
    },
    onError: e => toast.error(e.message),
  });
  if (!allowRetry && (value as { status?: string } | null)?.status !== "failed")
    return null;
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={retry.isPending}
      onClick={() => retry.mutate({ kind, id })}
    >
      重试中文准备
    </Button>
  );
}
