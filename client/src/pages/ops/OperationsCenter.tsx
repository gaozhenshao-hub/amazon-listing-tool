import { MEETING_ROLES } from "@shared/meetingNotes";
import { lazy, Suspense, type ReactNode } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";

const ProductTasks = lazy(() => import("./ProductTasksReadOnly"));
const MeetingRecords = lazy(() => import("./TaskMeetingTools"));
const OperationsJournal = lazy(() => import("./OperationsJournal"));
const NorthAmericaBoard = lazy(() => import("./NorthAmericaBoard"));

export type OperationsCenterPanel = "tasks" | "profit" | "products";
export type OperationsCenterProps = { initialPanel?: OperationsCenterPanel };
const entries = [
  { panel: "tasks", label: "运营任务", href: "/ops/product-tasks", directory: "ops_tasks" },
  { panel: "profit", label: "利润看板", href: "/ops/profit-board", directory: "ops_data_import" },
  { panel: "products", label: "产品看板", href: "/ops/product-board", directory: "ops_data_import" },
] as const;
const validId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
function PendingPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p role="status" className="p-4 text-sm text-muted-foreground">正在加载所选运营页面…</p>}>{children}</Suspense>;
}
function EnabledOperationsCenter({ initialPanel = "tasks" }: OperationsCenterProps) {
  const auth = useAuth(), permissions = usePermissions(), user = auth.user;
  const identityReady = !!user && validId(user.id) && validId(user.defaultWorkspaceId) && typeof user.role === "string" && user.role.trim().length > 0;
  const ready = !auth.loading && !auth.error && identityReady && !permissions.isLoading;
  const canReadDashboard = ready && permissions.canRead("ops", "ops_dashboard");
  const visibleEntries = entries.filter(entry => permissions.canRead("ops", entry.directory!));
  const selected = entries.find(entry => entry.panel === initialPanel);
  const identityKey = identityReady ? JSON.stringify([user.id, user.defaultWorkspaceId, user.role]) : "unverified";
  let content: ReactNode;
  // The legacy page keeps its existing auth/read behavior. This new container
  // does not redirect a denied new panel to that page or grant its permissions.
  if (!selected) content = <p role="alert">运营页面选择不合法，未加载其他页面。</p>;
  else if (auth.loading) content = <p role="status">正在确认运营页面身份，尚未加载数据页面…</p>;
  else if (auth.error) content = <p role="alert">身份读取失败，所选运营页面已隐藏；未保留旧数据。</p>;
  else if (!identityReady) content = <p role="alert">需要有效用户、角色和明确工作区才能打开所选运营页面。</p>;
  else if (permissions.isLoading) content = <p role="status">正在确认运营页面读取权限，尚未加载数据页面…</p>;
  else if (!visibleEntries.some(entry => entry.panel === initialPanel)) content = <p role="alert">没有所选运营页面的读取权限，旧内容已隐藏；未自动切换到其他页面。</p>;
  else if (initialPanel === "tasks") content = <>{MEETING_ROLES.includes(user!.role) && <MeetingRecords key={`meetings:${identityKey}`} />}<ProductTasks key={`tasks:${identityKey}`} /><OperationsJournal key={`journal:${identityKey}`} userId={user!.id} workspaceId={user!.defaultWorkspaceId!} /></>;
  else content = <NorthAmericaBoard key={`${initialPanel}:${identityKey}`} kind={initialPanel === "profit" ? "profit" : "products"} />;
  return <section aria-label="运营中心功能入口" className="min-w-0 max-w-full space-y-4">
    <PendingPage key={`${initialPanel}:${identityKey}`}>{content}</PendingPage>
  </section>;
}

/** Route props are the only panel selector. No query-string or persisted
 * selection can bypass route guards or override the legacy default. */
export default function OperationsCenter(props: OperationsCenterProps) {
  return <EnabledOperationsCenter {...props} />;
}
