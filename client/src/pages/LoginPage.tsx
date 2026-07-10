import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";
import { Sparkles, Eye, EyeOff, Loader2, Shield } from "lucide-react";

export default function LoginPage() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // 处理OAuth登录被拒绝的错误信息，以及已登录但需要修改密码的情况
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorMsg = params.get("message");
    const errorType = params.get("error");
    const mustChange = params.get("must_change");
    if (mustChange === "1") {
      // 已登录但需要修改初始密码
      setMustChangePassword(true);
      toast.info("首次登录请修改密码", { duration: 5000 });
      window.history.replaceState({}, "", "/login");
    } else if (errorMsg) {
      toast.error(decodeURIComponent(errorMsg), { duration: 8000 });
      // 清理URL参数
      window.history.replaceState({}, "", "/login");
    } else if (errorType === "no_account") {
      toast.error("您的账号尚未被管理员创建，请联系管理员添加账号后再登录", { duration: 8000 });
      window.history.replaceState({}, "", "/login");
    } else if (errorType === "disabled") {
      toast.error("您的账号已被禁用，请联系管理员", { duration: 8000 });
      window.history.replaceState({}, "", "/login");
    }
  }, []);

  const loginMutation = trpc.userAuth.login.useMutation({
    onSuccess: (data) => {
      if (data.mustChangePassword) {
        setMustChangePassword(true);
        toast.info("首次登录请修改密码");
      } else {
        toast.success("登录成功");
        window.location.href = "/";
      }
    },
    onError: (error) => {
      const msg = error.message || '';
      if (msg.includes('服务暂时不可用') || msg.includes('请求超时') || msg.includes('正在重试')) {
        toast.error('服务响应较慢，请稍后点击登录重试', { duration: 5000 });
      } else if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        toast.error('网络连接失败，请检查网络后重试');
      } else {
        toast.error(msg);
      }
    },
  });

  const changePasswordMutation = trpc.userAuth.changePassword.useMutation({
    onSuccess: () => {
      toast.success("密码修改成功，正在跳转...");
      setTimeout(() => { window.location.href = "/"; }, 1000);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password.trim()) {
      toast.error("请输入邮箱/手机号和密码");
      return;
    }
    loginMutation.mutate({ identifier: identifier.trim(), password });
  };

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("密码至少8位");
      return;
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
      toast.error("密码必须包含大小写字母和数字");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("两次输入的密码不一致");
      return;
    }
    changePasswordMutation.mutate({ newPassword });
  };

  // Force change password screen
  if (mustChangePassword) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background via-accent/30 to-background">
        <Card className="w-full max-w-md shadow-lg">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-amber-100 flex items-center justify-center">
              <Shield className="h-7 w-7 text-amber-600" />
            </div>
            <CardTitle className="text-xl">修改初始密码</CardTitle>
            <CardDescription>
              首次登录需要修改密码，密码要求：至少8位，包含大小写字母和数字
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">新密码</Label>
                <div className="relative">
                  <Input
                    id="newPassword"
                    type={showPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="至少8位，包含大小写字母和数字"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">确认新密码</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="再次输入新密码"
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={changePasswordMutation.isPending}
              >
                {changePasswordMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                确认修改
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background via-accent/30 to-background">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-7 w-7 text-primary" />
          </div>
          <CardTitle className="text-xl">AMZ 全链路</CardTitle>
          <CardDescription>
            登录以使用全部功能
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Password Login Form */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier">邮箱 / 手机号</Label>
              <Input
                id="identifier"
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="请输入邮箱或手机号"
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              登录
            </Button>
          </form>

          {/* Divider */}
          <div className="relative">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-3 text-xs text-muted-foreground">
              或
            </span>
          </div>

          {/* OAuth Login */}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => { window.location.href = getLoginUrl(); }}
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
            使用 Manus 账号登录
          </Button>

          <p className="text-xs text-center text-muted-foreground">
            如果您是新员工，请联系管理员创建账号
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
