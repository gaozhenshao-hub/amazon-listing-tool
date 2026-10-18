import { lazy, Suspense, type ReactNode } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { MERGED_READONLY_FEATURES_ENABLED } from "@/lib/mergedReadOnlyFeatures";

const LegacyCenter = lazy(() => import("./OpsDashboardUpgrade"));
const ProductTasks = lazy(() => import("./ProductTasksReadOnly"));
const ProfitBoard = lazy(() => import("./ProfitBoardReadOnly"));
const ProductBoard = lazy(() => import("./ProductBoardReadOnly"));

export type OperationsCenterPanel = "legacy" | "tasks" | "profit" | "products";
export type OperationsCenterProps = { initialPanel?: OperationsCenterPanel };
const entries = [
  { panel: "tasks", label: "运营任务", href: "/ops/product-tasks", directory: "ops_tasks" },
  { panel: "profit", label: "利润看板", href: "/ops/profit-board", directory: "ops_data_import" },
  { panel: "products", label: "产品看板", href: "/ops/product-board", directory: "ops_data_import" },
  { panel: "legacy", label: "原运营中心", href: "/ops/dashboard-upgrade", directory: null },
] as const;
const validId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
function PendingPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p role="status" className="p-4 text-sm text-muted-foreground">正在加载所选运营页面…</p>}>{children}</Suspense>;
}
function EnabledOperationsCenter({ initialPanel = "legacy" }: OperationsCenterProps) {
  const auth = useAuth(), permissions = usePermissions(), user = auth.user;
  const identityReady = !!user && validId(user.id) && validId(user.defaultWorkspaceId) && typeof user.role === "string" && user.role.trim().length > 0;
  const ready = !auth.loading && !auth.error && identityReady && !permissions.isLoading;
  const canReadDashboard = ready && permissions.canRead("ops", "ops_dashboard");
  const visibleEntries = entries.filter(entry => entry.panel === "legacy" || canReadDashboard && permissions.canRead("ops", entry.directory!));
  const selected = entries.find(entry => entry.panel === initialPanel);
  const identityKey = identityReady ? JSON.stringify([user.id, user.defaultWorkspaceId, user.role]) : "unverified";
  let content: ReactNode;
  // The legacy page keeps its existing auth/read behavior. This new container
  // does not redirect a denied new panel to that page or grant its permissions.
  if (initialPanel === "legacy") content = <LegacyCenter key={`legacy:${identityKey}`} />;
  else if (!selected) content = <p role="alert">运营页面选择不合法，未加载其他页面。</p>;
  else if (auth.loading) content = <p role="status">正在确认运营页面身份，尚未加载数据页面…</p>;
  else if (auth.error) content = <p role="alert">身份读取失败，所选运营页面已隐藏；未保留旧数据。</p>;
  else if (!identityReady) content = <p role="alert">需要有效用户、角色和明确工作区才能打开所选运营页面。</p>;
  else if (permissions.isLoading) content = <p role="status">正在确认运营页面读取权限，尚未加载数据页面…</p>;
  else if (!visibleEntries.some(entry => entry.panel === initialPanel)) content = <p role="alert">没有所选运营页面的读取权限，旧内容已隐藏；未自动切换到其他页面。</p>;
  else if (initialPanel === "tasks") content = <ProductTasks key={`tasks:${identityKey}`} />;
  else if (initialPanel === "profit") content = <ProfitBoard key={`profit:${identityKey}`} />;
  else content = <ProductBoard key={`products:${identityKey}`} />;
  return <section aria-label="运营中心功能入口" className="min-w-0 max-w-full space-y-4">
    <nav aria-label="运营中心页面" className="min-w-0 max-w-full overflow-x-auto rounded-lg border p-2">
      <div className="flex w-max min-w-full gap-2">{visibleEntries.map(entry => <a key={entry.panel} href={entry.href} aria-current={initialPanel === entry.panel ? "page" : undefined}
        className={`whitespace-nowrap rounded-md border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 ${initialPanel === entry.panel ? "border-primary bg-primary/10 font-medium" : "hover:bg-muted"}`}>{entry.label}</a>)}</div>
    </nav>
    <p className="text-xs text-muted-foreground">任务、产品与利润使用各自完整页面；当前看板按已保存来源读取，不表示已冻结归档。读取页面不会自动发起模型生成。</p>
    <PendingPage key={`${initialPanel}:${identityKey}`}>{content}</PendingPage>
  </section>;
}

/** Route props are the only panel selector. No query-string or persisted
 * selection can bypass route guards or override the legacy default. */
export default function OperationsCenter(props: OperationsCenterProps) {
  if (!MERGED_READONLY_FEATURES_ENABLED) return <PendingPage><LegacyCenter /></PendingPage>;
  return <EnabledOperationsCenter {...props} />;
}
