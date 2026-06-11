import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tag, Loader2, Play, CheckCircle2, Lock, Unlock, AlertCircle,
  ChevronDown, ChevronRight, Edit2, Save, X, RefreshCw, Info,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";

/**
 * 属性标注独立Tab组件
 * 
 * 流程：
 * 1. 检查标签管理维度框架是否存在且已确认
 * 2. 用户点击"AI打标"按钮，调用devTagging.startTagging
 * 3. 展示打标结果表格（ASIN × 维度矩阵），支持编辑
 * 4. 用户确认/解锁打标结果
 */
export default function AttributeTagging({ projectId }: { projectId: number }) {
  const utils = trpc.useUtils();
  const [expandedAsins, setExpandedAsins] = useState<Set<string>>(new Set());
  const [editingTag, setEditingTag] = useState<{ tagId: number; value: string } | null>(null);
  const [customInput, setCustomInput] = useState("");
  // Batch operation state
  const [batchDimension, setBatchDimension] = useState<string | null>(null);
  const [batchSelectedIds, setBatchSelectedIds] = useState<Set<number>>(new Set());
  const [batchValue, setBatchValue] = useState("");

  // ─── Queries ───
  const { data: status, isLoading: statusLoading } = trpc.devTagging.getTaggingStatus.useQuery({ projectId });
  const { data: dimensions, isLoading: dimsLoading } = trpc.devTagging.getDimensions.useQuery({ projectId });
  const { data: taggedProducts, isLoading: productsLoading } = trpc.devTagging.getTaggedProducts.useQuery({ projectId });
  // Consistency check - only query when there are tagged products
  const { data: consistency } = trpc.devTagging.checkConsistency.useQuery(
    { projectId },
    { enabled: (status?.taggedProducts ?? 0) > 0 }
  );

  // ─── Mutations ───
  const startTaggingMutation = trpc.devTagging.startTagging.useMutation({
    onSuccess: (result) => {
      toast.success(`AI打标完成：${result.tagged}个产品，${result.totalTags}个标签`);
      utils.devTagging.getTaggingStatus.invalidate({ projectId });
      utils.devTagging.getTaggedProducts.invalidate({ projectId });
    },
    onError: (e: any) => toast.error(`打标失败: ${e.message}`),
  });

  const updateTagMutation = trpc.devTagging.updateTag.useMutation({
    onSuccess: () => {
      toast.success("标签已更新");
      setEditingTag(null);
      setCustomInput("");
      utils.devTagging.getTaggedProducts.invalidate({ projectId });
      utils.devTagging.getTaggingStatus.invalidate({ projectId });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const confirmMutation = trpc.devTagging.confirmAll.useMutation({
    onSuccess: () => {
      toast.success("属性标注已确认锁定");
      utils.devTagging.getTaggingStatus.invalidate({ projectId });
      utils.devTagging.getTaggedProducts.invalidate({ projectId });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const unlockMutation = trpc.devTagging.unlockAll.useMutation({
    onSuccess: () => {
      toast.success("属性标注已解锁");
      utils.devTagging.getTaggingStatus.invalidate({ projectId });
      utils.devTagging.getTaggedProducts.invalidate({ projectId });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const batchSetMutation = trpc.devTagging.batchSetDimensionValue.useMutation({
    onSuccess: (result) => {
      toast.success(`批量修改成功，更新了 ${result.updated} 个标签`);
      setBatchDimension(null);
      setBatchSelectedIds(new Set());
      setBatchValue("");
      utils.devTagging.getTaggedProducts.invalidate({ projectId });
      utils.devTagging.getTaggingStatus.invalidate({ projectId });
    },
    onError: (e: any) => toast.error(`批量修改失败: ${e.message}`),
  });

  // ─── Derived data ───
  const confirmedDimensions = useMemo(() => {
    return (dimensions || []).filter(d => d.confirmed);
  }, [dimensions]);

  const dimensionNames = useMemo(() => {
    return confirmedDimensions.map(d => d.categoryName);
  }, [confirmedDimensions]);

  // Build dimension → available values map
  const dimensionValuesMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const dim of confirmedDimensions) {
      map.set(dim.categoryName, dim.items.map(item => item.tagName));
    }
    return map;
  }, [confirmedDimensions]);

  const toggleAsin = (asin: string) => {
    setExpandedAsins(prev => {
      const next = new Set(prev);
      if (next.has(asin)) next.delete(asin);
      else next.add(asin);
      return next;
    });
  };

  const isLoading = statusLoading || dimsLoading || productsLoading;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const hasCategories = status?.hasCategories ?? false;
  const categoriesConfirmed = status?.categoriesConfirmed ?? false;
  const isConfirmed = status?.confirmed ?? false;
  const hasTaggedProducts = (status?.taggedProducts ?? 0) > 0;

  // ─── Pre-condition check ───
  if (!hasCategories) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-10 w-10 mb-3 text-amber-500 opacity-60" />
          <p className="text-sm font-medium">请先完成标签管理</p>
          <p className="text-xs text-muted-foreground mt-1">
            属性标注需要标签管理中的维度框架作为基础。请先在「标签管理」tab中生成属性维度。
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!categoriesConfirmed) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-10 w-10 mb-3 text-amber-500 opacity-60" />
          <p className="text-sm font-medium">请先确认标签维度</p>
          <p className="text-xs text-muted-foreground mt-1">
            请在「标签管理」tab中确认至少一个属性维度后，再进行属性标注。
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            当前维度数：{status?.totalCategories ?? 0}，已确认：{status?.confirmedCategoriesCount ?? 0}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Tag className="h-4 w-4 text-primary" />
              属性标注
              {isConfirmed && (
                <Badge variant="outline" className="text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20">
                  <Lock className="h-3 w-3 mr-1" /> 已确认
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              {hasTaggedProducts && !isConfirmed && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-emerald-600 border-emerald-300 hover:bg-emerald-50"
                  onClick={() => confirmMutation.mutate({ projectId })}
                  disabled={confirmMutation.isPending}
                >
                  {confirmMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  确认锁定
                </Button>
              )}
              {isConfirmed && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-amber-600 border-amber-300 hover:bg-amber-50"
                  onClick={() => unlockMutation.mutate({ projectId })}
                  disabled={unlockMutation.isPending}
                >
                  {unlockMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlock className="h-3.5 w-3.5" />}
                  解锁编辑
                </Button>
              )}
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => startTaggingMutation.mutate({ projectId })}
                disabled={startTaggingMutation.isPending || isConfirmed}
              >
                {startTaggingMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : hasTaggedProducts ? (
                  <RefreshCw className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {hasTaggedProducts ? "重新打标" : "AI打标"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border p-3 text-center">
              <p className="text-2xl font-bold text-primary">{confirmedDimensions.length}</p>
              <p className="text-xs text-muted-foreground">属性维度</p>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <p className="text-2xl font-bold text-primary">{status?.totalProducts ?? 0}</p>
              <p className="text-xs text-muted-foreground">总产品数</p>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <p className="text-2xl font-bold text-emerald-600">{status?.taggedProducts ?? 0}</p>
              <p className="text-xs text-muted-foreground">已打标产品</p>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <p className="text-2xl font-bold text-blue-600">{status?.totalTags ?? 0}</p>
              <p className="text-xs text-muted-foreground">标签总数</p>
            </div>
          </div>

          {startTaggingMutation.isPending && (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              AI正在为产品打标签，请稍候...（每批5个产品，可能需要几分钟）
            </div>
          )}
        </CardContent>
      </Card>

      {/* Consistency Warning */}
      {consistency && !consistency.consistent && (
        <Card className="border-amber-300 bg-amber-50/50 dark:bg-amber-900/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertCircle className="h-4 w-4" />
              标签一致性检测异常
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">
              标签管理的维度框架与当前打标结果存在不一致，建议重新打标以确保数据准确性。
            </p>
            <div className="space-y-1.5">
              {consistency.issues.map((issue, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs">
                  <Badge
                    variant="outline"
                    className={`shrink-0 ${
                      issue.type === "extra_dimension" ? "border-red-300 text-red-600" :
                      issue.type === "missing_dimension" ? "border-blue-300 text-blue-600" :
                      "border-amber-300 text-amber-600"
                    }`}
                  >
                    {issue.type === "extra_dimension" ? "多余维度" :
                     issue.type === "missing_dimension" ? "缺少维度" : "无效值"}
                  </Badge>
                  <span className="text-muted-foreground">{issue.detail}</span>
                  {issue.affectedCount > 0 && (
                    <Badge variant="secondary" className="text-xs shrink-0">
                      {issue.affectedCount}个
                    </Badge>
                  )}
                </div>
              ))}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="mt-3 gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-100"
              onClick={() => startTaggingMutation.mutate({ projectId })}
              disabled={startTaggingMutation.isPending || isConfirmed}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              重新打标以修复
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Dimension Framework Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="h-4 w-4 text-muted-foreground" />
            当前维度框架（来自标签管理）
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {confirmedDimensions.map(dim => (
              <Badge key={dim.id} variant="secondary" className="text-xs py-1 px-2.5">
                {dim.categoryName}
                <span className="ml-1 text-muted-foreground">({dim.items.length}值)</span>
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tagged Products Table */}
      {hasTaggedProducts && taggedProducts && taggedProducts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">打标结果</CardTitle>
              {!isConfirmed && (
                <div className="flex items-center gap-2">
                  {batchDimension ? (
                    <>
                      <Badge variant="outline" className="text-xs">
                        批量修改: {batchDimension} ({batchSelectedIds.size}已选)
                      </Badge>
                      {batchSelectedIds.size > 0 && (
                        <div className="flex items-center gap-1">
                          <Select value={batchValue} onValueChange={setBatchValue}>
                            <SelectTrigger className="h-7 text-xs w-[140px]">
                              <SelectValue placeholder="选择目标值" />
                            </SelectTrigger>
                            <SelectContent>
                              {(dimensionValuesMap.get(batchDimension) || []).map(v => (
                                <SelectItem key={v} value={v}>{v}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1"
                            disabled={!batchValue || batchSetMutation.isPending}
                            onClick={() => {
                              batchSetMutation.mutate({
                                projectId,
                                dimensionName: batchDimension,
                                tagIds: Array.from(batchSelectedIds),
                                dimensionValue: batchValue,
                              });
                            }}
                          >
                            {batchSetMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                            应用
                          </Button>
                        </div>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => { setBatchDimension(null); setBatchSelectedIds(new Set()); setBatchValue(""); }}
                      >
                        <X className="h-3 w-3 mr-1" />取消
                      </Button>
                    </>
                  ) : (
                    <Select onValueChange={(val) => { setBatchDimension(val); setBatchSelectedIds(new Set()); setBatchValue(""); }}>
                      <SelectTrigger className="h-7 text-xs w-[160px]">
                        <SelectValue placeholder="选择维度批量修改" />
                      </SelectTrigger>
                      <SelectContent>
                        {dimensionNames.map(name => (
                          <SelectItem key={name} value={name}>{name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    {batchDimension && (
                      <th className="text-center px-2 py-2 font-medium w-8">
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={(() => {
                            const allIds = (taggedProducts || []).filter(p => p.tags.length > 0).map(p => {
                              const tag = p.tags.find(t => t.dimensionName === batchDimension);
                              return tag?.id;
                            }).filter(Boolean) as number[];
                            return allIds.length > 0 && allIds.every(id => batchSelectedIds.has(id));
                          })()}
                          onChange={(e) => {
                            const allIds = (taggedProducts || []).filter(p => p.tags.length > 0).map(p => {
                              const tag = p.tags.find(t => t.dimensionName === batchDimension);
                              return tag?.id;
                            }).filter(Boolean) as number[];
                            if (e.target.checked) {
                              setBatchSelectedIds(new Set(allIds));
                            } else {
                              setBatchSelectedIds(new Set());
                            }
                          }}
                        />
                      </th>
                    )}
                    <th className="text-left px-3 py-2 font-medium w-8"></th>
                    <th className="text-left px-3 py-2 font-medium whitespace-nowrap">ASIN</th>
                    <th className="text-left px-3 py-2 font-medium min-w-[200px]">标题</th>
                    {dimensionNames.map(name => (
                      <th key={name} className="text-left px-3 py-2 font-medium whitespace-nowrap min-w-[120px]">
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {taggedProducts.filter(p => p.tags.length > 0).map(product => {
                    const tagMap = new Map<string, { id: number; value: string; source: string; confirmed: number }>();
                    for (const tag of product.tags) {
                      tagMap.set(tag.dimensionName, {
                        id: tag.id as number,
                        value: tag.dimensionValue,
                        source: (tag.source || "ai") as string,
                        confirmed: (tag.confirmed ?? 0) as number,
                      });
                    }

                    return (
                      <tr key={product.asin} className={`border-b hover:bg-muted/30 transition-colors ${batchDimension && batchSelectedIds.has(product.tags.find(t => t.dimensionName === batchDimension)?.id as number) ? "bg-blue-50/50 dark:bg-blue-900/10" : ""}`}>
                        {batchDimension && (() => {
                          const tag = product.tags.find(t => t.dimensionName === batchDimension);
                          const tagId = tag?.id as number | undefined;
                          return (
                            <td className="text-center px-2 py-2">
                              {tagId ? (
                                <input
                                  type="checkbox"
                                  className="rounded"
                                  checked={batchSelectedIds.has(tagId)}
                                  onChange={(e) => {
                                    setBatchSelectedIds(prev => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.add(tagId);
                                      else next.delete(tagId);
                                      return next;
                                    });
                                  }}
                                />
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          );
                        })()}
                        <td className="px-3 py-2">
                          <button
                            onClick={() => toggleAsin(product.asin)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            {expandedAsins.has(product.asin) ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{product.asin}</td>
                        <td className="px-3 py-2">
                          <p className="text-xs line-clamp-2 max-w-[300px]" title={product.title}>
                            {product.title}
                          </p>
                        </td>
                        {dimensionNames.map(dimName => {
                          const tagData = tagMap.get(dimName);
                          const isEditing = editingTag?.tagId === tagData?.id;
                          const availableValues = dimensionValuesMap.get(dimName) || [];

                          if (!tagData) {
                            return (
                              <td key={dimName} className="px-3 py-2">
                                <span className="text-xs text-muted-foreground italic">—</span>
                              </td>
                            );
                          }

                          if (isEditing && !isConfirmed) {
                            return (
                              <td key={dimName} className="px-3 py-2">
                                <div className="flex flex-col gap-1">
                                  {availableValues.length > 0 ? (
                                    <Select
                                      value={editingTag!.value}
                                      onValueChange={(val) => {
                                        if (val === "__custom__") {
                                          setCustomInput(editingTag!.value);
                                        } else {
                                          setEditingTag({ tagId: editingTag!.tagId, value: val });
                                        }
                                      }}
                                    >
                                      <SelectTrigger className="h-7 text-xs">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {availableValues.map(v => (
                                          <SelectItem key={v} value={v}>{v}</SelectItem>
                                        ))}
                                        <SelectItem value="__custom__">自定义...</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  ) : (
                                    <Input
                                      value={editingTag!.value}
                                      onChange={(e) => setEditingTag({ tagId: editingTag!.tagId, value: e.target.value })}
                                      className="h-7 text-xs"
                                    />
                                  )}
                                  {customInput !== "" && (
                                    <Input
                                      value={customInput}
                                      onChange={(e) => {
                                        setCustomInput(e.target.value);
                                        setEditingTag({ tagId: editingTag!.tagId, value: e.target.value });
                                      }}
                                      placeholder="输入自定义值"
                                      className="h-7 text-xs"
                                    />
                                  )}
                                  <div className="flex gap-1">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 w-6 p-0"
                                      onClick={() => {
                                        updateTagMutation.mutate({
                                          tagId: tagData.id,
                                          dimensionValue: editingTag!.value,
                                        });
                                      }}
                                      disabled={updateTagMutation.isPending}
                                    >
                                      <Save className="h-3 w-3 text-emerald-600" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 w-6 p-0"
                                      onClick={() => { setEditingTag(null); setCustomInput(""); }}
                                    >
                                      <X className="h-3 w-3 text-red-500" />
                                    </Button>
                                  </div>
                                </div>
                              </td>
                            );
                          }

                          return (
                            <td key={dimName} className="px-3 py-2">
                              <div className="flex items-center gap-1 group">
                                <Badge
                                  variant={tagData.source === "manual" ? "default" : "secondary"}
                                  className="text-xs cursor-default"
                                >
                                  {tagData.value}
                                </Badge>
                                {!isConfirmed && (
                                  <button
                                    onClick={() => setEditingTag({ tagId: tagData.id, value: tagData.value })}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <Edit2 className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                                  </button>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Products without tags */}
            {taggedProducts.filter(p => p.tags.length === 0).length > 0 && (
              <div className="px-3 py-2 border-t bg-amber-50/50 dark:bg-amber-900/10">
                <p className="text-xs text-amber-600">
                  <AlertCircle className="h-3 w-3 inline mr-1" />
                  {taggedProducts.filter(p => p.tags.length === 0).length} 个产品尚未打标
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!hasTaggedProducts && !startTaggingMutation.isPending && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Tag className="h-10 w-10 mb-3 text-primary opacity-40" />
            <p className="text-sm font-medium">尚未进行属性标注</p>
            <p className="text-xs text-muted-foreground mt-1">
              点击上方「AI打标」按钮，AI将根据标签管理的维度框架为每个产品自动标注属性
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
