/**
 * Operator Name Mapping Confirmation Dialog
 * Shows after data import to map external operator names to system users
 * Supports: auto-matched (green), suggested (yellow), unmatched (red)
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  CheckCircle2, AlertTriangle, XCircle, Loader2, Users, ArrowRight, Link2,
} from "lucide-react";
import { toast } from "sonner";

type MappingResult = {
  externalName: string;
  coreName: string;
  status: "mapped" | "suggested" | "unmatched";
  mappedUserName: string | null;
  mappedUserId: number | null;
  suggestions: { userId: number; userName: string; score: number; matchType: string }[];
};

type SystemUser = { id: number; name: string };

interface OperatorMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operatorNames: string[];
  sourceType: "lingxing" | "saihu";
  onComplete?: () => void;
}

export default function OperatorMappingDialog({
  open,
  onOpenChange,
  operatorNames,
  sourceType,
  onComplete,
}: OperatorMappingDialogProps) {
  const [resolvedData, setResolvedData] = useState<{
    results: MappingResult[];
    systemUsers: SystemUser[];
    totalNames: number;
    mappedCount: number;
    suggestedCount: number;
    unmatchedCount: number;
  } | null>(null);

  // Local state for user selections (overrides for suggested/unmatched)
  const [selections, setSelections] = useState<Record<string, { userId: number | null; userName: string | null }>>({});
  const [saving, setSaving] = useState(false);

  // Resolve operator names mutation
  const resolveMutation = trpc.operatorMapping.resolveOperatorNames.useMutation({
    onSuccess: (data) => {
      setResolvedData(data as any);
      // Pre-fill selections with suggested matches
      const initial: Record<string, { userId: number | null; userName: string | null }> = {};
      for (const r of data.results) {
        if (r.status === "suggested" && r.mappedUserId) {
          initial[r.externalName] = { userId: r.mappedUserId, userName: r.mappedUserName };
        }
      }
      setSelections(initial);
    },
    onError: (err) => {
      toast.error("解析运营人员名称失败", { description: err.message });
    },
  });

  // Bulk upsert mutation
  const bulkUpsertMutation = trpc.operatorMapping.bulkUpsertMappings.useMutation({
    onSuccess: (data) => {
      toast.success("运营人员映射已保存", {
        description: `新建 ${data.created} 条，更新 ${data.updated} 条映射`,
      });
      setSaving(false);
      onOpenChange(false);
      onComplete?.();
    },
    onError: (err) => {
      toast.error("保存映射失败", { description: err.message });
      setSaving(false);
    },
  });

  // Trigger resolve when dialog opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && operatorNames.length > 0 && !resolvedData) {
      resolveMutation.mutate({ externalNames: operatorNames, sourceType });
    }
    if (!isOpen) {
      setResolvedData(null);
      setSelections({});
    }
    onOpenChange(isOpen);
  };

  // Also trigger on mount if already open
  if (open && operatorNames.length > 0 && !resolvedData && !resolveMutation.isPending) {
    resolveMutation.mutate({ externalNames: operatorNames, sourceType });
  }

  // Handle user selection change
  const handleSelectionChange = (externalName: string, userIdStr: string, systemUsers: SystemUser[]) => {
    if (userIdStr === "none") {
      setSelections(prev => ({
        ...prev,
        [externalName]: { userId: null, userName: null },
      }));
    } else {
      const userId = parseInt(userIdStr);
      const user = systemUsers.find(u => u.id === userId);
      setSelections(prev => ({
        ...prev,
        [externalName]: { userId, userName: user?.name || null },
      }));
    }
  };

  // Save all mappings
  const handleSave = () => {
    if (!resolvedData) return;
    setSaving(true);

    const mappings: { externalName: string; sourceType: "lingxing" | "saihu" | "all"; systemUserName: string | null; systemUserId: number | null }[] = [];

    for (const r of resolvedData.results) {
      if (r.status === "mapped") {
        // Already mapped, skip (don't overwrite)
        continue;
      }

      const sel = selections[r.externalName];
      if (sel) {
        mappings.push({
          externalName: r.externalName,
          sourceType,
          systemUserName: sel.userName,
          systemUserId: sel.userId,
        });
      } else if (r.status === "suggested" && r.mappedUserId) {
        // Auto-accept suggestion if user didn't change it
        mappings.push({
          externalName: r.externalName,
          sourceType,
          systemUserName: r.mappedUserName,
          systemUserId: r.mappedUserId,
        });
      }
    }

    if (mappings.length === 0) {
      toast.info("没有需要保存的映射");
      setSaving(false);
      onOpenChange(false);
      onComplete?.();
      return;
    }

    bulkUpsertMutation.mutate({ mappings });
  };

  // Skip all (close without saving)
  const handleSkip = () => {
    onOpenChange(false);
    onComplete?.();
  };

  // Compute summary
  const summary = useMemo(() => {
    if (!resolvedData) return null;
    let confirmed = 0;
    let pending = 0;
    for (const r of resolvedData.results) {
      if (r.status === "mapped") {
        confirmed++;
      } else if (selections[r.externalName]?.userId) {
        confirmed++;
      } else if (r.status === "suggested" && r.mappedUserId) {
        confirmed++;
      } else {
        pending++;
      }
    }
    return { confirmed, pending, total: resolvedData.results.length };
  }, [resolvedData, selections]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            运营人员名称映射
          </DialogTitle>
          <DialogDescription>
            导入数据中的运营人员名称与系统用户名不一致，请确认以下映射关系。确认后系统将记住映射，下次导入自动匹配。
          </DialogDescription>
        </DialogHeader>

        {resolveMutation.isPending ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mr-2" />
            <span className="text-muted-foreground">正在匹配运营人员名称...</span>
          </div>
        ) : resolvedData ? (
          <div className="space-y-4">
            {/* Summary Bar */}
            <div className="flex items-center gap-4 p-3 rounded-lg bg-accent/50">
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">
                  {resolvedData.mappedCount} 已映射
                </Badge>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-800">
                  {resolvedData.suggestedCount} 建议匹配
                </Badge>
              </div>
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800">
                  {resolvedData.unmatchedCount} 未匹配
                </Badge>
              </div>
              <div className="ml-auto text-sm text-muted-foreground">
                共 {resolvedData.totalNames} 个名称
              </div>
            </div>

            {/* All mapped - no action needed */}
            {resolvedData.suggestedCount === 0 && resolvedData.unmatchedCount === 0 && (
              <div className="p-4 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 text-center">
                <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400 mx-auto mb-2" />
                <p className="font-medium text-green-700 dark:text-green-300">所有运营人员名称已自动匹配</p>
                <p className="text-sm text-green-600/80 dark:text-green-400/80 mt-1">无需手动确认</p>
              </div>
            )}

            {/* Mapping Table */}
            {(resolvedData.suggestedCount > 0 || resolvedData.unmatchedCount > 0) && (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">状态</TableHead>
                      <TableHead>导出名称（领星/赛狐）</TableHead>
                      <TableHead className="w-[40px]"></TableHead>
                      <TableHead>映射到系统用户</TableHead>
                      <TableHead className="w-[100px]">匹配度</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resolvedData.results.map((r) => {
                      const sel = selections[r.externalName];
                      const effectiveUserId = sel?.userId ?? r.mappedUserId;
                      const effectiveUserName = sel?.userName ?? r.mappedUserName;

                      return (
                        <TableRow key={r.externalName}>
                          {/* Status Icon */}
                          <TableCell>
                            {r.status === "mapped" ? (
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                            ) : r.status === "suggested" ? (
                              <AlertTriangle className="h-4 w-4 text-yellow-600" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-500" />
                            )}
                          </TableCell>

                          {/* External Name */}
                          <TableCell>
                            <div>
                              <span className="font-medium">{r.externalName}</span>
                              {r.coreName !== r.externalName && (
                                <span className="text-xs text-muted-foreground ml-2">
                                  (核心: {r.coreName})
                                </span>
                              )}
                            </div>
                          </TableCell>

                          {/* Arrow */}
                          <TableCell>
                            <ArrowRight className="h-4 w-4 text-muted-foreground" />
                          </TableCell>

                          {/* System User Selection */}
                          <TableCell>
                            {r.status === "mapped" ? (
                              <div className="flex items-center gap-1.5">
                                <Link2 className="h-3.5 w-3.5 text-green-600" />
                                <span className="text-green-700 dark:text-green-300 font-medium">
                                  {r.mappedUserName}
                                </span>
                              </div>
                            ) : (
                              <Select
                                value={effectiveUserId?.toString() || "none"}
                                onValueChange={(val) => handleSelectionChange(r.externalName, val, resolvedData.systemUsers)}
                              >
                                <SelectTrigger className="h-8 text-sm">
                                  <SelectValue placeholder="选择系统用户..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">
                                    <span className="text-muted-foreground">不映射</span>
                                  </SelectItem>
                                  {resolvedData.systemUsers.map(u => (
                                    <SelectItem key={u.id} value={u.id.toString()}>
                                      {u.name}
                                      {r.suggestions.find(s => s.userId === u.id) && (
                                        <span className="text-xs text-muted-foreground ml-1">
                                          ({Math.round((r.suggestions.find(s => s.userId === u.id)?.score || 0) * 100)}%)
                                        </span>
                                      )}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>

                          {/* Match Score */}
                          <TableCell>
                            {r.status === "mapped" ? (
                              <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">
                                已确认
                              </Badge>
                            ) : r.suggestions.length > 0 ? (
                              <span className="text-xs text-muted-foreground">
                                {Math.round(r.suggestions[0].score * 100)}%
                              </span>
                            ) : (
                              <span className="text-xs text-red-500">无匹配</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Progress */}
            {summary && (
              <div className="text-sm text-muted-foreground text-center">
                已确认 {summary.confirmed}/{summary.total} 个映射
                {summary.pending > 0 && (
                  <span className="text-yellow-600 dark:text-yellow-400 ml-2">
                    ({summary.pending} 个待确认)
                  </span>
                )}
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleSkip} disabled={saving}>
            跳过
          </Button>
          <Button onClick={handleSave} disabled={saving || !resolvedData}>
            {saving ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" /> 保存中...</>
            ) : (
              <><CheckCircle2 className="h-4 w-4 mr-2" /> 确认映射</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
