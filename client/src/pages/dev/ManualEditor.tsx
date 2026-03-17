import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Lock, Unlock, Edit2, Save, X, Check, Globe, Download,
  Loader2, ChevronDown, ChevronRight, Eye, EyeOff,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface Chapter {
  key: string;
  titleEn: string;
  titleEs: string;
  contentEn: string;
  contentEs: string;
  confirmed?: boolean;
}

interface ManualEditorProps {
  manual: any;
  projectId: number;
}

export default function ManualEditor({ manual, projectId }: ManualEditorProps) {
  const utils = trpc.useUtils();

  // Parse chapters from manual
  const originalChapters = useMemo<Chapter[]>(() => {
    try {
      const parsed = JSON.parse(manual?.contentSections || "[]");
      return parsed.map((ch: any) => ({
        key: ch.key || "",
        titleEn: ch.titleEn || "",
        titleEs: ch.titleEs || "",
        contentEn: ch.contentEn || "",
        contentEs: ch.contentEs || "",
        confirmed: ch.confirmed ?? false,
      }));
    } catch {
      return [];
    }
  }, [manual?.contentSections]);

  const [chapters, setChapters] = useState<Chapter[]>(originalChapters);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Chapter | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [brandName, setBrandName] = useState(manual?.brandName || "");
  const [editingBrand, setEditingBrand] = useState(false);

  // Mutations
  const saveMutation = trpc.devManual.saveManual.useMutation({
    onSuccess: () => {
      toast.success("说明书已保存");
      utils.devManual.getManual.invalidate({ projectId });
    },
    onError: (err: any) => toast.error(`保存失败: ${err.message}`),
  });

  const htmlMutation = trpc.devManual.generateHtml.useMutation({
    onSuccess: (data: any) => {
      toast.success("HTML说明书生成完成");
      if (data.htmlEnUrl) window.open(data.htmlEnUrl, "_blank");
    },
    onError: (err: any) => toast.error(`生成失败: ${err.message}`),
  });

  const pdfMutation = trpc.devManual.exportPdf.useMutation({
    onSuccess: (data: any) => {
      toast.success("PDF导出完成");
      if (data.htmlUrl) window.open(data.htmlUrl, "_blank");
    },
    onError: (err: any) => toast.error(`导出失败: ${err.message}`),
  });

  // Stats
  const confirmedCount = chapters.filter(ch => ch.confirmed).length;
  const allConfirmed = chapters.length > 0 && confirmedCount === chapters.length;

  // Save chapters to backend
  const saveChapters = (updated: Chapter[], status?: "draft" | "editing" | "confirmed") => {
    saveMutation.mutate({
      projectId,
      chapters: JSON.stringify(updated),
      brandName: brandName || undefined,
      status: status || (updated.every(ch => ch.confirmed) ? "confirmed" : "editing"),
    });
  };

  // Start editing a chapter
  const startEdit = (idx: number) => {
    setEditingIdx(idx);
    setEditDraft({ ...chapters[idx] });
    setExpandedIdx(idx);
  };

  // Save edit
  const saveEdit = () => {
    if (editingIdx === null || !editDraft) return;
    const updated = [...chapters];
    updated[editingIdx] = { ...editDraft, confirmed: false }; // editing resets confirmation
    setChapters(updated);
    setEditingIdx(null);
    setEditDraft(null);
    saveChapters(updated);
  };

  // Cancel edit
  const cancelEdit = () => {
    setEditingIdx(null);
    setEditDraft(null);
  };

  // Confirm a chapter
  const confirmChapter = (idx: number) => {
    const updated = [...chapters];
    updated[idx] = { ...updated[idx], confirmed: true };
    setChapters(updated);
    saveChapters(updated);
  };

  // Unlock a chapter
  const unlockChapter = (idx: number) => {
    const updated = [...chapters];
    updated[idx] = { ...updated[idx], confirmed: false };
    setChapters(updated);
    saveChapters(updated);
  };

  // Confirm all
  const confirmAll = () => {
    const updated = chapters.map(ch => ({ ...ch, confirmed: true }));
    setChapters(updated);
    saveChapters(updated, "confirmed");
  };

  // Unlock all
  const unlockAll = () => {
    const updated = chapters.map(ch => ({ ...ch, confirmed: false }));
    setChapters(updated);
    saveChapters(updated, "editing");
  };

  if (chapters.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Globe className="h-10 w-10 mb-3 opacity-30" />
          <p className="text-sm">请先点击"生成说明书"按钮</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold">说明书编辑</h3>
          <Badge variant={allConfirmed ? "default" : "secondary"} className="text-xs">
            {confirmedCount}/{chapters.length} 章已确认
          </Badge>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={() => setShowComparison(!showComparison)} className="gap-1 text-xs">
            {showComparison ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {showComparison ? "隐藏对比" : "AI原版对比"}
          </Button>
          {allConfirmed ? (
            <Button size="sm" variant="outline" onClick={unlockAll} className="gap-1 text-xs text-amber-600">
              <Unlock className="h-3 w-3" />全部解锁
            </Button>
          ) : (
            <Button size="sm" onClick={confirmAll} className="gap-1 text-xs">
              <Lock className="h-3 w-3" />全部确认
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => htmlMutation.mutate({ projectId })} disabled={htmlMutation.isPending} className="gap-1 text-xs">
            {htmlMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
            HTML(EN+ES)
          </Button>
          <Button size="sm" variant="outline" onClick={() => pdfMutation.mutate({ projectId, language: "en" })} disabled={pdfMutation.isPending} className="gap-1 text-xs">
            <Download className="h-3 w-3" />PDF(EN)
          </Button>
          <Button size="sm" variant="outline" onClick={() => pdfMutation.mutate({ projectId, language: "es" })} disabled={pdfMutation.isPending} className="gap-1 text-xs">
            <Download className="h-3 w-3" />PDF(ES)
          </Button>
        </div>
      </div>

      {/* Brand Info */}
      <Card className="bg-gradient-to-r from-blue-50/50 to-indigo-50/50 border-blue-100">
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">品牌名称:</span>
            {editingBrand ? (
              <div className="flex items-center gap-2">
                <Input
                  className="h-7 w-48 text-sm"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                />
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditingBrand(false); saveChapters(chapters); }}>
                  <Save className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setBrandName(manual?.brandName || ""); setEditingBrand(false); }}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{brandName || "未设置"}</span>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setEditingBrand(true)}>
                  <Edit2 className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Chapter Summary Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left p-3 font-medium w-16">章节</th>
                  <th className="text-left p-3 font-medium">英文标题</th>
                  <th className="text-left p-3 font-medium">西语标题</th>
                  <th className="text-center p-3 font-medium w-24">状态</th>
                  <th className="text-center p-3 font-medium w-32">操作</th>
                </tr>
              </thead>
              <tbody>
                {chapters.map((ch, idx) => {
                  const isEditing = editingIdx === idx;
                  const isExpanded = expandedIdx === idx;

                  return (
                    <tr key={idx} className={`border-b transition-colors ${isExpanded ? "bg-blue-50/30" : "hover:bg-muted/20"} ${ch.confirmed ? "bg-emerald-50/20" : ""}`}>
                      <td className="p-3 font-mono text-xs text-muted-foreground">
                        <button className="flex items-center gap-1" onClick={() => setExpandedIdx(isExpanded ? null : idx)}>
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          Ch.{idx + 1}
                        </button>
                      </td>
                      <td className="p-3">{ch.titleEn || ch.key}</td>
                      <td className="p-3 text-muted-foreground">{ch.titleEs || "—"}</td>
                      <td className="p-3 text-center">
                        {ch.confirmed ? (
                          <Badge className="bg-emerald-100 text-emerald-700 text-xs">已确认</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-200">待确认</Badge>
                        )}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {!ch.confirmed ? (
                            <>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => startEdit(idx)}>
                                <Edit2 className="h-3 w-3 mr-1" />编辑
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-emerald-600" onClick={() => confirmChapter(idx)}>
                                <Check className="h-3 w-3 mr-1" />确认
                              </Button>
                            </>
                          ) : (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-amber-600" onClick={() => unlockChapter(idx)}>
                              <Unlock className="h-3 w-3 mr-1" />解锁
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Expanded Chapter Detail / Edit */}
      {expandedIdx !== null && (
        <Card className="border-blue-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-xs">Ch.{expandedIdx + 1}</span>
              {editingIdx === expandedIdx ? "编辑章节" : chapters[expandedIdx].titleEn || chapters[expandedIdx].key}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {editingIdx === expandedIdx && editDraft ? (
              /* ─── Edit Mode ─── */
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-blue-600 mb-1 block">英文标题</label>
                    <Input
                      value={editDraft.titleEn}
                      onChange={(e) => setEditDraft({ ...editDraft, titleEn: e.target.value })}
                      className="text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-orange-600 mb-1 block">西语标题</label>
                    <Input
                      value={editDraft.titleEs}
                      onChange={(e) => setEditDraft({ ...editDraft, titleEs: e.target.value })}
                      className="text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-blue-600 mb-1 block">英文内容</label>
                    <Textarea
                      value={editDraft.contentEn}
                      onChange={(e) => setEditDraft({ ...editDraft, contentEn: e.target.value })}
                      rows={10}
                      className="text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-orange-600 mb-1 block">西语内容</label>
                    <Textarea
                      value={editDraft.contentEs}
                      onChange={(e) => setEditDraft({ ...editDraft, contentEs: e.target.value })}
                      rows={10}
                      className="text-sm font-mono"
                    />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="outline" onClick={cancelEdit} className="gap-1">
                    <X className="h-3 w-3" />取消
                  </Button>
                  <Button size="sm" onClick={saveEdit} disabled={saveMutation.isPending} className="gap-1">
                    {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    保存
                  </Button>
                </div>

                {/* AI Original Comparison */}
                {showComparison && originalChapters[expandedIdx] && (
                  <div className="border-t pt-4 mt-4">
                    <p className="text-xs font-medium text-muted-foreground mb-2">AI原版内容（对比参考）</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-60">
                      <div>
                        <p className="text-xs text-blue-600 mb-1">English (Original)</p>
                        <p className="text-xs whitespace-pre-wrap bg-muted/30 p-2 rounded max-h-40 overflow-y-auto">
                          {originalChapters[expandedIdx].contentEn || "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-orange-600 mb-1">Español (Original)</p>
                        <p className="text-xs whitespace-pre-wrap bg-muted/30 p-2 rounded max-h-40 overflow-y-auto">
                          {originalChapters[expandedIdx].contentEs || "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* ─── View Mode ─── */
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-blue-600 mb-1">English</p>
                  <p className="text-sm whitespace-pre-wrap">{chapters[expandedIdx].contentEn || "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-orange-600 mb-1">Español</p>
                  <p className="text-sm whitespace-pre-wrap">{chapters[expandedIdx].contentEs || "—"}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Progress Bar */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${chapters.length > 0 ? (confirmedCount / chapters.length) * 100 : 0}%` }}
          />
        </div>
        <span>{confirmedCount}/{chapters.length} 章已确认</span>
        {saveMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
      </div>
    </div>
  );
}
