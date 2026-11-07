import { lazy, Suspense, useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PICK_PACKAGING,
  PICK_QUOTE_TERMS,
  type PickPatent,
  type PickSheetData,
} from "@shared/productSelection";

type Suppliers = PickSheetData["suppliers"];
type PublicPatent = Omit<PickPatent, "storageUri">;
const PdfReportPreview = lazy(() => import("./PdfReportPreview"));

export function SelectionSuppliers({
  value,
  onChange,
  disabled,
}: {
  value: Suppliers;
  onChange: (value: Suppliers) => void;
  disabled: boolean;
}) {
  const fields = [
    ["specification", "产品规格", 200],
    ["configuration", "产品配置", 400],
    ["supplier", "厂家名称", 200],
  ] as const;
  const selectClass = "h-9 w-full rounded-md border bg-background px-2";
  return (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">国内现货情况</h2>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        供货情况
        <select
          className="h-9 rounded-md border bg-background px-2"
          disabled={disabled}
          value={value.availability ?? ""}
          onChange={e =>
            onChange({
              ...value,
              availability: (e.target.value ||
                null) as Suppliers["availability"],
            })
          }
        >
          <option value="">待填写</option>
          <option value="in_stock">有现货</option>
          <option value="unavailable">无现货</option>
        </select>
      </label>
      {value.availability === "in_stock" && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[950px] text-sm">
              <thead>
                <tr>
                  {[
                    ...fields.map(([, label]) => label),
                    "厂家报价（CNY）",
                    "报价标签",
                    "包装",
                    "操作",
                  ].map(label => (
                    <th key={label} className="bg-muted p-2 text-left">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {value.quotes.map((quote, index) => {
                  const edit = <K extends keyof typeof quote>(
                    key: K,
                    field: (typeof quote)[K]
                  ) =>
                    onChange({
                      ...value,
                      quotes: value.quotes.map(item =>
                        item.id === quote.id ? { ...item, [key]: field } : item
                      ),
                    });
                  return (
                    <tr className="border-b" key={quote.id}>
                      {fields.map(([key, label, max]) => (
                        <td key={key} className="p-1">
                          <Input
                            aria-label={label + " " + (index + 1)}
                            disabled={disabled}
                            maxLength={max}
                            value={quote[key]}
                            onChange={e => edit(key, e.target.value)}
                          />
                        </td>
                      ))}
                      <td className="p-1">
                        <Input
                          aria-label={"厂家报价 " + (index + 1)}
                          type="number"
                          min={0}
                          step="any"
                          disabled={disabled}
                          value={quote.price ?? ""}
                          onChange={e =>
                            edit(
                              "price",
                              e.target.value === ""
                                ? null
                                : e.target.valueAsNumber
                            )
                          }
                        />
                      </td>
                      <td className="p-1">
                        <select
                          aria-label={"报价标签 " + (index + 1)}
                          className={selectClass}
                          disabled={disabled}
                          value={quote.terms}
                          onChange={e =>
                            edit("terms", e.target.value as typeof quote.terms)
                          }
                        >
                          {PICK_QUOTE_TERMS.map(option => (
                            <option key={option}>{option}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-1">
                        <select
                          aria-label={"包装 " + (index + 1)}
                          className={selectClass}
                          disabled={disabled}
                          value={quote.packaging}
                          onChange={e =>
                            edit(
                              "packaging",
                              e.target.value as typeof quote.packaging
                            )
                          }
                        >
                          {PICK_PACKAGING.map(option => (
                            <option key={option}>{option}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-1">
                        {!disabled && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              onChange({
                                ...value,
                                quotes: value.quotes.filter(
                                  item => item.id !== quote.id
                                ),
                              })
                            }
                          >
                            移除
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!value.quotes.length && (
                  <tr>
                    <td colSpan={7} className="p-3 text-muted-foreground">
                      暂无厂家报价
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {!disabled && (
            <Button
              variant="outline"
              disabled={value.quotes.length >= 100}
              onClick={() =>
                onChange({
                  ...value,
                  quotes: [
                    ...value.quotes,
                    {
                      id: crypto.randomUUID(),
                      specification: "",
                      configuration: "",
                      supplier: "",
                      price: null,
                      terms: "含税含运",
                      packaging: "无包装",
                    },
                  ],
                })
              }
            >
              新增厂家报价
            </Button>
          )}
        </>
      )}
      {value.availability === "unavailable" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["estimatedPrice", "预估单价（CNY）"],
              ["moldCost", "预估开模费（CNY）"],
            ] as const
          ).map(([field, label]) => (
            <label className="grid gap-1 text-sm" key={field}>
              {label}
              <Input
                type="number"
                min={0}
                step="any"
                disabled={disabled}
                value={value[field] ?? ""}
                onChange={e =>
                  onChange({
                    ...value,
                    [field]:
                      e.target.value === "" ? null : e.target.valueAsNumber,
                  })
                }
              />
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

function PatentPreview({
  sheetId,
  report,
  onClose,
}: {
  sheetId: string;
  report: PublicPatent;
  onClose: () => void;
}) {
  const preview = trpc.productSelection.previewPatent.useQuery(
    { id: sheetId, reportId: report.id },
    { refetchOnWindowFocus: false, staleTime: 0, gcTime: 0 }
  );
  const body = useMemo(
    () =>
      preview.data?.kind === "word"
        ? DOMPurify.sanitize(preview.data.html, {
            ALLOWED_TAGS: [
              "h1",
              "h2",
              "h3",
              "h4",
              "h5",
              "h6",
              "p",
              "br",
              "b",
              "strong",
              "em",
              "i",
              "u",
              "s",
              "sup",
              "sub",
              "blockquote",
              "ol",
              "ul",
              "li",
              "table",
              "thead",
              "tbody",
              "tr",
              "td",
              "th",
              "img",
            ],
            ALLOWED_ATTR: ["src", "alt", "colspan", "rowspan"],
            ALLOWED_URI_REGEXP: /^data:image\/(?:png|jpe?g|gif|webp);base64,/i,
            ALLOW_DATA_ATTR: false,
          })
        : "",
    [preview.data]
  );
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[92vh] max-w-5xl flex-col">
        <DialogHeader>
          <DialogTitle>{report.name}</DialogTitle>
          <DialogDescription>专利分析报告在线预览</DialogDescription>
        </DialogHeader>
        {preview.isPending && <p className="p-3 text-sm">正在打开报告…</p>}
        {preview.error && (
          <div>
            <p className="text-sm">{preview.error.message}</p>
            <Button variant="outline" onClick={() => void preview.refetch()}>
              重试
            </Button>
          </div>
        )}
        {preview.data?.kind === "local-pdf" && (
          <Suspense fallback={<p className="p-3 text-sm">正在加载 PDF 预览…</p>}>
            <PdfReportPreview base64={preview.data.base64} />
          </Suspense>
        )}
        {preview.data?.kind === "pdf" && (
          <iframe
            title={report.name}
            src={preview.data.url}
            referrerPolicy="no-referrer"
            className="h-[70vh] w-full rounded-md border"
          />
        )}
        {preview.data?.kind === "word" && (
          <article
            className="max-h-[70vh] overflow-y-auto rounded-md border p-5 [&_h1]:text-xl [&_h2]:text-lg [&_p]:mb-2 [&_table]:w-full [&_td]:border [&_td]:p-2 [&_li]:ml-4 [&_li]:list-disc"
            dangerouslySetInnerHTML={{
              __html: body || "<p>此文件没有可预览的正文。</p>",
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function SelectionPatents({
  sheetId,
  reports,
  disabled,
  onUpload,
}: {
  sheetId: string;
  reports: PublicPatent[];
  disabled: boolean;
  onUpload: (file: File) => Promise<void>;
}) {
  const [selected, setSelected] = useState<PublicPatent | null>(null);
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-lg font-semibold">产品专利分析</h2>
      {!disabled && (
        <label className="grid max-w-sm gap-1 text-sm">
          上传专利分析报告（PDF 或 Word .docx）
          <Input
            type="file"
            accept=".pdf,.docx"
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void onUpload(file);
            }}
          />
        </label>
      )}
      {reports.length ? (
        <div className="grid gap-2">
          {reports.map(report => (
            <div
              key={report.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm"
            >
              <Button
                variant="ghost"
                className="max-w-full truncate"
                onClick={() => setSelected(report)}
              >
                {report.name} · 查看
              </Button>
              <span className="text-muted-foreground">
                {new Date(report.uploadedAt).toLocaleDateString("zh-CN")}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">尚未上传报告</p>
      )}
      {selected && (
        <PatentPreview
          sheetId={sheetId}
          report={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
