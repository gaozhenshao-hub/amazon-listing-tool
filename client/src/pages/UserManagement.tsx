import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ROLE_LABELS, ALL_ROLES } from "@shared/const";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  UserPlus, Upload, Search, RotateCcw, Shield, ShieldAlert,
  Loader2, Users, UserCheck, UserX, Clock, Pencil, Trash2, AlertTriangle,
} from "lucide-react";

// ─── Status badge ────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    active: { label: "正常", variant: "default" },
    disabled: { label: "已禁用", variant: "destructive" },
    pending: { label: "待激活", variant: "secondary" },
  };
  const v = variants[status] || { label: status, variant: "outline" };
  return <Badge variant={v.variant}>{v.label}</Badge>;
}

// ─── Create User Dialog ──────────────────────────────────────
function CreateUserDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", email: "", phone: "", role: "ops_specialist",
    department: "", jobTitle: "", initialPassword: "Abc12345",
  });

  const createMutation = trpc.userManagement.create.useMutation({
    onSuccess: (data) => {
      toast.success(`用户创建成功，初始密码: ${data.defaultPassword}`);
      setOpen(false);
      setForm({ name: "", email: "", phone: "", role: "ops_specialist", department: "", jobTitle: "", initialPassword: "Abc12345" });
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><UserPlus className="mr-2 h-4 w-4" />添加用户</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>添加新用户</DialogTitle>
          <DialogDescription>创建后系统将生成初始密码，用户首次登录需修改</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>姓名 *</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="请输入姓名" />
            </div>
            <div className="space-y-2">
              <Label>角色 *</Label>
              <Select value={form.role} onValueChange={v => setForm({ ...form, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALL_ROLES.filter(r => r !== "super_admin").map(r => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>邮箱</Label>
              <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="user@example.com" />
            </div>
            <div className="space-y-2">
              <Label>手机号</Label>
              <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="13800138000" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>部门</Label>
              <Input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} placeholder="如: 运营部" />
            </div>
            <div className="space-y-2">
              <Label>职位</Label>
              <Input value={form.jobTitle} onChange={e => setForm({ ...form, jobTitle: e.target.value })} placeholder="如: 运营专员" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>初始密码（留空使用默认: Abc12345）</Label>
            <Input type="password" value={form.initialPassword} onChange={e => setForm({ ...form, initialPassword: e.target.value })} placeholder="留空使用默认密码" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={() => createMutation.mutate(form as any)} disabled={createMutation.isPending || !form.name}>
            {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Bulk Import Dialog ──────────────────────────────────────
function BulkImportDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [csvText, setCsvText] = useState("");

  const bulkMutation = trpc.userManagement.bulkImport.useMutation({
    onSuccess: (data) => {
      toast.success(`导入完成: 成功 ${data.successCount} 人, 跳过 ${data.skipCount} 人`);
      if (data.errors.length > 0) {
        toast.warning(`部分导入失败: ${data.errors.slice(0, 3).join("; ")}`);
      }
      setOpen(false);
      setCsvText("");
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });

  const handleImport = () => {
    const lines = csvText.trim().split("\n").filter(l => l.trim());
    if (lines.length === 0) { toast.error("请输入用户数据"); return; }

    // Build reverse lookup: Chinese label -> role code
    const labelToRole: Record<string, string> = {};
    Object.entries(ROLE_LABELS).forEach(([code, label]) => { labelToRole[label] = code; });

    const users = lines.map(line => {
      const parts = line.split(/[,，\t]/).map(s => s.trim());
      const rawRole = parts[3] || "";
      // Support both Chinese label and English code
      const role = labelToRole[rawRole] || (ALL_ROLES.includes(rawRole as any) ? rawRole : "ops_specialist");
      return {
        name: parts[0] || "",
        email: parts[1] || undefined,
        phone: parts[2] || undefined,
        role,
        department: parts[4] || undefined,
        jobTitle: parts[5] || undefined,
      };
    }).filter(u => u.name);

    if (users.length === 0) { toast.error("未识别到有效用户数据"); return; }
    bulkMutation.mutate({ users });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline"><Upload className="mr-2 h-4 w-4" />批量导入</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>批量导入用户</DialogTitle>
          <DialogDescription>
            每行一个用户，用逗号或Tab分隔：姓名, 邮箱, 手机号, 角色, 部门, 职位
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 font-mono space-y-0.5">
            <p className="font-semibold mb-1">格式示例（姓名，邮箱，手机号，角色，部门，职位）：</p>
            <p>张三，zhangsan@example.com，13800001111，公司管理员，管理层，总经理</p>
            <p>李四，lisi@example.com，13800002222，运营主管，运营部，运营主管</p>
            <p>王五，wangwu@example.com，13800003333，运营专员，运营部，运营专员</p>
            <p>赵六，zhaoliu@example.com，13800004444，产品开发，产品部，产品经理</p>
            <p>孙七，sunqi@example.com，13800005555，财务，财务部，会计</p>
            <p>周八，zhouba@example.com，13800006666，采购，供应链部，采购专员</p>
            <p>吴九，wujiu@example.com，13800007777，美工，设计部，平面设计师</p>
          </div>
          <div className="text-xs text-muted-foreground">
            角色可选值: {ALL_ROLES.filter(r => r !== "super_admin").map(r => ROLE_LABELS[r]).join("、")}
          </div>
          <textarea
            className="w-full h-40 p-3 text-sm border rounded-lg font-mono resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            value={csvText}
            onChange={e => setCsvText(e.target.value)}
            placeholder="粘贴用户数据..."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
          <Button onClick={handleImport} disabled={bulkMutation.isPending || !csvText.trim()}>
            {bulkMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit User Dialog ────────────────────────────────────────
function EditUserDialog({ user, currentUserId, onSuccess }: { user: any; currentUserId?: string; onSuccess: () => void }) {
  const isSelf = currentUserId && user.id === currentUserId;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: user.name || "",
    email: user.email || "",
    phone: user.phone || "",
    role: user.role,
    department: user.department || "",
    jobTitle: user.jobTitle || "",
    status: user.status,
  });

  const updateMutation = trpc.userManagement.update.useMutation({
    onSuccess: () => {
      toast.success("用户信息已更新");
      setOpen(false);
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });

  const resetPwdMutation = trpc.userManagement.resetPassword.useMutation({
    onSuccess: (data) => {
      toast.success(`密码已重置为: ${data.newPassword}`);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Pencil className="h-3.5 w-3.5" />
          编辑
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>编辑用户: {user.name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>姓名</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>角色 {isSelf && <span className="text-xs text-muted-foreground">(不可修改自己的角色)</span>}</Label>
              <Select value={form.role} onValueChange={v => setForm({ ...form, role: v })} disabled={!!isSelf}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALL_ROLES.map(r => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>邮箱</Label>
              <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>手机号</Label>
              <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>部门</Label>
              <Input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>职位</Label>
              <Input value={form.jobTitle} onChange={e => setForm({ ...form, jobTitle: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>状态</Label>
            <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">正常</SelectItem>
                <SelectItem value="disabled">禁用</SelectItem>
                <SelectItem value="pending">待激活</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="flex justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => resetPwdMutation.mutate({ userId: user.id })}
            disabled={resetPwdMutation.isPending}
          >
            <RotateCcw className="mr-2 h-3 w-3" />
            {resetPwdMutation.isPending ? "重置中..." : "重置密码"}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={() => updateMutation.mutate({ userId: user.id, ...form })} disabled={updateMutation.isPending}>
              {updateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


// ─── Delete User Dialog ────────────────────────────────────────────────
function DeleteUserDialog({ user, allUsers, onSuccess }: { user: any; allUsers: any[]; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"confirm" | "transfer" | "deleting">("confirm");
  const [targetUserId, setTargetUserId] = useState<string>("");

  const checkDataQuery = trpc.userManagement.checkUserData.useQuery(
    { userId: user.id },
    { enabled: open }
  );

  const transferMutation = trpc.userManagement.transferUserData.useMutation({
    onSuccess: () => {
      toast.success("数据转移成功");
      deleteMutation.mutate({ userId: user.id });
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.userManagement.deleteUser.useMutation({
    onSuccess: () => {
      toast.success(`用户 ${user.name} 已删除`);
      setOpen(false);
      setStep("confirm");
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });

  const hasData = checkDataQuery.data && checkDataQuery.data.total > 0;
  const otherUsers = allUsers.filter(u => u.id !== user.id && u.status === "active");

  const DATA_LABELS: Record<string, string> = {
    projects: "Listing项目",
    devProjects: "产品开发项目",
    kbImageSets: "图片知识库",
    kbCopywriting: "文案知识库",
    kbInnovations: "产品创新知识库",
    kbSkills: "运营技能知识库",
    kbVideos: "视频知识库",
    products: "产品档案",
  };

  const handleDelete = () => {
    if (hasData) {
      setStep("transfer");
    } else {
      deleteMutation.mutate({ userId: user.id });
    }
  };

  const handleTransferAndDelete = () => {
    if (!targetUserId) {
      toast.error("请选择目标用户");
      return;
    }
    setStep("deleting");
    transferMutation.mutate({ fromUserId: user.id, toUserId: Number(targetUserId) });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setStep("confirm"); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10">
          <Trash2 className="h-3.5 w-3.5" />
          删除
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            删除用户: {user.name}
          </DialogTitle>
        </DialogHeader>

        {step === "confirm" && (
          <div className="space-y-4">
            {checkDataQuery.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在检查关联数据...
              </div>
            ) : hasData ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  该用户关联以下数据，删除前需要先转移给其他用户：
                </p>
                <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                  {Object.entries(checkDataQuery.data!.counts).map(([key, count]) => (
                    count > 0 && (
                      <div key={key} className="flex justify-between text-sm">
                        <span>{DATA_LABELS[key] || key}</span>
                        <span className="font-medium">{count} 条</span>
                      </div>
                    )
                  ))}
                  <div className="border-t pt-1 mt-1 flex justify-between text-sm font-semibold">
                    <span>合计</span>
                    <span>{checkDataQuery.data!.total} 条</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                该用户没有关联数据，可以直接删除。此操作不可撤销！
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={checkDataQuery.isLoading || deleteMutation.isPending}
              >
                {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {hasData ? "下一步：转移数据" : "确认删除"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "transfer" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              请选择一个目标用户，将 <span className="font-medium">{user.name}</span> 的所有数据转移给该用户：
            </p>
            {otherUsers.length === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                没有可用的目标用户，请先创建或启用其他用户后再进行转移。
              </div>
            ) : (
              <Select value={targetUserId} onValueChange={setTargetUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择目标用户" />
                </SelectTrigger>
                <SelectContent>
                  {otherUsers.map(u => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.name} ({ROLE_LABELS[u.role] || u.role}{u.department ? ` - ${u.department}` : ""})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("confirm")}>返回</Button>
              <Button
                variant="destructive"
                onClick={handleTransferAndDelete}
                disabled={!targetUserId || otherUsers.length === 0 || transferMutation.isPending || deleteMutation.isPending}
              >
                {(transferMutation.isPending || deleteMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                转移并删除
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "deleting" && (
          <div className="flex flex-col items-center gap-3 py-4">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">正在转移数据并删除用户...</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ───────────────────────────────────────────────
export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const usersQuery = trpc.userManagement.list.useQuery();
  const loginLogsQuery = trpc.userManagement.loginLogs.useQuery({ limit: 50 });

  const users = usersQuery.data || [];

  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      const matchSearch = !searchQuery ||
        (u.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (u.email || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (u.phone || "").includes(searchQuery);
      const matchRole = roleFilter === "all" || u.role === roleFilter;
      const matchStatus = statusFilter === "all" || u.status === statusFilter;
      return matchSearch && matchRole && matchStatus;
    });
  }, [users, searchQuery, roleFilter, statusFilter]);

  const stats = useMemo(() => ({
    total: users.length,
    active: users.filter(u => u.status === "active").length,
    disabled: users.filter(u => u.status === "disabled").length,
    pending: users.filter(u => u.status === "pending").length,
  }), [users]);

  const handleRefresh = () => {
    usersQuery.refetch();
    loginLogsQuery.refetch();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">用户管理</h1>
          <p className="text-sm text-muted-foreground mt-1">管理团队成员、角色分配和访问权限</p>
        </div>
        <div className="flex gap-2">
          <BulkImportDialog onSuccess={handleRefresh} />
          <CreateUserDialog onSuccess={handleRefresh} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs text-muted-foreground">总用户数</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
              <UserCheck className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.active}</p>
              <p className="text-xs text-muted-foreground">正常</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-red-100 flex items-center justify-center">
              <UserX className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.disabled}</p>
              <p className="text-xs text-muted-foreground">已禁用</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
              <Clock className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.pending}</p>
              <p className="text-xs text-muted-foreground">待激活</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">用户列表</TabsTrigger>
          <TabsTrigger value="logs">登录日志</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4">
          {/* Filters */}
          <div className="flex gap-3 items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索姓名、邮箱或手机号..."
                className="pl-9"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="角色筛选" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部角色</SelectItem>
                {ALL_ROLES.map(r => (
                  <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[120px]"><SelectValue placeholder="状态筛选" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="active">正常</SelectItem>
                <SelectItem value="disabled">已禁用</SelectItem>
                <SelectItem value="pending">待激活</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* User Table */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>姓名</TableHead>
                    <TableHead>邮箱</TableHead>
                    <TableHead>手机号</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>部门</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>最后登录</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usersQuery.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ) : filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        暂无用户数据
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map(user => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {user.role === "super_admin" && <ShieldAlert className="h-4 w-4 text-amber-500" />}
                            {user.role === "admin" && <Shield className="h-4 w-4 text-blue-500" />}
                            {user.name || "-"}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{user.email || "-"}</TableCell>
                        <TableCell className="text-sm">{user.phone || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {ROLE_LABELS[user.role] || user.role}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{user.department || "-"}</TableCell>
                        <TableCell><StatusBadge status={user.status} /></TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {user.lastSignedIn ? new Date(user.lastSignedIn).toLocaleString("zh-CN") : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <EditUserDialog user={user} currentUserId={currentUser?.id?.toString()} onSuccess={handleRefresh} />
                            {String(user.id) !== currentUser?.id?.toString() && user.role !== "super_admin" && (
                              <DeleteUserDialog user={user} allUsers={users} onSuccess={handleRefresh} />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">最近登录记录</CardTitle>
              <CardDescription>显示最近50条登录记录</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>时间</TableHead>
                    <TableHead>用户ID</TableHead>
                    <TableHead>登录方式</TableHead>
                    <TableHead>登录标识</TableHead>
                    <TableHead>IP地址</TableHead>
                    <TableHead>结果</TableHead>
                    <TableHead>失败原因</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loginLogsQuery.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ) : (loginLogsQuery.data || []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        暂无登录记录
                      </TableCell>
                    </TableRow>
                  ) : (
                    (loginLogsQuery.data || []).map((log: any) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-sm">
                          {log.createdAt ? new Date(log.createdAt).toLocaleString("zh-CN") : "-"}
                        </TableCell>
                        <TableCell className="text-sm">{log.userId || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {log.loginMethod === "password" ? "密码" : "OAuth"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{log.loginIdentifier || "-"}</TableCell>
                        <TableCell className="text-sm">{log.ipAddress || "-"}</TableCell>
                        <TableCell>
                          {log.success ? (
                            <Badge variant="default" className="text-xs">成功</Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs">失败</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{log.failReason || "-"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
