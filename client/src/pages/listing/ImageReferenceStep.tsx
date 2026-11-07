import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { type ImageOutline } from "@shared/imagePlanning";
import ImagePlanningReferences from "./ImagePlanningReferences";
import { ResearchLockButton, useResearchLock } from "./ResearchLock";
export default function ImageReferenceStep({
  projectId,
  registerSave,
}: {
  projectId: number;
  registerSave: (fn: (() => Promise<boolean>) | null) => void;
}) {
  const query = trpc.imagePlanning.get.useQuery(
      { projectId },
      { refetchOnWindowFocus: false }
    ),
    save = trpc.imagePlanning.save.useMutation(),
    utils = trpc.useUtils(),
    lock = useResearchLock(projectId, "references");
  const [data, setData] = useState<ImageOutline | null>(null),
    [dirty, setDirty] = useState(false),
    revision = useRef(0),
    latest = useRef(data),
    saveRef = useRef<() => Promise<boolean>>(async () => true);
  latest.current = data;
  useEffect(() => {
    if (query.data && !dirty && query.data.revision >= revision.current) {
      setData(query.data.data);
      revision.current = query.data.revision;
    }
  }, [query.data, dirty]);
  useEffect(() => {
    registerSave(() => saveRef.current());
    return () => registerSave(null);
  }, [registerSave]);
  useEffect(() => {
    if (!dirty) return;
    const stop = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, [dirty]);
  async function persist(value = latest.current) {
    if (!value) return false;
    if (!dirty && value === latest.current) return true;
    try {
      const result = await save.mutateAsync({
        projectId,
        revision: revision.current,
        data: value,
      });
      revision.current = result.revision;
      const savedCurrent = latest.current === value;
      if (savedCurrent) {
        latest.current = result.data;
        setData(result.data);
        setDirty(false);
      }
      await utils.imagePlanning.get.invalidate({ projectId });
      return savedCurrent;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "参考套图未保存，请重试");
      return false;
    }
  }
  saveRef.current = () => persist();
  if (!data)
    return (
      <p className="rounded-xl border p-8">
        {query.error ? "参考套图暂时无法读取，请重新进入" : "正在读取参考套图…"}
      </p>
    );
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-3">
        <span className="text-xs text-muted-foreground">
          {dirty ? "有未保存修改" : "已保存"}
        </span>
        <ResearchLockButton state={lock} beforeLock={() => persist()} />
      </div>
      <ImagePlanningReferences
        projectId={projectId}
        data={data}
        readOnly={lock.locked || lock.loading}
        onChange={next => {
          if (!lock.locked && !lock.loading) {
            latest.current = next;
            setData(next);
            setDirty(true);
          }
        }}
        onPersist={persist}
      />
    </div>
  );
}
