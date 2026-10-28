import { useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IMAGE_TAGGING_OPTIONS } from "@shared/imageTagging";
import { AdjustResultButton } from "./KnowledgeAssetActions";

const fields = [
  {
    key: "setCategory",
    name: "类目",
    options: IMAGE_TAGGING_OPTIONS.categories,
  },
  { key: "setStyle", name: "风格", options: IMAGE_TAGGING_OPTIONS.styles },
  {
    key: "setPrimaryColor",
    name: "主色",
    options: IMAGE_TAGGING_OPTIONS.colors,
  },
  {
    key: "setAccentColor",
    name: "提亮色",
    options: IMAGE_TAGGING_OPTIONS.colors,
  },
] as const;
function SetEditor({
  id,
  onClose,
  onSaved,
}: {
  id: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const query = trpc.knowledgeAssets.setTags.useQuery({ id }, { staleTime: 0 });
  const [patch, setPatch] = useState<Record<string, string>>({});
  const save = trpc.knowledgeAssets.saveSetTags.useMutation({
    onSuccess: () => {
      toast.success("整套标签已同步");
      onSaved();
      onClose();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <Dialog
      open
      onOpenChange={v => {
        if (!v && !save.isPending) onClose();
      }}
    >
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>编辑 ASIN 集标签</DialogTitle>
        </DialogHeader>
        {query.error ? (
          <p role="alert">
            标签暂时无法读取
            <Button variant="link" onClick={() => query.refetch()}>
              重试
            </Button>
          </p>
        ) : !query.data ? (
          <p>正在读取标签…</p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={e => {
              e.preventDefault();
              const d = query.data!;
              save.mutate({
                id,
                version: d.version,
                tags: Object.fromEntries(
                  fields.map(f => [
                    f.key,
                    patch[f.key] ?? String(d.tags[f.key] || ""),
                  ])
                ) as {
                  setCategory: string;
                  setStyle: string;
                  setPrimaryColor: string;
                  setAccentColor: string;
                },
              });
            }}
          >
            {fields.map(f => (
              <label
                key={f.key}
                className="grid grid-cols-[64px_1fr] items-center gap-3 text-sm"
              >
                {f.name}
                <select
                  className="h-10 rounded-lg border bg-background px-3"
                  value={patch[f.key] ?? String(query.data!.tags[f.key] || "")}
                  onChange={e =>
                    setPatch(p => ({ ...p, [f.key]: e.target.value }))
                  }
                >
                  <option value="">
                    {f.key === "setAccentColor" ? "无明显提亮色" : "请选择"}
                  </option>
                  {f.options.map(v => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            ))}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending}
                onClick={onClose}
              >
                取消
              </Button>
              <Button disabled={save.isPending}>
                {save.isPending ? "保存中…" : "保存并同步"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
export default function SetTagsActions({ id }: { id: number }) {
  const [editing, setEditing] = useState(false),
    utils = trpc.useUtils();
  const refresh = () => {
    void utils.kbImages.invalidate();
    void utils.kbVideos.invalidate();
    void utils.knowledgeAssets.setTags.invalidate({ id });
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => setEditing(true)}>
        <Pencil className="mr-2 h-4 w-4" />
        编辑
      </Button>
      <AdjustResultButton kind="set" id={id} onSaved={refresh} />
      {editing && (
        <SetEditor
          id={id}
          onClose={() => setEditing(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
