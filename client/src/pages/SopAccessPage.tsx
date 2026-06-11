import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Shield,
  Globe,
  Users as UsersIcon,
  Lock,
  BookOpen,
  Settings,
  UserPlus,
  Loader2,
  AlertCircle,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { ROLE_LABELS, ADMIN_ROLES } from "@shared/const";

const ACCESS_LEVEL_CONFIG: Record<string, { label: string; icon: typeof Globe; color: string; description: string }> = {
  public: { label: "全员可见", icon: Globe, color: "bg-emerald-100 text-emerald-700", description: "所有角色都可以查看" },
  team: { label: "团队可见", icon: UsersIcon, color: "bg-blue-100 text-blue-700", description: "仅指定角色可查看" },
  restricted: { label: "受限访问", icon: Lock, color: "bg-amber-100 text-amber-700", description: "仅授权用户可查看" },
};

const VISIBILITY_MAP: Record<string, string> = {
  public: "public",
  team: "team",
  restricted: "private",
};

const ROLE_OPTIONS = [
  { value: "ops_manager", label: "运营主管" },
  { value: "ops_specialist", label: "运营专员" },
  { value: "product_dev", label: "产品开发" },
  { value: "finance", label: "财务" },
  { value: "purchaser", label: "采购" },
  { value: "designer", label: "美工" },
];

export default function SopAccessPage() {
  const { user } = useAuth();
  const [visibilityDialogOpen, setVisibilityDialogOpen] = useState(false);
  const [grantDialogOpen, setGrantDialogOpen] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<any>(null);
  const [newAccessLevel, setNewAccessLevel] = useState("public");
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [grantUserIds, setGrantUserIds] = useState<number[]>([]);
  const [grantLevel, setGrantLevel] = useState<"intermediate" | "advanced">("intermediate");

  const isAdmin = user && ADMIN_ROLES.includes(user.role as any);

  // Query all accessible SOPs
  const skillsQuery = trpc.sopAccess.listAccessible.useQuery({ page: 1, pageSize: 200 });
  const usersQuery = trpc.userManagement.list.useQuery(undefined, { enabled: grantDialogOpen });
  const grantsQuery = trpc.sopAccess.listGrants.useQuery(undefined, { enabled: isAdmin === true });

  // Mutations
  const updateVisibilityMutation = trpc.sopAccess.updateSkillVisibility.useMutation({
    onSuccess: () => {
      toast.success("可见性已更新");
      skillsQuery.refetch();
      setVisibilityDialogOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const grantAccessMutation = trpc.sopAccess.grantAccess.useMutation({
    onSuccess: (data) => {
      toast.success(`授权成功，共 ${data.successCount} 人`);
      grantsQuery.refetch();
      setGrantDialogOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeAccessMutation = trpc.sopAccess.revokeAccess.useMutation({
    onSuccess: () => {
      toast.success("已撤销授权");
      grantsQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const skills = skillsQuery.data?.items || [];

  const openVisibilityDialog = (skill: any) => {
    setSelectedSkill(skill);
    setNewAccessLevel(skill.accessLevel || "public");
    try {
      setSelectedRoles(skill.allowedRoles ? JSON.parse(skill.allowedRoles) : []);
    } catch {
      setSelectedRoles([]);
    }
    setVisibilityDialogOpen(true);
  };

  const openGrantDialog = (skill: any) => {
    setSelectedSkill(skill);
    setGrantUserIds([]);
    setGrantLevel("intermediate");
    setGrantDialogOpen(true);
  };

  const handleSaveVisibility = () => {
    if (!selectedSkill) return;
    updateVisibilityMutation.mutate({
      id: selectedSkill.id,
      visibility: (VISIBILITY_MAP[newAccessLevel] || "public") as "private" | "team" | "public",
      accessLevel: newAccessLevel as "public" | "team" | "restricted",
      allowedRoles: newAccessLevel === "team" ? JSON.stringify(selectedRoles) : undefined,
    });
  };

  const handleGrantAccess = () => {
    if (grantUserIds.length === 0) return;
    grantAccessMutation.mutate({
      userIds: grantUserIds,
      skillLevel: grantLevel,
    });
  };

  const toggleRole = (role: string) => {
    setSelectedRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
  };

  const toggleGrantUser = (userId: number) => {
    setGrantUserIds(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Shield className="h-7 w-7 text-primary" />
            SOP权限管理
          </h1>
          <p className="text-muted-foreground mt-1">管理运营SOP知识库的可见性和访问权限</p>
        </div>
        {isAdmin && (
          <Button variant="outline" onClick={() => openGrantDialog(null)}>
            <UserPlus className="h-4 w-4 mr-1" />
            批量授权
          </Button>
        )}
      </div>

      {/* Access Level Legend */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Object.entries(ACCESS_LEVEL_CONFIG).map(([key, config]) => {
          const Icon = config.icon;
          return (
            <Card key={key} className="border-dashed">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${config.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium text-sm">{config.label}</p>
                  <p className="text-xs text-muted-foreground">{config.description}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Skills List */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">SOP列表</h2>
        {skills.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <AlertCircle className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
              <p className="text-muted-foreground">暂无SOP知识库内容</p>
            </CardContent>
          </Card>
        ) : (
          skills.map((skill: any) => {
            const accessConf = ACCESS_LEVEL_CONFIG[skill.accessLevel || "public"];
            const AccessIcon = accessConf?.icon || Globe;
            let allowedRolesList: string[] = [];
            try {
              allowedRolesList = skill.allowedRoles ? JSON.parse(skill.allowedRoles) : [];
            } catch { /* ignore */ }

            return (
              <Card key={skill.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <BookOpen className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-foreground truncate">
                          {skill.title || `SOP #${skill.id}`}
                        </h3>
                        <Badge className={`text-xs ${accessConf?.color || "bg-gray-100"}`}>
                          <AccessIcon className="h-3 w-3 mr-1" />
                          {accessConf?.label || "未知"}
                        </Badge>
                        {skill.reviewStatus === "approved" && (
                          <Badge className="text-xs bg-emerald-100 text-emerald-700">已审核</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                        <span>{new Date(skill.createdAt).toLocaleDateString("zh-CN")}</span>
                        {allowedRolesList.length > 0 && (
                          <span>
                            允许角色: {allowedRolesList.map(r => ROLE_LABELS[r] || r).join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openVisibilityDialog(skill)}
                        >
                          <Settings className="h-4 w-4 mr-1" />
                          可见性
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Grants List */}
      {isAdmin && (grantsQuery.data || []).length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">当前授权记录</h2>
          {(grantsQuery.data || []).map((grant: any) => (
            <Card key={grant.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                    <UsersIcon className="h-4 w-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{grant.userName}</p>
                    <p className="text-xs text-muted-foreground">
                      级别: {grant.skillLevel === "advanced" ? "高级" : "中级"} · 授权人: {grant.granterName}
                      {grant.expiresAt && ` · 过期: ${new Date(grant.expiresAt).toLocaleDateString("zh-CN")}`}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  onClick={() => revokeAccessMutation.mutate({ grantId: grant.id })}
                  disabled={revokeAccessMutation.isPending}
                >
                  撤销
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Visibility Dialog */}
      <Dialog open={visibilityDialogOpen} onOpenChange={setVisibilityDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
              设置可见性
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {selectedSkill && (
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="font-medium text-sm">{selectedSkill.title}</p>
              </div>
            )}
            <div>
              <label className="text-sm font-medium mb-1.5 block">访问级别</label>
              <Select value={newAccessLevel} onValueChange={setNewAccessLevel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ACCESS_LEVEL_CONFIG).map(([key, config]) => (
                    <SelectItem key={key} value={key}>
                      <span className="flex items-center gap-2">
                        {config.label} — {config.description}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {newAccessLevel === "team" && (
              <div>
                <label className="text-sm font-medium mb-1.5 block">允许的角色</label>
                <div className="grid grid-cols-2 gap-2">
                  {ROLE_OPTIONS.map(role => (
                    <button
                      key={role.value}
                      onClick={() => toggleRole(role.value)}
                      className={`px-3 py-2 rounded-md text-sm border transition-colors ${
                        selectedRoles.includes(role.value)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-foreground border-border hover:bg-accent"
                      }`}
                    >
                      {role.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVisibilityDialogOpen(false)}>取消</Button>
            <Button
              onClick={handleSaveVisibility}
              disabled={updateVisibilityMutation.isPending || (newAccessLevel === "team" && selectedRoles.length === 0)}
            >
              {updateVisibilityMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Grant Access Dialog */}
      <Dialog open={grantDialogOpen} onOpenChange={setGrantDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              授权用户访问SOP
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">授权级别</label>
              <Select value={grantLevel} onValueChange={(v) => setGrantLevel(v as "intermediate" | "advanced")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="intermediate">中级 — 查看已审核SOP</SelectItem>
                  <SelectItem value="advanced">高级 — 查看所有SOP</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">选择用户（可多选）</label>
              <div className="max-h-60 overflow-y-auto space-y-1 border rounded-md p-2">
                {(usersQuery.data || []).map((u: any) => (
                  <button
                    key={u.id}
                    onClick={() => toggleGrantUser(u.id)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                      grantUserIds.includes(u.id)
                        ? "bg-primary/10 text-primary font-medium"
                        : "hover:bg-accent"
                    }`}
                  >
                    {u.name} ({ROLE_LABELS[u.role] || u.role})
                  </button>
                ))}
              </div>
              {grantUserIds.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">已选择 {grantUserIds.length} 人</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantDialogOpen(false)}>取消</Button>
            <Button
              onClick={handleGrantAccess}
              disabled={grantUserIds.length === 0 || grantAccessMutation.isPending}
            >
              {grantAccessMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              授权 ({grantUserIds.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
