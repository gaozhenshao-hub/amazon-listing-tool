import { useState, useMemo } from "react";
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
  Shield, ShieldAlert, Edit3, Save, Loader2,
  Package, FileText, TrendingUp, Headphones, BookOpen, Users,
  type LucideIcon,
} from "lucide-react";

const MODULE_ICONS: Record<string, LucideIcon> = {
  dev: Package,
  listing: FileText,
  ops: TrendingUp,
  service: Headphones,
  knowledge: BookOpen,
  admin: Users,
};

const MODULE_COLORS: Record<string, string> = {
  dev: "bg-orange-100 text-orange-700",
  listing: "bg-blue-100 text-blue-700",
  ops: "bg-green-100 text-green-700",
  service: "bg-purple-100 text-purple-700",
  knowledge: "bg-amber-100 text-amber-700",
  admin: "bg-red-100 text-red-700",
};

export default function RoleManagement() {
  const utils = trpc.useUtils();
  const { data: roles, isLoading } = trpc.roleManagement.list.useQuery();
  const { data: modules } = trpc.roleManagement.modules.useQuery();
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [editModules, setEditModules] = useState<string[]>([]);
  const [editDescription, setEditDescription] = useState("");

  const updateMutation = trpc.roleManagement.update.useMutation({
    onSuccess: () => {
      toast.success("角色权限已更新");
      utils.roleManagement.list.invalidate();
      setEditingRole(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleEdit = (role: any) => {
    setEditingRole(role.role);
    setEditModules([...role.modules]);
    setEditDescription(role.description || "");
  };

  const handleToggleModule = (moduleId: string) => {
    setEditModules(prev =>
      prev.includes(moduleId)
        ? prev.filter(m => m !== moduleId)
        : [...prev, moduleId]
    );
  };

  const handleSave = () => {
    if (!editingRole) return;
    updateMutation.mutate({
      role: editingRole,
      modules: editModules,
      description: editDescription || undefined,
    });
  };

  // Stats
  const stats = useMemo(() => {
    if (!roles) return { total: 0, withAdmin: 0, avgModules: 0 };
    return {
      total: roles.length,
      withAdmin: roles.filter(r => r.modules.includes("admin")).length,
      avgModules: Math.round(roles.reduce((sum, r) => sum + r.modules.length, 0) / roles.length * 10) / 10,
    };
  }, [roles]);

  const editingRoleData = roles?.find(r => r.role === editingRole);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">角色权限管理</h1>
          <p className="text-sm text-muted-foreground mt-1">管理各角色的模块访问权限，控制团队成员可使用的功能范围</p>
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
          <CardDescription>查看和编辑每个角色可访问的功能模块</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">角色</TableHead>
                <TableHead>可访问模块</TableHead>
                <TableHead className="w-[100px]">模块数</TableHead>
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
                roles.map(role => (
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
                      <Badge variant="outline" className="text-xs">
                        {role.modules.length} / {modules?.length || 6}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {role.updatedAt ? new Date(role.updatedAt).toLocaleDateString("zh-CN") : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      {!role.isSystem ? (
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(role)}>
                          <Edit3 className="h-4 w-4" />
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">系统角色</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Module Legend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">模块说明</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {(modules || []).map(mod => {
              const Icon = MODULE_ICONS[mod.id] || Package;
              return (
                <div key={mod.id} className="flex items-start gap-3 p-3 rounded-lg border">
                  <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${MODULE_COLORS[mod.id] || "bg-gray-100"}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{mod.label}</p>
                    <p className="text-xs text-muted-foreground">{mod.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editingRole} onOpenChange={(open) => { if (!open) setEditingRole(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑角色权限: {editingRoleData?.label}</DialogTitle>
            <DialogDescription>
              选择该角色可以访问的功能模块
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
              <Label>模块权限</Label>
              <div className="space-y-3 border rounded-lg p-4">
                {(modules || []).map(mod => {
                  const Icon = MODULE_ICONS[mod.id] || Package;
                  const isChecked = editModules.includes(mod.id);
                  return (
                    <div
                      key={mod.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        isChecked ? "bg-primary/5 border-primary/30" : "hover:bg-accent"
                      }`}
                      onClick={() => handleToggleModule(mod.id)}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => handleToggleModule(mod.id)}
                      />
                      <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${MODULE_COLORS[mod.id] || "bg-gray-100"}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-sm">{mod.label}</p>
                        <p className="text-xs text-muted-foreground">{mod.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
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
