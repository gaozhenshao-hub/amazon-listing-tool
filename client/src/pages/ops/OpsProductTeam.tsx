import { useAuth } from "@/_core/hooks/useAuth";
import { ProductTaskProductIdentitySchema } from "@shared/productTaskRead";
import { ProductTasksEmbeddedReadOnly } from "./ProductTasksReadOnly";

/** Product details and the task board share records and authorization. */
export default function OpsProductTeam({ parentAsin, storeName, country }: {
  parentAsin: string; storeName?: string | null; country?: string | null;
}) {
  const { user, loading } = useAuth();
  if (loading) return <p role="status">正在加载产品任务…</p>;
  const product = ProductTaskProductIdentitySchema.safeParse({ workspaceId: user?.defaultWorkspaceId, parentAsin, storeName, country });
  if (!product.success) return <p className="rounded-lg border p-4 text-sm text-muted-foreground">
    当前产品的店铺归属尚未完整，暂不能按产品筛选任务。
    <a className="ml-2 text-primary underline" href="/ops/product-tasks">打开任务看板</a>
  </p>;
  return <ProductTasksEmbeddedReadOnly product={product.data} />;
}
