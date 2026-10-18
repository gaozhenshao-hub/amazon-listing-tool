import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import {
  SaihuReportScopeSchema,
  SaihuReportStartInputSchema,
  SaihuReportApplyInputSchema,
  SaihuReportReceiptSchema,
  saihuReportHash,
  type SaihuReportIdentity,
  type SaihuReportPublicRun,
} from "@shared/saihuReportSync";
import {
  SaihuReportOptionsResultSchema,
  SaihuReportCheckResultSchema,
  SaihuReportHistoryResultSchema,
  SaihuReportInspectResultSchema,
  type SaihuReportOptionsResult,
  type SaihuReportInspectResult,
} from "@shared/saihuReportSyncView";
import {
  readSaihuReportPending,
  persistSaihuReportPending,
  clearSaihuReportPending,
  type SaihuReportPending,
} from "./saihuReportPending";
import { publishMonthlyFinancialChange } from "./monthlyFinancialWriteEvents";

const button = "rounded border px-3 py-2 text-sm disabled:opacity-50",
  cell = "border-b px-2 py-2 text-left align-top";
export function SaihuReportSyncController({
  identity,
}: {
  identity: SaihuReportIdentity;
}) {
  return (
    <OwnedSaihuReportSync
      key={`${identity.userId}:${identity.workspaceId}`}
      identity={identity}
    />
  );
}
function OwnedSaihuReportSync({ identity }: { identity: SaihuReportIdentity }) {
  const { userId, workspaceId } = identity;
  const client = trpc.useUtils().client.opsSaihuReport,
    generation = useRef(0),
    live = useRef(true),
    busyRef = useRef(false);
  const [kind, setKind] = useState<"daily" | "monthly">("daily"),
    [startDate, setStartDate] = useState(""),
    [endDate, setEndDate] = useState(""),
    [options, setOptions] = useState<SaihuReportOptionsResult | null>(null),
    [runs, setRuns] = useState<SaihuReportPublicRun[]>([]),
    [selected, setSelected] = useState<SaihuReportInspectResult | null>(null),
    [pending, setPending] = useState<SaihuReportPending | null>(null),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [acknowledged, setAcknowledged] = useState(false),
    [overview, setOverview] = useState<unknown>(null);
  useEffect(() => {
    const lifetime = generation,
      owner = { userId, workspaceId };
    live.current = true;
    try {
      setPending(readSaihuReportPending(owner));
    } catch {
      setError("本地恢复元数据损坏；不能新建请求，请保留记录联系管理员。");
    }
    const storage = () => {
      try {
        setPending(readSaihuReportPending(owner));
      } catch {
        setError("恢复元数据无效，操作已锁定。");
      }
    };
    window.addEventListener("storage", storage);
    return () => {
      live.current = false;
      lifetime.current++;
      window.removeEventListener("storage", storage);
    };
  }, [userId, workspaceId]);
  const bound = (value: SaihuReportIdentity) => {
    if (
      value.userId !== identity.userId ||
      value.workspaceId !== identity.workspaceId
    )
      throw new Error("RESPONSE_SCOPE_CHANGED");
  };
  async function task(body: (current: () => boolean) => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const token = ++generation.current,
      current = () => live.current && token === generation.current;
    setError(null);
    try {
      await body(current);
    } catch (err) {
      if (current())
        setError(
          err instanceof Error && err.message === "RECOVERY_LOCK_UNAVAILABLE"
            ? "浏览器跨窗口安全锁不可用，已阻止新请求；请使用支持 Web Locks 的安全页面。"
            : err instanceof Error &&
                /^SAIHU_REPORT_[A-Z_]+$/u.test(err.message)
              ? err.message
              : "请求未能核实；若已提交，请仅检查或取消原操作，不要换编号重发。"
        );
    } finally {
      busyRef.current = false;
      if (current()) setBusy(false);
    }
  }
  function invalidate() {
    generation.current++;
    setOptions(null);
    setSelected(null);
    setAcknowledged(false);
    setOverview(null);
    setNotice(null);
  }
  async function loadOptions() {
    await task(async current => {
      const scope = SaihuReportScopeSchema.parse({
          kind,
          start: startDate,
          end: kind === "monthly" ? startDate : endDate,
        }),
        value = SaihuReportOptionsResultSchema.parse(
          await client.preview.query({
            expectedWorkspaceId: identity.workspaceId,
            scope,
          })
        );
      bound(value.identity);
      if (current()) {
        setOptions(value);
        setSelected(null);
        setAcknowledged(false);
      }
    });
  }
  async function loadHistory() {
    await task(async current => {
      const value = SaihuReportHistoryResultSchema.parse(
        await client.history.query({
          expectedWorkspaceId: identity.workspaceId,
          cursor: null,
          limit: 20,
        })
      );
      bound(value.identity);
      if (current()) setRuns(value.runs);
    });
  }
  async function inspect(operationId: string, rowOffset = 0) {
    await task(async current => {
      const value = SaihuReportInspectResultSchema.parse(
        await client.inspect.query({
          expectedWorkspaceId: identity.workspaceId,
          operationId,
          rowOffset,
          pageSize: 25,
        })
      );
      bound(value.run.identity);
      if (value.run.operationId !== operationId)
        throw new Error("RESPONSE_SCOPE_CHANGED");
      if (current()) {
        setSelected(value);
        setAcknowledged(false);
      }
    });
  }
  async function accepted(
    raw: unknown,
    operation: SaihuReportPending,
    current: () => boolean
  ) {
    const receipt = SaihuReportReceiptSchema.parse(raw);
    bound(receipt.identity);
    if (
      receipt.operationId !== operation.operationId ||
      receipt.runOperationId !== operation.runOperationId ||
      receipt.action !== operation.action ||
      (receipt.status === "committed" &&
        receipt.requestHash !== operation.requestHash)
    )
      throw new Error("RECEIPT_SCOPE_CHANGED");
    if (receipt.status === "unknown") {
      if (current()) setNotice("提交结果未知，只能继续检查或取消当前编号。");
      return;
    }
    await clearSaihuReportPending(operation);
    if (current()) {
      setPending(null);
      setSelected(null);
      setOptions(null);
      setAcknowledged(false);
      setNotice(
        receipt.status === "committed"
          ? operation.action === "start"
            ? "采集已排队；不会自动应用。请刷新任务记录查看预览。"
            : "操作已确认；请重新读取任务和正式看板。"
          : "原操作已取消。原成功版本保留。"
      );
    }
    if (
      operation.action !== "start" &&
      receipt.status === "committed" &&
      receipt.batchId
    )
      publishMonthlyFinancialChange({
        ...identity,
        action: operation.action === "apply" ? "confirm" : "revoke",
        batchId: receipt.batchId,
      });
  }
  async function start() {
    if (
      !options ||
      options.capability.status !== "available" ||
      !options.configurationHash ||
      pending ||
      error
    )
      return;
    await task(async current => {
      const operationId = crypto.randomUUID(),
        input = SaihuReportStartInputSchema.parse({
          expectedWorkspaceId: identity.workspaceId,
          operationId,
          scope: options.scope,
          expectedConfigurationHash: options.configurationHash,
          expectedHistoryHash: options.historyHash,
        }),
        operation: SaihuReportPending = {
          version: 1,
          identity,
          operationId,
          runOperationId: operationId,
          action: "start",
          requestHash: saihuReportHash({ identity, request: input }),
        };
      if (!current()) return;
      await persistSaihuReportPending(operation);
      if (!current()) return;
      if (current()) setPending(operation);
      await accepted(await client.start.mutate(input), operation, current);
    });
  }
  async function apply(action: "apply" | "revoke") {
    if (
      !selected ||
      !acknowledged ||
      pending ||
      (action === "apply" && !selected.canApply) ||
      (action === "revoke" && !selected.canRevoke)
    )
      return;
    await task(async current => {
      const fresh = SaihuReportInspectResultSchema.parse(
        await client.inspect.query({
          expectedWorkspaceId: identity.workspaceId,
          operationId: selected.run.operationId,
          rowOffset: selected.rowPage.offset,
          pageSize: 25,
        })
      );
      bound(fresh.run.identity);
      if (
        fresh.run.operationId !== selected.run.operationId ||
        fresh.run.previewHash !== selected.run.previewHash ||
        fresh.historyHash !== selected.historyHash ||
        (action === "apply" && !fresh.canApply) ||
        (action === "revoke" && !fresh.canRevoke)
      ) {
        if (current()) {
          setSelected(fresh);
          setAcknowledged(false);
          setNotice("来源或影响范围有变化，请重新审阅后确认。");
        }
        return;
      }
      const operationId = crypto.randomUUID(),
        input = SaihuReportApplyInputSchema.parse({
          expectedWorkspaceId: identity.workspaceId,
          operationId,
          runOperationId: selected.run.operationId,
          expectedPreviewHash: selected.run.previewHash,
          expectedHistoryHash: selected.historyHash,
          fullScopeAcknowledged: true,
        }),
        operation: SaihuReportPending = {
          version: 1,
          identity,
          operationId,
          runOperationId: selected.run.operationId,
          action,
          requestHash: saihuReportHash({ identity, action, request: input }),
        };
      if (!current()) return;
      await persistSaihuReportPending(operation);
      if (!current()) return;
      if (current()) setPending(operation);
      await accepted(
        await (action === "apply"
          ? client.applyPreview.mutate(input)
          : client.revoke.mutate(input)),
        operation,
        current
      );
    });
  }
  async function recover(cancel = false) {
    await task(async current => {
      const operation = readSaihuReportPending(identity);
      if (!operation || JSON.stringify(operation) !== JSON.stringify(pending)) {
        if (current()) {
          setPending(operation);
          setNotice("未决操作已变化，请核对当前编号后重新选择检查或取消。");
        }
        return;
      }
      const input = {
        expectedWorkspaceId: identity.workspaceId,
        operationId: operation.operationId,
        runOperationId: operation.runOperationId,
      };
      if (operation.action === "start") {
        const startInput = {
          expectedWorkspaceId: identity.workspaceId,
          operationId: operation.operationId,
        };
        if (cancel)
          await accepted(
            await client.cancel.mutate(startInput),
            operation,
            current
          );
        else {
          const value = SaihuReportCheckResultSchema.parse(
            await client.check.query(startInput)
          );
          if (value.run) {
            bound(value.run.identity);
            if (value.run.operationId !== operation.operationId)
              throw new Error("RESPONSE_SCOPE_CHANGED");
          }
          if (value.receipt) await accepted(value.receipt, operation, current);
          else if (current())
            setNotice("原操作尚无可核实结果；可再次检查，或明确取消原编号。");
        }
      } else
        await accepted(
          await (operation.action === "apply"
            ? cancel
              ? client.applyCancel.mutate(input)
              : client.applyCheck.query(input)
            : cancel
              ? client.revokeCancel.mutate(input)
              : client.revokeCheck.query(input)),
          operation,
          current
        );
    });
  }
  async function cancelRun(operationId: string) {
    await task(async current => {
      const receipt = SaihuReportReceiptSchema.parse(
        await client.cancel.mutate({
          expectedWorkspaceId: identity.workspaceId,
          operationId,
        })
      );
      bound(receipt.identity);
      if (receipt.operationId !== operationId)
        throw new Error("RESPONSE_SCOPE_CHANGED");
      if (current()) {
        setSelected(null);
        setNotice("采集已取消；历史源记录保留，未应用数据不会进入看板。");
      }
    });
  }
  return (
    <section
      className="space-y-4 rounded border p-4"
      aria-label="赛狐受控日月报"
    >
      <h3 className="font-semibold">赛狐日／月报 · 受控手工同步</h3>
      <p className="text-sm text-muted-foreground">
        先采集原件与完整性预览，再由人工应用。不会替代领星周一至周日口径，不启动定时同步。日报周六至周五，月报为
        USD 结算利润，不能混填运营利润。
      </p>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {pending && (
        <div className="rounded border border-amber-500 p-3">
          <p>
            未决 {pending.action}：{pending.operationId}
          </p>
          <button
            className={button}
            disabled={busy}
            onClick={() => void recover()}
          >
            检查原操作
          </button>{" "}
          <button
            className={button}
            disabled={busy}
            onClick={() => void recover(true)}
          >
            明确取消原操作
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <label>
          报表类型{" "}
          <select
            disabled={busy || !!pending}
            value={kind}
            onChange={e => {
              invalidate();
              setKind(e.target.value === "daily" ? "daily" : "monthly");
              setStartDate("");
              setEndDate("");
            }}
          >
            <option value="daily">逐日报表</option>
            <option value="monthly">月结报表</option>
          </select>
        </label>
        <label>
          开始{" "}
          <input
            aria-label="开始周期"
            type={kind === "monthly" ? "month" : "date"}
            disabled={busy || !!pending}
            value={startDate}
            onChange={e => {
              invalidate();
              setStartDate(e.target.value);
            }}
          />
        </label>
        {kind === "daily" && (
          <label>
            结束{" "}
            <input
              aria-label="结束周期"
              type="date"
              disabled={busy || !!pending}
              value={endDate}
              onChange={e => {
                invalidate();
                setEndDate(e.target.value);
              }}
            />
          </label>
        )}
        <button
          className={button}
          disabled={
            busy || !!pending || !startDate || (kind === "daily" && !endDate)
          }
          onClick={() => void loadOptions()}
        >
          读取配置与影响基准
        </button>
      </div>
      {options && (
        <div>
          <p>
            状态：
            {options.capability.status === "available"
              ? "可手工采集"
              : options.capability.reasonCode}
            ；仅限以下已核实店铺／站点：
          </p>
          <ul>
            {options.shops.map(shop => (
              <li key={shop.shopId}>
                {shop.storeName} · {shop.country} · {shop.shopId}
              </li>
            ))}
          </ul>
          <button
            className={button}
            disabled={
              busy ||
              !!pending ||
              options.capability.status !== "available" ||
              !!error
            }
            onClick={() => void start()}
          >
            创建后台采集预览（不应用）
          </button>
        </div>
      )}
      <button
        className={button}
        disabled={busy}
        onClick={() => void loadHistory()}
      >
        刷新本人采集记录
      </button>
      <ul>
        {runs.map(run => (
          <li
            className="flex flex-wrap items-center gap-2 py-2"
            key={run.operationId}
          >
            <span>
              {run.scope.kind} {run.scope.start}～{run.scope.end} · {run.state}
              {run.applied
                ? run.revoked
                  ? " · 已撤销"
                  : " · 已应用"
                : ""}{" "}
              {run.reasonCode}
            </span>
            <button
              className={button}
              disabled={busy || run.state !== "preview"}
              onClick={() => void inspect(run.operationId)}
            >
              审阅完整性与数据
            </button>
            {!["failed", "cancelled"].includes(run.state) && !run.applied && (
              <button
                className={button}
                disabled={busy || !!pending}
                onClick={() => void cancelRun(run.operationId)}
              >
                取消此采集
              </button>
            )}
          </li>
        ))}
      </ul>
      {selected && (
        <div className="space-y-3">
          <h4>
            预览：
            {selected.coverage.complete
              ? "覆盖核验通过"
              : "覆盖不完整，禁止应用"}
          </h4>
          {selected.applyBlockingReason && (
            <p role="status">应用受阻：{selected.applyBlockingReason}</p>
          )}
          <p>
            {selected.coverage.blockingReasons.join("；")} ·
            只展示规范化预览，原始响应未写入浏览器存储。
          </p>
          <div className="overflow-auto">
            <table>
              <thead>
                <tr>
                  {["周期", "店铺／站点", "行数", "明确空范围"].map(v => (
                    <th className={cell} key={v}>
                      {v}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selected.coverage.observed.map(value => (
                  <tr key={`${value.period}:${value.shop.shopId}`}>
                    <td className={cell}>{value.period}</td>
                    <td className={cell}>
                      {value.shop.storeName}／{value.shop.country}
                    </td>
                    <td className={cell}>{value.rowCount}</td>
                    <td className={cell}>
                      {value.explicitEmpty ? "有来源证据" : "否"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-auto">
            <table>
              <thead>
                <tr>
                  {[
                    "周期",
                    "店铺／站点",
                    "ASIN／原父体",
                    "指标（未知不补零）",
                  ].map(v => (
                    <th className={cell} key={v}>
                      {v}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {selected.rows.map(row => (
                  <tr key={`${row.period}:${row.shop.shopId}:${row.asin}`}>
                    <td className={cell}>{row.period}</td>
                    <td className={cell}>
                      {row.shop.storeName}／{row.shop.country}
                    </td>
                    <td className={cell}>
                      {row.asin}
                      <br />
                      {row.parentAsin}
                    </td>
                    <td className={cell}>
                      <pre className="whitespace-pre-wrap text-xs">
                        {JSON.stringify(row.metrics, null, 2)}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            共 {selected.rowPage.total} 行；当前从 {selected.rowPage.offset + 1}{" "}
            行开始。
          </p>
          <button
            className={button}
            disabled={busy || selected.rowPage.offset === 0}
            onClick={() =>
              void inspect(
                selected.run.operationId,
                Math.max(0, selected.rowPage.offset - 25)
              )
            }
          >
            上一页
          </button>{" "}
          <button
            className={button}
            disabled={busy || !selected.rowPage.hasMore}
            onClick={() =>
              void inspect(
                selected.run.operationId,
                selected.rowPage.offset + 25
              )
            }
          >
            下一页
          </button>
          {selected.monthlyImpact && (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">
              {JSON.stringify(selected.monthlyImpact, null, 2)}
            </pre>
          )}
          <label className="block">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={busy || !!pending}
              onChange={e => setAcknowledged(e.target.checked)}
            />{" "}
            我已核对全部覆盖范围、替换／撤销影响；确认不与领星自然周或月结／日运营利润混用。
          </label>
          <button
            className={button}
            disabled={busy || !!pending || !acknowledged || !selected.canApply}
            onClick={() => void apply("apply")}
          >
            人工应用这版报表
          </button>{" "}
          <button
            className={button}
            disabled={busy || !!pending || !acknowledged || !selected.canRevoke}
            onClick={() => void apply("revoke")}
          >
            撤销这版，恢复前一有效版本
          </button>
        </div>
      )}
      <button
        className={button}
        disabled={busy}
        onClick={() =>
          void task(async current => {
            const value = await client.dailyOverview.query({
              expectedWorkspaceId: identity.workspaceId,
              marketplace: "ALL",
              weeks: 12,
            });
            bound(value.identity);
            if (current()) setOverview(value);
          })
        }
      >
        读取正式赛狐日事实／周覆盖
      </button>
      {overview !== null && (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">
          {JSON.stringify(overview, null, 2)}
        </pre>
      )}
    </section>
  );
}
export default function SaihuReportSync() {
  const auth = useAuth(),
    permissions = usePermissions();
  if (auth.loading || permissions.isLoading)
    return <p role="status">正在确认赛狐报表身份与权限…</p>;
  const user = auth.user;
  if (
    auth.error ||
    !user ||
    !Number.isSafeInteger(user.id) ||
    !Number.isSafeInteger(user.defaultWorkspaceId) ||
    !user.defaultWorkspaceId ||
    !["super_admin", "admin", "ops_manager"].includes(user.role) ||
    !permissions.canRead("ops", "ops_dashboard") ||
    !permissions.canRead("ops", "ops_data_import")
  )
    return (
      <p role="alert">
        赛狐手工同步需要有效工作区、管理角色和运营导入读取权限；旧内容已隐藏。
      </p>
    );
  return (
    <SaihuReportSyncController
      identity={{ userId: user.id, workspaceId: user.defaultWorkspaceId }}
    />
  );
}
