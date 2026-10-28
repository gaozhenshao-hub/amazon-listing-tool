import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  BookOpen,
  Check,
  Download,
  FolderOpen,
  ImagePlus,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import {
  defaultDesignParams,
  designParamsSchema,
  designOptions,
  designParameterKeys,
  designModelLabel,
  designReferenceLimit,
  designStatusLabels,
  isDesignPending,
  type DesignDraft,
  type DesignParams,
} from "@shared/designStudio";
import "./designStudio.css";
import { DesignParameters, DesignPlanEditor } from "./DesignPlanEditor";
import { DesignPromptLibrary, type PromptSource } from "./DesignPromptLibrary";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SaveMaterialDialog, type MaterialSource } from "./DesignMaterials";

type Reference = { id: string; name: string; bytes?: number };
const imageUrl = (id: string) => `/api/design/assets/${id}`;
const friendlyError = (error: unknown) =>
  error instanceof Error ? error.message : "操作失败，请稍后重试";

export default function DesignStudio() {
  const { user } = useAuth();
  const permissions = usePermissions();
  const editable = permissions.canEdit("design", "design_images");
  const deletable = permissions.canDelete("design", "design_images");
  const [selected, setSelected] = useState<string | null>(null);
  const [limit, setLimit] = useState(60);
  const [historyLimit, setHistoryLimit] = useState(60);
  const [prompt, setPrompt] = useState("");
  const [params, setParams] = useState<DesignParams>(defaultDesignParams);
  const [references, setReferences] = useState<Reference[]>([]);
  const [uploading, setUploading] = useState(false);
  const [replaceReferences, setReplaceReferences] = useState(false);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [materialSource, setMaterialSource] = useState<MaterialSource | null>(
    null
  );
  const [librarySource, setLibrarySource] = useState<PromptSource | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [deletion, setDeletion] = useState<{
    id: string;
    kind: "conversation" | "generation";
  } | null>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const createId = useRef<string | null>(null);
  const initialized = useRef(false);
  const restoredParams = useRef<string | null>(null);
  const utils = trpc.useUtils();
  const conversations = trpc.designStudio.conversations.useQuery({ limit });
  const history = trpc.designStudio.history.useQuery(
    { id: selected!, limit: historyLimit },
    {
      enabled: !!selected,
      refetchInterval: 4000,
      refetchIntervalInBackground: false,
    }
  );
  const create = trpc.designStudio.create.useMutation();
  const generate = trpc.designStudio.generate.useMutation();
  const chat = trpc.designStudio.chat.useMutation();
  const direct = trpc.designStudio.generateDirect.useMutation();
  const remove = trpc.designStudio.remove.useMutation();
  const rename = trpc.designStudio.rename.useMutation();
  const check = trpc.designStudio.check.useMutation();
  const maxReferences = designReferenceLimit(params);
  const tooManyReferences = references.length > maxReferences;
  const pending =
    history.data?.items.some(item => isDesignPending(item.status)) ?? false;
  const chatPending =
    history.data?.chats.some(item => isDesignPending(item.status)) ?? false;
  const busy =
    generate.isPending ||
    direct.isPending ||
    chat.isPending ||
    create.isPending ||
    uploading;
  const submitting = useRef(false);
  const latestChatStatus = history.data?.chats.at(-1)?.status;

  useEffect(() => {
    if (initialized.current || !conversations.data || !user) return;
    initialized.current = true;
    const savedDraft = sessionStorage.getItem(
      `design-library-draft-${user.id}`
    );
    if (
      savedDraft &&
      new URLSearchParams(window.location.search).get("promptLibrary") === "1"
    ) {
      sessionStorage.removeItem(`design-library-draft-${user.id}`);
      try {
        const draft = JSON.parse(savedDraft);
        const validated = designParamsSchema.parse(draft.params);
        if (typeof draft.prompt === "string" && draft.prompt.length <= 8000) {
          setPrompt(draft.prompt);
          setParams(validated);
          return;
        }
      } catch {
        toast.error("提示词读取失败，请重新选择");
      }
    }
    const last = sessionStorage.getItem(`design-conversation-${user.id}`);
    if (conversations.data.items.some(item => item.id === last))
      setSelected(last);
  }, [conversations.data, user]);
  useEffect(() => {
    if (user && initialized.current) {
      if (selected)
        sessionStorage.setItem(`design-conversation-${user.id}`, selected);
      else sessionStorage.removeItem(`design-conversation-${user.id}`);
    }
    setHistoryLimit(60);
    setRenaming(false);
  }, [selected, user]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [
    selected,
    history.data?.items.length,
    history.data?.chats.length,
    latestChatStatus,
  ]);
  useEffect(() => {
    if (!selected || !history.data || restoredParams.current === selected)
      return;
    restoredParams.current = selected;
    const lastChat = history.data.chats.at(-1);
    const lastImage = history.data.items.at(-1);
    const last =
      lastChat && (!lastImage || lastChat.createdAt > lastImage.createdAt)
        ? lastChat
        : lastImage;
    if (last)
      setParams({
        ...last.params,
        ...(last === lastImage && lastImage?.batch
          ? { count: String(lastImage.batch.total) }
          : {}),
      } as DesignParams);
  }, [selected, history.data]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreview(null);
        setDeletion(null);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const refresh = async () => {
    await Promise.all([
      utils.designStudio.conversations.invalidate(),
      utils.designStudio.history.invalidate(),
    ]);
  };
  const choose = (id: string | null) => {
    setSelected(id);
    setPrompt("");
    setReferences([]);
    setReplaceReferences(false);
    request.current = null;
    createId.current = null;
  };
  const ensureConversation = async () => {
    if (selected) return selected;
    createId.current ||= crypto.randomUUID();
    const created = await create.mutateAsync({ id: createId.current });
    setSelected(created.id);
    return created.id;
  };
  const submit = async (
    text = prompt,
    options = params,
    refs = references,
    mode: "chat" | "direct" = "chat"
  ) => {
    if (
      !editable ||
      !text.trim() ||
      refs.length > designReferenceLimit(options) ||
      busy ||
      pending ||
      chatPending ||
      submitting.current
    )
      return;
    submitting.current = true;
    try {
      const conversationId = await ensureConversation();
      const payload = {
        conversationId,
        prompt: text.trim(),
        params: options,
        references: refs.map(r => r.id),
        ...(mode === "chat"
          ? {
              referenceMode: replaceReferences
                ? ("replace" as const)
                : ("append" as const),
            }
          : {}),
      };
      const signature = JSON.stringify({ mode, ...payload });
      if (request.current?.signature !== signature)
        request.current = { signature, id: crypto.randomUUID() };
      await (mode === "direct" ? direct : chat).mutateAsync({
        ...payload,
        requestId: request.current.id,
      });
      request.current = null;
      setPrompt("");
      setReferences([]);
      setReplaceReferences(false);
      await refresh();
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      submitting.current = false;
    }
  };
  const confirmPlan = async (planId: string, draft: DesignDraft) => {
    if (
      !selected ||
      !editable ||
      busy ||
      pending ||
      chatPending ||
      submitting.current
    )
      return;
    submitting.current = true;
    try {
      await generate.mutateAsync({
        conversationId: selected,
        planId,
        draft,
        requestId: crypto.randomUUID(),
      });
      await refresh();
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      submitting.current = false;
    }
  };
  const upload = async (
    files: FileList | File[] | null,
    current = references,
    onUploaded = (ref: Reference) =>
      setReferences(previous => [...previous, ref]),
    referenceLimit = maxReferences
  ) => {
    if (!files || !editable || uploading) return;
    const incoming = Array.from(files);
    if (incoming.length + current.length > referenceLimit)
      return void toast.error(`当前模型最多使用 ${referenceLimit} 张参考图`);
    if (incoming.some(file => file.size > 10 * 1024 * 1024))
      return void toast.error("每张参考图不能超过 10MB");
    if (
      incoming.reduce((sum, f) => sum + f.size, 0) +
        current.reduce((sum, f) => sum + (f.bytes || 0), 0) >
      30 * 1024 * 1024
    )
      return void toast.error("参考图合计不能超过 30MB");
    setUploading(true);
    try {
      for (const file of incoming) {
        const form = new FormData();
        form.append("image", file);
        const result = await fetch("/api/design/upload", {
          method: "POST",
          body: form,
          credentials: "same-origin",
        });
        const data = await result.json();
        if (!result.ok) throw new Error(data.error || "参考图上传失败");
        onUploaded(data);
      }
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const items = history.data?.items || [];
  const chats = history.data?.chats || [];
  const latestChat = chats.at(-1);
  const timeline = [
    ...items.map(item => ({ kind: "image" as const, item })),
    ...chats.map(item => ({ kind: "chat" as const, item })),
  ].sort((a, b) => {
    if (
      a.kind === "image" &&
      b.kind === "image" &&
      a.item.batch &&
      a.item.batch.id === b.item.batch?.id
    )
      return a.item.batch.index - b.item.batch.index;
    return (
      a.item.createdAt.localeCompare(b.item.createdAt) ||
      a.item.id.localeCompare(b.item.id)
    );
  });
  return (
    <div className="design-studio">
      <aside className="design-sidebar">
        <div className="design-brand">
          <span>
            <Sparkles size={20} />
          </span>
          <div>
            美工板块<small>IMAGE STUDIO</small>
          </div>
        </div>
        <button
          className="design-new"
          onClick={() => choose(null)}
          disabled={busy}
        >
          <Plus size={18} /> 新建对话
        </button>
        <input
          className="design-search"
          placeholder="搜索对话"
          aria-label="搜索对话"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="design-history-list">
          <div className="design-section-label">我的生图对话</div>
          {conversations.isLoading && <p className="design-muted">正在加载…</p>}
          {conversations.error && (
            <button onClick={() => conversations.refetch()}>
              加载失败，点击重试
            </button>
          )}
          {conversations.data?.items
            .filter(item =>
              item.title.toLowerCase().includes(search.toLowerCase())
            )
            .map(item => (
              <button
                key={item.id}
                className={`design-conversation ${selected === item.id ? "active" : ""}`}
                onClick={() => choose(item.id)}
                disabled={busy}
              >
                <MessageSquare size={16} />
                <span>{item.title}</span>
              </button>
            ))}
          {conversations.data?.items.length === 0 && (
            <p className="design-muted">第一张作品，从一个想法开始。</p>
          )}
          {conversations.data?.hasMore && (
            <button
              disabled={limit >= 200}
              onClick={() => setLimit(v => Math.min(v + 60, 200))}
            >
              查看更多对话
            </button>
          )}
        </div>
        <div className="design-sidebar-foot">
          <i /> GEM 3.8 Flash · 双模型生图
          <small>先聊需求，再确认生图 · 仅自己可见</small>
        </div>
      </aside>
      <section className="design-main">
        <header className="design-header">
          {renaming ? (
            <form
              onSubmit={async e => {
                e.preventDefault();
                try {
                  await rename.mutateAsync({
                    id: selected!,
                    title: titleDraft,
                  });
                  setRenaming(false);
                  await refresh();
                } catch (error) {
                  toast.error(friendlyError(error));
                }
              }}
            >
              <input
                autoFocus
                maxLength={120}
                value={titleDraft}
                onChange={e => setTitleDraft(e.target.value)}
                aria-label="对话名称"
              />
              <button aria-label="保存对话名称" disabled={rename.isPending}>
                <Check size={17} />
              </button>
            </form>
          ) : (
            <h1>
              {selected ? history.data?.title || "生图对话" : "生图"}
              <span>创意工作台</span>
            </h1>
          )}
          {permissions.canRead("design", "design_prompts") && (
            <button onClick={() => setLibraryOpen(true)}>
              <BookOpen size={17} /> 提示词库
            </button>
          )}
          {selected && (
            <div className="design-header-actions">
              {editable && (
                <button
                  title="重命名"
                  aria-label="重命名对话"
                  onClick={() => {
                    setTitleDraft(history.data?.title || "");
                    setRenaming(true);
                  }}
                >
                  <Pencil size={16} />
                </button>
              )}
              {deletable && (
                <button
                  title="删除对话"
                  aria-label="删除对话"
                  disabled={pending || busy || chatPending}
                  onClick={() =>
                    setDeletion({ id: selected, kind: "conversation" })
                  }
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          )}
        </header>
        <div className="design-messages">
          {!selected && (
            <div className="design-welcome">
              <div className="design-welcome-icon">
                <Sparkles size={32} />
              </div>
              <p>把想法，变成画面。</p>
              <h2>今天想创作什么？</h2>
              <div className="design-welcome-description">
                先聊聊你想要的图片，或上传产品参考图。
                <br />
                AI 整理方案，你确认后才会开始生图。
              </div>
              <div className="design-ideas">
                {[
                  [
                    "产品白底图",
                    "为参考图中的产品制作一张清晰的电商白底主图，保持产品外观、结构和颜色准确，光线柔和，突出材质。",
                  ],
                  [
                    "生活方式场景",
                    "为参考图中的产品创作一个自然、真实的使用场景，保持产品外观一致，使用温暖的自然光，画面干净。",
                  ],
                  [
                    "营销海报",
                    "创作一张产品营销海报，主体突出，排版简洁，预留标题与卖点区域，呈现高级的商业摄影质感。",
                  ],
                ].map(([label, value]) => (
                  <button
                    key={label}
                    onClick={() => {
                      setPrompt(value);
                      promptInput.current?.focus();
                    }}
                  >
                    <ImagePlus size={18} />
                    {label}
                    <span>↗</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {selected && history.isLoading && (
            <div className="design-loading">
              <Loader2 className="animate-spin" />
              正在加载对话
            </div>
          )}
          {history.error && (
            <div className="design-error">
              对话读取失败：{history.error.message}
              <button onClick={() => history.refetch()}>重试</button>
            </div>
          )}
          {history.data?.hasMore && (
            <button
              className="design-load-more"
              disabled={historyLimit >= 500}
              onClick={() => setHistoryLimit(v => Math.min(v + 60, 500))}
            >
              查看更早的作品
            </button>
          )}
          {selected &&
            !history.isLoading &&
            !history.error &&
            !items.length &&
            !chats.length && (
              <p className="design-empty">
                在下方开始聊需求，确认方案后再生成。
              </p>
            )}
          {timeline.map(entry => {
            if (entry.kind === "chat") {
              const turn = entry.item;
              const latest = turn.id === latestChat?.id;
              return (
                <article key={turn.id} className="design-chat-turn">
                  <div className="design-user-message">
                    <small>
                      你 ·{" "}
                      {new Date(turn.createdAt).toLocaleString("zh-CN", {
                        hour12: false,
                      })}
                    </small>
                    <p>{turn.prompt}</p>
                    {!!turn.referenceIds.length && (
                      <div className="design-reference-strip">
                        <small>本轮参考图</small>
                        {turn.referenceIds.map(id => (
                          <button key={id} onClick={() => setPreview(id)}>
                            <img
                              src={imageUrl(id)}
                              alt="对话参考图"
                              loading="lazy"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="design-assistant-message">
                    <strong>
                      <Sparkles size={16} /> 美工助手 · GEM 3.8 Flash
                    </strong>
                    {isDesignPending(turn.status) && (
                      <p>
                        <Loader2 size={16} className="animate-spin" />{" "}
                        正在理解需求和参考图…
                      </p>
                    )}
                    {turn.reply && (
                      <p className="design-chat-reply">
                        {turn.reply.replace(/\\n/g, "\n")}
                      </p>
                    )}
                    {turn.error && (
                      <div className="design-error">
                        {turn.error}
                        {editable && latest && (
                          <button
                            disabled={busy || pending || chatPending}
                            onClick={() =>
                              submit(
                                turn.prompt,
                                turn.params as DesignParams,
                                turn.referenceIds.map(id => ({
                                  id,
                                  name: "参考图",
                                }))
                              )
                            }
                          >
                            重新发送
                          </button>
                        )}
                      </div>
                    )}
                    {turn.plan?.ready && (
                      <div className="design-plan">
                        {latest && !turn.generationId && editable ? (
                          <DesignPlanEditor
                            key={turn.id}
                            initial={{
                              prompt: turn.plan.prompt,
                              params: turn.params as DesignParams,
                              references: turn.plan.referenceIds,
                            }}
                            disabled={
                              busy || pending || chatPending || !!history.error
                            }
                            promptTranslation={turn.plan.promptTranslation}
                            uploading={uploading}
                            upload={upload}
                            onPreview={setPreview}
                            onConfirm={draft => confirmPlan(turn.id, draft)}
                          />
                        ) : (
                          <>
                            <div className="design-chips">
                              {designParameterKeys(
                                turn.params as DesignParams
                              ).map(key => (
                                <span key={key}>
                                  {
                                    designOptions[key].find(
                                      option =>
                                        option[0] ===
                                        (turn.params as DesignParams)[key]
                                    )?.[1]
                                  }
                                </span>
                              ))}
                            </div>
                            <details>
                              <summary>
                                查看生图方案 · {turn.plan.referenceIds.length}{" "}
                                张参考图
                              </summary>
                              <p>{turn.plan.prompt}</p>
                              {turn.plan.promptTranslation && (
                                <div className="design-prompt-translation">
                                  <strong>中文翻译</strong>
                                  <p>{turn.plan.promptTranslation}</p>
                                </div>
                              )}
                              <div className="design-reference-strip">
                                {turn.plan.referenceIds.map(id => (
                                  <button
                                    key={id}
                                    onClick={() => setPreview(id)}
                                  >
                                    <img
                                      src={imageUrl(id)}
                                      alt="方案参考图"
                                      loading="lazy"
                                    />
                                  </button>
                                ))}
                              </div>
                            </details>
                            <span className="design-muted">
                              {turn.generationId
                                ? "已确认并提交生图"
                                : !latest
                                  ? "已有后续讨论，请使用最新方案"
                                  : "当前账号只有查看权限"}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              );
            }
            const item = entry.item;
            return (
              <article key={item.id} className="design-turn">
                <div className="design-turn-top">
                  <span className="design-turn-marker">
                    <Sparkles size={16} />{" "}
                    {designModelLabel(item.params as DesignParams)}
                    {item.batch &&
                      ` · 本批第 ${item.batch.index}/${item.batch.total} 张`}
                  </span>
                  <time>
                    {new Date(item.createdAt).toLocaleString("zh-CN", {
                      hour12: false,
                    })}
                  </time>
                </div>
                <p className="design-prompt">{item.prompt}</p>
                <div className="design-chips">
                  {designParameterKeys(item.params as DesignParams).map(key => (
                    <span key={key}>
                      {
                        designOptions[key].find(
                          option =>
                            option[0] === (item.params as DesignParams)[key]
                        )?.[1]
                      }
                    </span>
                  ))}
                </div>
                {item.referenceIds.length > 0 && (
                  <div className="design-reference-strip">
                    <small>参考图</small>
                    {item.referenceIds.map(id => (
                      <button key={id} onClick={() => setPreview(id)}>
                        <img src={imageUrl(id)} alt="参考图" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
                {isDesignPending(item.status) && (
                  <div className="design-generating">
                    <div>
                      <Loader2 size={28} className="animate-spin" />
                      <strong>
                        {designStatusLabels[item.status]}
                        {item.progress > 0 ? ` · ${item.progress}%` : ""}
                      </strong>
                      <span>
                        图片逐张处理，可以离开页面稍后查看；多张生成可能需要更长时间。
                      </span>
                    </div>
                  </div>
                )}
                {item.assetIds.length > 0 && (
                  <div className="design-results">
                    {item.assetIds.map(id => (
                      <div key={id}>
                        <button
                          className="design-result-image"
                          onClick={() => setPreview(id)}
                        >
                          <img
                            src={imageUrl(id)}
                            alt={item.prompt.slice(0, 100)}
                            loading="lazy"
                          />
                          <span>点击放大</span>
                        </button>
                        <div className="design-image-actions">
                          <a href={`${imageUrl(id)}?download=1`} download>
                            <Download size={15} />
                            下载原图
                          </a>
                          {item.status === "succeeded" &&
                            permissions.canEdit(
                              "design",
                              "design_materials"
                            ) && (
                              <button
                                onClick={() =>
                                  setMaterialSource({
                                    generationId: item.id,
                                    assetId: id,
                                    name: `作品-${new Date(item.createdAt).toLocaleDateString("sv-SE")}.png`,
                                  })
                                }
                              >
                                <FolderOpen size={15} /> 保存到素材库
                              </button>
                            )}
                          {editable && (
                            <button
                              disabled={busy || pending || chatPending}
                              onClick={() => {
                                setReferences([{ id, name: "生成图片" }]);
                                setPrompt("");
                                promptInput.current?.focus();
                                toast.success(
                                  "已作为参考图，请描述需要修改的内容"
                                );
                              }}
                            >
                              <ImagePlus size={15} />
                              继续修改
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!isDesignPending(item.status) && item.error && (
                  <div className="design-error">
                    {item.error}
                    {item.status === "unknown" && item.canCheck && (
                      <button
                        disabled={check.isPending}
                        onClick={async () => {
                          try {
                            await check.mutateAsync({ id: item.id });
                            await refresh();
                          } catch (error) {
                            toast.error(friendlyError(error));
                          }
                        }}
                      >
                        检查进度
                      </button>
                    )}
                  </div>
                )}
                <div className="design-turn-actions">
                  {item.status === "failed" && editable && (
                    <button
                      disabled={busy || pending || chatPending}
                      onClick={() =>
                        submit(
                          item.prompt,
                          { ...item.params, count: "1" } as DesignParams,
                          item.referenceIds.map(id => ({ id, name: "参考图" })),
                          "direct"
                        )
                      }
                    >
                      <RefreshCw size={15} /> 重试这一张
                    </button>
                  )}
                  {item.status === "succeeded" &&
                    permissions.canEdit("design", "design_prompts") && (
                      <button
                        onClick={() => {
                          setLibrarySource({
                            generationId: item.id,
                            prompt: item.prompt,
                            params: item.params as DesignParams,
                          });
                          setLibraryOpen(true);
                        }}
                      >
                        <BookOpen size={15} />
                        保存到提示词库
                      </button>
                    )}
                  {editable && (
                    <>
                      <button
                        disabled={busy || pending || chatPending}
                        onClick={() => {
                          setPrompt(item.prompt);
                          setParams(item.params as DesignParams);
                          setReferences(
                            item.referenceIds.map(id => ({
                              id,
                              name: "参考图",
                            }))
                          );
                          promptInput.current?.focus();
                        }}
                      >
                        <Pencil size={15} />
                        重新编辑
                      </button>
                      <button
                        disabled={
                          busy ||
                          pending ||
                          chatPending ||
                          item.status === "unknown"
                        }
                        onClick={() =>
                          submit(
                            `请按以下已生成图片的要求重新整理方案，等待我确认后再次生成：\n${item.prompt}`,
                            item.params as DesignParams,
                            item.referenceIds.map(id => ({
                              id,
                              name: "参考图",
                            }))
                          )
                        }
                      >
                        <RefreshCw size={15} />
                        重新准备方案
                      </button>
                    </>
                  )}
                  {deletable && (
                    <button
                      disabled={isDesignPending(item.status) || busy}
                      onClick={() =>
                        setDeletion({ id: item.id, kind: "generation" })
                      }
                    >
                      <Trash2 size={15} />
                      删除
                    </button>
                  )}
                </div>
              </article>
            );
          })}
          <div ref={bottom} />
        </div>
        <div className="design-composer-wrap">
          <div
            className="design-composer"
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              void upload(e.dataTransfer.files);
            }}
          >
            {references.length > 0 && (
              <div className="design-uploads">
                {references.map((ref, index) => (
                  <div key={`${ref.id}-${index}`}>
                    <img src={imageUrl(ref.id)} alt={ref.name} />
                    <button
                      aria-label={`移除参考图 ${index + 1}`}
                      disabled={busy}
                      onClick={() =>
                        setReferences(v => v.filter((_, i) => i !== index))
                      }
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <small>
                  {references.length}/{maxReferences} 张参考图
                </small>
              </div>
            )}
            <div className="design-reference-context">
              <span>
                聊天会结合本对话多轮参考图；确认方案中可调整实际生图用图。
              </span>
              <label>
                <input
                  type="checkbox"
                  checked={replaceReferences}
                  disabled={!editable || busy || chatPending}
                  onChange={e => setReplaceReferences(e.target.checked)}
                />{" "}
                仅使用本次参考图
              </label>
            </div>
            {tooManyReferences && (
              <p className="design-error">
                当前模型最多支持 {maxReferences} 张参考图，请移除多余图片。
              </p>
            )}
            <div className="design-input-row">
              <button
                className="design-upload-button"
                disabled={!editable || busy}
                onClick={() => fileInput.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Plus size={24} />
                )}
                <span>参考图</span>
              </button>
              <textarea
                ref={promptInput}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="描述想做的图片，也可以上传参考图。&#10;发送消息沟通需求，或点击“直接生成图片”立即生图。"
                maxLength={8000}
                disabled={!editable || busy || chatPending}
                onPaste={e => {
                  const files = Array.from(e.clipboardData.files);
                  if (files.length) {
                    e.preventDefault();
                    void upload(files);
                  }
                }}
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                aria-label="需求消息"
              />
            </div>
            <input
              ref={fileInput}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              onChange={e => upload(e.target.files)}
            />
            <div className="design-controls">
              <span className="design-model-pill">
                <Sparkles size={14} />
                先聊需求
              </span>
              <DesignParameters
                params={params}
                onChange={setParams}
                disabled={!editable || busy}
              />
              <button
                className="design-direct"
                disabled={
                  !editable ||
                  busy ||
                  pending ||
                  chatPending ||
                  !prompt.trim() ||
                  tooManyReferences ||
                  !!history.error
                }
                onClick={() => submit(prompt, params, references, "direct")}
                title="跳过聊天，使用当前输入和参考图直接生图"
              >
                <Sparkles size={16} /> 直接生成 {params.count} 张
              </button>
              <button
                className="design-send"
                aria-label="发送消息"
                title="发送消息 · Ctrl + Enter"
                disabled={
                  !editable ||
                  busy ||
                  pending ||
                  chatPending ||
                  !prompt.trim() ||
                  tooManyReferences ||
                  !!history.error
                }
                onClick={() => submit()}
              >
                {busy || pending || chatPending ? (
                  <Loader2 size={21} className="animate-spin" />
                ) : (
                  <ArrowUp size={23} />
                )}
              </button>
            </div>
          </div>
          <p className="design-composer-note">
            {!editable
              ? "当前账号只有查看权限"
              : `发送消息用于聊天 · ${designModelLabel(params)} · 本次生成 ${params.count} 张，按实际生成消耗额度 · 最多 ${maxReferences} 张参考图，单张 ≤10MB，合计 ≤30MB`}
          </p>
        </div>
      </section>
      <Dialog open={libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent
          className="prompt-library-dialog"
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">团队提示词库</DialogTitle>
          <DesignPromptLibrary
            source={librarySource}
            onSourceHandled={() => setLibrarySource(null)}
            onUse={(text, options) => {
              setPrompt(text);
              setParams(options);
              setLibraryOpen(false);
              toast.success("已填入提示词，请检查参考图后再生成");
              setTimeout(() => promptInput.current?.focus(), 0);
            }}
          />
        </DialogContent>
      </Dialog>
      {preview && (
        <div
          className="design-modal"
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          onClick={() => setPreview(null)}
        >
          <button className="design-modal-close" aria-label="关闭预览">
            <X />
          </button>
          <img
            src={imageUrl(preview)}
            alt="图片预览"
            onClick={e => e.stopPropagation()}
          />
          <a
            onClick={e => e.stopPropagation()}
            href={`${imageUrl(preview)}?download=1`}
            download
          >
            <Download size={18} />
            下载原图
          </a>
        </div>
      )}
      <SaveMaterialDialog
        source={materialSource}
        onClose={() => setMaterialSource(null)}
      />
      {deletion && (
        <div
          className="design-modal"
          role="dialog"
          aria-modal="true"
          aria-label="确认删除"
        >
          <div className="design-confirm">
            <h3>
              删除
              {deletion.kind === "conversation" ? "这段对话" : "这条生成记录"}？
            </h3>
            <p>删除后将不再显示在你的历史记录中。</p>
            <div>
              <button onClick={() => setDeletion(null)}>取消</button>
              <button
                disabled={remove.isPending}
                onClick={async () => {
                  try {
                    await remove.mutateAsync(deletion);
                    if (deletion.kind === "conversation") choose(null);
                    setDeletion(null);
                    await refresh();
                  } catch (error) {
                    toast.error(friendlyError(error));
                  }
                }}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
