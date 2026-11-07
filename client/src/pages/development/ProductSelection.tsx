import { useEffect, useRef, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { Link } from "wouter";
import { ArrowLeft, Lock, LockOpen } from "lucide-react";
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
import {
  PICK_FILE_BYTES,
  PICK_REVIEW_LABELS,
  PICK_STATUS_LABELS,
  pickDetailsSchema,
  pickReview,
  pickStatus,
  type PickReview,
  type PickStatus,
  type PickSheetData,
} from "@shared/productSelection";
import { pickAnalysis, type PickRow } from "@shared/productSelectionAnalysis";
import { calculatePickProfit } from "@shared/productSelectionProfit";
import { SelectionCompetitors } from "./SelectionCompetitors";
import { fmt, percent, SelectionProfit } from "./SelectionProfit";
import { SelectionPatents, SelectionSuppliers } from "./SelectionSupply";
import {
  EditSelectionRowTags,
  SelectionAutoTags,
  SelectionTagSettings,
} from "./SelectionTags";

const exchangeOptions = { staleTime: 3600000, retry: false };
const dateToday = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
type Details = Pick<
  PickSheetData,
  "nameZh" | "nameEn" | "notes" | "suppliers" | "profit"
>;
type UploadKind = "snapshot" | "history";
type Modal =
  | { kind: "tag-settings" | "auto-tags" | "review" | "submit" }
  | { kind: "tags" | "sales"; row: PickRow };

async function encodeFile(file: File) {
  if (file.size > PICK_FILE_BYTES) throw new Error("单份文件最大 8 MB");
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("无法读取文件，请重新选择"));
    reader.readAsDataURL(file);
  });
  return { name: file.name, base64 };
}
function message(error: unknown) {
  return error instanceof Error ? error.message : "操作暂未完成，请重试";
}

export default function ProductSelection({ id }: { id?: string }) {
  return id ? <SelectionDetail key={id} id={id} /> : <SelectionList />;
}

function SelectionList() {
  const [status, setStatus] = useState<PickStatus>("draft");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const list = trpc.productSelection.list.useQuery({ status, page, query });
  const fx = trpc.productSelection.exchange.useQuery(
    undefined,
    exchangeOptions
  );
  return (
    <main className="space-y-4 p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">选品表</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            按产品查看竞品市场量、单件利润和审核进度。
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dev/library">前往待调研产品库创建</Link>
        </Button>
      </header>
      <div className="flex flex-wrap gap-2">
        {pickStatus.map(key => (
          <Button
            key={key}
            variant={status === key ? "default" : "outline"}
            onClick={() => {
              setStatus(key);
              setPage(1);
            }}
          >
            {PICK_STATUS_LABELS[key]}
          </Button>
        ))}
        <Input
          className="w-64"
          placeholder="搜索产品中英文名"
          maxLength={200}
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
      </div>
      {list.isPending && (
        <p className="text-sm text-muted-foreground">正在读取选品表…</p>
      )}
      {list.error && (
        <p className="text-sm text-destructive">{list.error.message}</p>
      )}
      {list.data && !list.data.items.length && (
        <p className="rounded-xl border p-6 text-sm text-muted-foreground">
          当前状态下暂无选品表。
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.data?.items.map(item => {
          const profit =
            item.site === "amazon.com"
              ? calculatePickProfit(item.profit, fx.data?.rate ?? null)
              : null;
          return (
            <Link
              key={item.id}
              href={"/dev/selection/" + item.id}
              className="block rounded-xl border bg-card p-4 hover:border-primary focus-visible:ring"
            >
              <h2 className="line-clamp-2 font-semibold">
                {item.nameZh || item.nameEn || item.sourceTitle}
              </h2>
              {item.nameZh && item.nameEn && (
                <p className="line-clamp-1 text-sm text-muted-foreground">
                  {item.nameEn}
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                {item.creator} · {item.site} ·{" "}
                {new Date(item.updatedAt).toLocaleDateString("zh-CN")}
                {item.outcome ? " · " + PICK_REVIEW_LABELS[item.outcome] : ""}
              </p>
              <dl className="mt-3 grid gap-2 border-t pt-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">导入样本父体月销量</dt>
                  <dd>
                    {fmt(item.marketUnits)}
                    {item.marketUnits !== null ? " 件" : ""} · 已知{" "}
                    {item.marketKnown} / {item.marketKnown + item.marketMissing}{" "}
                    个父体
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">
                    预计单件利润 · 普通 / 旺季
                  </dt>
                  <dd>
                    {profit?.ordinary.cny == null
                      ? "待测算"
                      : "¥" +
                        fmt(profit.ordinary.cny, 2) +
                        " / ¥" +
                        fmt(profit.peak.cny, 2) +
                        "（" +
                        percent(profit.ordinary.margin) +
                        " / " +
                        percent(profit.peak.margin) +
                        "）"}
                  </dd>
                </div>
              </dl>
            </Link>
          );
        })}
      </div>
      {(list.data?.total ?? 0) > 24 && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <span className="self-center text-sm">第 {page} 页</span>
          <Button
            variant="outline"
            disabled={page * 24 >= (list.data?.total ?? 0)}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </main>
  );
}

function SelectionDetail({ id }: { id: string }) {
  const query = trpc.productSelection.get.useQuery(
    { id },
    { refetchOnWindowFocus: false }
  );
  if (query.isPending)
    return <p className="p-6 text-sm text-muted-foreground">正在读取选品表…</p>;
  if (!query.data)
    return (
      <div className="space-y-3 p-6">
        <p>{query.error?.message ?? "无法读取选品表"}</p>
        <Button asChild variant="outline">
          <Link href="/dev/selection">返回选品表</Link>
        </Button>
      </div>
    );
  return (
    <SelectionDetailForm
      sheet={query.data}
      reload={() => query.refetch({ throwOnError: true })}
    />
  );
}

type Detail = inferRouterOutputs<AppRouter>["productSelection"]["get"];
function SelectionDetailForm({
  sheet,
  reload,
}: {
  sheet: Detail;
  reload: () => Promise<unknown>;
}) {
  const { data, id, revision } = sheet;
  const [draft, setDraft] = useState<Details>(() =>
    pickDetailsSchema.parse(data)
  );
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const autoNames = useRef<Promise<Pick<Details, "nameZh" | "nameEn">> | null>(
    null
  );
  const [modal, setModal] = useState<Modal | null>(null);
  const [review, setReview] = useState<PickReview>("approve");
  const [reviewNotes, setReviewNotes] = useState("");
  const [sales, setSales] = useState("");
  const [nameGuidance, setNameGuidance] = useState("");
  const [nameProposal, setNameProposal] = useState<Pick<
    Details,
    "nameZh" | "nameEn"
  > | null>(null);
  const [nameDialog, setNameDialog] = useState(false);
  const [nameLoading, setNameLoading] = useState(false);
  const latest = useRef({ draft, revision, busy, status: sheet.status });
  latest.current = { draft, revision, busy, status: sheet.status };
  const utils = trpc.useUtils();
  const fx = trpc.productSelection.exchange.useQuery(
    undefined,
    exchangeOptions
  );
  const saveDetails = trpc.productSelection.details.useMutation();
  const importExcel = trpc.productSelection.importExcel.useMutation();
  const editSales = trpc.productSelection.editSales.useMutation();
  const editTags = trpc.productSelection.editTags.useMutation();
  const saveTags = trpc.productSelection.tagSettings.useMutation();
  const submit = trpc.productSelection.submit.useMutation();
  const audit = trpc.productSelection.review.useMutation();
  const patent = trpc.productSelection.uploadPatent.useMutation();
  const generateNames = trpc.productSelection.generateNames.useMutation();
  const saved = pickDetailsSchema.parse(data);
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const canEdit = sheet.status === "draft";
  const analysis = pickAnalysis(data, dateToday());
  const ref = { id, revision };
  const close = () => setModal(null);
  const set = <K extends keyof Details>(key: K, value: Details[K]) =>
    setDraft(old => ({ ...old, [key]: value }));

  async function run(action: () => Promise<unknown>, success?: string) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    try {
      await action();
      await reload();
      await utils.productSelection.list.invalidate();
      if (success) toast.success(success);
      return true;
    } catch (error) {
      toast.error(message(error));
      return false;
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }

  useEffect(() => {
    if (!canEdit || (data.nameZh && data.nameEn)) return;
    let active = true;
    const original = JSON.stringify(draft);
    autoNames.current ??= generateNames.mutateAsync({ ...ref, guidance: "" });
    void autoNames.current
      .then(names => {
        const current = latest.current;
        if (!active || current.status !== "draft") return;
        if (
          lock.current ||
          current.revision !== revision ||
          JSON.stringify(current.draft) !== original
        ) {
          setNameProposal(names);
          return;
        }
        const details = { ...current.draft, ...names };
        setDraft(details);
        void run(() => saveDetails.mutateAsync({ ...ref, details }));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // Generate once for a newly opened draft. Later changes are explicit.
  }, [id]);

  useEffect(() => {
    if (!changed) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed]);

  async function namePreview() {
    setNameLoading(true);
    try {
      setNameProposal(
        await generateNames.mutateAsync({ ...ref, guidance: nameGuidance })
      );
    } catch (error) {
      toast.error(message(error));
    } finally {
      setNameLoading(false);
    }
  }
  function save() {
    const parsed = pickDetailsSchema.safeParse(draft);
    if (!parsed.success) {
      toast.error(
        "请检查产品信息、报价和利润参数。包装尺寸、重量和手动汇率需大于 0，费率需在 0–100% 内。"
      );
      return;
    }
    void run(
      () => saveDetails.mutateAsync({ ...ref, details: parsed.data }),
      "选品表已保存"
    ).then(ok => {
      if (ok) setDraft(parsed.data);
    });
  }
  function upload(kind: UploadKind, file: File) {
    void run(
      async () =>
        importExcel.mutateAsync({ ...ref, kind, file: await encodeFile(file) }),
      "已导入 " + (kind === "snapshot" ? "竞品搜索表" : "历史月销量表")
    );
  }

  return (
    <main className="min-w-0 space-y-4 p-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <Button asChild variant="ghost" size="sm">
            <Link href="/dev/selection">
              <ArrowLeft className="size-4" />
              选品表
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold">
            {saved.nameZh || saved.nameEn || sheet.sourceTitle}
          </h1>
          {saved.nameZh && saved.nameEn && (
            <p className="text-sm text-muted-foreground">{saved.nameEn}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm">
            {canEdit ? (
              <LockOpen className="size-4" />
            ) : (
              <Lock className="size-4" />
            )}
            {canEdit ? "已解锁，可编辑" : "已锁定，仅浏览"}
          </span>
          {canEdit && (
            <Button disabled={busy || !changed} onClick={save}>
              {busy ? "处理中…" : "保存选品表"}
            </Button>
          )}
        </div>
      </header>
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            产品名称（中文）
            <Input
              disabled={!canEdit || busy}
              maxLength={200}
              value={draft.nameZh}
              onChange={e => set("nameZh", e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            产品名称（英文）
            <Input
              disabled={!canEdit || busy}
              maxLength={300}
              value={draft.nameEn}
              onChange={e => set("nameEn", e.target.value)}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>选品人员 {sheet.creator}</span>
          <span className="rounded-full bg-muted px-2 py-1">
            {PICK_STATUS_LABELS[sheet.status]}
          </span>
          <span>
            审核结果{" "}
            {sheet.outcome ? PICK_REVIEW_LABELS[sheet.outcome] : "未审核"}
          </span>
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setNameDialog(true)}
            >
              {nameProposal ? "查看 AI 命名建议" : "AI 生成中英文名"}
            </Button>
          )}
        </div>
        {sheet.reviewNotes && (
          <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">
            审核备注 · {sheet.reviewNotes}
          </p>
        )}
        <label className="grid gap-1 text-sm">
          产品备注
          <Textarea
            disabled={!canEdit || busy}
            maxLength={4000}
            value={draft.notes}
            onChange={e => set("notes", e.target.value)}
          />
        </label>
      </section>
      <SelectionCompetitors
        analysis={analysis}
        tags={data.tags}
        editable={canEdit && !busy}
        onEditTags={row => setModal({ kind: "tags", row })}
        onEditSales={row => {
          setSales(row.manualSales ? String(row.childSales) : "");
          setModal({ kind: "sales", row });
        }}
        toolbar={
          <>
            <div className="grid gap-3 md:grid-cols-2">
              {(
                [
                  ["snapshot", "竞品搜索结果表"],
                  ["history", "历史月销量表"],
                ] as const
              ).map(([kind, label]) => (
                <div
                  className="space-y-1 rounded-lg border p-2 text-sm"
                  key={kind}
                >
                  <label className="grid gap-1">
                    {label}（.xlsx）
                    {canEdit && (
                      <Input
                        type="file"
                        accept=".xlsx"
                        disabled={busy}
                        onChange={e => {
                          const file = e.currentTarget.files?.[0];
                          e.currentTarget.value = "";
                          if (file) upload(kind, file);
                        }}
                      />
                    )}
                  </label>
                  <p className="break-all text-xs text-muted-foreground">
                    {data.imported[kind]
                      ? data.imported[kind].name +
                        " · " +
                        data.imported[kind].count +
                        " 条"
                      : "尚未导入"}
                  </p>
                </div>
              ))}
            </div>
            {data.imported.snapshot && data.imported.history && (
              <p className="text-sm text-muted-foreground">
                历史销量匹配 {analysis.matchedChildren} / {analysis.rows.length}{" "}
                个子 ASIN。
                {analysis.conflictingParents
                  ? "有 " +
                    analysis.conflictingParents +
                    " 条父体关系冲突，已排除。"
                  : ""}
              </p>
            )}
            {canEdit && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setModal({ kind: "tag-settings" })}
                >
                  设置标签
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !analysis.rows.length || !data.tags.length}
                  onClick={() => setModal({ kind: "auto-tags" })}
                >
                  一键打标
                </Button>
              </div>
            )}
          </>
        }
      />
      <SelectionPatents
        sheetId={id}
        reports={data.patents}
        disabled={!canEdit || busy}
        onUpload={async file => {
          await run(
            async () =>
              patent.mutateAsync({ ...ref, file: await encodeFile(file) }),
            "专利报告已上传"
          );
        }}
      />
      <SelectionSuppliers
        value={draft.suppliers}
        disabled={!canEdit || busy}
        onChange={value => set("suppliers", value)}
      />
      <SelectionProfit
        site={sheet.site}
        value={draft.profit}
        disabled={!canEdit || busy}
        onChange={value => set("profit", value)}
        fx={fx.data}
      />
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold">选品审核</h2>
        {canEdit && (
          <Button
            disabled={
              busy ||
              changed ||
              !data.imported.snapshot ||
              !data.imported.history
            }
            onClick={() => setModal({ kind: "submit" })}
          >
            提交审核
          </Button>
        )}
        {canEdit && changed && (
          <p className="text-sm text-muted-foreground">
            请先保存表单修改，再提交审核。
          </p>
        )}
        {canEdit && (!data.imported.snapshot || !data.imported.history) && (
          <p className="text-sm text-muted-foreground">
            导入两份竞品数据后可提交审核。
          </p>
        )}
        {sheet.status === "pending" && sheet.canReview && (
          <Button
            disabled={busy}
            onClick={() => {
              setReview("approve");
              setReviewNotes("");
              setModal({ kind: "review" });
            }}
          >
            审核
          </Button>
        )}
        {sheet.events.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer">查看审核记录</summary>
            <ul className="mt-2 space-y-2">
              {sheet.events.map((event, i) => (
                <li key={i} className="rounded bg-muted p-2">
                  <strong>
                    {event.action === "submit"
                      ? "提交审核"
                      : PICK_REVIEW_LABELS[event.action]}
                  </strong>{" "}
                  · {event.actor} · {new Date(event.at).toLocaleString("zh-CN")}
                  {event.notes && (
                    <p className="mt-1 whitespace-pre-wrap">{event.notes}</p>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      {modal?.kind === "tag-settings" && (
        <SelectionTagSettings
          tags={data.tags}
          busy={busy}
          onClose={close}
          onTag={
            analysis.rows.length
              ? () => setModal({ kind: "auto-tags" })
              : undefined
          }
          onSave={tags =>
            run(() => saveTags.mutateAsync({ ...ref, tags }), "标签设置已保存")
          }
        />
      )}
      {modal?.kind === "tags" && (
        <EditSelectionRowTags
          row={modal.row}
          tags={data.tags}
          manual={data.manualTagAsins.includes(modal.row.asin)}
          busy={busy}
          onClose={close}
          onSave={(tags, allowAuto) =>
            run(
              () =>
                editTags.mutateAsync({
                  ...ref,
                  asin: modal.row.asin,
                  tags,
                  allowAuto,
                }),
              "标签已保存"
            )
          }
        />
      )}
      {modal?.kind === "auto-tags" && (
        <SelectionAutoTags
          rows={analysis.rows}
          tags={data.tags}
          manual={data.manualTagAsins}
          reference={ref}
          run={run}
          busy={busy}
          onClose={close}
        />
      )}
      {modal?.kind === "sales" && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open && !busy) close();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>补填子体销量 · {modal.row.asin}</DialogTitle>
              <DialogDescription>
                留空恢复导入值。填写 0 表示确认该子体销量为零。
              </DialogDescription>
            </DialogHeader>
            <Input
              type="number"
              min={0}
              step={1}
              aria-label="子体销量"
              placeholder={
                modal.row.childSales == null
                  ? "暂无销量"
                  : "导入值 " + modal.row.childSales
              }
              value={sales}
              onChange={e => setSales(e.target.value)}
            />
            <Button
              disabled={
                busy ||
                (sales !== "" &&
                  (!Number.isInteger(Number(sales)) ||
                    Number(sales) < 0 ||
                    Number(sales) > 100000000))
              }
              onClick={async () => {
                if (
                  await run(
                    () =>
                      editSales.mutateAsync({
                        ...ref,
                        asin: modal.row.asin,
                        sales: sales === "" ? null : Number(sales),
                      }),
                    "子体销量已保存"
                  )
                )
                  close();
              }}
            >
              保存销量
            </Button>
          </DialogContent>
        </Dialog>
      )}
      {modal?.kind === "submit" && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open && !busy) close();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>提交选品审核</DialogTitle>
              <DialogDescription>
                提交后进入待审核并锁定编辑。管理员可审核或退回补充。
              </DialogDescription>
            </DialogHeader>
            <Button
              disabled={busy}
              onClick={async () => {
                if (await run(() => submit.mutateAsync(ref), "已提交审核"))
                  close();
              }}
            >
              确认提交
            </Button>
          </DialogContent>
        </Dialog>
      )}
      {modal?.kind === "review" && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open && !busy) close();
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>审核选品表</DialogTitle>
              <DialogDescription>
                拒绝退回草稿补资料，PASS 表示淘汰，待定仍可继续审核。
              </DialogDescription>
            </DialogHeader>
            <label className="grid gap-1 text-sm">
              审核结果
              <select
                className="h-9 rounded-md border bg-background px-2"
                value={review}
                onChange={e => setReview(e.target.value as PickReview)}
              >
                {pickReview.map(key => (
                  <option value={key} key={key}>
                    {PICK_REVIEW_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              审核备注
              <Textarea
                maxLength={4000}
                value={reviewNotes}
                onChange={e => setReviewNotes(e.target.value)}
              />
            </label>
            <Button
              disabled={busy}
              onClick={async () => {
                if (
                  await run(
                    () =>
                      audit.mutateAsync({
                        ...ref,
                        action: review,
                        notes: reviewNotes,
                      }),
                    "审核结果已保存"
                  )
                )
                  close();
              }}
            >
              保存审核结果
            </Button>
          </DialogContent>
        </Dialog>
      )}
      {nameDialog && (
        <Dialog
          open
          onOpenChange={open => {
            if (!open && !nameLoading) setNameDialog(false);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>AI 生成中英文产品名</DialogTitle>
              <DialogDescription>
                根据来源标题提炼通用产品名，采用后仍可编辑。
              </DialogDescription>
            </DialogHeader>
            {nameProposal && (
              <div className="space-y-1 rounded-lg bg-muted p-3 text-sm">
                <p>{nameProposal.nameZh}</p>
                <p>{nameProposal.nameEn}</p>
              </div>
            )}
            <Textarea
              aria-label="命名调整意见"
              placeholder="可填写命名调整意见"
              maxLength={2000}
              value={nameGuidance}
              onChange={e => setNameGuidance(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={nameLoading}
                onClick={() => void namePreview()}
              >
                {nameLoading
                  ? "生成中…"
                  : nameProposal
                    ? "调整结果（AI）"
                    : "生成建议"}
              </Button>
              {nameProposal && (
                <Button
                  disabled={nameLoading}
                  onClick={() => {
                    setDraft({ ...draft, ...nameProposal });
                    setNameDialog(false);
                  }}
                >
                  采用名称
                </Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </main>
  );
}
