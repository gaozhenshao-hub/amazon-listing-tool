import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  saihuReportHash,
  type SaihuReportIdentity,
} from "@shared/saihuReportSync";
import {
  SaihuReportSchedulePolicySchema,
  SaihuReportScheduleTargetSchema,
  SaihuReportScheduleViewSchema,
  SaihuReportScheduleActivationSchema,
  SaihuReportScheduleReceiptSchema,
  SaihuReportScheduleSourceSchema,
  SaihuReportScheduleListSchema,
  SaihuReportScheduleSaveInputSchema,
  SaihuReportSchedulePauseInputSchema,
  SaihuReportScheduleActivateInputSchema,
  type SaihuReportScheduleView,
} from "@shared/saihuReportSchedule";
import {
  readSaihuSchedulePending,
  reserveSaihuSchedulePending,
  releaseSaihuSchedulePending,
  type SaihuSchedulePending,
} from "./saihuReportSchedulePending";
const button = "rounded border px-3 py-2 text-sm disabled:opacity-50";
export function SaihuReportScheduleController({
  identity,
}: {
  identity: SaihuReportIdentity;
}) {
  return (
    <Owned
      key={`${identity.userId}:${identity.workspaceId}`}
      identity={identity}
    />
  );
}
function Owned({ identity }: { identity: SaihuReportIdentity }) {
  const { userId, workspaceId } = identity,
    client = trpc.useUtils().client.opsSaihuSchedule,
    live = useRef(true),
    generation = useRef(0),
    busyRef = useRef(false);
  const [planId, setPlanId] = useState(""),
    [policy, setPolicy] = useState(""),
    [target, setTarget] = useState(""),
    [sourceKind, setSourceKind] = useState(""),
    [plan, setPlan] = useState<SaihuReportScheduleView | null>(null),
    [plans, setPlans] = useState<SaihuReportScheduleView[]>([]),
    [activation, setActivation] = useState<ReturnType<
      typeof SaihuReportScheduleActivationSchema.parse
    > | null>(null),
    [pending, setPending] = useState<SaihuSchedulePending | null>(null),
    [dirty, setDirty] = useState(false),
    [verified, setVerified] = useState(false),
    [busy, setBusy] = useState(false),
    [ackScope, setAckScope] = useState(false),
    [ackNext, setAckNext] = useState(false),
    [message, setMessage] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const owner = { userId, workspaceId },
      lifetime = generation;
    live.current = true;
    const refresh = () => {
      try {
        const p = readSaihuSchedulePending(owner);
        setPending(p);
        if (p) setPlanId(p.planId);
      } catch {
        setError("计划恢复元数据无效，已阻止新写入。");
      }
    };
    refresh();
    window.addEventListener("storage", refresh);
    return () => {
      live.current = false;
      lifetime.current++;
      window.removeEventListener("storage", refresh);
    };
  }, [userId, workspaceId]);
  const bound = (value: SaihuReportIdentity) => {
    if (value.userId !== userId || value.workspaceId !== workspaceId)
      throw new Error("SCHEDULE_RESPONSE_SCOPE_CHANGED");
  };
  async function task(body: (current: () => boolean) => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const token = ++generation.current,
      current = () => live.current && token === generation.current;
    try {
      await body(current);
    } catch {
      if (current())
        setError(
          "计划请求未核实；已提交时只能检查或取消原编号，不自动重发。缺少安全锁、批准政策或来源时不会启用。"
        );
    } finally {
      busyRef.current = false;
      if (current()) setBusy(false);
    }
  }
  function invalidate() {
    setActivation(null);
    setAckScope(false);
    setAckNext(false);
    setDirty(true);
  }
  function adopt(value: SaihuReportScheduleView) {
    bound(value.identity);
    setPlan(value);
    setPlanId(value.planId);
    setPolicy(JSON.stringify(value.policy, null, 2));
    setTarget(JSON.stringify(value.target, null, 2));
    setVerified(true);
    setDirty(false);
    setActivation(null);
    setAckScope(false);
    setAckNext(false);
  }
  async function read() {
    if (dirty && !window.confirm("读取会替换未保存的计划草稿，是否继续？"))
      return;
    await task(async current => {
      const value = await client.read.query({
        expectedWorkspaceId: workspaceId,
        planId,
      });
      if (!current()) return;
      if (value) adopt(SaihuReportScheduleViewSchema.parse(value));
      else {
        setPlan(null);
        setVerified(true);
        setMessage("此编号尚无已保存计划；保存后仍为暂停。");
      }
    });
  }
  async function accepted(
    raw: unknown,
    operation: SaihuSchedulePending,
    current: () => boolean
  ) {
    const receipt = SaihuReportScheduleReceiptSchema.parse(raw);
    bound(receipt.identity);
    if (
      receipt.planId !== operation.planId ||
      receipt.operationId !== operation.operationId ||
      receipt.action !== operation.action ||
      (receipt.status === "committed" &&
        receipt.requestHash !== operation.requestHash)
    )
      throw new Error("SCHEDULE_RECEIPT_CHANGED");
    await releaseSaihuSchedulePending(operation);
    if (current()) {
      setPending(null);
      setDirty(false);
      setVerified(false);
      setActivation(null);
      setAckNext(false);
      setAckScope(false);
      setMessage(
        receipt.status === "cancelled"
          ? "原计划请求已取消；已成功的计划不会被撤销。"
          : "计划操作已确认，请重新读取状态；没有自动应用报表。"
      );
    }
  }
  async function write(action: "save" | "pause" | "activate") {
    if (
      pending ||
      !verified ||
      (action !== "save" && (!plan || dirty)) ||
      (action === "activate" &&
        (!activation?.available || !ackScope || !ackNext))
    )
      return;
    await task(async current => {
      const operationId = crypto.randomUUID(),
        base = {
          expectedWorkspaceId: workspaceId,
          planId,
          operationId,
          expectedVersionHash: plan?.versionHash ?? null,
        };
      let input;
      if (action === "save")
        input = SaihuReportScheduleSaveInputSchema.parse({
          ...base,
          policy: SaihuReportSchedulePolicySchema.parse(JSON.parse(policy)),
          target: target.trim()
            ? SaihuReportScheduleTargetSchema.nullable().parse(
                JSON.parse(target)
              )
            : null,
        });
      else if (action === "pause")
        input = SaihuReportSchedulePauseInputSchema.parse(base);
      else {
        const fresh = SaihuReportScheduleActivationSchema.parse(
          await client.activationPreview.query({
            expectedWorkspaceId: workspaceId,
            planId,
          })
        );
        bound(fresh.plan.identity);
        if (
          fresh.activationHash !== activation?.activationHash ||
          !fresh.available
        ) {
          if (current()) {
            setActivation(fresh);
            setAckNext(false);
            setAckScope(false);
            setMessage("计划、来源或下一周期变化，请重新审阅。");
          }
          return;
        }
        input = SaihuReportScheduleActivateInputSchema.parse({
          ...base,
          expectedActivationHash: fresh.activationHash,
          confirmFullScope: true,
          confirmNextOccurrence: true,
        });
      }
      if (!current()) return;
      const operation: SaihuSchedulePending = {
        version: 1,
        identity,
        planId,
        operationId,
        action,
        requestHash: saihuReportHash({ identity, action, request: input }),
      };
      await reserveSaihuSchedulePending(operation);
      if (!current()) return;
      setPending(operation);
      const result =
        action === "save"
          ? await client.save.mutate(
              SaihuReportScheduleSaveInputSchema.parse(input)
            )
          : action === "pause"
            ? await client.pause.mutate(
                SaihuReportSchedulePauseInputSchema.parse(input)
              )
            : await client.activate.mutate(
                SaihuReportScheduleActivateInputSchema.parse(input)
              );
      await accepted(result, operation, current);
    });
  }
  async function recover(cancel = false) {
    await task(async current => {
      const operation = readSaihuSchedulePending(identity);
      if (!operation || JSON.stringify(operation) !== JSON.stringify(pending)) {
        if (current()) {
          setPending(operation);
          setMessage("原计划请求已变化，请核对编号后重新选择。");
        }
        return;
      }
      const input = {
          expectedWorkspaceId: workspaceId,
          planId: operation.planId,
          operationId: operation.operationId,
          action: operation.action,
        },
        result = cancel
          ? await client.cancel.mutate(input)
          : await client.check.query(input);
      if (result) await accepted(result, operation, current);
      else if (current())
        setMessage("原编号尚无回执；只可继续检查或明确取消。");
    });
  }
  return (
    <section aria-label="赛狐周期计划" className="space-y-3 rounded border p-3">
      <h4>赛狐周期计划 · 默认暂停／只生成预览</h4>
      <p>
        这是 C
        的第一切片：仅显式计划到队列。完整历史窗口、公平发现及跨进程执行锁仍待后续接入；当前超预算明确拒绝。不会自动应用、创建全工作区计划或停用领星。
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {pending && (
        <div>
          <p>
            未决计划 {pending.action}：{pending.operationId}
          </p>
          <button
            className={button}
            disabled={busy}
            onClick={() => void recover()}
          >
            检查原计划请求
          </button>
          <button
            className={button}
            disabled={busy}
            onClick={() => void recover(true)}
          >
            取消原计划请求
          </button>
        </div>
      )}
      <button
        className={button}
        disabled={busy || !!pending}
        onClick={() => {
          if (dirty && !window.confirm("是否放弃当前未保存草稿？")) return;
          setPlanId(crypto.randomUUID());
          setPlan(null);
          setPolicy("");
          setTarget("");
          setVerified(true);
          setDirty(false);
          setActivation(null);
        }}
      >
        新建暂停计划编号
      </button>
      <button
        className={button}
        disabled={busy}
        onClick={() =>
          void task(async current => {
            const result = SaihuReportScheduleListSchema.parse(
              await client.list.query({
                expectedWorkspaceId: workspaceId,
                cursor: null,
                limit: 20,
              })
            );
            bound(result.identity);
            if (current()) {
              setPlans(result.plans);
              setMessage(
                result.nextCursor
                  ? "还有更多计划；本页显示前20条，可使用明确计划编号读取。"
                  : "本人计划列表已核实。"
              );
            }
          })
        }
      >
        读取本人计划列表
      </button>
      <ul>
        {plans.map(row => (
          <li key={row.planId}>
            {row.planId} · {row.status}
            <button
              className={button}
              disabled={busy || !!pending}
              onClick={() => {
                if (dirty && !window.confirm("是否放弃当前未保存草稿？"))
                  return;
                adopt(row);
              }}
            >
              选择此计划
            </button>
          </li>
        ))}
      </ul>
      <label>
        计划编号{" "}
        <input
          aria-label="赛狐计划编号"
          value={planId}
          disabled={busy || !!pending}
          onChange={e => {
            setPlanId(e.target.value);
            setVerified(false);
            setPlan(null);
            invalidate();
          }}
        />
      </label>
      <button
        className={button}
        disabled={busy || !planId}
        onClick={() => void read()}
      >
        读取此计划
      </button>
      {plan && (
        <p>
          已保存状态：{plan.status} · 版本 {plan.revision} · {plan.reasonCode} ·
          下一 occurrence{" "}
          {plan.nextScheduledFor === null
            ? "未配置"
            : new Date(plan.nextScheduledFor).toISOString()}
        </p>
      )}
      <label>
        计划来源类型{" "}
        <select
          aria-label="计划来源类型"
          value={sourceKind}
          disabled={busy || !!pending}
          onChange={e => setSourceKind(e.target.value)}
        >
          <option value="">明确选择</option>
          <option value="daily">赛狐日报</option>
          <option value="monthly">赛狐结算月报</option>
        </select>
      </label>
      <button
        className={button}
        disabled={busy || !!pending || !sourceKind}
        onClick={() =>
          void task(async current => {
            const result = SaihuReportScheduleSourceSchema.parse(
              await client.sourceOptions.query({
                expectedWorkspaceId: workspaceId,
                kind: sourceKind === "monthly" ? "monthly" : "daily",
              })
            );
            bound(result.identity);
            if (current()) {
              setTarget(JSON.stringify(result.target, null, 2));
              invalidate();
              setMessage(
                result.reasonCode ?? "以下是完整批准店铺范围；保存不会激活。"
              );
            }
          })
        }
      >
        读取批准计划来源
      </button>
      <p>
        政策 JSON
        必须明确所有键：period、timezone、hour、minute、weekday、monthDay、monthlyNotBeforeDay、firstScheduledFor（毫秒）、maxLatenessMinutes、compensation（type/maxOccurrences）、pendingPreviewLimit。无值使用
        null，计划不可激活；不适用的 weekday/月字段必须为 null。支持 UTC 与
        Asia/Shanghai，不猜时区。period 可选
        previous_day／last_complete_sat_fri_week／previous_month。compensation
        为 none 且上限0，或 bounded 且明确上限。
      </p>
      <label>
        显式政策{" "}
        <textarea
          aria-label="赛狐计划显式政策"
          rows={10}
          value={policy}
          disabled={busy || !!pending}
          onChange={e => {
            setPolicy(e.target.value);
            invalidate();
          }}
        />
      </label>
      <label>
        完整批准来源范围{" "}
        <textarea
          aria-label="赛狐计划完整范围"
          rows={6}
          value={target}
          disabled={busy || !!pending}
          onChange={e => {
            setTarget(e.target.value);
            invalidate();
          }}
        />
      </label>
      <button
        className={button}
        disabled={busy || !!pending || !verified || !planId || !policy}
        onClick={() => void write("save")}
      >
        保存为暂停计划
      </button>
      <button
        className={button}
        disabled={busy || !!pending || !verified || !plan || dirty}
        onClick={() => void write("pause")}
      >
        暂停此计划
      </button>
      <button
        className={button}
        disabled={busy || !!pending || !verified || !plan || dirty}
        onClick={() =>
          void task(async current => {
            const result = SaihuReportScheduleActivationSchema.parse(
              await client.activationPreview.query({
                expectedWorkspaceId: workspaceId,
                planId,
              })
            );
            bound(result.plan.identity);
            if (current()) {
              setActivation(result);
              setAckNext(false);
              setAckScope(false);
            }
          })
        }
      >
        预览下一 occurrence 与激活门槛
      </button>
      {activation && (
        <div>
          <p>
            激活：{activation.available ? "可确认" : activation.reasonCode}
            ；不会自动应用
          </p>
          <pre>
            {JSON.stringify(
              {
                target: activation.plan.target,
                next: activation.next,
                policy: activation.plan.policy,
              },
              null,
              2
            )}
          </pre>
          <label>
            <input
              type="checkbox"
              aria-label="确认计划完整范围"
              checked={ackScope}
              disabled={busy}
              onChange={e => setAckScope(e.target.checked)}
            />
            确认完整店铺、站点和来源
          </label>
          <label>
            <input
              type="checkbox"
              aria-label="确认计划下一周期"
              checked={ackNext}
              disabled={busy}
              onChange={e => setAckNext(e.target.checked)}
            />
            确认原 scheduledFor、下一周期和漏跑／积压政策
          </label>
          <button
            className={button}
            disabled={
              busy ||
              !!pending ||
              !activation.available ||
              !ackScope ||
              !ackNext ||
              dirty
            }
            onClick={() => void write("activate")}
          >
            明确激活此单工作区计划
          </button>
        </div>
      )}
    </section>
  );
}
