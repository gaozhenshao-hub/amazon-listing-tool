import { useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  Plus,
  Upload,
  Search,
  Download,
  Pencil,
  Trash2,
  RotateCcw,
  FileImage,
  Files,
  ArrowLeft,
  Globe,
  LockKeyhole,
  X,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/hooks/usePermissions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  materialExtensions,
  materialFileLimit,
  materialSize,
} from "@shared/designMaterials";
import "./designMaterials.css";

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "操作失败，请稍后重试";
const fileUrl = (id: string, download = false) =>
  `/api/design/materials/files/${id}${download ? "?download=1" : ""}`;
export type MaterialSource = {
  generationId: string;
  assetId: string;
  name: string;
};
export function SaveMaterialDialog({
  source,
  onClose,
}: {
  source: MaterialSource | null;
  onClose: () => void;
}) {
  const projects = trpc.designMaterials.projects.useQuery(undefined, {
    enabled: !!source,
  });
  const save = trpc.designMaterials.saveGenerated.useMutation();
  const create = trpc.designMaterials.saveProject.useMutation();
  const utils = trpc.useUtils();
  const [target, setTarget] = useState("");
  const [name, setName] = useState("");
  const [projectName, setProjectName] = useState("");
  useEffect(() => {
    if (source) {
      setName(source.name);
      setTarget("");
      setProjectName("");
    }
  }, [source]);
  return (
    <Dialog
      open={!!source}
      onOpenChange={open => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent className="material-dialog">
        <DialogHeader>
          <DialogTitle>保存到素材库</DialogTitle>
          <DialogDescription>
            保存一份独立素材，之后删除生图对话不会影响它。
          </DialogDescription>
        </DialogHeader>
        <label>
          素材名称
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={180}
          />
        </label>
        <label>
          保存位置
          <select value={target} onChange={e => setTarget(e.target.value)}>
            <option value="">请选择保存位置</option>
            <option value="public">公共素材 · 美工团队可见</option>
            {projects.data?.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} · 仅自己可见
              </option>
            ))}
            <option value="new">新建项目…</option>
          </select>
        </label>
        {target === "new" && (
          <label>
            新项目名称
            <input
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              maxLength={180}
            />
          </label>
        )}
        {target === "public" && (
          <p className="material-hint">
            此图片将共享给美工团队，原对话和其他参考图仍仅自己可见。
          </p>
        )}
        {projects.error && <p role="alert">{projects.error.message}</p>}
        <button
          className="material-primary"
          disabled={
            !name.trim() ||
            !target ||
            (target === "new" && !projectName.trim()) ||
            save.isPending ||
            create.isPending
          }
          onClick={async () => {
            if (!source) return;
            try {
              let projectId = target === "public" ? null : target;
              if (target === "new") {
                const p = await create.mutateAsync({
                  id: crypto.randomUUID(),
                  name: projectName,
                });
                projectId = p.id;
                setTarget(p.id);
                await utils.designMaterials.projects.invalidate();
              }
              const r = await save.mutateAsync({ ...source, name, projectId });
              toast.success(
                r.duplicate ? "该文件已存在，无需重复保存" : "已保存到素材库"
              );
              await utils.designMaterials.invalidate();
              onClose();
            } catch (e) {
              toast.error(errorText(e));
            }
          }}
        >
          {save.isPending || create.isPending ? "正在保存…" : "保存素材"}
        </button>
      </DialogContent>
    </Dialog>
  );
}

export default function DesignMaterials() {
  const permissions = usePermissions(),
    utils = trpc.useUtils();
  const editable = permissions.canEdit("design", "design_materials"),
    deletable = permissions.canDelete("design", "design_materials");
  const [section, setSection] = useState<"projects" | "public">("projects");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [trash, setTrash] = useState(false);
  const [edit, setEdit] = useState<{
    kind: "project" | "file";
    id: string;
    name: string;
    revision?: number;
  } | null>(null);
  const [preview, setPreview] = useState<{ id: string; name: string } | null>(
    null
  );
  const [uploading, setUploading] = useState(false);
  const [uploads, setUploads] = useState<
    { name: string; state: string; failed?: boolean }[]
  >([]);
  const input = useRef<HTMLInputElement>(null);
  const projects = trpc.designMaterials.projects.useQuery();
  const inFiles = section === "public" || projectId !== null;
  const files = trpc.designMaterials.list.useQuery(
    {
      projectId: section === "public" ? null : projectId,
      search: query,
      offset,
      trash,
    },
    { enabled: inFiles }
  );
  const create = trpc.designMaterials.saveProject.useMutation(),
    rename = trpc.designMaterials.rename.useMutation(),
    remove = trpc.designMaterials.trash.useMutation();
  const active = projects.data?.find(p => p.id === projectId);
  const refresh = () => utils.designMaterials.invalidate();
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setOffset(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const navigate = (s: "projects" | "public", id: string | null = null) => {
    setSection(s);
    setProjectId(id);
    setTrash(false);
    setOffset(0);
    setSearch("");
  };
  const upload = async (selected: FileList | null) => {
    if (!selected?.length || uploading) return;
    const target = section === "public" ? null : projectId;
    if (section === "projects" && !target) return;
    const batch = Array.from(selected);
    setUploading(true);
    setUploads(batch.map(f => ({ name: f.name, state: "等待上传" })));
    for (let index = 0; index < batch.length; index++) {
      const file = batch[index];
      const update = (state: string, failed = false) =>
        setUploads(current =>
          current.map((r, i) => (i === index ? { ...r, state, failed } : r))
        );
      if (file.size > materialFileLimit) {
        update("超过 100MB", true);
        continue;
      }
      update("上传中…");
      try {
        const body = new FormData();
        body.append("file", file);
        const response = await fetch(
          `/api/design/materials/upload${target ? `?projectId=${encodeURIComponent(target)}` : ""}`,
          { method: "POST", credentials: "same-origin", body }
        );
        const data = await response
          .json()
          .catch(() => ({ error: "上传失败，请稍后重试" }));
        if (!response.ok) throw Error(data.error || "上传失败");
        update(data.duplicate ? "文件已存在，已跳过" : "上传完成");
      } catch (e) {
        update(errorText(e), true);
      }
    }
    setUploading(false);
    await refresh();
    if (input.current) input.current.value = "";
  };
  return (
    <section className="material-library">
      <header className="material-heading">
        <div>
          <span className="material-eyebrow">
            <FolderOpen size={17} /> DESIGN ASSETS
          </span>
          <h1>素材库</h1>
          <p>项目里的创作，团队的灵感。把好素材留在这里。</p>
        </div>
        <div className="material-header-actions">
          {editable && section === "projects" && !projectId && (
            <button
              className="material-primary"
              onClick={() =>
                setEdit({ kind: "project", id: crypto.randomUUID(), name: "" })
              }
            >
              <Plus size={17} />
              新建项目
            </button>
          )}
          {editable && inFiles && !trash && (
            <button
              className="material-primary"
              disabled={uploading}
              onClick={() => input.current?.click()}
            >
              {uploading ? (
                <Loader2 size={17} className="animate-spin" />
              ) : (
                <Upload size={17} />
              )}
              上传素材
            </button>
          )}
        </div>
      </header>
      <nav className="material-tabs" aria-label="素材范围">
        <button
          aria-pressed={section === "projects"}
          disabled={uploading}
          onClick={() => navigate("projects")}
        >
          <LockKeyhole size={17} />
          项目素材<span>仅自己可见</span>
        </button>
        <button
          aria-pressed={section === "public"}
          disabled={uploading}
          onClick={() => navigate("public")}
        >
          <Globe size={17} />
          公共素材<span>美工团队共享</span>
        </button>
      </nav>
      <div className="material-toolbar">
        <div className="material-breadcrumb">
          {projectId && section === "projects" && (
            <button
              aria-label="返回项目列表"
              disabled={uploading}
              onClick={() => navigate("projects")}
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <h2>
            {section === "public" ? "公共素材" : active?.name || "我的项目"}
            {trash ? " · 回收站" : ""}
          </h2>
        </div>
        <div className="material-tools">
          <label className="material-search">
            <Search size={16} />
            <input
              aria-label="搜索素材或项目"
              placeholder={inFiles ? "搜索文件名称" : "搜索项目名称"}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </label>
          {inFiles && (
            <button
              aria-pressed={trash}
              disabled={uploading}
              onClick={() => {
                setTrash(!trash);
                setOffset(0);
              }}
            >
              <Trash2 size={16} />
              {trash ? "返回素材" : "回收站"}
            </button>
          )}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={materialExtensions.map(e => "." + e).join(",")}
        onChange={e => void upload(e.target.files)}
      />
      {inFiles && !trash && (
        <p className="material-hint">
          支持图片、PSD / AI
          源文件、视频、文档及压缩包，可多选上传；单个文件不超过 100MB。
          {section === "public"
            ? "这里的素材可被美工团队查看和下载。"
            : "此项目的素材仅自己可见。"}
        </p>
      )}
      {!!uploads.length && (
        <div className="material-uploads">
          <div>
            <strong>上传记录</strong>
            {!uploading && (
              <button aria-label="收起上传记录" onClick={() => setUploads([])}>
                <X size={16} />
              </button>
            )}
          </div>
          {uploads.map((u, i) => (
            <p key={i}>
              <span>{u.name}</span>
              <span className={u.failed ? "material-failed" : ""}>
                {u.state}
              </span>
            </p>
          ))}
        </div>
      )}
      {(projects.error || (inFiles && files.error)) && (
        <div className="material-empty" role="alert">
          <p>{projects.error?.message || files.error?.message}</p>
          <button onClick={() => void refresh()}>重新加载</button>
        </div>
      )}
      {!inFiles && (
        <div className="material-project-grid">
          {projects.isLoading && <p>正在加载项目…</p>}
          {projects.data
            ?.filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
            .map(p => (
              <article className="material-project" key={p.id}>
                <button
                  className="material-project-open"
                  onClick={() => navigate("projects", p.id)}
                >
                  <span className="material-folder-icon">
                    <FolderOpen size={34} />
                  </span>
                  <h3>{p.name}</h3>
                  <p>
                    {p.fileCount} 份素材 · {materialSize(p.bytes)}
                  </p>
                  <span className="material-private">
                    <LockKeyhole size={12} />
                    私有项目
                  </span>
                </button>
                {editable && (
                  <button
                    className="material-project-edit"
                    aria-label={`重命名项目 ${p.name}`}
                    onClick={() =>
                      setEdit({ kind: "project", id: p.id, name: p.name })
                    }
                  >
                    <Pencil size={16} />
                  </button>
                )}
              </article>
            ))}
        </div>
      )}
      {!inFiles &&
        !projects.isLoading &&
        !projects.error &&
        !projects.data?.some(p =>
          p.name.toLowerCase().includes(query.toLowerCase())
        ) && (
          <div className="material-empty">
            <FolderOpen size={44} />
            <h3>{query ? "没有找到项目" : "为下一次创作，新建一个项目"}</h3>
            <p>按产品或作图需求整理图片和源文件。</p>
          </div>
        )}
      {inFiles && (
        <>
          {files.isLoading && (
            <div className="material-empty">正在加载素材…</div>
          )}
          <div className="material-file-grid">
            {files.data?.items.map(f => (
              <article className="material-file" key={f.id}>
                <button
                  className="material-thumbnail"
                  aria-label={`预览 ${f.name}`}
                  disabled={trash || !f.mime.startsWith("image/")}
                  onClick={() => setPreview({ id: f.id, name: f.name })}
                >
                  {!trash && f.mime.startsWith("image/") ? (
                    <img src={fileUrl(f.id)} alt={f.name} loading="lazy" />
                  ) : (
                    <span>
                      <Files size={40} />
                      <b>{f.name.split(".").pop()?.toUpperCase()}</b>
                    </span>
                  )}
                </button>
                <div className="material-file-info">
                  <h3 title={f.name}>{f.name}</h3>
                  <p>
                    {materialSize(f.bytes)} ·{" "}
                    {new Date(f.createdAt).toLocaleDateString("zh-CN")}
                  </p>
                  {section === "public" && <p>上传人：{f.authorName}</p>}
                  <div className="material-file-actions">
                    {!trash && (
                      <a href={fileUrl(f.id, true)}>
                        <Download size={15} />
                        下载
                      </a>
                    )}
                    {!trash && f.canManage && editable && (
                      <button
                        aria-label={`重命名 ${f.name}`}
                        onClick={() =>
                          setEdit({
                            kind: "file",
                            id: f.id,
                            name: f.name,
                            revision: f.revision,
                          })
                        }
                      >
                        <Pencil size={15} />
                      </button>
                    )}
                    {f.canManage && (trash ? editable : deletable) && (
                      <button
                        disabled={remove.isPending}
                        aria-label={
                          trash ? `恢复 ${f.name}` : `移入回收站 ${f.name}`
                        }
                        onClick={async () => {
                          try {
                            await remove.mutateAsync({
                              id: f.id,
                              revision: f.revision,
                              restore: trash,
                            });
                            toast.success(
                              trash ? "已恢复素材" : "已移入回收站，可随时恢复"
                            );
                            await refresh();
                          } catch (e) {
                            toast.error(errorText(e));
                          }
                        }}
                      >
                        {trash ? (
                          <>
                            <RotateCcw size={15} />
                            恢复
                          </>
                        ) : (
                          <Trash2 size={15} />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {!files.isLoading && !files.error && !files.data?.items.length && (
            <div className="material-empty">
              <FileImage size={44} />
              <h3>
                {trash ? "回收站为空" : query ? "没有找到素材" : "还没有素材"}
              </h3>
              <p>
                {trash
                  ? "删除的素材会保留在这里，方便找回。"
                  : "上传文件，或在生图结果下点击“保存到素材库”。"}
              </p>
            </div>
          )}
          {(offset > 0 || files.data?.hasMore) && (
            <div className="material-pagination">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(n => Math.max(0, n - 40))}
              >
                上一页
              </button>
              <span>第 {offset / 40 + 1} 页</span>
              <button
                disabled={!files.data?.hasMore}
                onClick={() => setOffset(n => n + 40)}
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
      <Dialog
        open={!!edit}
        onOpenChange={open => {
          if (!open) setEdit(null);
        }}
      >
        <DialogContent className="material-dialog">
          <DialogHeader>
            <DialogTitle>
              {edit?.kind === "project" ? "项目名称" : "素材名称"}
            </DialogTitle>
            <DialogDescription>
              {edit?.kind === "project"
                ? "为产品或作图需求创建独立的素材空间。"
                : "修改名称不会改变文件内容。"}
            </DialogDescription>
          </DialogHeader>
          <input
            aria-label="名称"
            value={edit?.name || ""}
            onChange={e =>
              setEdit(v => (v ? { ...v, name: e.target.value } : v))
            }
            maxLength={180}
          />
          <button
            className="material-primary"
            disabled={
              !edit?.name.trim() || create.isPending || rename.isPending
            }
            onClick={async () => {
              if (!edit) return;
              try {
                if (edit.kind === "project")
                  await create.mutateAsync({ id: edit.id, name: edit.name });
                else
                  await rename.mutateAsync({
                    id: edit.id,
                    name: edit.name,
                    revision: edit.revision!,
                  });
                await refresh();
                setEdit(null);
                toast.success("已保存");
              } catch (e) {
                toast.error(errorText(e));
              }
            }}
          >
            保存
          </button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!preview}
        onOpenChange={open => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent className="material-preview">
          <DialogHeader>
            <DialogTitle>{preview?.name}</DialogTitle>
            <DialogDescription>素材预览</DialogDescription>
          </DialogHeader>
          {preview && (
            <>
              <img src={fileUrl(preview.id)} alt={preview.name} />
              <a className="material-primary" href={fileUrl(preview.id, true)}>
                <Download size={16} />
                下载原图
              </a>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
