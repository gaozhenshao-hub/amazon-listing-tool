import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { ArrowRight, Package, Truck, TrendingUp, Image, BarChart3, BookOpen, BrainCircuit, Users } from "lucide-react";
const modules = [
  { id: "dev", title: "产品开发", href: "/dev", description: "此模块待开发", icon: Package },
  { id: "procurement", title: "采购物流", href: "/procurement", description: "物流进度与时效", icon: Truck },
  { id: "ops", title: "运营", href: "/ops/products", description: "产品、库存、任务、利润和 Listing", icon: TrendingUp },
  { id: "design", title: "美工", href: "/design/images", description: "AI 生图、提示词与素材", icon: Image },
  { id: "finance", title: "财务", href: "/finance", description: "此模块待开发", icon: BarChart3 },
  { id: "knowledge", title: "知识库", href: "/knowledge/images", description: "图片资料、受控采集与审核", icon: BookOpen },
  { id: "emperor", title: "AI 管理", href: "/emperor/skills", description: "Skill、Agent、模型与通用设置", icon: BrainCircuit },
  { id: "admin", title: "系统管理", href: "/admin/users", description: "用户与角色权限", icon: Users },
] as const;
export default function PlatformHome() {
  const { user } = useAuth();
  const permissions = usePermissions();
  return <main className="mx-auto max-w-6xl space-y-8 py-6">
    <header><h1 className="text-3xl font-semibold">首页</h1><p className="mt-2 text-muted-foreground">选择需要使用的工作模块</p></header>
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{modules.filter(module => permissions.hasModuleAccess(module.id) || module.id === "ops" && permissions.hasModuleAccess("listing")).map(module => <Link key={module.id} href={module.href} className="group rounded-2xl border bg-card p-6 transition-colors hover:border-primary/40 hover:bg-accent/30">
      <module.icon className="mb-5 h-7 w-7 text-primary" /><h2 className="text-xl font-semibold">{module.title}</h2><p className="mt-2 text-sm text-muted-foreground">{module.description}</p><span className="mt-6 flex items-center gap-2 text-sm text-primary">进入模块<ArrowRight className="h-4 w-4" /></span>
    </Link>)}</div>
  </main>;
}
