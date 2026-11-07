import { useState } from "react";
import { useLocation } from "wouter";
import {
  Package,
  Store,
  Download,
  ExternalLink,
  Pencil,
  Link2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { RESEARCH_STATES } from "@shared/researchLibrary";
import { toast } from "sonner";
const field = "rounded-lg border bg-background px-3 py-2 text-sm";
function Collection({
  kind,
  ownerId,
}: {
  kind: "product" | "store";
  ownerId?: number;
}) {
  const [query, setQuery] = useState(""),
    [state, setState] = useState<string>(""),
    [page, setPage] = useState(1),
    [edit, setEdit] = useState<{
      id: string;
      note: string;
      state: keyof typeof RESEARCH_STATES;
      title: string;
      revision: number;
    } | null>(null);
  const result = trpc.researchLibrary.list.useQuery({
      kind,
      query,
      ownerId,
      page,
      state: (state || undefined) as keyof typeof RESEARCH_STATES | undefined,
    }),
    update = trpc.researchLibrary.update.useMutation(),
    createSelection = trpc.productSelection.create.useMutation(),
    utils = trpc.useUtils();
  const [, navigate] = useLocation();
  return (
    <section className="space-y-5 rounded-2xl border bg-background p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-primary/10 p-3 text-primary">
            {kind === "product" ? (
              <Package className="h-5 w-5" />
            ) : (
              <Store className="h-5 w-5" />
            )}
          </span>
          <div>
            <h2 className="text-lg font-semibold">
              {kind === "product" ? "待调研产品" : "有价值的店铺"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {result.data?.total || 0}条收藏 ·{" "}
              {kind === "product"
                ? "保留发现产品的来源、收藏人和调研记录"
                : "积累值得持续关注的品牌与卖家店铺"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <input
            aria-label={kind === "product" ? "搜索待调研产品" : "搜索收藏店铺"}
            className={field + " w-64"}
            placeholder="搜索ASIN、名称、品牌或备注"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
          <select
            aria-label={`${kind==="product"?"产品":"店铺"}调研状态筛选`}
            className={field}
            value={state}
            onChange={e => {
              setState(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部状态</option>
            {Object.entries(RESEARCH_STATES).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {result.error ? (
        <p role="alert" className="rounded-xl bg-muted p-5">
          收藏暂时无法读取，请检查当前账号权限后重试。
          <Button variant="link" onClick={() => void result.refetch()}>
            重试
          </Button>
        </p>
      ) : result.isLoading ? (
        <p className="p-8 text-muted-foreground">正在读取收藏…</p>
      ) : !result.data?.items.length ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-sm text-muted-foreground">
          {query || state
            ? "没有符合筛选条件的收藏"
            : kind === "product"
              ? "安装收藏插件后，在亚马逊商品标题旁点击“加入产品库”。"
              : "浏览亚马逊店铺页面时，点击“收藏该店铺”。"}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {result.data.items.map(item => (
            <article
              key={item.id}
              className="flex flex-col rounded-xl border p-4 transition-shadow hover:shadow-md"
            >
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="flex gap-4"
              >
                {item.thumbnail ? (
                  <img
                    src={item.thumbnail}
                    alt={item.title}
                    className="h-28 w-28 shrink-0 rounded-lg bg-white object-contain"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    {kind === "product" ? <Package /> : <Store />}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="line-clamp-3 text-sm font-medium leading-6">
                    {item.title}
                  </p>
                  {item.asin && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {item.asin}
                    </p>
                  )}
                  {item.price && (
                    <p className="mt-1 text-sm font-semibold">{item.price}</p>
                  )}
                </div>
              </a>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-muted px-2 py-1">
                  {item.site.replace("amazon.", "").toUpperCase()}
                </span>
                <span
                  className={`rounded-full px-2 py-1 ${item.state === "valuable" ? "bg-emerald-50 text-emerald-800" : "bg-blue-50 text-blue-800"}`}
                >
                  {RESEARCH_STATES[item.state]}
                </span>
                <span className="ml-auto text-muted-foreground">
                  {item.collector}
                </span>
              </div>
              {item.note && (
                <p className="mt-3 line-clamp-3 whitespace-pre-wrap rounded-lg bg-muted/30 p-3 text-xs leading-5">
                  {item.note}
                </p>
              )}
              <div className="mt-auto flex items-center justify-between pt-4">
                <span className="text-xs text-muted-foreground">
                  {new Date(item.createdAt).toLocaleDateString("zh-CN")}
                </span>
                <div className="flex gap-1">
                  {kind === "product" ? <Button size="sm" variant="outline" disabled={createSelection.isPending} onClick={() => {
                    createSelection.mutate({ bookmarkId: item.id }, {
                      onSuccess: sheet => navigate("/dev/selection/" + sheet.id),
                      onError: error => toast.error(error.message),
                    });
                  }}>创建选品表</Button> : <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setEdit({
                        id: item.id,
                        note: item.note,
                        state: item.state,
                        title: item.title,
                        revision: item.revision,
                      })
                    }
                  >
                    <Pencil className="mr-1 h-3 w-3" />
                    记录
                  </Button>}
                  <Button size="sm" variant="ghost" asChild>
                    <a href={item.url} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-1 h-3 w-3" />
                      来源
                    </a>
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {(result.data?.total || 0) > 24 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <span className="text-xs">第{page}页</span>
          <Button
            variant="outline"
            disabled={page * 24 >= (result.data?.total || 0)}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}
      {edit && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open) setEdit(null);
          }}
        >
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>调研记录</DialogTitle>
            <p className="text-sm text-muted-foreground">{edit.title}</p>
            <select
              aria-label="调研进度"
              className={field}
              value={edit.state}
              onChange={e =>
                setEdit({
                  ...edit,
                  state: e.target.value as keyof typeof RESEARCH_STATES,
                })
              }
            >
              {Object.entries(RESEARCH_STATES).map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
            <textarea
              aria-label="调研备注"
              maxLength={4000}
              className={field + " min-h-40"}
              value={edit.note}
              onChange={e => setEdit({ ...edit, note: e.target.value })}
            />
            <Button
              disabled={update.isPending}
              onClick={async () => {
                try {
                  await update.mutateAsync({
                    id: edit.id,
                    note: edit.note,
                    state: edit.state,
                    revision: edit.revision,
                  });
                  await utils.researchLibrary.list.invalidate();
                  setEdit(null);
                  toast.success("调研记录已保存");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "暂未保存");
                }
              }}
            >
              保存记录
            </Button>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
export default function ResearchLibrary() {
  const collectors = trpc.researchLibrary.collectors.useQuery(),
    sessions = trpc.researchLibrary.extensionSessions.useQuery(),
    revoke = trpc.researchLibrary.revokeExtension.useMutation(),
    utils = trpc.useUtils();
  const [ownerId, setOwnerId] = useState<number | undefined>(),
    [instructions, setInstructions] = useState(false),
    [connections, setConnections] = useState(false);
  const overview = trpc.researchLibrary.list.useQuery({
    kind: "product",
    query: "",
    page: 1,
  });
  return (
    <main className="mx-auto max-w-[1700px] space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">待调研产品库</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            收集值得研究的产品与店铺，留下发现它们的理由。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setConnections(true)}>
            <Link2 className="mr-2 h-4 w-4" />
            我的插件连接
          </Button>
          <Button variant="outline" onClick={() => setInstructions(true)}>
            安装说明
          </Button>
          <Button asChild>
            <a href="/downloads/research-collector.zip" download>
              <Download className="mr-2 h-4 w-4" />
              下载浏览器插件
            </a>
          </Button>
        </div>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 p-4">
        <p className="text-sm text-muted-foreground">
          {overview.data?.canSeeAll
            ? "当前可查看工作区所有人的收藏，支持按收集人筛选。"
            : "当前展示你自己收集的产品与店铺。"}
        </p>
        {overview.data?.canSeeAll && (
          <select
            aria-label="按收集人筛选"
            className={field}
            value={ownerId || ""}
            onChange={e =>
              setOwnerId(e.target.value ? Number(e.target.value) : undefined)
            }
          >
            <option value="">所有收集人</option>
            {collectors.data?.map(c => (
              <option key={Number(c.id)} value={Number(c.id)}>
                {String(c.name || "未命名用户")}
              </option>
            ))}
          </select>
        )}
      </div>
      <Collection
        key={`product:${ownerId || 0}`}
        kind="product"
        ownerId={ownerId}
      />
      <Collection
        key={`store:${ownerId || 0}`}
        kind="store"
        ownerId={ownerId}
      />
      {instructions && (
        <Dialog open onOpenChange={setInstructions}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>安装收藏插件 · Chrome / Edge</DialogTitle>
            <ol className="list-decimal space-y-3 pl-5 text-sm leading-6">
              <li>下载插件压缩包，解压到一个固定文件夹。</li>
              <li>
                打开浏览器的扩展管理页：Chrome使用 chrome://extensions，Edge使用
                edge://extensions。
              </li>
              <li>
                打开“开发者模式”，选择“加载已解压的扩展”，选中刚解压的文件夹。
              </li>
              <li>
                点击浏览器工具栏中的“星启产品收藏”，再点“登录系统账号”。在插件弹出的对话框登录，登录保留30天。更新旧插件后请重新加载扩展。
              </li>
              <li>
                浏览亚马逊商品或店铺，点击页面上的收藏按钮。收藏会归到当前登录人名下。
              </li>
            </ol>
            <p className="text-xs text-muted-foreground">
              插件文件夹需要保留。插件只处理你主动收藏的商品和店铺，登录连接可在“我的插件连接”中解除。
            </p>
          </DialogContent>
        </Dialog>
      )}
      {connections && (
        <Dialog open onOpenChange={setConnections}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>我的插件连接</DialogTitle>
            {sessions.data?.length ? (
              sessions.data.map(s => (
                <div
                  key={String(s.id)}
                  className="flex items-center justify-between gap-4 rounded-xl border p-3"
                >
                  <div>
                    <p className="text-sm">{String(s.browser_name)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      有效至{" "}
                      {new Date(String(s.expires_at)).toLocaleDateString(
                        "zh-CN"
                      )}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={async () => {
                      await revoke.mutateAsync({ id: String(s.id) });
                      await utils.researchLibrary.extensionSessions.invalidate();
                      toast.success("已解除该插件连接");
                    }}
                  >
                    解除连接
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                暂无已连接的收藏插件。
              </p>
            )}
          </DialogContent>
        </Dialog>
      )}
    </main>
  );
}
