import { useEffect, useRef } from "react";
import { toast } from "sonner";
const editors = new Map<number, Set<() => Promise<void>>>();
export function useListingPageFlush(
  projectId: number | null | undefined,
  save: () => Promise<void>
) {
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => {
    if (!projectId) return;
    const handler = () => latest.current(),
      set = editors.get(projectId) || new Set<() => Promise<void>>();
    set.add(handler);
    editors.set(projectId, set);
    return () => {
      set.delete(handler);
      if (!set.size) editors.delete(projectId);
    };
  }, [projectId]);
}
export async function flushListingPage(projectId: number | null | undefined) {
  if (!projectId) return false;
  try {
    for (const save of editors.get(projectId) || []) await save();
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "请先保存当前修改");
    return false;
  }
}
