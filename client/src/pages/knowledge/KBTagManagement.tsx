import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, PlusCircle, Edit3, Trash2, Tag, BarChart3, RefreshCw, ChevronRight, Shield, User, FolderTree } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { ADMIN_ROLES } from "@shared/const";

// Dimension metadata for display
const DIMENSION_META: Record<string, { label: string; icon: string; level: string; hasParent: boolean; description: string }> = {
  category: { label: "产品类目", icon: "📦", level: "套图", hasParent: false, description: "产品所属类目（18种）" },
  color: { label: "颜色标签", icon: "🎨", level: "套图+单图", hasParent: false, description: "主颜色和提亮色（13种）" },
  style: { label: "设计风格", icon: "✨", level: "套图", hasParent: false, description: "图片设计风格（13种），含结构化参数" },
  imageType: { label: "图片类型", icon: "🖼️", level: "单图", hasParent: true, description: "图片大类→子类（二级联动）" },
  sellingPoint: { label: "卖点分类", icon: "💡", level: "单图", hasParent: true, description: "卖点大类→明细（二级联动）" },
  composition: { label: "构图类型", icon: "📐", level: "单图", hasParent: false, description: "图片构图方式（8种）" },
  imageBelong: { label: "图片归属", icon: "📋", level: "单图", hasParent: true, description: "图片位置归属（主图/套图/A+/品牌故事），A+下含12个子模块" },
};

interface StyleParams {
  lightType?: string;
  colorTemp?: string;
  materialKeywords?: string;
  tabooElements?: string;
  refBrands?: string;
  aiKeywords?: string;
  styleFeature?: string;
}

export function KBTagManagement() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const isAdmin = user?.role && (ADMIN_ROLES as readonly string[]).includes(user.role);

  const [selectedDimension, setSelectedDimension] = useState("category");
  const [selectedParent, setSelectedParent] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingTag, setEditingTag] = useState<any>(null);
  const [newTagValue, setNewTagValue] = useState("");
  const [newTagMetadata, setNewTagMetadata] = useState("");
  const [showStyleEditor, setShowStyleEditor] = useState(false);
  const [styleParams, setStyleParams] = useState<StyleParams>({});

  // Queries
  const { data: tags, isLoading: tagsLoading } = trpc.kbTags.listAllForDimension.useQuery(
    { dimension: selectedDimension }
  );
  const { data: stats, isLoading: statsLoading } = trpc.kbTags.getUsageStats.useQuery();

  // Mutations
  const createTag = trpc.kbTags.create.useMutation({
    onSuccess: () => {
      toast.success("标签创建成功");
      utils.kbTags.listAllForDimension.invalidate();
      setShowAddDialog(false);
      setNewTagValue("");
      setNewTagMetadata("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const updateTag = trpc.kbTags.update.useMutation({
    onSuccess: () => {
      toast.success("标签更新成功");
      utils.kbTags.listAllForDimension.invalidate();
      setShowEditDialog(false);
      setEditingTag(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteTag = trpc.kbTags.delete.useMutation({
    onSuccess: () => {
      toast.success("标签已删除");
      utils.kbTags.listAllForDimension.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const initSystemTags = trpc.kbTags.initSystemTags.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      utils.kbTags.listAllForDimension.invalidate();
      utils.kbTags.getUsageStats.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Computed: group hierarchical tags by parent
  const groupedTags = useMemo(() => {
    if (!tags) return { parents: [], children: {} as Record<string, any[]> };
    const dimMeta = DIMENSION_META[selectedDimension];
    if (!dimMeta?.hasParent) {
      return { parents: tags, children: {} };
    }
    // Hierarchical: separate parents (parentValue is null) from children
    const parents = tags.filter(t => !t.parentValue);
    const children: Record<string, any[]> = {};
    tags.filter(t => t.parentValue).forEach(t => {
      if (!children[t.parentValue!]) children[t.parentValue!] = [];
      children[t.parentValue!].push(t);
    });
    return { parents, children };
  }, [tags, selectedDimension]);

  // Get current dimension stats
  const currentStats = stats?.[selectedDimension];

  function handleAddTag() {
    const metadata = selectedDimension === "style" && Object.keys(styleParams).length > 0
      ? JSON.stringify(styleParams)
      : newTagMetadata || undefined;
    createTag.mutate({
      dimension: selectedDimension,
      parentValue: selectedParent || undefined,
      value: newTagValue.trim(),
      isSystem: isAdmin ? true : false,
      metadata,
    });
  }

  function handleEditTag() {
    if (!editingTag) return;
    const metadata = selectedDimension === "style" && Object.keys(styleParams).length > 0
      ? JSON.stringify(styleParams)
      : newTagMetadata || undefined;
    updateTag.mutate({
      id: editingTag.id,
      value: newTagValue.trim() || undefined,
      metadata,
    });
  }

  function handleDeleteTag(tag: any) {
    if (!confirm(`确定要删除标签"${tag.value}"吗？${tag.usageCount > 0 ? `（已被${tag.usageCount}次引用）` : ""}`)) return;
    deleteTag.mutate({ id: tag.id, force: tag.usageCount > 0 });
  }

  function openEditDialog(tag: any) {
    setEditingTag(tag);
    setNewTagValue(tag.value);
    if (tag.metadata) {
      try {
        setStyleParams(JSON.parse(tag.metadata));
        setNewTagMetadata(tag.metadata);
      } catch { setNewTagMetadata(tag.metadata || ""); }
    } else {
      setStyleParams({});
      setNewTagMetadata("");
    }
    setShowEditDialog(true);
  }

  function openAddDialog(parentValue?: string) {
    setSelectedParent(parentValue || null);
    setNewTagValue("");
    setNewTagMetadata("");
    setStyleParams({});
    setShowAddDialog(true);
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">标签体系管理</h3>
          <p className="text-sm text-muted-foreground">管理图片知识库的7维标签分类体系</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => initSystemTags.mutate()}
              disabled={initSystemTags.isPending}
            >
              {initSystemTags.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              初始化系统标签
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Left: Dimension List */}
        <div className="lg:col-span-1 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1">标签维度</p>
          {Object.entries(DIMENSION_META).map(([key, meta]) => {
            const dimStats = stats?.[key];
            const isActive = selectedDimension === key;
            return (
              <Card
                key={key}
                className={`cursor-pointer transition-all hover:shadow-sm ${isActive ? "ring-2 ring-primary bg-primary/5" : "hover:bg-muted/50"}`}
                onClick={() => { setSelectedDimension(key); setSelectedParent(null); }}
              >
                <CardContent className="p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium">{meta.label}</span>
                        {meta.hasParent && <FolderTree className="h-3 w-3 text-muted-foreground" />}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className="text-[10px] h-4 px-1">{meta.level}</Badge>
                        {dimStats && (
                          <span className="text-[10px] text-muted-foreground">
                            覆盖 {dimStats.total > 0 ? Math.round((dimStats.labeled / dimStats.total) * 100) : 0}%
                          </span>
                        )}
                      </div>
                    </div>
                    {isActive && <ChevronRight className="h-4 w-4 text-primary" />}
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {/* Stats Summary */}
          {currentStats && (
            <Card className="mt-4">
              <CardHeader className="p-3 pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <BarChart3 className="h-3 w-3" /> 使用统计
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0 space-y-2">
                <div className="flex justify-between text-xs">
                  <span>总数</span>
                  <span className="font-medium">{currentStats.total}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span>已标注</span>
                  <span className="font-medium">{currentStats.labeled}</span>
                </div>
                <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${currentStats.total > 0 ? Math.round((currentStats.labeled / currentStats.total) * 100) : 0}%` }}
                  />
                </div>
                {currentStats.topValues.length > 0 && (
                  <>
                    <Separator className="my-2" />
                    <p className="text-[10px] text-muted-foreground">TOP使用</p>
                    {currentStats.topValues.slice(0, 5).map((tv: any) => (
                      <div key={tv.value} className="flex justify-between text-[11px]">
                        <span className="truncate max-w-[100px]">{tv.value}</span>
                        <Badge variant="outline" className="text-[9px] h-4 px-1">{tv.count}</Badge>
                      </div>
                    ))}
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Tag List & Management */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{DIMENSION_META[selectedDimension]?.icon}</span>
                  <div>
                    <CardTitle className="text-base">{DIMENSION_META[selectedDimension]?.label}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">{DIMENSION_META[selectedDimension]?.description}</p>
                  </div>
                </div>
                <Button size="sm" className="gap-1.5" onClick={() => openAddDialog()}>
                  <PlusCircle className="h-3.5 w-3.5" /> 新增标签
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {tagsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : !tags || tags.length === 0 ? (
                <div className="text-center py-8">
                  <Tag className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">暂无标签</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {isAdmin ? "点击「初始化系统标签」从常量导入预设标签" : "点击「新增标签」添加自定义标签"}
                  </p>
                </div>
              ) : DIMENSION_META[selectedDimension]?.hasParent ? (
                /* Hierarchical display for imageType / sellingPoint */
                <div className="space-y-4">
                  {groupedTags.parents.map((parent: any) => (
                    <div key={parent.id} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="default" className="text-xs">{parent.value}</Badge>
                          {parent.isSystem ? (
                            <Shield className="h-3 w-3 text-blue-500" />
                          ) : (
                            <User className="h-3 w-3 text-green-500" />
                          )}
                          <span className="text-xs text-muted-foreground">
                            {(groupedTags.children[parent.value] || []).length} 个子标签
                          </span>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => openAddDialog(parent.value)}
                            title="添加子标签"
                          >
                            <PlusCircle className="h-3 w-3" />
                          </Button>
                          {(isAdmin || !parent.isSystem) && (
                            <>
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditDialog(parent)}>
                                <Edit3 className="h-3 w-3" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDeleteTag(parent)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 pl-4">
                        {(groupedTags.children[parent.value] || []).map((child: any) => (
                          <div key={child.id} className="group inline-flex items-center gap-1 bg-muted/50 rounded-md px-2 py-1 text-xs hover:bg-muted transition-colors">
                            <span>{child.value}</span>
                            {child.usageCount > 0 && (
                              <Badge variant="outline" className="text-[9px] h-3.5 px-1 ml-0.5">{child.usageCount}</Badge>
                            )}
                            {(isAdmin || !child.isSystem) && (
                              <span className="hidden group-hover:inline-flex gap-0.5 ml-1">
                                <button className="text-muted-foreground hover:text-foreground" onClick={() => openEditDialog(child)}>
                                  <Edit3 className="h-2.5 w-2.5" />
                                </button>
                                <button className="text-muted-foreground hover:text-destructive" onClick={() => handleDeleteTag(child)}>
                                  <Trash2 className="h-2.5 w-2.5" />
                                </button>
                              </span>
                            )}
                          </div>
                        ))}
                        {(groupedTags.children[parent.value] || []).length === 0 && (
                          <span className="text-xs text-muted-foreground italic">暂无子标签</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                /* Flat display for category / color / style / composition / imageBelong */
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {groupedTags.parents.map((tag: any) => (
                      <div
                        key={tag.id}
                        className="group relative inline-flex items-center gap-1.5 border rounded-lg px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                      >
                        <span>{tag.value}</span>
                        {tag.isSystem ? (
                          <Shield className="h-3 w-3 text-blue-500" />
                        ) : (
                          <User className="h-3 w-3 text-green-500" />
                        )}
                        {tag.usageCount > 0 && (
                          <Badge variant="secondary" className="text-[9px] h-4 px-1">{tag.usageCount}</Badge>
                        )}
                        {/* Style params indicator */}
                        {selectedDimension === "style" && tag.metadata && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1 text-amber-600">参数</Badge>
                        )}
                        {(isAdmin || !tag.isSystem) && (
                          <span className="hidden group-hover:inline-flex gap-1 ml-1">
                            <button className="text-muted-foreground hover:text-foreground" onClick={() => openEditDialog(tag)}>
                              <Edit3 className="h-3 w-3" />
                            </button>
                            <button className="text-muted-foreground hover:text-destructive" onClick={() => handleDeleteTag(tag)}>
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Style params detail section */}
                  {selectedDimension === "style" && tags && tags.length > 0 && (
                    <div className="mt-4 border-t pt-4">
                      <p className="text-xs font-medium text-muted-foreground mb-3">风格结构化参数预览</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {tags.filter(t => t.metadata).slice(0, 4).map((tag: any) => {
                          let params: StyleParams = {};
                          try { params = JSON.parse(tag.metadata); } catch {}
                          return (
                            <Card key={tag.id} className="p-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium">{tag.value}</span>
                                {(isAdmin || !tag.isSystem) && (
                                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditDialog(tag)}>
                                    <Edit3 className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                              <div className="space-y-1 text-[11px] text-muted-foreground">
                                {params.lightType && <div><span className="font-medium">光源:</span> {params.lightType}</div>}
                                {params.colorTemp && <div><span className="font-medium">色温:</span> {params.colorTemp}</div>}
                                {params.materialKeywords && <div><span className="font-medium">材质:</span> {params.materialKeywords}</div>}
                                {params.tabooElements && <div><span className="font-medium">禁忌:</span> {params.tabooElements}</div>}
                                {params.refBrands && <div><span className="font-medium">参考品牌:</span> {params.refBrands}</div>}
                                {params.aiKeywords && <div className="truncate"><span className="font-medium">AI关键词:</span> {params.aiKeywords}</div>}
                                {params.styleFeature && <div><span className="font-medium">风格特点:</span> {params.styleFeature}</div>}
                              </div>
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add Tag Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              新增{DIMENSION_META[selectedDimension]?.label}标签
              {selectedParent && <span className="text-sm font-normal text-muted-foreground ml-2">（父级: {selectedParent}）</span>}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>标签值</Label>
              <Input
                value={newTagValue}
                onChange={(e) => setNewTagValue(e.target.value)}
                placeholder={`输入${DIMENSION_META[selectedDimension]?.label}名称`}
                className="mt-1"
              />
            </div>
            {selectedDimension === "style" && (
              <div className="space-y-3">
                <Label className="text-xs font-medium">风格结构化参数</Label>
                <div className="grid grid-cols-1 gap-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">光源类型</Label>
                    <Input
                      value={styleParams.lightType || ""}
                      onChange={(e) => setStyleParams(p => ({ ...p, lightType: e.target.value }))}
                      placeholder="如：柔光箱 + 均匀散射"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">色温范围</Label>
                    <Input
                      value={styleParams.colorTemp || ""}
                      onChange={(e) => setStyleParams(p => ({ ...p, colorTemp: e.target.value }))}
                      placeholder="如：5500-6500K（冷白）"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">材质关键词</Label>
                    <Input
                      value={styleParams.materialKeywords || ""}
                      onChange={(e) => setStyleParams(p => ({ ...p, materialKeywords: e.target.value }))}
                      placeholder="如：哑光塑料、阳极氧化铝、玻璃"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">禁忌元素</Label>
                    <Input
                      value={styleParams.tabooElements || ""}
                      onChange={(e) => setStyleParams(p => ({ ...p, tabooElements: e.target.value }))}
                      placeholder="如：花哨背景、过多文字"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">参考品牌</Label>
                    <Input
                      value={styleParams.refBrands || ""}
                      onChange={(e) => setStyleParams(p => ({ ...p, refBrands: e.target.value }))}
                      placeholder="如：Apple、Dyson、Bose"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">AI关键词（英文）</Label>
                    <Input
                      value={styleParams.aiKeywords || ""}
                      onChange={(e) => setStyleParams(p => ({ ...p, aiKeywords: e.target.value }))}
                      placeholder="如：minimalist product photography, clean white background"
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">风格特点</Label>
                    <Input
                      value={styleParams.styleFeature || ""}
                      onChange={(e) => setStyleParams(p => ({ ...p, styleFeature: e.target.value }))}
                      placeholder="如：线条简洁、大面积留白、高级感质感"
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              </div>
            )}
            {selectedDimension !== "style" && (
              <div>
                <Label className="text-xs text-muted-foreground">元数据（可选，JSON格式）</Label>
                <Textarea
                  value={newTagMetadata}
                  onChange={(e) => setNewTagMetadata(e.target.value)}
                  placeholder='{"key": "value"}'
                  className="mt-1 h-16 text-xs font-mono"
                />
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {isAdmin ? (
                <><Shield className="h-3 w-3 text-blue-500" /> 将创建为系统标签（所有用户可见）</>
              ) : (
                <><User className="h-3 w-3 text-green-500" /> 将创建为自定义标签（仅自己可见）</>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowAddDialog(false)}>取消</Button>
              <Button size="sm" onClick={handleAddTag} disabled={!newTagValue.trim() || createTag.isPending}>
                {createTag.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                创建
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Tag Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>编辑标签</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>标签值</Label>
              <Input
                value={newTagValue}
                onChange={(e) => setNewTagValue(e.target.value)}
                className="mt-1"
              />
            </div>
            {selectedDimension === "style" && (
              <div className="space-y-3">
                <Label className="text-xs font-medium">风格结构化参数</Label>
                <div className="grid grid-cols-1 gap-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">光源类型</Label>
                    <Input
                      value={styleParams.lightType || ""}
                      onChange={(e) => setStyleParams(p => ({ ...p, lightType: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">色温范围</Label>
                    <Input
                      value={styleParams.colorTemp || ""}
                      onChange={(e) => setStyleParams(p => ({ ...p, colorTemp: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">材质关键词</Label>
                    <Input
                      value={styleParams.materialKeywords || ""}
                      onChange={(e) => setStyleParams(p => ({ ...p, materialKeywords: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">禁忌元素</Label>
                    <Input
                      value={styleParams.tabooElements || ""}
                      onChange={(e) => setStyleParams(p => ({ ...p, tabooElements: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">参考品牌</Label>
                    <Input
                      value={styleParams.refBrands || ""}
                      onChange={(e) => setStyleParams(p => ({ ...p, refBrands: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">AI关键词（英文）</Label>
                    <Input
                      value={styleParams.aiKeywords || ""}
                      onChange={(e) => setStyleParams(p => ({ ...p, aiKeywords: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">风格特点</Label>
                    <Input
                      value={styleParams.styleFeature || ""}
                      onChange={(e) => setStyleParams(p => ({ ...p, styleFeature: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              </div>
            )}
            {selectedDimension !== "style" && editingTag?.metadata && (
              <div>
                <Label className="text-xs text-muted-foreground">元数据</Label>
                <Textarea
                  value={newTagMetadata}
                  onChange={(e) => setNewTagMetadata(e.target.value)}
                  className="mt-1 h-16 text-xs font-mono"
                />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowEditDialog(false)}>取消</Button>
              <Button size="sm" onClick={handleEditTag} disabled={updateTag.isPending}>
                {updateTag.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
