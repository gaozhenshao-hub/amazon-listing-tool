import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  FolderKanban,
  UserPlus,
  Trash2,
  Loader2,
  AlertCircle,
  Package,
  FileText,
  Search,
  Eye,
  Edit,
  Users as UsersIcon,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { ROLE_LABELS } from "@shared/const";

type ProjectType = "dev_project" | "listing_project";
type Permission = "read" | "write";

const PROJECT_TYPE_LABELS: Record<ProjectType, { label: string; icon: typeof Package }> = {
  dev_project: { label: "产品开发项目", icon: Package },
  listing_project: { label: "Listing项目", icon: FileText },
};

const PERMISSION_LABELS: Record<Permission, { label: string; color: string }> = {
  read: { label: "只读", color: "bg-blue-100 text-blue-700" },
  write: { label: "可编辑", color: "bg-emerald-100 text-emerald-700" },
};

export default function ProjectAssignmentPage() {
  const { user } = useAuth();
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedProjectType, setSelectedProjectType] = useState<ProjectType>("dev_project");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [selectedPermission, setSelectedPermission] = useState<Permission>("read");
  const [filterType, setFilterType] = useState<ProjectType | "all">("all");
  const [searchTerm, setSearchTerm] = useState("");

  // Queries
  const assignmentsQuery = trpc.projectAssignment.listAll.useQuery({
    page: 1,
    pageSize: 200,
    projectType: filterType !== "all" ? filterType : undefined,
  });

  const availableProjectsQuery = trpc.projectAssignment.listAvailableProjects.useQuery(
    { projectType: selectedProjectType },
    { enabled: assignDialogOpen }
  );

  const availableUsersQuery = trpc.projectAssignment.listAvailableUsers.useQuery(
    undefined,
    { enabled: assignDialogOpen }
  );

  // Mutations
  const assignMutation = trpc.projectAssignment.assign.useMutation({
    onSuccess: (data) => {
      toast.success(`分配成功，共 ${data.successCount} 人`);
      assignmentsQuery.refetch();
      setAssignDialogOpen(false);
      resetAssignForm();
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeMutation = trpc.projectAssignment.revoke.useMutation({
    onSuccess: () => {
      toast.success("已撤销分配");
      assignmentsQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const updatePermissionMutation = trpc.projectAssignment.updatePermission.useMutation({
    onSuccess: () => {
      toast.success("权限已更新");
      assignmentsQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const resetAssignForm = () => {
    setSelectedProjectId(null);
    setSelectedUserIds([]);
    setSelectedPermission("read");
  };

  const toggleUser = (userId: number) => {
    setSelectedUserIds(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const handleAssign = () => {
    if (!selectedProjectId || selectedUserIds.length === 0) return;
    assignMutation.mutate({
      projectId: selectedProjectId,
      projectType: selectedProjectType,
      userIds: selectedUserIds,
      permission: selectedPermission,
    });
  };

  const assignments = assignmentsQuery.data?.items || [];
  const filteredAssignments = useMemo(() => {
    if (!searchTerm) return assignments;
    const term = searchTerm.toLowerCase();
    return assignments.filter((a: any) =>
      a.projectName?.toLowerCase().includes(term) ||
      a.assignedUserName?.toLowerCase().includes(term)
    );
  }, [assignments, searchTerm]);

  // Group assignments by project
  const groupedAssignments = useMemo(() => {
    const groups: Record<string, { projectName: string; projectType: ProjectType; projectId: number; items: any[] }> = {};
    for (const a of filteredAssignments) {
      const key = `${a.projectType}-${a.projectId}`;
      if (!groups[key]) {
        groups[key] = {
          projectName: (a as any).projectName || `项目#${a.projectId}`,
          projectType: a.projectType as ProjectType,
          projectId: a.projectId,
          items: [],
        };
      }
      groups[key].items.push(a);
    }
    return Object.values(groups);
  }, [filteredAssignments]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FolderKanban className="h-7 w-7 text-primary" />
            项目分配管理
          </h1>
          <p className="text-muted-foreground mt-1">将产品开发项目和Listing项目分配给团队成员，实现跨模块数据引用</p>
        </div>
        <Button onClick={() => { resetAssignForm(); setAssignDialogOpen(true); }}>
          <UserPlus className="h-4 w-4 mr-1" />
          新建分配
        </Button>
      </div>

      {/* Data Flow Diagram */}
      <Card className="border-dashed bg-muted/30">
        <CardContent className="p-4">
          <div className="flex items-center justify-center gap-3 text-sm flex-wrap">
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg">
              <Package className="h-4 w-4" />
              模块1 (产品开发)
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary rounded-lg font-medium">
              <FolderKanban className="h-4 w-4" />
              管理员分配
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-100 text-emerald-700 rounded-lg">
              <FileText className="h-4 w-4" />
              模块2 (Listing) 引用产品画像
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索项目名称或用户..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterType} onValueChange={(v) => setFilterType(v as any)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部项目类型</SelectItem>
            <SelectItem value="dev_project">产品开发项目</SelectItem>
            <SelectItem value="listing_project">Listing项目</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="outline" className="text-sm">
          共 {filteredAssignments.length} 条分配
        </Badge>
      </div>

      {/* Grouped Assignments */}
      {groupedAssignments.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground/40 mx-auto mb-4" />
            <p className="text-muted-foreground">暂无项目分配记录</p>
            <p className="text-sm text-muted-foreground mt-1">点击"新建分配"将项目分配给团队成员</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groupedAssignments.map((group) => {
            const TypeIcon = PROJECT_TYPE_LABELS[group.projectType]?.icon || Package;
            return (
              <Card key={`${group.projectType}-${group.projectId}`}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TypeIcon className="h-5 w-5 text-primary" />
                    {group.projectName}
                    <Badge variant="outline" className="text-xs font-normal">
                      {PROJECT_TYPE_LABELS[group.projectType]?.label}
                    </Badge>
                    <Badge variant="outline" className="text-xs font-normal">
                      {group.items.length} 人
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="divide-y">
                    {group.items.map((item: any) => (
                      <div key={item.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <UsersIcon className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{item.assignedUserName}</p>
                            <p className="text-xs text-muted-foreground">
                              {ROLE_LABELS[item.assignedUserRole] || item.assignedUserRole}
                              {" · "}分配人: {item.assignerName}
                              {" · "}{new Date(item.createdAt).toLocaleDateString("zh-CN")}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Select
                            value={item.permission}
                            onValueChange={(v) => updatePermissionMutation.mutate({
                              assignmentId: item.id,
                              permission: v as Permission,
                            })}
                          >
                            <SelectTrigger className="w-[100px] h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="read">
                                <span className="flex items-center gap-1">
                                  <Eye className="h-3 w-3" /> 只读
                                </span>
                              </SelectItem>
                              <SelectItem value="write">
                                <span className="flex items-center gap-1">
                                  <Edit className="h-3 w-3" /> 可编辑
                                </span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 h-8"
                            onClick={() => revokeMutation.mutate({ assignmentId: item.id })}
                            disabled={revokeMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Assign Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              新建项目分配
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Project Type */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">项目类型</label>
              <Select
                value={selectedProjectType}
                onValueChange={(v) => {
                  setSelectedProjectType(v as ProjectType);
                  setSelectedProjectId(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dev_project">产品开发项目 (模块1)</SelectItem>
                  <SelectItem value="listing_project">Listing项目 (模块2)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Project Selection */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">选择项目</label>
              <Select
                value={selectedProjectId?.toString() || ""}
                onValueChange={(v) => setSelectedProjectId(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择要分配的项目" />
                </SelectTrigger>
                <SelectContent>
                  {(availableProjectsQuery.data || []).map((p: any) => (
                    <SelectItem key={p.id} value={p.id.toString()}>
                      {p.name} {p.targetMarket ? `(${p.targetMarket})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Permission */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">权限级别</label>
              <Select value={selectedPermission} onValueChange={(v) => setSelectedPermission(v as Permission)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="read">
                    <span className="flex items-center gap-2">
                      <Eye className="h-4 w-4" /> 只读 — 查看项目数据和产品画像
                    </span>
                  </SelectItem>
                  <SelectItem value="write">
                    <span className="flex items-center gap-2">
                      <Edit className="h-4 w-4" /> 可编辑 — 可修改项目数据
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* User Selection */}
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                选择用户（可多选）
                {selectedUserIds.length > 0 && (
                  <span className="text-primary ml-2">已选 {selectedUserIds.length} 人</span>
                )}
              </label>
              <div className="max-h-48 overflow-y-auto space-y-1 border rounded-md p-2">
                {(availableUsersQuery.data || []).map((u: any) => (
                  <button
                    key={u.id}
                    onClick={() => toggleUser(u.id)}
                    className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center justify-between ${
                      selectedUserIds.includes(u.id)
                        ? "bg-primary/10 text-primary font-medium"
                        : "hover:bg-accent"
                    }`}
                  >
                    <span>
                      {u.name}
                      <span className="text-xs text-muted-foreground ml-2">
                        {ROLE_LABELS[u.role] || u.role}
                        {u.department ? ` · ${u.department}` : ""}
                      </span>
                    </span>
                    {selectedUserIds.includes(u.id) && (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>取消</Button>
            <Button
              onClick={handleAssign}
              disabled={!selectedProjectId || selectedUserIds.length === 0 || assignMutation.isPending}
            >
              {assignMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              分配 ({selectedUserIds.length} 人)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
