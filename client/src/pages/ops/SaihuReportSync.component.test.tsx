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
import { SaihuReportSyncController } from "./SaihuReportSync";
import {
  readSaihuReportPending,
  persistSaihuReportPending,
} from "./saihuReportPending";
import type { SaihuReportIdentity } from "@shared/saihuReportSync";

const calls = vi.hoisted(() =>
  Object.fromEntries(
    [
      "preview",
      "start",
      "check",
      "cancel",
      "history",
      "inspect",
      "applyPreview",
      "applyCheck",
      "applyCancel",
      "revoke",
      "revokeCheck",
      "revokeCancel",
      "dailyOverview",
    ].map(key => [key, vi.fn()])
  )
);
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({}) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({}) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      client: {
        opsSaihuReport: Object.fromEntries(
          Object.entries(calls).map(([key, call]) => [
            key,
            { query: call, mutate: call },
          ])
        ),
      },
    }),
  },
}));
const identity = { userId: 3, workspaceId: 7 };
const options = (owner: SaihuReportIdentity = identity) => ({
  identity: owner,
  scope: { kind: "daily", start: "2026-10-01", end: "2026-10-01" },
  historyHash: "a".repeat(64),
  configurationHash: "b".repeat(64),
  shops: [
    { shopId: "synthetic-shop", storeName: "SYNTHETIC 原店铺", country: "US" },
  ],
  capability: { status: "available", reasonCode: null },
  reportingCalendar: "saturday_friday",
  currency: "USD",
  autoApply: false,
});
function mount(owner: SaihuReportIdentity = identity) {
  return render(<SaihuReportSyncController identity={owner} />);
}
function inputDates() {
  fireEvent.change(screen.getByLabelText("开始周期"), {
    target: { value: "2026-10-01" },
  });
  fireEvent.change(screen.getByLabelText("结束周期"), {
    target: { value: "2026-10-01" },
  });
}
async function preview() {
  inputDates();
  fireEvent.click(screen.getByRole("button", { name: "读取配置与影响基准" }));
  await screen.findByText(/SYNTHETIC 原店铺/);
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  let tail = Promise.resolve();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: vi.fn((_key, _options, body) => {
        const work = tail.then(body);
        tail = work.then(
          () => undefined,
          () => undefined
        );
        return work;
      }),
    },
  });
  calls.preview.mockResolvedValue(options());
  calls.check.mockResolvedValue({ receipt: null, run: null });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Saihu original Ops controller recovery and identity lifetime", () => {
  it("mount does not read private sources, start collection, apply or revoke", () => {
    mount();
    for (const call of Object.values(calls))
      expect(call).not.toHaveBeenCalled();
  });
  it("same-identity auth refresh while preview is pending preserves draft and clears busy on completion", async () => {
    let resolve!: (value: unknown) => void;
    calls.preview.mockImplementation(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const view = mount();
    inputDates();
    fireEvent.click(screen.getByRole("button", { name: "读取配置与影响基准" }));
    expect(screen.getByLabelText("开始周期")).toBeDisabled();
    view.rerender(<SaihuReportSyncController identity={{ ...identity }} />);
    await act(async () => {
      resolve(options());
    });
    expect(screen.getByLabelText("开始周期")).toHaveValue("2026-10-01");
    expect(screen.getByLabelText("开始周期")).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "创建后台采集预览（不应用）" })
    ).toBeEnabled();
  });
  it("unknown start persists one original UUID; check and remount never create another request", async () => {
    calls.start.mockRejectedValue(new Error("synthetic ACK lost"));
    const view = mount();
    await preview();
    fireEvent.click(
      screen.getByRole("button", { name: "创建后台采集预览（不应用）" })
    );
    await screen.findByRole("alert");
    const pending = readSaihuReportPending(identity)!;
    expect(pending).not.toBeNull();
    expect(calls.start).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "检查原操作" }));
    await waitFor(() =>
      expect(calls.check).toHaveBeenCalledWith({
        expectedWorkspaceId: 7,
        operationId: pending.operationId,
      })
    );
    expect(readSaihuReportPending(identity)?.operationId).toBe(
      pending.operationId
    );
    view.unmount();
    mount({ ...identity });
    expect(screen.getByText(new RegExp(pending.operationId))).toBeVisible();
    expect(calls.start).toHaveBeenCalledTimes(1);
    expect(calls.check).toHaveBeenCalledTimes(1);
  });
  it("late old-identity preview cannot populate a new actor/workspace or leave its controls busy", async () => {
    let resolve!: (value: unknown) => void;
    calls.preview.mockImplementation(
      () =>
        new Promise(done => {
          resolve = done;
        })
    );
    const view = mount();
    inputDates();
    fireEvent.click(screen.getByRole("button", { name: "读取配置与影响基准" }));
    view.rerender(
      <SaihuReportSyncController identity={{ userId: 4, workspaceId: 8 }} />
    );
    await act(async () => {
      resolve(options());
    });
    expect(screen.queryByText(/SYNTHETIC 原店铺/)).toBeNull();
    expect(screen.getByLabelText("开始周期")).toHaveValue("");
    expect(screen.getByLabelText("开始周期")).toBeEnabled();
    expect(calls.start).not.toHaveBeenCalled();
  });
  it("does not send without a cross-tab lock or persist an unprotected UUID", async () => {
    mount();
    await preview();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "创建后台采集预览（不应用）" })
    );
    await screen.findByText(/浏览器跨窗口安全锁不可用/);
    expect(calls.start).not.toHaveBeenCalled();
    expect(readSaihuReportPending(identity)).toBeNull();
  });
  it("a changed persisted UUID is presented for fresh review rather than silently checked or cancelled", async () => {
    const operation = {
      version: 1 as const,
      identity,
      operationId: "11111111-1111-4111-8111-111111111111",
      runOperationId: "11111111-1111-4111-8111-111111111111",
      action: "start" as const,
      requestHash: "a".repeat(64),
    };
    await persistSaihuReportPending(operation);
    mount();
    const replacement = {
      ...operation,
      operationId: "22222222-2222-4222-8222-222222222222",
      runOperationId: "22222222-2222-4222-8222-222222222222",
    };
    localStorage.setItem(
      "saihu-report-pending:v1:3:7",
      JSON.stringify(replacement)
    );
    fireEvent.click(screen.getByRole("button", { name: "明确取消原操作" }));
    await screen.findByText(/未决操作已变化/);
    expect(calls.cancel).not.toHaveBeenCalled();
    expect(calls.check).not.toHaveBeenCalled();
    expect(screen.getByText(new RegExp(replacement.operationId))).toBeVisible();
  });
});
