// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaihuReportScheduleController } from "./SaihuReportSchedule";
import { readSaihuSchedulePending } from "./saihuReportSchedulePending";
import { saihuReportHash } from "@shared/saihuReportSync";
import type { SaihuReportScheduleView } from "@shared/saihuReportSchedule";
const calls = vi.hoisted(() =>
  Object.fromEntries(
    [
      "list",
      "sourceOptions",
      "read",
      "activationPreview",
      "save",
      "pause",
      "activate",
      "check",
      "cancel",
    ].map(k => [k, vi.fn()])
  )
);
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: {
        opsSaihuSchedule: Object.fromEntries(
          Object.entries(calls).map(([k, fn]) => [k, { query: fn, mutate: fn }])
        ),
      },
    }),
  },
}));
const identity = { userId: 3, workspaceId: 7 },
  target = {
    kind: "daily",
    shops: [
      { shopId: "s1", storeName: "SYNTHETIC 完整批准店铺", country: "US" },
    ],
    configurationHash: "a".repeat(64),
  },
  policy = {
    period: "previous_day",
    timezone: "Asia/Shanghai",
    hour: 9,
    minute: 0,
    weekday: null,
    monthDay: null,
    monthlyNotBeforeDay: null,
    firstScheduledFor: Date.parse("2026-10-20T01:00:00Z"),
    maxLatenessMinutes: 60,
    compensation: { type: "none", maxOccurrences: 0 },
    pendingPreviewLimit: 1,
  };
let stored: SaihuReportScheduleView | null = null;
function receipt(
  input: { planId: string; operationId: string },
  action: "save" | "pause" | "activate"
) {
  return {
    identity,
    planId: input.planId,
    operationId: input.operationId,
    action,
    status: "committed",
    requestHash: saihuReportHash({ identity, action, request: input }),
    revision: stored!.revision,
    versionHash: stored!.versionHash,
  };
}
function mount() {
  return render(<SaihuReportScheduleController identity={identity} />);
}
async function draft() {
  fireEvent.click(screen.getByRole("button", { name: "新建暂停计划编号" }));
  fireEvent.change(screen.getByLabelText("赛狐计划显式政策"), {
    target: { value: JSON.stringify(policy) },
  });
  fireEvent.change(screen.getByLabelText("计划来源类型"), {
    target: { value: "daily" },
  });
  fireEvent.click(screen.getByRole("button", { name: "读取批准计划来源" }));
  await waitFor(() =>
    expect(screen.getByLabelText("赛狐计划完整范围")).toHaveValue(
      JSON.stringify(target, null, 2)
    )
  );
}
async function paused() {
  await draft();
  fireEvent.click(screen.getByRole("button", { name: "保存为暂停计划" }));
  await screen.findByText(/计划操作已确认/);
  fireEvent.click(screen.getByRole("button", { name: "读取此计划" }));
  await screen.findByText(/已保存状态：paused/);
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  stored = null;
  let tail = Promise.resolve();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: vi.fn((_key, _options, body) => {
        const p = tail.then(body);
        tail = p.then(
          () => undefined,
          () => undefined
        );
        return p;
      }),
    },
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  calls.sourceOptions.mockResolvedValue({ identity, target, reasonCode: null });
  calls.list.mockImplementation(() => ({
    identity,
    plans: stored ? [stored] : [],
    nextCursor: null,
  }));
  calls.read.mockImplementation(() => stored);
  calls.check.mockResolvedValue(null);
  calls.save.mockImplementation(input => {
    const body = {
      version: 1 as const,
      identity,
      planId: input.planId,
      revision: (stored?.revision ?? 0) + 1,
      status: "paused" as const,
      policy: input.policy,
      target: input.target,
      nextScheduledFor: input.policy.firstScheduledFor,
      outstanding: [],
      reasonCode: null,
    };
    stored = { ...body, versionHash: saihuReportHash(body) };
    return receipt(input, "save");
  });
  calls.activationPreview.mockImplementation(() => ({
    plan: stored,
    next: {
      scheduledFor: policy.firstScheduledFor,
      operationId: "22222222-2222-5222-8222-222222222222",
      scope: { kind: "daily", start: "2026-10-19", end: "2026-10-19" },
    },
    available: true,
    reasonCode: null,
    activationHash: "c".repeat(64),
    autoApply: false,
    schedulingEnabled: true,
  }));
  calls.activate.mockImplementation(input => receipt(input, "activate"));
  calls.pause.mockImplementation(input => receipt(input, "pause"));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("explicit paused plan controls in original Ops surface", () => {
  it("mount does not read, save, seed, activate or queue anything", () => {
    mount();
    for (const call of Object.values(calls))
      expect(call).not.toHaveBeenCalled();
    expect(screen.getByLabelText("赛狐计划显式政策")).toHaveValue("");
  });
  it("saves only an explicitly entered paused plan; no activate follows save or read", async () => {
    mount();
    await paused();
    expect(calls.save).toHaveBeenCalledTimes(1);
    expect(calls.save.mock.calls[0][0]).toMatchObject({
      expectedWorkspaceId: 7,
      expectedVersionHash: null,
      policy,
      target,
    });
    expect(calls.activate).not.toHaveBeenCalled();
    expect(readSaihuSchedulePending(identity)).toBeNull();
  });
  it("activation requires separate fresh preview, full scope and next occurrence confirmations", async () => {
    mount();
    await paused();
    fireEvent.click(
      screen.getByRole("button", { name: "预览下一 occurrence 与激活门槛" })
    );
    const activate = await screen.findByRole("button", {
      name: "明确激活此单工作区计划",
    });
    expect(activate).toBeDisabled();
    fireEvent.click(screen.getByLabelText("确认计划完整范围"));
    expect(activate).toBeDisabled();
    fireEvent.click(screen.getByLabelText("确认计划下一周期"));
    fireEvent.click(activate);
    await waitFor(() => expect(calls.activate).toHaveBeenCalledTimes(1));
    expect(calls.activationPreview).toHaveBeenCalledTimes(2);
    expect(calls.activate.mock.calls[0][0]).toMatchObject({
      confirmFullScope: true,
      confirmNextOccurrence: true,
      expectedActivationHash: "c".repeat(64),
    });
  });
  it("unknown save/remount checks only the original UUID and never resends the plan", async () => {
    calls.save.mockRejectedValue(new Error("synthetic ACK lost"));
    const view = mount();
    await draft();
    fireEvent.click(screen.getByRole("button", { name: "保存为暂停计划" }));
    await screen.findByRole("alert");
    const pending = readSaihuSchedulePending(identity)!;
    expect(pending).not.toBeNull();
    expect(JSON.stringify(pending)).not.toContain("SYNTHETIC");
    view.unmount();
    mount();
    fireEvent.click(screen.getByRole("button", { name: "检查原计划请求" }));
    await waitFor(() =>
      expect(calls.check).toHaveBeenCalledWith({
        expectedWorkspaceId: 7,
        planId: pending.planId,
        operationId: pending.operationId,
        action: "save",
      })
    );
    expect(calls.save).toHaveBeenCalledTimes(1);
    expect(readSaihuSchedulePending(identity)?.operationId).toBe(
      pending.operationId
    );
  });
  it("same-identity object refresh does not strand a pending read; cross-identity late results stay hidden", async () => {
    const view = mount();
    await paused();
    let resolve!: (value: unknown) => void;
    calls.read.mockImplementation(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    fireEvent.click(screen.getByRole("button", { name: "读取此计划" }));
    view.rerender(<SaihuReportScheduleController identity={{ ...identity }} />);
    await act(async () => resolve(stored));
    expect(screen.getByLabelText("赛狐计划编号")).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "读取此计划" }));
    view.rerender(
      <SaihuReportScheduleController identity={{ userId: 4, workspaceId: 8 }} />
    );
    await act(async () => resolve(stored));
    expect(screen.queryByText(/已保存状态/)).toBeNull();
    expect(screen.getByLabelText("赛狐计划编号")).toHaveValue("");
  });
  it("missing cross-tab lock blocks save before any RPC or private-policy persistence", async () => {
    mount();
    await draft();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
    fireEvent.click(screen.getByRole("button", { name: "保存为暂停计划" }));
    await screen.findByRole("alert");
    expect(calls.save).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });
});
