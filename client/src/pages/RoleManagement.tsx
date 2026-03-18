import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Shield, ShieldAlert, Edit3, Save, Loader2, ChevronDown, ChevronRight,
  Package, FileText, TrendingUp, Headphones, BookOpen, Users,
  Eye, Pencil, Trash2,
  type LucideIcon,
} from "lucide-react";

const MODULE_ICONS: Record<string, LucideIcon> = {
  dev: Package, listing: FileText, ops: TrendingUp,
  service: Headphones, knowledge: BookOpen, admin: Users,
};

const MODULE_COLORS: Record<string, string> = {
  dev: "bg-orange-100 text-orange-700",
  listing: "bg-blue-100 text-blue-700",
  ops: "bg-green-100 text-green-700",
  service: "bg-purple-100 text-purple-700",
  knowledge: "bg-amber-100 text-amber-700",
  admin: "bg-red-100 text-red-700",
};

const OP_ICONS: Record<string, LucideIcon> = { read: Eye, edit: Pencil, delete: Trash2 };
const OP_LABELS: Record<string, string> = { read: "只读", edit: "编辑", delete: "删除" };
const OP_COLORS: Record<string, string> = {
  read: "text-blue-600", edit: "text-amber-600", delete: "text-red-600",
};

interface SubModulePerm { subModuleId: string; operations: string[]; }
interface ModulePerm { moduleId: string; operations: string[]; subModules?: SubModulePerm[]; }

export default function RoleManagement() {
  const utils = trpc.useUtils();
  const { data: roles, isLoading } = trpc.roleManagement.list.useQuery();
  const { data: modules } = trpc.roleManagement.modules.useQuery();
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [editModules, setEditModules] = useState<string[]>([]);
  const [editDescription, setEditDescription] = useState("");
  const [editDetailedPerms, setEditDetailedPerms] = useState<ModulePerm[]>([]);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  const updateMutation = trpc.roleManagement.update.useMutation({
    onSuccess: () => {
      toast.success("角色权限已更新");
      utils.roleManagement.list.invalidate();
      setEditingRole(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleEdit = useCallback((role: any) => {
    setEditingRole(role.role);
    setEditModules([...role.modules]);
    setEditDescription(role.description || "");
    // Initialize detailed permissions from existing data or create defaults
    if (role.detailedPermissions?.length) {
      setEditDetailedPerms(role.detailedPermissions);
    } else {
      // Default: all enabled modules get full permissions
      setEditDetailedPerms(role.modules.map((modId: string) => ({
        moduleId: modId,
        operations: ['read', 'edit', 'delete'],
        subModules: [],
      })));
    }
    setExpandedModules(new Set());
  }, []);

  const handleToggleModule = useCallback((moduleId: string) => {
    setEditModules(prev => {
      const next = prev.includes(moduleId)
        ? prev.filter(m => m !== moduleId)
        : [...prev, moduleId];
      // Also update detailed permissions
      setEditDetailedPerms(dp => {
        if (next.includes(moduleId)) {
          if (!dp.find(p => p.moduleId === moduleId)) {
            return [...dp, { moduleId, operations: ['read', 'edit', 'delete'], subModules: [] }];
          }
          return dp;
        }
        return dp.filter(p => p.moduleId !== moduleId);
      });
      return next;
    });
  }, []);

  const handleToggleModuleOp = useCallback((moduleId: string, op: string) => {
    setEditDetailedPerms(prev => prev.map(p => {
      if (p.moduleId !== moduleId) return p;
      const ops = p.operations.includes(op)
        ? p.operations.filter(o => o !== op)
        : [...p.operations, op];
      return { ...p, operations: ops };
    }));
  }, []);

  const handleToggleSubModuleOp = useCallback((moduleId: string, subModuleId: string, op: string) => {
    setEditDetailedPerms(prev => prev.map(p => {
      if (p.moduleId !== moduleId) return p;
      const subs = p.subModules || [];
      const existingSub = subs.find(s => s.subModuleId === subModuleId);
      let newSubs: SubModulePerm[];
      if (existingSub) {
        const ops = existingSub.operations.includes(op)
          ? existingSub.operations.filter(o => o !== op)
          : [...existingSub.operations, op];
        newSubs = subs.map(s => s.subModuleId === subModuleId ? { ...s, operations: ops } : s);
      } else {
        newSubs = [...subs, { subModuleId, operations: [op] }];
      }
      return { ...p, subModules: newSubs };
    }));
  }, []);

  const toggleExpand = useCallback((moduleId: string) => {
    setExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }, []);

  const handleSave = () => {
    if (!editingRole) return;
    updateMutation.mutate({
      role: editingRole,
      modules: editModules,
      description: editDescription || undefined,
      detailedPermissions: editDetailedPerms as any,
    });
  };

  const stats = useMemo(() => {
    if (!roles) return { total: 0, withAdmin: 0, avgModules: 0 };
    return {
      total: roles.length,
      withAdmin: roles.filter(r => r.modules.includes("admin")).length,
      avgModules: Math.round(roles.reduce((sum, r) => sum + r.modules.length, 0) / roles.length * 10) / 10,
    };
  }, [roles]);

  const editingRoleData = roles?.find(r => r.role === editingRole);

  const getSubModuleOps = (moduleId: string, subModuleId: string): string[] => {
    const perm = editDetailedPerms.find(p => p.moduleId === moduleId);
    const sub = perm?.subModules?.find(s => s.subModuleId === subModuleId);
    return sub?.operations || [];
  };

  const getModuleOps = (moduleId: string): string[] => {
    const perm = editDetailedPerms.find(p => p.moduleId === moduleId);
    return perm?.operations || [];
  };

  // Summary of detailed permissions for display
  const getPermSummary = (role: any) => {
    if (!role.detailedPermissions?.length) return null;
    const restricted = role.detailedPermissions.filter(
      (p: ModulePerm) => p.operations.length < 3 || (p.subModules && p.subModules.length > 0)
    );
    if (restricted.length === 0) return null;
    return restricted.length;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">角色权限管理</h1>
          <p className="text-sm text-muted-foreground mt-1">
            管理各角色的模块访问权限，支持操作级别（只读/编辑/删除）和二级模块的精细控制
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <Shield className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs text-muted-foreground">角色总数</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-red-100 flex items-center justify-center">
              <ShieldAlert className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.withAdmin}</p>
              <p className="text-xs text-muted-foreground">含管理权限</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
              <Package className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.avgModules}</p>
              <p className="text-xs text-muted-foreground">平均模块数</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Role Permission Matrix */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">权限矩阵</CardTitle>
          <CardDescription>查看和编辑每个角色的模块访问权限和操作级别</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">角色</TableHead>
                <TableHead>可访问模块</TableHead>
                <TableHead className="w-[100px]">细粒度</TableHead>
                <TableHead className="w-[120px]">最后更新</TableHead>
                <TableHead className="text-right w-[80px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : !roles?.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    暂无角色数据
                  </TableCell>
                </TableRow>
              ) : (
                roles.map(role => {
                  const restrictedCount = getPermSummary(role);
                  return (
                    <TableRow key={role.role}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {role.role === "super_admin" && <ShieldAlert className="h-4 w-4 text-amber-500" />}
                          {role.role === "admin" && <Shield className="h-4 w-4 text-blue-500" />}
                          <div>
                            <p className="font-medium text-sm">{role.label}</p>
                            {role.description && (
                              <p className="text-xs text-muted-foreground truncate max-w-[140px]">{role.description}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1.5">
                          {role.modules.map(modId => {
                            const mod = modules?.find(m => m.id === modId);
                            const Icon = MODULE_ICONS[modId] || Package;
                            return (
                              <Badge
                                key={modId}
                                variant="secondary"
                                className={`text-xs gap-1 ${MODULE_COLORS[modId] || ""}`}
                              >
                                <Icon className="h-3 w-3" />
                                {mod?.label || modId}
                              </Badge>
                            );
                          })}
                          {role.modules.length === 0 && (
                            <span className="text-xs text-muted-foreground">无权限</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {restrictedCount ? (
                          <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                            {restrictedCount}项定制
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">默认</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {role.updatedAt ? new Date(role.updatedAt).toLocaleDateString("zh-CN") : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => handleEdit(role)}>
                          <Edit3 className="h-4 w-4 mr-1" />
                          编辑
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Module Legend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">模块与子模块说明</CardTitle>
          <CardDescription>每个一级模块下包含多个二级子模块，可分别控制权限</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(modules || []).map(mod => {
              const Icon = MODULE_ICONS[mod.id] || Package;
              return (
                <div key={mod.id} className="border rounded-lg overflow-hidden">
                  <div className="flex items-start gap-3 p-3 bg-accent/30">
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${MODULE_COLORS[mod.id] || "bg-gray-100"}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{mod.label}</p>
                      <p className="text-xs text-muted-foreground">{mod.description}</p>
                    </div>
                  </div>
                  {mod.subModules?.length > 0 && (
                    <div className="px-3 py-2 space-y-1">
                      {mod.subModules.map(sub => (
                        <div key={sub.id} className="flex items-center gap-2 text-xs text-muted-foreground py-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                          {sub.label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog - Fine-grained permissions */}
      <Dialog open={!!editingRole} onOpenChange={(open) => { if (!open) setEditingRole(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>编辑角色权限: {editingRoleData?.label}</DialogTitle>
            <DialogDescription>
              选择模块访问权限，展开模块可配置操作级别和二级子模块权限
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>角色描述</Label>
              <Input
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                placeholder="输入角色描述..."
              />
            </div>
            <div className="space-y-2">
              <Label>模块权限（点击展开配置操作级别和子模块）</Label>
              <div className="space-y-2 border rounded-lg p-3">
                {(modules || []).map(mod => {
                  const Icon = MODULE_ICONS[mod.id] || Package;
                  const isChecked = editModules.includes(mod.id);
                  const isExpanded = expandedModules.has(mod.id);
                  const modOps = getModuleOps(mod.id);
                  const hasSubModules = mod.subModules && mod.subModules.length > 0;

                  return (
                    <div key={mod.id} className={`border rounded-lg overflow-hidden transition-colors ${
                      isChecked ? "border-primary/30 bg-primary/5" : ""
                    }`}>
                      {/* Module header */}
                      <div className="flex items-center gap-3 p-3">
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => handleToggleModule(mod.id)}
                        />
                        <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${MODULE_COLORS[mod.id] || "bg-gray-100"}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm">{mod.label}</p>
                          <p className="text-xs text-muted-foreground truncate">{mod.description}</p>
                        </div>
                        {isChecked && (
                          <div className="flex items-center gap-2">
                            {/* Operation badges */}
                            <div className="flex gap-1">
                              {['read', 'edit', 'delete'].map(op => {
                                const OpIcon = OP_ICONS[op];
                                return (
                                  <button
                                    key={op}
                                    onClick={(e) => { e.stopPropagation(); handleToggleModuleOp(mod.id, op); }}
                                    className={`p-1 rounded transition-colors ${
                                      modOps.includes(op)
                                        ? `${OP_COLORS[op]} bg-accent`
                                        : "text-muted-foreground/30 hover:text-muted-foreground/60"
                                    }`}
                                    title={`${OP_LABELS[op]}${modOps.includes(op) ? '（已启用）' : '（已禁用）'}`}
                                  >
                                    <OpIcon className="h-3.5 w-3.5" />
                                  </button>
                                );
                              })}
                            </div>
                            {hasSubModules && (
                              <Button
                                variant="ghost" size="sm"
                                className="h-7 w-7 p-0"
                                onClick={(e) => { e.stopPropagation(); toggleExpand(mod.id); }}
                              >
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Sub-modules (expanded) */}
                      {isChecked && isExpanded && hasSubModules && (
                        <div className="border-t bg-accent/20 px-3 py-2 space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground mb-2">二级子模块权限</p>
                          {mod.subModules!.map(sub => {
                            const subOps = getSubModuleOps(mod.id, sub.id);
                            return (
                              <div key={sub.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-accent/50">
                                <span className="text-sm">{sub.label}</span>
                                <div className="flex gap-1">
                                  {['read', 'edit', 'delete'].map(op => {
                                    const OpIcon = OP_ICONS[op];
                                    const isActive = subOps.includes(op);
                                    return (
                                      <button
                                        key={op}
                                        onClick={() => handleToggleSubModuleOp(mod.id, sub.id, op)}
                                        className={`p-1 rounded transition-colors ${
                                          isActive
                                            ? `${OP_COLORS[op]} bg-background`
                                            : "text-muted-foreground/30 hover:text-muted-foreground/60"
                                        }`}
                                        title={`${sub.label} - ${OP_LABELS[op]}`}
                                      >
                                        <OpIcon className="h-3.5 w-3.5" />
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Legend */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground border-t pt-3">
              <span className="font-medium">图标说明:</span>
              <span className="flex items-center gap-1"><Eye className="h-3 w-3 text-blue-600" /> 只读</span>
              <span className="flex items-center gap-1"><Pencil className="h-3 w-3 text-amber-600" /> 编辑</span>
              <span className="flex items-center gap-1"><Trash2 className="h-3 w-3 text-red-600" /> 删除</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRole(null)}>取消</Button>
            <Button onClick={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Save className="mr-2 h-4 w-4" />
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
