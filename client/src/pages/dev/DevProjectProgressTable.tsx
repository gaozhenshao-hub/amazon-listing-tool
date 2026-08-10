import { useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowRight,
  Check,
  Image as ImageIcon,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";

type ReviewStatus = "unreviewed" | "reviewing" | "approved" | "rejected";

export type DevProjectListRow = {
  id: number;
  name: string;
  description: string | null;
  targetMarket: string | null;
  createdAt: Date | string;
  status: string;
  phase: "market_analysis" | "project_execution" | null;
  approvedAt: Date | string | null;
  primaryCompetitorAsin: string | null;
  primaryCompetitorImageUrl: string | null;
  selectorName: string | null;
  developerNames: string[];
  operatorNames: string[];
  landingProgress: number;
  expectedLandingDate: string | null;
  reviewStatus: ReviewStatus;
  assistantName: string | null;
  sellingPrice: string | null;
  profit: string | null;
  profitMargin: string | null;
};

type EditableProgress = {
  primaryCompetitorAsin: string;
  selectorName: string;
  landingProgress: number;
  reviewStatus: ReviewStatus;
  assistantName: string;
};

const reviewLabels: Record<ReviewStatus, { label: string; className: string }> = {
  unreviewed: { label: "未审核", className: "bg-slate-100 text-slate-700" },
  reviewing: { label: "审核中", className: "bg-amber-100 text-amber-700" },
  approved: { label: "已通过", className: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "未通过", className: "bg-red-100 text-red-700" },
};

const statusLabels: Record<string, string> = {
  draft: "草稿",
  data_collection: "数据采集",
  analyzing: "分析中",
  scoring: "评分中",
  completed: "已完成",
  archived: "已归档",
};

function editableFromRow(row: DevProjectListRow): EditableProgress {
  return {
    primaryCompetitorAsin: row.primaryCompetitorAsin ?? "",
    selectorName: row.selectorName ?? "",
    landingProgress: row.landingProgress,
    reviewStatus: row.reviewStatus,
    assistantName: row.assistantName ?? "",
  };
}

function formatMoney(value: string | null) {
  if (!value?.trim()) return "-";
  return /[$¥€£]/.test(value) ? value : `$${value}`;
}

function formatMargin(value: string | null) {
  if (!value?.trim()) return "-";
  return value.includes("%") ? value : `${value}%`;
}

function formatDate(value: string | null) {
  if (!value) return "未规划";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(value));
}

function TextOrDash({ children }: { children: string | null | undefined }) {
  return <span className={children ? "text-foreground" : "text-muted-foreground"}>{children || "-"}</span>;
}

export function DevProjectProgressTable({
  rows,
  allowDelete,
  onDelete,
}: {
  rows: DevProjectListRow[];
  allowDelete: boolean;
  onDelete: (projectId: number) => void;
}) {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditableProgress | null>(null);
  const updateProgress = trpc.devProject.updateProgress.useMutation({
    onSuccess: async () => {
      await utils.devProject.listProgress.invalidate();
      toast.success("项目进度已保存");
      setEditingId(null);
      setDraft(null);
    },
    onError: (error) => toast.error(error.message || "项目进度保存失败"),
  });

  const startEdit = (row: DevProjectListRow) => {
    setEditingId(row.id);
    setDraft(editableFromRow(row));
  };

  const save = (projectId: number) => {
    if (!draft) return;
    updateProgress.mutate({
      projectId,
      primaryCompetitorAsin: draft.primaryCompetitorAsin || null,
      selectorName: draft.selectorName || null,
      landingProgress: draft.landingProgress,
      reviewStatus: draft.reviewStatus,
      assistantName: draft.assistantName || null,
    });
  };

  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1760px] border-collapse text-sm">
          <thead className="bg-muted/70 text-left text-xs text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-20 w-[240px] border-b bg-muted px-4 py-3 font-medium">项目名称</th>
              <th className="w-[160px] border-b px-3 py-3 font-medium">主要竞品 ASIN</th>
              <th className="w-[92px] border-b px-3 py-3 font-medium">图片</th>
              <th className="w-[120px] border-b px-3 py-3 font-medium">选品人</th>
              <th className="w-[150px] border-b px-3 py-3 font-medium">开发人员</th>
              <th className="w-[150px] border-b px-3 py-3 font-medium">运营人员</th>
              <th className="w-[170px] border-b px-3 py-3 font-medium">产品落地进度</th>
              <th className="w-[130px] border-b px-3 py-3 font-medium">预期落地时间</th>
              <th className="w-[130px] border-b px-3 py-3 font-medium">产品审核进度</th>
              <th className="w-[130px] border-b px-3 py-3 font-medium">产品协助人</th>
              <th className="w-[100px] border-b px-3 py-3 text-right font-medium">产品售价</th>
              <th className="w-[100px] border-b px-3 py-3 text-right font-medium">产品利润</th>
              <th className="w-[100px] border-b px-3 py-3 text-right font-medium">利润率</th>
              <th className="sticky right-0 z-20 w-[132px] border-b bg-muted px-3 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const editing = editingId === row.id && draft;
              const review = reviewLabels[row.reviewStatus];
              return (
                <tr
                  key={row.id}
                  className="cursor-pointer border-b last:border-b-0 hover:bg-muted/30"
                  onClick={() => setLocation(`/dev/project/${row.id}`)}
                >
                  <td className="sticky left-0 z-10 bg-background px-4 py-3" title={row.description || undefined}>
                    <button className="max-w-[215px] truncate text-left font-medium hover:text-primary" type="button">
                      {row.name}
                    </button>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {row.phase === "project_execution" ? "项目落地" : "市场分析"}
                      {row.targetMarket ? ` · ${row.targetMarket}` : ""}
                      {` · ${statusLabels[row.status] || row.status}`}
                    </div>
                  </td>
                  <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}>
                    {editing ? (
                      <Input
                        value={draft.primaryCompetitorAsin}
                        maxLength={20}
                        className="h-8 font-mono uppercase"
                        placeholder="填写 ASIN"
                        onChange={(event) => setDraft({ ...draft, primaryCompetitorAsin: event.target.value.toUpperCase() })}
                      />
                    ) : (
                      <TextOrDash>{row.primaryCompetitorAsin}</TextOrDash>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded border bg-muted">
                      {row.primaryCompetitorImageUrl ? (
                        <img src={row.primaryCompetitorImageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <ImageIcon className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}>
                    {editing ? (
                      <Input
                        value={draft.selectorName}
                        className="h-8"
                        placeholder="填写"
                        onChange={(event) => setDraft({ ...draft, selectorName: event.target.value })}
                      />
                    ) : <TextOrDash>{row.selectorName}</TextOrDash>}
                  </td>
                  <td className="px-3 py-3"><TextOrDash>{row.developerNames.join("、")}</TextOrDash></td>
                  <td className="px-3 py-3"><TextOrDash>{row.operatorNames.join("、")}</TextOrDash></td>
                  <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}>
                    {editing ? (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={draft.landingProgress}
                          className="h-8 w-20"
                          onChange={(event) => setDraft({
                            ...draft,
                            landingProgress: Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                          })}
                        />
                        <span className="text-muted-foreground">%</span>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full bg-emerald-500" style={{ width: `${row.landingProgress}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{row.landingProgress}%</span>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 tabular-nums">{formatDate(row.expectedLandingDate)}</td>
                  <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}>
                    {editing && !row.approvedAt ? (
                      <Select value={draft.reviewStatus} onValueChange={(value: ReviewStatus) => setDraft({ ...draft, reviewStatus: value })}>
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(reviewLabels).map(([value, item]) => (
                            <SelectItem key={value} value={value}>{item.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="secondary" className={review.className}>{review.label}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-3" onClick={(event) => event.stopPropagation()}>
                    {editing ? (
                      <Input
                        value={draft.assistantName}
                        className="h-8"
                        placeholder="填写"
                        onChange={(event) => setDraft({ ...draft, assistantName: event.target.value })}
                      />
                    ) : <TextOrDash>{row.assistantName}</TextOrDash>}
                  </td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums">{formatMoney(row.sellingPrice)}</td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums">{formatMoney(row.profit)}</td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums">{formatMargin(row.profitMargin)}</td>
                  <td className="sticky right-0 z-10 bg-background px-3 py-3" onClick={(event) => event.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      {editing ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="保存"
                            disabled={updateProgress.isPending}
                            onClick={() => save(row.id)}
                          ><Check className="h-4 w-4" /></Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="取消"
                            onClick={() => { setEditingId(null); setDraft(null); }}
                          ><X className="h-4 w-4" /></Button>
                        </>
                      ) : (
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="编辑项目进度" onClick={() => startEdit(row)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {allowDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          title="删除项目"
                          onClick={() => onDelete(row.id)}
                        ><Trash2 className="h-4 w-4" /></Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="进入项目" onClick={() => setLocation(`/dev/project/${row.id}`)}>
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
