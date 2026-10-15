import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Loader2, RefreshCw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import MonthlyFinancialFilePreview from "./MonthlyFinancialFilePreview";
import {
  filterReadGroups,
  financialReadGroups,
  formatReadAmount,
  inventoryReadGroups,
  readGroupPage,
  readText,
  type FinancialReadRecord,
  type InventoryReadRecord,
  type OperationsReadResult,
} from "./operationsReadOnlyModel";

type ContentProps = {
  inventory: OperationsReadResult<InventoryReadRecord>;
  financial: OperationsReadResult<FinancialReadRecord>;
  asOfDate: string | null;
  refreshing: boolean;
  onRefresh: () => void;
};
const sectionClass = "min-w-0 rounded-xl border bg-card p-4 md:p-5";
const cellClass = "px-3 py-3 align-top";
const sourceNames: Record<string, string> = {
  manual_assignment: "人工负责人规则",
  lingxing_name_mapping: "已确认名称映射",
  product_profile: "产品主档",
  weekly_report: "历史周报",
  unmapped: "未映射",
};
const sourceLabel = (key: string) =>
  Object.prototype.hasOwnProperty.call(sourceNames, key)
    ? sourceNames[key]
    : key || "来源未返回";

function ReadNotice({
  state,
  noun,
}: {
  state: OperationsReadResult<unknown>;
  noun: string;
}) {
  if (state.status === "error")
    return (
      <p
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
      >
        {noun}读取失败：{state.message}。本页不使用缓存记录或零值替代失败结果。
      </p>
    );
  if (state.status === "loading")
    return (
      <p
        role="status"
        className="flex items-center gap-2 p-8 text-sm text-muted-foreground"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        正在读取{noun}…
      </p>
    );
  return null;
}
function ScopeHeading({
  parentAsin,
  storeName,
  country,
}: {
  parentAsin: string;
  storeName: string;
  country: string;
}) {
  return (
    <div>
      <h3 className="break-all font-semibold">
        父 ASIN：{parentAsin || "未返回"}
      </h3>
      <p className="mt-1 break-words text-xs text-muted-foreground">
        店铺：{storeName || "未返回 / 未限定"} · 站点：
        {country || "未返回 / 未限定"}
      </p>
    </div>
  );
}
function PageControls({
  page,
  pageCount,
  total,
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground">
        第 {page} / {pageCount} 页 · 共 {total} 组 · 每页最多 6
        个完整组，不拆分父体范围
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          上一页
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => onChange(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}

/** Presentational export for synthetic UI tests; real authentication remains in existing query middleware. */
export function OperationsReadOnlyContent({
  inventory,
  financial,
  asOfDate,
  refreshing,
  onRefresh,
}: ContentProps) {
  const [tab, setTab] = useState<"inventory" | "financial">("inventory");
  const [search, setSearch] = useState("");
  const [requestedPage, setRequestedPage] = useState(1);
  const inventoryGroups = useMemo(
    () =>
      inventory.status === "ready" ? inventoryReadGroups(inventory.rows) : [],
    [inventory]
  );
  const financialGroups = useMemo(
    () =>
      financial.status === "ready" ? financialReadGroups(financial.rows) : [],
    [financial]
  );
  const filteredInventory = filterReadGroups(inventoryGroups, search),
    filteredFinancial = filterReadGroups(financialGroups, search);
  const inventoryPage = readGroupPage(filteredInventory, requestedPage),
    financialPage = readGroupPage(filteredFinancial, requestedPage);
  const selectedPage = tab === "inventory" ? inventoryPage : financialPage;

  return (
    <main className="mx-auto max-w-[1600px] space-y-5 p-5 md:p-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ClipboardList className="h-6 w-6" />
            运营数据只读总览
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            已有库存、成本参数与手工财务台账 · 不同步、不改规划、不写入
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href="/ops/inventory">原库存规划</a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="/ops/products">原产品总览</a>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            重新读取已有数据
          </Button>
        </div>
      </header>
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-900">
        只读范围沿用现有接口权限。库存为当前工作区接口已返回的运营快照与规划结果；财务仅当前用户的手工台账，不是完整
        ERP 月报。不会启动新抓取、文件上传、定时同步或 AI。未知、冲突及旧 NULL
        范围记录不会自动归属。
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          [
            "库存基准日（非本次同步时间）",
            inventory.status === "ready" ? asOfDate || "未返回" : "—",
          ],
          [
            "库存记录 / 范围组",
            inventory.status === "ready"
              ? `${inventory.rows.length} / ${inventoryGroups.length}`
              : "—",
          ],
          [
            "手工财务记录 / 范围组",
            financial.status === "ready"
              ? `${financial.rows.length} / ${financialGroups.length}`
              : "—",
          ],
        ].map(([label, value]) => (
          <div key={label} className={sectionClass}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-2 break-words text-lg font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2" aria-label="只读数据类别">
          <Button
            variant={tab === "inventory" ? "default" : "outline"}
            aria-pressed={tab === "inventory"}
            onClick={() => {
              setTab("inventory");
              setRequestedPage(1);
            }}
          >
            库存与成本
          </Button>
          <Button
            variant={tab === "financial" ? "default" : "outline"}
            aria-pressed={tab === "financial"}
            onClick={() => {
              setTab("financial");
              setRequestedPage(1);
            }}
          >
            手工财务台账
          </Button>
        </div>
        <Input
          aria-label="搜索只读记录"
          placeholder="搜索父/子 ASIN、店铺、站点、SKU、负责人"
          value={search}
          onChange={event => {
            setSearch(event.target.value);
            setRequestedPage(1);
          }}
          className="max-w-lg"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        按父 ASIN、店铺、站点完整分组；搜索命中子体时保留整组。同一子 ASIN
        在不同店铺或站点不合并。页面筛选不改变权限。
      </p>

      {tab === "inventory" ? (
        <section aria-label="库存与成本只读记录" className="space-y-4">
          <p className="text-xs leading-6 text-muted-foreground">
            库存、成本与币种均为接口规划值，部分空库存可能被接口补零，币种也可能缺省为
            USD，不视为已核实的原报表事实。不重新计算建议采购量；接口未独立返回可售
            / FBA
            在途明细，本页不拆算。成本可能因缺失或可选查询失败而未返回；“—”不表示零或已证实未配置。不换汇、不汇总货值。
          </p>
          <ReadNotice state={inventory} noun="库存与成本" />
          {inventory.status === "ready" && filteredInventory.length === 0 && (
            <p className={sectionClass}>当前筛选没有接口返回的库存记录。</p>
          )}
          {inventoryPage.groups.map(group => (
            <article key={group.key} className={sectionClass}>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <ScopeHeading
                  parentAsin={group.parentAsin}
                  storeName={group.storeName}
                  country={group.country}
                />
                <p className="text-right text-xs leading-6 text-muted-foreground">
                  {group.rows.length} 条接口记录
                  <br />
                  组内总库存（接口值合计）：
                  {formatReadAmount(group.totalInventory)}
                  {group.totalInventory === null && (
                    <span className="block text-amber-700">
                      身份、重复或数值待核对，不合计
                    </span>
                  )}
                </p>
              </div>
              <div className="max-w-full overflow-x-auto">
                <table className="w-full min-w-[1100px] text-sm">
                  <thead>
                    <tr className="border-y bg-muted/40 text-left">
                      {[
                        "子 ASIN / SKU / 产品",
                        "负责人",
                        "总库存 / 本地库存（接口规划值）",
                        "成本币种",
                        "产品成本",
                        "头程费用 估 / 实",
                        "FBA 费用 估 / 实",
                        "售价",
                      ].map(label => (
                        <th key={label} className={cellClass}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map(row => (
                      <tr key={row.key} className="border-b align-top">
                        <td className={cellClass}>
                          <p className="font-mono text-xs font-medium">
                            {row.asin || "未返回子 ASIN"}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            SKU：{row.sku || "未返回"}
                          </p>
                          <p className="mt-1 max-w-64 break-words text-xs">
                            {row.productName || "品名未返回"}
                          </p>
                          {row.issues.map(issue => (
                            <p
                              key={issue}
                              className="mt-1 max-w-64 text-xs text-amber-700"
                            >
                              {issue}
                            </p>
                          ))}
                        </td>
                        <td className={cellClass}>
                          <p>{row.operator || "未返回"}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {sourceLabel(row.operatorSource)}
                          </p>
                        </td>
                        <td
                          className={`${cellClass} whitespace-nowrap tabular-nums`}
                        >
                          <p>
                            {formatReadAmount(row.totalInventory)} /{" "}
                            {formatReadAmount(row.localInventory)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {row.localConfirmed
                              ? "接口返回本地库存确认记录"
                              : "未返回本地库存确认凭据"}
                          </p>
                        </td>
                        <td className={cellClass}>
                          {row.currency || "未返回 / 待核对"}
                        </td>
                        <td className={`${cellClass} tabular-nums`}>
                          {formatReadAmount(row.productCost)}
                        </td>
                        <td
                          className={`${cellClass} whitespace-nowrap tabular-nums`}
                        >
                          {formatReadAmount(row.estimatedFirstLegCost)} /{" "}
                          {formatReadAmount(row.actualFirstLegCost)}
                        </td>
                        <td
                          className={`${cellClass} whitespace-nowrap tabular-nums`}
                        >
                          {formatReadAmount(row.estimatedFbaFee)} /{" "}
                          {formatReadAmount(row.actualFbaFee)}
                        </td>
                        <td className={`${cellClass} tabular-nums`}>
                          {formatReadAmount(row.sellingPrice)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section aria-label="手工财务台账只读记录" className="space-y-4">
          <p className="text-xs leading-6 text-muted-foreground">
            金额沿用现手工财务台账 USD
            口径；不是来源报表的独立币种认证。保留负数与零值，不以库存成本推导利润，不生成费用明细、环比归因或跨范围合计。旧
            NULL 店铺 / 站点记录只单列，不关联至某个库存组。
          </p>
          <ReadNotice state={financial} noun="手工财务台账" />
          {financial.status === "ready" && filteredFinancial.length === 0 && (
            <p className={sectionClass}>当前筛选没有接口返回的手工财务记录。</p>
          )}
          {financialPage.groups.map(group => (
            <article key={group.key} className={sectionClass}>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <ScopeHeading
                  parentAsin={group.parentAsin}
                  storeName={group.storeName}
                  country={group.country}
                />
                <p
                  className={`text-xs ${group.scopeKind === "scoped" ? "text-muted-foreground" : "text-amber-700"}`}
                >
                  {group.scopeKind === "scoped"
                    ? "完整范围 · 原样展示"
                    : group.scopeKind === "legacy"
                      ? "旧 NULL 范围 · 不自动归属"
                      : "范围不完整 · 待核对"}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-y bg-muted/40 text-left">
                      <th className={cellClass}>月份</th>
                      <th className={cellClass}>手工财务利润（USD）</th>
                      <th className={cellClass}>原记录 ID / 状态说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map(row => (
                      <tr key={row.key} className="border-b">
                        <td className={`${cellClass} whitespace-nowrap`}>
                          {row.yearMonth || "未返回"}
                        </td>
                        <td className={`${cellClass} tabular-nums`}>
                          {formatReadAmount(row.financialProfit)}
                        </td>
                        <td className={cellClass}>
                          <p className="font-mono text-xs">
                            {row.recordId || "ID 未返回"}
                          </p>
                          {row.issues.map(issue => (
                            <p
                              key={issue}
                              className="mt-1 text-xs text-amber-700"
                            >
                              {issue}
                            </p>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </section>
      )}
      {(tab === "inventory" ? inventory.status : financial.status) ===
        "ready" && (
        <PageControls
          page={selectedPage.page}
          pageCount={selectedPage.pageCount}
          total={
            tab === "inventory"
              ? filteredInventory.length
              : filteredFinancial.length
          }
          onChange={setRequestedPage}
        />
      )}
    </main>
  );
}

/** Own fresh responses rather than shared query-cache data whose keys omit user/workspace. */
function ScopedOperationsReadOnly() {
  const client = trpc.useUtils().client;
  const [revision, setRevision] = useState(0);
  const [inventory, setInventory] = useState<
    OperationsReadResult<InventoryReadRecord>
  >({ status: "loading" });
  const [financial, setFinancial] = useState<
    OperationsReadResult<FinancialReadRecord>
  >({ status: "loading" });
  const [asOfDate, setAsOfDate] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setInventory({ status: "loading" });
    setFinancial({ status: "loading" });
    setAsOfDate(null);
    const failure = (error: unknown) => ({
      status: "error" as const,
      message: error instanceof Error ? error.message : "只读请求未成功返回",
    });
    void client.dataImport.getInventoryPlanningFromImport
      .query({ marketplace: "ALL" }, { signal: controller.signal })
      .then(data => {
        if (!current) return;
        setAsOfDate(readText(data.asOfDate) || null);
        setInventory({ status: "ready", rows: data.rows });
      })
      .catch(error => {
        if (current) setInventory(failure(error));
      });
    void client.dataImport.getMonthlyFinancialProfits
      .query(undefined, { signal: controller.signal })
      .then(rows => {
        if (current) setFinancial({ status: "ready", rows });
      })
      .catch(error => {
        if (current) setFinancial(failure(error));
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [client, revision]);

  return (
    <OperationsReadOnlyContent
      inventory={inventory}
      financial={financial}
      asOfDate={asOfDate}
      refreshing={
        inventory.status === "loading" || financial.status === "loading"
      }
      onRefresh={() => {
        setInventory({ status: "loading" });
        setFinancial({ status: "loading" });
        setAsOfDate(null);
        setRevision(value => value + 1);
      }}
    />
  );
}

/** No business reads while authentication is pending; a changed identity remounts all owned state. */
export default function OperationsReadOnlyOverview() {
  const { user, loading, error } = useAuth();
  if (loading)
    return (
      <p role="status" className="p-8 text-sm text-muted-foreground">
        正在确认用户与工作区，尚未读取运营数据…
      </p>
    );
  if (error)
    return (
      <p role="alert" className="p-8 text-sm text-red-700">
        用户信息读取失败，未读取运营数据。
      </p>
    );
  if (!user)
    return (
      <p className="p-8 text-sm text-muted-foreground">
        请先登录后查看只读运营数据。
      </p>
    );
  if (
    !Number.isSafeInteger(user.id) ||
    user.id <= 0 ||
    !Number.isSafeInteger(user.defaultWorkspaceId) ||
    !user.defaultWorkspaceId ||
    user.defaultWorkspaceId < 0
  ) {
    return (
      <p role="alert" className="p-8 text-sm text-amber-700">
        当前用户 / 工作区信息不完整，未读取运营数据。
      </p>
    );
  }
  const scopeKey = JSON.stringify([
    user.id,
    user.defaultWorkspaceId,
    user.role,
  ]);
  return (
    <>
      <ScopedOperationsReadOnly key={`reads:${scopeKey}`} />
      <MonthlyFinancialFilePreview
        key={`file:${scopeKey}`}
        scopeKey={scopeKey}
      />
    </>
  );
}
