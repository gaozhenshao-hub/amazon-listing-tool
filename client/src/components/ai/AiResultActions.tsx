import { useRef, useState } from "react";
import { MessageSquare, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export type AiResultImprovementContext = {
  businessModule: string;
  sourceResultId: string;
  projectId?: number;
  productAsin?: string;
  input: string;
  originalResult: string;
  editedResult: string;
  feedback: string;
  targetType: "skill" | "agent";
  targetKey: string;
  scope: "current_result" | "project" | "category" | "shared";
};

/** New AI result views share these actions; the owning business authorizes and persists the handoff. */
export function AiResultActions({
  context,
  onAdjust,
  onImprove,
}: {
  context: AiResultImprovementContext;
  onAdjust: (context: AiResultImprovementContext) => void | Promise<void>;
  onImprove: (context: AiResultImprovementContext) => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const submitting = useRef(false);
  async function perform(callback: typeof onAdjust) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      await callback(context);
    } catch {
      setError("暂时无法打开，请重试。当前结果已保留。");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => void perform(onAdjust)}
        >
          <MessageSquare className="h-4 w-4" />
          调整结果
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => void perform(onImprove)}
        >
          <Sparkles className="h-4 w-4" />
          用于改进
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
