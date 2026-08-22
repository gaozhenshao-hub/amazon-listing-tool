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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Shield, ShieldAlert, ShieldCheck, Edit3, Save, Loader2, ChevronDown, ChevronRight,
  Package, FileText, TrendingUp, Headphones, BookOpen, Users,
  Eye, Pencil, Trash2, XCircle, Network, Route, Layers3, UserRoundCheck, AlertTriangle,
  Globe2, Bot, DatabaseZap,
  type LucideIcon,
} from "lucide-react";

const MODULE_ICONS: Record<string, LucideIcon> = {
  dev: Package, listing: FileText, ops: TrendingUp,
  service: Headphones, knowledge: BookOpen, admin: Users,
  offsite: Globe2, emperor: Bot,
};

const MODULE_COLORS: Record<string, string> = {
  dev: "bg-orange-100 text-orange-700",
  listing: "bg-blue-100 text-blue-700",
  ops: "bg-green-100 text-green-700",
  service: "bg-purple-100 text-purple-700",
  knowledge: "bg-amber-100 text-amber-700",
  admin: "bg-red-100 text-red-700",
  offsite: "bg-cyan-100 text-cyan-700",
  emperor: "bg-indigo-100 text-indigo-700",
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
  const usersQuery = trpc.userManagement.list.useQuery();
  const governanceQuery = trpc.roleManagement.governanceSnapshot.useQuery();
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [editModules, setEditModules] = useState<string[]>([]);
  const [editDescription, setEditDescription] = useState("");
  const [editDetailedPerms, setEditDetailedPerms] = useState<ModulePerm[]>([]);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [changePreview, setChangePreview] = useState<any | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchModules, setBatchModules] = useState<string[]>([]);
  const [batchPreview, setBatchPreview] = useState<any | null>(null);

  const updateMutation = trpc.roleManagement.update.useMutation({
    onSuccess: () => {
      toast.success("角色权限已更新");
      utils.roleManagement.list.invalidate();
      utils.roleManagement.governanceSnapshot.invalidate();
      setEditingRole(null);
      setChangePreview(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const previewMutation = trpc.roleManagement.previewUpdate.useMutation({
    onSuccess: (preview) => setChangePreview(preview),
    onError: (err) => toast.error(err.message),
  });

  const batchUpdateMutation = trpc.roleManagement.batchUpdate.useMutation({
    onSuccess: () => {
      toast.success("批量角色模板已更新");
      utils.roleManagement.list.invalidate();
      utils.roleManagement.governanceSnapshot.invalidate();
      setSelectedRoles(new Set());
      setBatchDialogOpen(false);
      setBatchPreview(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const buildBatchPayload = () => ({
    updates: (roles || []).filter(role => selectedRoles.has(role.role)).map(role => ({
      role: role.role,
      modules: batchModules,
      description: role.description || undefined,
    })),
  });

  const handleBatchPreview = async () => {
    if (selectedRoles.size === 0) return;
    try {
      setBatchPreview(await utils.roleManagement.batchPreview.fetch(buildBatchPayload()));
    } catch (error: any) {
      toast.error(error?.message || "批量权限预览失败");
    }
  };

  const toggleBatchModule = (moduleId: string) => {
    setBatchPreview(null);
    setBatchModules(previous => previous.includes(moduleId) ? previous.filter(item => item !== moduleId) : [...previous, moduleId]);
  };

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
    setChangePreview(null);
  }, []);

  const handleToggleModule = useCallback((moduleId: string) => {
    setChangePreview(null);
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
    setChangePreview(null);
    setEditDetailedPerms(prev => prev.map(p => {
      if (p.moduleId !== moduleId) return p;
      const ops = p.operations.includes(op)
        ? p.operations.filter(o => o !== op)
        : [...p.operations, op];
      return { ...p, operations: ops };
    }));
  }, []);

  const handleToggleSubModuleOp = useCallback((moduleId: string, subModuleId: string, op: string) => {
    setChangePreview(null);
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

  const handleGrantAll = useCallback(() => {
    if (!modules) return;
    // Enable all modules
    const allModuleIds = modules.map(m => m.id);
    setEditModules(allModuleIds);
    // Grant full permissions (read/edit/delete) for all modules and all sub-modules
    setEditDetailedPerms(modules.map(mod => ({
      moduleId: mod.id,
      operations: ['read', 'edit', 'delete'],
      subModules: (mod.subModules || []).map(sub => ({
        subModuleId: sub.id,
        operations: ['read', 'edit', 'delete'],
      })),
    })));
    // Expand all modules to show the result
    setExpandedModules(new Set(allModuleIds));
    setChangePreview(null);
    toast.success("已授予所有模块及子模块的全部权限");
  }, [modules]);

  const handleRevokeAll = useCallback(() => {
    setEditModules([]);
    setEditDetailedPerms([]);
    setExpandedModules(new Set());
    setChangePreview(null);
    toast.info("已清除所有模块权限");
  }, []);

  const buildEditPayload = () => ({
    role: editingRole || "",
    modules: editModules,
    description: editDescription || undefined,
    detailedPermissions: editDetailedPerms as any,
  });

  const handlePreview = () => {
    if (!editingRole) return;
    previewMutation.mutate(buildEditPayload());
  };

  const handleSave = () => {
    if (!editingRole) return;
    if (!changePreview) {
      toast.info("请先查看变更影响与风险提示");
      handlePreview();
      return;
    }
    updateMutation.mutate(buildEditPayload());
  };

  const stats = useMemo(() => {
    const activeMembers = (usersQuery.data || []).filter((user) => user.status === "active").length;
    const moduleCount = modules?.length || 0;
    const subModuleCount = (modules || []).reduce((sum, module) => sum + (module.subModules?.length || 0), 0);
    if (!roles) return { total: 0, withAdmin: 0, avgModules: 0, activeMembers, moduleCount, subModuleCount, customizedRoles: 0 };
    return {
      total: roles.length,
      withAdmin: roles.filter(r => r.modules.includes("admin")).length,
      avgModules: Math.round(roles.reduce((sum, r) => sum + r.modules.length, 0) / roles.length * 10) / 10,
      activeMembers,
      moduleCount,
      subModuleCount,
      customizedRoles: roles.filter((role) => role.detailedPermissions?.length).length,
    };
  }, [roles, usersQuery.data, modules]);

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
      <div className="rounded-2xl border bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 p-6 text-white shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium text-indigo-200">
              <ShieldCheck className="h-4 w-4" />
              单公司权限治理中心
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">公司成员、角色模板与业务资源的统一授权</h1>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              权限目录已统一覆盖模块、子模块、页面路由与资源映射。当前页面只展示与配置，不会自动改变任何成员的实际访问结果。
            </p>
          </div>
          <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-slate-200">
            <div className="flex items-center gap-2 font-medium"><Network className="h-4 w-4 text-emerald-300" />统一目录已连接</div>
            <p className="mt-1 text-xs text-slate-300">角色模板 → 路由目录 → 资源授权</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <Shield className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.activeMembers}</p>
              <p className="text-xs text-muted-foreground">活跃公司成员</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-red-100 flex items-center justify-center">
              <ShieldAlert className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs text-muted-foreground">角色模板</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
              <Package className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.moduleCount}</p>
              <p className="text-xs text-muted-foreground">一级模块目录</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-indigo-100 flex items-center justify-center">
              <Layers3 className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.subModuleCount}</p>
              <p className="text-xs text-muted-foreground">二级权限目录</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl bg-muted/60 p-1">
          <TabsTrigger value="overview" className="gap-1.5"><ShieldCheck className="h-3.5 w-3.5" />权限总览</TabsTrigger>
          <TabsTrigger value="roles" className="gap-1.5"><Users className="h-3.5 w-3.5" />角色模板</TabsTrigger>
          <TabsTrigger value="members" className="gap-1.5"><UserRoundCheck className="h-3.5 w-3.5" />成员影响</TabsTrigger>
          <TabsTrigger value="resources" className="gap-1.5"><DatabaseZap className="h-3.5 w-3.5" />资源动作字典</TabsTrigger>
          <TabsTrigger value="catalog" className="gap-1.5"><Route className="h-3.5 w-3.5" />权限目录</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">最终权限如何计算</CardTitle>
                <CardDescription>所有成员位于同一公司，权限按固定顺序叠加并记录来源。</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-4">
                  {[
                    ["1", "角色模板", "岗位的模块与操作基线"],
                    ["2", "成员状态", "启用、禁用与角色归属"],
                    ["3", "资源范围", "项目、ASIN与资产授权"],
                    ["4", "例外策略", "单独允许或拒绝（拒绝优先）"],
                  ].map(([step, title, description], index) => (
                    <div key={title} className="relative rounded-xl border bg-muted/20 p-3">
                      {index < 3 && <div className="absolute -right-3 top-1/2 hidden h-px w-6 bg-border sm:block" />}
                      <span className="text-xs font-semibold text-primary">{step}</span>
                      <p className="mt-1 text-sm font-medium">{title}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card className="border-amber-200 bg-amber-50/40">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base text-amber-900"><AlertTriangle className="h-4 w-4" />待治理关注项</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-amber-900">
                <div className="flex justify-between gap-3"><span>含管理模块角色</span><strong>{stats.withAdmin}</strong></div>
                <div className="flex justify-between gap-3"><span>存在细粒度配置的角色</span><strong>{stats.customizedRoles}</strong></div>
                <p className="border-t border-amber-200 pt-2 text-xs leading-5 text-amber-800">目录同步阶段新增的路由目前处于“仅目录”模式，待管理员审核角色模板后再启用强制拦截。</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><UserRoundCheck className="h-4 w-4 text-primary" />成员授权入口</CardTitle>
              <CardDescription>成员账户、状态与角色分配继续由“用户管理”维护；此处展示当前公司权限治理基线。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {(usersQuery.data || []).slice(0, 12).map((user) => (
                <Badge key={user.id} variant="outline" className="gap-1.5 px-2.5 py-1">
                  <span className={user.status === "active" ? "h-1.5 w-1.5 rounded-full bg-emerald-500" : "h-1.5 w-1.5 rounded-full bg-muted-foreground"} />
                  {user.name || user.email || `用户 ${user.id}`} · {user.role}
                </Badge>
              ))}
              {!usersQuery.isLoading && !(usersQuery.data || []).length && <span className="text-sm text-muted-foreground">暂无成员数据</span>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="members" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">成员与角色影响</CardTitle>
              <CardDescription>所有成员属于同一公司默认工作空间。此视图只解释角色模板变更影响；成员角色调整仍由用户管理页面执行。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {(governanceQuery.data?.roleMembers || []).map((item) => (
                  <div key={item.role} className="rounded-xl border bg-muted/20 p-3">
                    <p className="text-sm font-medium">{roles?.find(role => role.role === item.role)?.label || item.role}</p>
                    <p className="mt-1 text-2xl font-semibold">{item.activeMemberCount}</p>
                    <p className="text-xs text-muted-foreground">活跃成员 · 停用 {item.inactiveMemberCount}</p>
                  </div>
                ))}
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>成员</TableHead><TableHead>角色</TableHead><TableHead>部门/职务</TableHead><TableHead>状态</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(governanceQuery.data?.members || []).map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">{member.name || `成员 ${member.id}`}</TableCell>
                      <TableCell>{roles?.find(role => role.role === member.role)?.label || member.role}</TableCell>
                      <TableCell className="text-muted-foreground">{[member.department, member.jobTitle].filter(Boolean).join(" / ") || "—"}</TableCell>
                      <TableCell><Badge variant={member.status === "active" ? "secondary" : "outline"}>{member.status === "active" ? "启用" : "停用"}</Badge></TableCell>
                    </TableRow>
                  ))}
                  {!governanceQuery.isLoading && !(governanceQuery.data?.members || []).length && <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">暂无成员数据</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="resources" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">服务端资源授权字典</CardTitle>
              <CardDescription>后端资源动作会收敛为读、编辑或删除操作；此表仅解释授权语义，不展示密钥或业务对象。</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>资源</TableHead><TableHead>所属模块</TableHead><TableHead>二级模块</TableHead><TableHead>动作映射</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(governanceQuery.data?.resources || []).map((resource) => {
                    const mappedActions = Object.entries(governanceQuery.data?.actionOperationMap || {}).reduce<Record<string, string[]>>((acc, [action, operation]) => {
                      (acc[operation] ||= []).push(action); return acc;
                    }, {});
                    return <TableRow key={resource.resource}>
                      <TableCell className="font-mono text-xs">{resource.resource}</TableCell>
                      <TableCell>{modules?.find(module => module.id === resource.moduleId)?.label || resource.moduleId}</TableCell>
                      <TableCell className="text-muted-foreground">{modules?.find(module => module.id === resource.moduleId)?.subModules?.find(sub => sub.id === resource.subModuleId)?.label || "模块级"}</TableCell>
                      <TableCell><div className="flex flex-wrap gap-1">{Object.entries(mappedActions).map(([operation, actions]) => <Badge key={operation} variant="outline" className="text-xs">{OP_LABELS[operation]}：{actions.join("、")}</Badge>)}</div></TableCell>
                    </TableRow>;
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="space-y-4">
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
                <TableHead className="w-[42px]">选择</TableHead>
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
                  <TableCell colSpan={6} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : !roles?.length ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    暂无角色数据
                  </TableCell>
                </TableRow>
              ) : (
                roles.map(role => {
                  const restrictedCount = getPermSummary(role);
                  return (
                    <TableRow key={role.role}>
                      <TableCell>
                        <Checkbox
                          checked={selectedRoles.has(role.role)}
                          onCheckedChange={(checked) => setSelectedRoles(previous => {
                            const next = new Set(previous);
                            if (checked) next.add(role.role); else next.delete(role.role);
                            setBatchPreview(null);
                            return next;
                          })}
                          aria-label={`选择角色 ${role.label}`}
                        />
                      </TableCell>
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
          {selectedRoles.size > 0 && (
            <div className="flex items-center justify-between gap-3 border-t bg-slate-50 px-4 py-3">
              <p className="text-sm text-slate-700">已选择 <strong>{selectedRoles.size}</strong> 个角色。批量操作将覆盖所选角色的模块集合，提交前必须预览影响。</p>
              <Button size="sm" onClick={() => { setBatchModules([]); setBatchPreview(null); setBatchDialogOpen(true); }}>
                <Layers3 className="mr-1 h-4 w-4" />批量配置
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>批量配置角色模块</DialogTitle>
            <DialogDescription>将统一替换已选角色的模块集合。操作不会自动修改成员角色；请先查看服务端计算的影响范围与风险。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-700">目标角色：{(roles || []).filter(role => selectedRoles.has(role.role)).map(role => role.label).join("、") || "未选择"}</p>
            <div className="grid grid-cols-2 gap-2 rounded-md border p-3 sm:grid-cols-3">
              {(modules || []).map(module => (
                <label key={module.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={batchModules.includes(module.id)} onCheckedChange={() => toggleBatchModule(module.id)} />
                  {module.label}
                </label>
              ))}
            </div>
            {batchPreview && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />最高风险：{batchPreview.highestRisk}；受影响成员：{batchPreview.totalAffectedMemberCount}</div>
                <p className="mt-1 text-xs">已生成 {batchPreview.previews?.length || 0} 个角色的服务端预览。提交后会为每个角色写入脱敏安全审计。</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchDialogOpen(false)}>取消</Button>
            <Button variant="secondary" onClick={handleBatchPreview}>查看影响</Button>
            <Button disabled={!batchPreview || batchUpdateMutation.isPending} onClick={() => batchUpdateMutation.mutate(buildBatchPayload())}>
              {batchUpdateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}确认批量更新
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

        </TabsContent>

        <TabsContent value="catalog" className="space-y-4">
      {/* Module Legend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">模块与子模块说明</CardTitle>
          <CardDescription>每个一级模块下包含多个二级子模块，可分别控制权限</CardDescription>
        </CardHeader>
        <CardContent>
            <div className="mb-4 flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">已强制 {(governanceQuery.data?.routes || []).filter(route => route.enforcement === "enforced").length} 条</Badge>
              <Badge variant="outline">目录观察 {(governanceQuery.data?.routes || []).filter(route => route.enforcement === "catalog_only").length} 条</Badge>
              <span className="self-center text-muted-foreground">目录观察态不会改变当前成员访问结果。</span>
            </div>
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
        </TabsContent>
      </Tabs>

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
                onChange={e => { setEditDescription(e.target.value); setChangePreview(null); }}
                placeholder="输入角色描述..."
              />
            </div>
            <div className="rounded-xl border border-dashed bg-muted/30 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">变更影响预览</p>
                  <p className="text-xs text-muted-foreground">先由服务端校验目录与风险；预览不会写入任何授权。</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={handlePreview} disabled={previewMutation.isPending}>
                  {previewMutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}查看影响
                </Button>
              </div>
              {changePreview && <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                <div className="rounded-lg bg-background p-2">影响成员 <strong>{changePreview.affectedMemberCount}</strong></div>
                <div className="rounded-lg bg-background p-2">风险等级 <strong>{changePreview.riskLevel}</strong></div>
                <div className="rounded-lg bg-background p-2">模块变更 <strong>+{changePreview.addedModules.length} / -{changePreview.removedModules.length}</strong></div>
                {(changePreview.requiresExplicitConfirmation || changePreview.addedModules.length || changePreview.removedModules.length) && <p className="sm:col-span-3 text-amber-700">保存后会更新角色模板并写入脱敏审计；不会自动变更成员角色、项目或ASIN范围。</p>}
              </div>}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>模块权限（点击展开配置操作级别和子模块）</Label>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1 text-green-600 border-green-200 hover:bg-green-50 hover:text-green-700"
                    onClick={handleGrantAll}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    一键全部授权
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1 text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600"
                    onClick={handleRevokeAll}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    清除全部
                  </Button>
                </div>
              </div>
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
