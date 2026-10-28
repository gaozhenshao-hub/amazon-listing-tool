import { useEffect, useState } from "react";
import {
  BookOpen,
  Plus,
  Search,
  Copy,
  Sparkles,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  defaultDesignParams,
  designModelLabel,
  type DesignParams,
} from "@shared/designStudio";
import {
  designPromptCategories,
  designPromptSeeds,
  type DesignPromptDraft,
} from "@shared/designPrompts";
import { DesignParameters } from "./DesignPlanEditor";
import "./designPromptLibrary.css";

export type PromptSource = {
  generationId: string;
  prompt: string;
  params: DesignParams;
};
type Editor = DesignPromptDraft & {
  revision?: number;
  sourceGenerationId?: string;
};
export function DesignPromptLibrary({
  onUse,
  source,
  onSourceHandled,
}: {
  onUse?: (prompt: string, params: DesignParams) => void;
  source?: PromptSource | null;
  onSourceHandled?: () => void;
}) {
  const { user } = useAuth();
  const permissions = usePermissions();
  const utils = trpc.useUtils();
  const editable = permissions.canEdit("design", "design_prompts");
  const deletable = permissions.canDelete("design", "design_prompts");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [offset, setOffset] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [remove, setRemove] = useState<{
    id: string;
    revision: number;
    title: string;
  } | null>(null);
  const [showSeeds, setShowSeeds] = useState(true);
  const data = trpc.designPrompts.list.useQuery(
    { search: query, category, offset },
    { refetchOnWindowFocus: true }
  );
  const save = trpc.designPrompts.save.useMutation();
  const deletion = trpc.designPrompts.remove.useMutation();
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setOffset(0);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    if (source) {
      setEditor({
        id: crypto.randomUUID(),
        title: source.prompt.slice(0, 40),
        category: "其他",
        prompt: source.prompt,
        params: source.params,
        notes: "",
        sourceGenerationId: source.generationId,
      });
      onSourceHandled?.();
    }
  }, [source, onSourceHandled]);
  const use = (prompt: string, params: DesignParams) => {
    if (onUse) return onUse(prompt, params);
    sessionStorage.setItem(
      `design-library-draft-${user!.id}`,
      JSON.stringify({ prompt, params })
    );
    window.location.assign("/design/images?promptLibrary=1");
  };
  const refresh = () => utils.designPrompts.list.invalidate();
  const error = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : "操作失败，请重试");
  const starter = () =>
    setEditor({
      id: crypto.randomUUID(),
      title: "",
      category: "其他",
      prompt: "",
      params: defaultDesignParams,
      notes: "",
    });
  return (
    <div className="prompt-library">
      <header className="prompt-library-heading">
        <div>
          <span className="prompt-eyebrow">
            <BookOpen size={16} />
            团队创作积累
          </span>
          <h1>提示词库</h1>
          <p>好作品留下方法。共享提示词与示例，个人作图对话各自独立。</p>
        </div>
        {editable && (
          <button className="prompt-primary" onClick={starter}>
            <Plus size={17} />
            新增提示词
          </button>
        )}
      </header>
      <div className="prompt-toolbar">
        <label>
          <Search size={17} />
          <input
            aria-label="搜索提示词"
            placeholder="搜索名称或提示词内容"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </label>
        <button onClick={() => setShowSeeds(v => !v)}>
          {showSeeds ? "收起基础模板" : "查看基础模板"}
        </button>
      </div>
      <nav className="prompt-categories" aria-label="提示词分类">
        {designPromptCategories.map(c => (
          <button
            key={c}
            aria-pressed={category === c}
            onClick={() => {
              setCategory(c);
              setOffset(0);
            }}
          >
            {c}
          </button>
        ))}
      </nav>
      {data.isLoading && <p className="prompt-empty">正在加载团队提示词…</p>}
      {data.error && (
        <div className="prompt-empty" role="alert">
          提示词读取失败。<button onClick={() => data.refetch()}>重试</button>
        </div>
      )}
      {!data.isLoading && !data.error && data.data?.items.length === 0 && (
        <div className="prompt-empty">
          <BookOpen size={28} />
          <h2>
            {query || category !== "全部"
              ? "暂未找到匹配内容"
              : "把满意的作品，积累成团队经验"}
          </h2>
          <p>可以新增提示词，或在已生成图片下点击“保存到提示词库”。</p>
          <button onClick={() => setShowSeeds(true)}>先看看基础模板</button>
        </div>
      )}
      <div className="prompt-grid">
        {data.data?.items.map(item => (
          <article className="prompt-card" key={item.id}>
            {item.hasExample ? (
              <a
                className="prompt-example"
                href={`/api/design/prompt-examples/${item.id}`}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src={`/api/design/prompt-examples/${item.id}`}
                  alt={item.title + "示例图"}
                  loading="lazy"
                />
              </a>
            ) : (
              <div className="prompt-example prompt-no-example">
                <Sparkles size={30} />
                <span>{item.category}</span>
              </div>
            )}
            <div className="prompt-card-body">
              <div className="prompt-meta">
                <span>{item.category}</span>
                <small>{designModelLabel(item.params)}</small>
              </div>
              <h2>{item.title}</h2>
              <details>
                <summary>查看完整提示词</summary>
                <p>{item.prompt}</p>
                {item.notes && (
                  <p className="prompt-notes">使用心得：{item.notes}</p>
                )}
              </details>
              <small>分享人：{item.authorName}</small>
              <div className="prompt-actions">
                <button
                  className="prompt-primary"
                  onClick={() => use(item.prompt, item.params as DesignParams)}
                >
                  使用提示词
                </button>
                <button
                  aria-label={`复制 ${item.title}`}
                  onClick={() =>
                    navigator.clipboard
                      .writeText(item.prompt)
                      .then(() => toast.success("提示词已复制"), error)
                  }
                >
                  <Copy size={16} />
                </button>
                {editable && item.canManage && (
                  <button
                    aria-label={`编辑 ${item.title}`}
                    onClick={() =>
                      setEditor({
                        ...item,
                        category: item.category as Editor["category"],
                        params: item.params as DesignParams,
                      })
                    }
                  >
                    <Pencil size={16} />
                  </button>
                )}
                {deletable && item.canManage && (
                  <button
                    aria-label={`删除 ${item.title}`}
                    onClick={() => setRemove(item)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {!!data.data && (offset > 0 || data.data.hasMore) && (
        <div className="prompt-pagination">
          <button
            disabled={!offset}
            onClick={() => setOffset(v => Math.max(0, v - 30))}
          >
            上一页
          </button>
          <span>第 {offset / 30 + 1} 页</span>
          <button
            disabled={!data.data.hasMore}
            onClick={() => setOffset(v => v + 30)}
          >
            下一页
          </button>
        </div>
      )}
      {showSeeds && (
        <section className="prompt-starters">
          <h2>基础模板</h2>
          <p>
            用于起步，尚未经你们产品验证。替换【】中的内容并上传产品图，再按实际效果调整。
          </p>
          <div className="prompt-grid">
            {designPromptSeeds
              .filter(s => category === "全部" || s.category === category)
              .map(seed => (
                <article className="prompt-card prompt-card-body" key={seed.id}>
                  <span className="prompt-eyebrow">{seed.category}</span>
                  <h2>{seed.title}</h2>
                  <details>
                    <summary>查看模板</summary>
                    <p>{seed.prompt}</p>
                    <p className="prompt-notes">{seed.notes}</p>
                  </details>
                  <button onClick={() => use(seed.prompt, seed.params)}>
                    使用模板
                  </button>
                  {editable && (
                    <button
                      onClick={() =>
                        setEditor({
                          ...seed,
                          id: crypto.randomUUID(),
                          category: seed.category as Editor["category"],
                        })
                      }
                    >
                      修改后保存
                    </button>
                  )}
                </article>
              ))}
          </div>
        </section>
      )}
      <Dialog
        open={!!editor}
        onOpenChange={open => {
          if (!open && !save.isPending) setEditor(null);
        }}
      >
        <DialogContent className="prompt-editor">
          <DialogHeader>
            <DialogTitle>
              {editor?.revision ? "编辑提示词" : "保存到团队提示词库"}
            </DialogTitle>
            <DialogDescription>
              {editor?.sourceGenerationId
                ? "提示词、生成参数和这张结果图会分享给美工团队；个人对话与原参考图不会共享。"
                : "团队成员可以查看和使用；作者与管理员可以编辑、删除。"}
            </DialogDescription>
          </DialogHeader>
          {editor && (
            <form
              onSubmit={async e => {
                e.preventDefault();
                try {
                  await save.mutateAsync({
                    id: editor.id,
                    title: editor.title,
                    category: editor.category,
                    prompt: editor.prompt,
                    notes: editor.notes,
                    params: editor.params,
                    ...(editor.revision ? { revision: editor.revision } : {}),
                    ...(editor.sourceGenerationId
                      ? { sourceGenerationId: editor.sourceGenerationId }
                      : {}),
                  });
                  setEditor(null);
                  await refresh();
                  toast.success("已保存到团队提示词库");
                } catch (e) {
                  error(e);
                }
              }}
            >
              <label>
                名称
                <input
                  required
                  maxLength={120}
                  value={editor.title}
                  onChange={e =>
                    setEditor({ ...editor, title: e.target.value })
                  }
                />
              </label>
              <label>
                分类
                <select
                  value={editor.category}
                  onChange={e =>
                    setEditor({
                      ...editor,
                      category: e.target.value as Editor["category"],
                    })
                  }
                >
                  {designPromptCategories
                    .filter(c => c !== "全部")
                    .map(c => (
                      <option key={c}>{c}</option>
                    ))}
                </select>
              </label>
              <label>
                提示词
                <textarea
                  required
                  rows={8}
                  maxLength={8000}
                  value={editor.prompt}
                  onChange={e =>
                    setEditor({ ...editor, prompt: e.target.value })
                  }
                />
              </label>
              <label>
                使用心得
                <textarea
                  rows={2}
                  maxLength={2000}
                  placeholder="适用产品、关键参数、需要注意的细节…"
                  value={editor.notes}
                  onChange={e =>
                    setEditor({ ...editor, notes: e.target.value })
                  }
                />
              </label>
              <div className="prompt-parameters"><DesignParameters
                params={editor.params}
                onChange={params => setEditor({ ...editor, params })}
                disabled={save.isPending}
              /></div>
              <div className="prompt-actions">
                <button
                  type="button"
                  disabled={save.isPending}
                  onClick={() => setEditor(null)}
                >
                  取消
                </button>
                <button className="prompt-primary" disabled={save.isPending}>
                  {save.isPending ? "正在保存…" : "保存并共享"}
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!remove}
        onOpenChange={v => {
          if (!v) setRemove(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除这条提示词？</DialogTitle>
            <DialogDescription>
              “{remove?.title}”将从共享库移除，原来的作图记录不会删除。
            </DialogDescription>
          </DialogHeader>
          <button
            disabled={deletion.isPending}
            onClick={async () => {
              try {
                await deletion.mutateAsync({
                  id: remove!.id,
                  revision: remove!.revision,
                });
                setRemove(null);
                await refresh();
                toast.success("已从提示词库移除");
              } catch (e) {
                error(e);
              }
            }}
          >
            确认删除
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
export default DesignPromptLibrary;
