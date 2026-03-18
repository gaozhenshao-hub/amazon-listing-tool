import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { ROLE_LABELS } from "@shared/const";
import { User, Lock, Shield, Eye, EyeOff, Loader2, CheckCircle } from "lucide-react";

export default function ProfilePage() {
  const { user } = useAuth();
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [pwdForm, setPwdForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const changePasswordMutation = trpc.userAuth.changePassword.useMutation({
    onSuccess: () => {
      toast.success("密码修改成功");
      setPwdForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    },
    onError: (err) => toast.error(err.message),
  });

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (pwdForm.newPassword.length < 8) {
      toast.error("密码至少8位");
      return;
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(pwdForm.newPassword)) {
      toast.error("密码必须包含大小写字母和数字");
      return;
    }
    if (pwdForm.newPassword !== pwdForm.confirmPassword) {
      toast.error("两次输入的密码不一致");
      return;
    }
    changePasswordMutation.mutate({
      currentPassword: pwdForm.currentPassword || undefined,
      newPassword: pwdForm.newPassword,
    });
  };

  if (!user) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">个人设置</h1>
        <p className="text-sm text-muted-foreground mt-1">管理您的账号信息和安全设置</p>
      </div>

      {/* Profile Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <User className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">{user.name || "未设置姓名"}</CardTitle>
              <CardDescription className="flex items-center gap-2 mt-0.5">
                <Badge variant="outline" className="text-xs">
                  {ROLE_LABELS[user.role] || user.role}
                </Badge>
                {user.status === "active" && (
                  <span className="flex items-center gap-1 text-xs text-green-600">
                    <CheckCircle className="h-3 w-3" /> 正常
                  </span>
                )}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground">邮箱</Label>
              <p className="text-sm mt-1">{user.email || "未设置"}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">手机号</Label>
              <p className="text-sm mt-1">{(user as any).phone || "未设置"}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">部门</Label>
              <p className="text-sm mt-1">{(user as any).department || "未设置"}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">职位</Label>
              <p className="text-sm mt-1">{(user as any).jobTitle || "未设置"}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">登录方式</Label>
              <p className="text-sm mt-1">
                {(user as any).loginMethod === "password" ? "密码登录" : (user as any).loginMethod || "OAuth"}
              </p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">最后登录</Label>
              <p className="text-sm mt-1">
                {user.lastSignedIn ? new Date(user.lastSignedIn).toLocaleString("zh-CN") : "-"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
              <Lock className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <CardTitle className="text-base">修改密码</CardTitle>
              <CardDescription>密码要求：至少8位，包含大小写字母和数字</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">当前密码</Label>
              <div className="relative">
                <Input
                  id="currentPassword"
                  type={showCurrentPwd ? "text" : "password"}
                  value={pwdForm.currentPassword}
                  onChange={e => setPwdForm({ ...pwdForm, currentPassword: e.target.value })}
                  placeholder="请输入当前密码"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPwd(!showCurrentPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showCurrentPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">新密码</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showNewPwd ? "text" : "password"}
                  value={pwdForm.newPassword}
                  onChange={e => setPwdForm({ ...pwdForm, newPassword: e.target.value })}
                  placeholder="至少8位，包含大小写字母和数字"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPwd(!showNewPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNewPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">确认新密码</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={pwdForm.confirmPassword}
                onChange={e => setPwdForm({ ...pwdForm, confirmPassword: e.target.value })}
                placeholder="再次输入新密码"
              />
            </div>
            <Button type="submit" disabled={changePasswordMutation.isPending}>
              {changePasswordMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              修改密码
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Security Info */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <Shield className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-base">安全信息</CardTitle>
              <CardDescription>账号安全相关设置</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">登录保护</p>
              <p className="text-xs text-muted-foreground">连续5次密码错误将锁定账号15分钟</p>
            </div>
            <Badge variant="outline" className="text-xs text-green-600 border-green-200">已启用</Badge>
          </div>
          <Separator />
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">密码上次修改</p>
              <p className="text-xs text-muted-foreground">
                {(user as any).lastPasswordChangedAt
                  ? new Date((user as any).lastPasswordChangedAt).toLocaleString("zh-CN")
                  : "从未修改"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
