import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PickTag } from "@shared/productSelection";
import type { PickRow } from "@shared/productSelectionAnalysis";

type Ref = { id: string; revision: number };
type Change = { asin: string; ids: string[] };
type Run = (
  action: () => Promise<unknown>,
  success?: string
) => Promise<boolean>;
const chunkSize = 35;
const empty = (): PickTag => ({
  id: crypto.randomUUID(),
  dimension: "",
  name: "",
  description: "",
});

export function SelectionTagSettings({
  tags,
  onSave,
  onClose,
  onTag,
  busy,
}: {
  tags: PickTag[];
  onSave: (tags: PickTag[]) => Promise<boolean>;
  onClose: () => void;
  onTag?: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(tags);
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>设置标签</DialogTitle>
          <DialogDescription>
            先填写维度和标签，再按需添加判断说明。删除标签会同时移除竞品中的该标签。
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto">
          {draft.map((tag, i) => (
            <div
              className="grid grid-cols-[1fr_1fr_2fr_auto] gap-2"
              key={tag.id}
            >
              {(["dimension", "name", "description"] as const).map(
                (key, field) => (
                  <Input
                    key={key}
                    value={tag[key]}
                    placeholder={
                      ["维度，如材质", "标签，如金属款", "判断说明（选填）"][
                        field
                      ]
                    }
                    aria-label={
                      ["维度", "标签", "判断说明"][field] + " " + (i + 1)
                    }
                    maxLength={field === 2 ? 250 : 40}
                    onChange={e =>
                      setDraft(
                        draft.map(item =>
                          item.id === tag.id
                            ? { ...item, [key]: e.target.value }
                            : item
                        )
                      )
                    }
                  />
                )
              )}
              <Button
                variant="ghost"
                onClick={() =>
                  setDraft(draft.filter(item => item.id !== tag.id))
                }
              >
                移除
              </Button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <Button
            variant="outline"
            disabled={draft.length >= 60}
            onClick={() => setDraft([...draft, empty()])}
          >
            新增标签
          </Button>
          {onTag && (
            <Button
              variant="outline"
              disabled={
                busy ||
                !draft.length ||
                draft.some(tag => !tag.dimension.trim() || !tag.name.trim())
              }
              onClick={async () => {
                if (await onSave(draft)) onTag();
              }}
            >
              保存并一键打标
            </Button>
          )}
          <Button
            disabled={
              busy ||
              draft.some(tag => !tag.dimension.trim() || !tag.name.trim())
            }
            onClick={async () => {
              if (await onSave(draft)) onClose();
            }}
          >
            保存标签
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EditSelectionRowTags({
  row,
  tags,
  manual,
  onSave,
  onClose,
  busy,
}: {
  row: PickRow;
  tags: PickTag[];
  manual: boolean;
  onSave: (ids: string[], auto: boolean) => Promise<boolean>;
  onClose: () => void;
  busy: boolean;
}) {
  const [ids, setIds] = useState(row.tagIds);
  const [auto, setAuto] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>调整标签 · {row.asin}</DialogTitle>
          <DialogDescription>{row.title}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[50vh] gap-2 overflow-y-auto">
          {tags.map(tag => (
            <label key={tag.id} className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={ids.includes(tag.id)}
                onChange={e =>
                  setIds(
                    e.target.checked
                      ? [...ids, tag.id]
                      : ids.filter(id => id !== tag.id)
                  )
                }
              />
              {tag.dimension} · {tag.name}
            </label>
          ))}
          {!tags.length && (
            <p className="text-sm text-muted-foreground">请先设置可用标签。</p>
          )}
        </div>
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={auto}
            onChange={e => setAuto(e.target.checked)}
          />
          允许以后由 AI 更新此行{manual ? "（当前已人工锁定）" : ""}
        </label>
        <Button
          disabled={busy || (!tags.length && !manual)}
          onClick={async () => {
            if (await onSave(ids, auto)) onClose();
          }}
        >
          保存
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function SelectionAutoTags({
  rows,
  tags,
  manual,
  reference,
  run,
  busy,
  onClose,
}: {
  rows: PickRow[];
  tags: PickTag[];
  manual: string[];
  reference: Ref;
  run: Run;
  busy: boolean;
  onClose: () => void;
}) {
  const generate = trpc.productSelection.generateTags.useMutation(),
    accept = trpc.productSelection.acceptTags.useMutation();
  const [suggestions, setSuggestions] = useState<Change[] | null>(null);
  const [initial, setInitial] = useState<Change[] | null>(null);
  const [guidance, setGuidance] = useState("");
  const [lastGuidance, setLastGuidance] = useState("");
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [running, setRunning] = useState(false);
  const started = useRef(false);
  const manualSet = new Set(manual);
  const eligible = rows.filter(row => row.title && !manualSet.has(row.asin));
  const titles = new Map(rows.map(row => [row.asin, row.title]));
  const tagNames = new Map(tags.map(tag => [tag.id, tag.name]));
  const changed =
    !!initial && JSON.stringify(initial) !== JSON.stringify(suggestions);

  async function produce(adjust: boolean) {
    const previous = new Map(
      suggestions?.map(change => [change.asin, change.ids])
    );
    const asins = eligible.map(row => row.asin);
    setRunning(true);
    setProgress({ done: 0, total: asins.length });
    const results: Change[] = [];
    try {
      for (let i = 0; i < asins.length; i += chunkSize) {
        const batch = asins.slice(i, i + chunkSize);
        results.push(
          ...(await generate.mutateAsync({
            ...reference,
            asins: batch,
            guidance: adjust ? guidance : "",
            previous: batch.flatMap(asin =>
              previous.has(asin) ? [{ asin, ids: previous.get(asin)! }] : []
            ),
          }))
        );
        setProgress({ done: i + batch.length, total: asins.length });
      }
      setSuggestions(results);
      if (!adjust) setInitial(results);
      else {
        setLastGuidance(guidance);
        setGuidance("");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "打标未完成，请重试"
      );
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    if (started.current || !eligible.length) return;
    started.current = true;
    void produce(false);
  }, []);

  async function save(improve: boolean) {
    if (!suggestions) return;
    const ok = await run(
      () =>
        accept.mutateAsync({
          ...reference,
          changes: suggestions,
          improve:
            improve && initial
              ? { guidance: lastGuidance, before: initial }
              : undefined,
        }),
      improve ? "标签已保存，技能改进草稿已创建" : "标签已保存"
    );
    if (ok) onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !running && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>一键打标</DialogTitle>
          <DialogDescription>
            使用商品标题和当前标签定义。已人工锁定的标签会保留。确认后才写入选品表。
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          可打标 {eligible.length} 项。已人工锁定{" "}
          {rows.filter(row => manualSet.has(row.asin)).length} 项。
          {progress && running
            ? " 进度 " + progress.done + "/" + progress.total
            : ""}
        </p>
        {suggestions && (
          <div className="max-h-[45vh] space-y-2 overflow-y-auto text-sm">
            {suggestions.map((change, index) => (
              <div className="rounded-md border p-2" key={change.asin}>
                <p className="font-medium">
                  {change.asin} · {titles.get(change.asin)}
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {tags.map(tag => (
                    <label className="flex items-center gap-1" key={tag.id}>
                      <input
                        disabled={running || busy}
                        type="checkbox"
                        checked={change.ids.includes(tag.id)}
                        onChange={e =>
                          setSuggestions(
                            suggestions.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    ids: e.target.checked
                                      ? [...item.ids, tag.id]
                                      : item.ids.filter(id => id !== tag.id),
                                  }
                                : item
                            )
                          )
                        }
                      />
                      {tagNames.get(tag.id)}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {suggestions && (
          <label className="grid gap-1 text-sm">
            调整意见
            <Textarea
              disabled={running || busy}
              value={guidance}
              onChange={e => setGuidance(e.target.value)}
              maxLength={2000}
              placeholder="例如，仅标题明确写有不锈钢时才打金属款标签。"
            />
          </label>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            disabled={running || busy}
            onClick={onClose}
          >
            取消
          </Button>
          {!suggestions ? (
            <Button
              disabled={running || !eligible.length}
              onClick={() => void produce(false)}
            >
              {running ? "正在打标…" : "开始打标"}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={running || busy || !guidance.trim()}
                onClick={() => void produce(true)}
              >
                调整结果（AI）
              </Button>
              {changed && (
                <Button
                  variant="outline"
                  disabled={busy || running}
                  onClick={() => void save(true)}
                >
                  确认并用于改进
                </Button>
              )}
              <Button
                disabled={busy || running}
                onClick={() => void save(false)}
              >
                {changed ? "确认本次调整" : "确认标签"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
