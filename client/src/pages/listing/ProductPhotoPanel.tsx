import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
const base64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
export default function ProductPhotoPanel({
  projectId,
  readOnly,
  beforeWrite,
  onRevision,
}: {
  projectId: number;
  readOnly: boolean;
  beforeWrite: () => Promise<boolean>;
  onRevision: (r: number) => void;
}) {
  const query = trpc.imagePlanning.productPhotos.useQuery({ projectId }),
    upload = trpc.imagePlanning.uploadProductPhoto.useMutation(),
    reorder = trpc.imagePlanning.reorderProductPhotos.useMutation();
  const file = useRef<HTMLInputElement>(null),
    [kind, setKind] = useState<"product" | "accessory">("product"),
    [busy, setBusy] = useState(false);
  const change = async (ids: string[]) => {
    if (readOnly || busy || !(await beforeWrite())) return;
    try {
      setBusy(true);
      const r = await reorder.mutateAsync({
        projectId,
        ids,
        expectedIds: query.data?.map(p => p.id) || [],
      });
      onRevision(r.revision);
      await query.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "图片修改失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mt-4 space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm">本品图片</strong>
        <select
          aria-label="本品图片类型"
          disabled={readOnly || busy}
          className="rounded border bg-background p-1 text-sm"
          value={kind}
          onChange={e => setKind(e.target.value as typeof kind)}
        >
          <option value="product">白底产品图（不同角度）</option>
          <option value="accessory">产品配件图</option>
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={readOnly || busy}
          onClick={() => file.current?.click()}
        >
          {busy ? "正在上传…" : "上传图片"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        支持多选 JPG、PNG、WebP，每张最大10MB；图片将用于图片策划和后续制作。
      </p>
      <input
        ref={file}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        disabled={readOnly || busy}
        aria-label="上传本品图片"
        onChange={async e => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          if (readOnly || !files.length || !(await beforeWrite())) return;
          setBusy(true);
          try {
            for (const f of files) {
              if (f.size > 10 * 1024 * 1024)
                throw new Error(f.name + "超过10MB");
              const r = await upload.mutateAsync({
                projectId,
                name: f.name,
                kind,
                base64: await base64(f),
              });
              onRevision(r.revision);
            }
            toast.success("本品图片已保存");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "上传失败");
          } finally {
            await query.refetch();
            setBusy(false);
          }
        }}
      />
      {query.error && (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {query.data?.map((p, index) => (
          <article
            key={p.id}
            className="overflow-hidden rounded-lg border bg-background"
          >
            <a href={p.url} target="_blank" rel="noreferrer">
              <img
                src={p.url}
                alt={p.name}
                className="aspect-square w-full object-contain p-1"
              />
            </a>
            <div className="p-2">
              <p className="truncate text-xs" title={p.name}>
                {p.name}
              </p>
              <small className="text-muted-foreground">
                {p.kind === "product" ? "产品图" : "配件图"}
              </small>
              {!readOnly && (
                <div className="mt-1 flex gap-2 text-xs">
                  <button
                    disabled={busy || !index}
                    onClick={() => {
                      const ids = query.data!.map(v => v.id);
                      [ids[index], ids[index - 1]] = [
                        ids[index - 1],
                        ids[index],
                      ];
                      void change(ids);
                    }}
                  >
                    前移
                  </button>
                  <button
                    disabled={busy || index === query.data!.length - 1}
                    onClick={() => {
                      const ids = query.data!.map(v => v.id);
                      [ids[index], ids[index + 1]] = [
                        ids[index + 1],
                        ids[index],
                      ];
                      void change(ids);
                    }}
                  >
                    后移
                  </button>
                  <button
                    disabled={busy}
                    className="text-destructive"
                    onClick={() =>
                      void change(
                        query.data!.filter(v => v.id !== p.id).map(v => v.id)
                      )
                    }
                  >
                    移除
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
      {!query.data?.length && (
        <p className="text-xs text-muted-foreground">
          可补充产品各角度及配件实拍图。
        </p>
      )}
    </section>
  );
}
