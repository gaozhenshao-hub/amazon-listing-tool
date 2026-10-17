// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OperationsReadOnlyOverview, {
  OperationsReadOnlyContent,
} from "./OperationsReadOnlyOverview";
import type { InventoryReadRecord } from "./operationsReadOnlyModel";

const controls = vi.hoisted(() => {
  const inventory = vi.fn(),
    financial = vi.fn();
  return {
    auth: {
      user: { id: 1, defaultWorkspaceId: 10, role: "ops_specialist" } as {
        id: number;
        defaultWorkspaceId: number;
        role: string;
      } | null,
      loading: false,
      error: null as Error | null,
    },
    inventory,
    financial,
    client: {
      dataImport: {
        getInventoryPlanningFromImport: { query: inventory },
        getMonthlyFinancialProfits: { query: financial },
      },
    },
  };
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => controls.auth }));
vi.mock("@/lib/trpc", () => ({
  trpc: { useUtils: () => ({ client: controls.client }) },
}));
// Separate live-query/security tests cover this child; these checks prove the
// real overview mounts it only within the authenticated identity boundary.
vi.mock("./OperationsCostSheetReadOnly", () => ({
  default: () => <section aria-label="完整成本表入口">完整成本表独立只读入口</section>,
}));

const row = (
  changes: Partial<InventoryReadRecord> = {}
): InventoryReadRecord => ({
  asin: "CHILD-A",
  parentAsin: "PARENT-A",
  storeName: "Store A",
  country: "US",
  productName: "接口产品",
  totalInventory: 0,
  localInventory: 0,
  productCost: null,
  currency: "USD",
  ...changes,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  controls.auth = {
    user: { id: 1, defaultWorkspaceId: 10, role: "ops_specialist" },
    loading: false,
    error: null,
  };
  controls.inventory
    .mockReset()
    .mockResolvedValue({ asOfDate: "2026-10-01", rows: [row()] });
  controls.financial.mockReset().mockResolvedValue([]);
});
afterEach(cleanup);

describe("operations read-only view", () => {
  it("labels API defaults and missing costs honestly, with only existing navigation and read controls", () => {
    const refresh = vi.fn();
    render(
      <OperationsReadOnlyContent
        inventory={{ status: "ready", rows: [row()] }}
        financial={{ status: "ready", rows: [] }}
        asOfDate="2026-10-01"
        refreshing={false}
        onRefresh={refresh}
      />
    );
    expect(screen.getByText(/部分空库存可能被接口补零/)).toBeVisible();
    expect(screen.getByText(/币种也可能缺省为 USD/)).toBeVisible();
    expect(screen.getByText(/不表示零或已证实未配置/)).toBeVisible();
    expect(screen.getByText(/未返回本地库存确认凭据/)).toBeVisible();
    expect(screen.getByRole("link", { name: "原库存规划" })).toHaveAttribute(
      "href",
      "/ops/inventory"
    );
    expect(screen.getByRole("link", { name: "原产品总览" })).toHaveAttribute(
      "href",
      "/ops/products"
    );
    expect(
      screen.queryByRole("button", { name: /保存|确认|同步|AI|上传|采购/ })
    ).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重新读取已有数据" }));
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("shows original manual amounts and NULL records separately without pretending they are full reports", () => {
    render(
      <OperationsReadOnlyContent
        inventory={{ status: "ready", rows: [] }}
        financial={{
          status: "ready",
          rows: [
            {
              id: 1,
              parentAsin: "PARENT-A",
              storeName: null,
              country: null,
              yearMonth: "2026-09",
              financialProfit: "-8.50",
            },
            {
              id: 2,
              parentAsin: "PARENT-A",
              storeName: "Store A",
              country: "US",
              yearMonth: "2026-09",
              financialProfit: "0.00",
            },
          ],
        }}
        asOfDate={null}
        refreshing={false}
        onRefresh={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "手工财务台账" }));
    const section = screen.getByRole("region", {
      name: "手工财务台账只读记录",
    });
    expect(
      within(section).getByText("旧 NULL 范围 · 不自动归属")
    ).toBeVisible();
    expect(within(section).getByText("-8.5")).toBeVisible();
    expect(within(section).getByText("0")).toBeVisible();
    expect(within(section).getByText(/不生成费用明细/)).toBeVisible();
  });
  it("keeps full source-scoped parents together while searching and paging", () => {
    const records = [
      row(),
      row({ asin: "CHILD-B", productName: "兄弟子体" }),
      ...Array.from({ length: 6 }, (_, index) =>
        row({
          asin: `X${index}`,
          parentAsin: `PARENT-${index}`,
          productName: `其他${index}`,
        })
      ),
    ];
    render(
      <OperationsReadOnlyContent
        inventory={{ status: "ready", rows: records }}
        financial={{ status: "ready", rows: [] }}
        asOfDate="2026-10-01"
        refreshing={false}
        onRefresh={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText(/第 2 \/ 2 页/)).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索只读记录" }), {
      target: { value: "CHILD-B" },
    });
    expect(screen.getByText("CHILD-A")).toBeVisible();
    expect(screen.getByText("CHILD-B")).toBeVisible();
    expect(screen.getByText(/第 1 \/ 1 页/)).toBeVisible();
    expect(screen.queryByText("其他0")).not.toBeInTheDocument();
  });
  it("distinguishes permission failures and loading from genuine empty results", () => {
    render(
      <OperationsReadOnlyContent
        inventory={{ status: "error", message: "FORBIDDEN" }}
        financial={{ status: "loading" }}
        asOfDate={null}
        refreshing={false}
        onRefresh={() => {}}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("FORBIDDEN");
    expect(
      screen.queryByRole("button", { name: "下一页" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("当前筛选没有接口返回的库存记录。")
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "手工财务台账" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "正在读取手工财务台账"
    );
    expect(
      screen.queryByRole("button", { name: "下一页" })
    ).not.toBeInTheDocument();
  });
});

describe("fresh authenticated query ownership (synthetic client)", () => {
  it.each(["unauthenticated", "loading", "auth-error", "workspace-missing"])(
    "starts zero business reads when %s",
    kind => {
      if (kind === "unauthenticated") controls.auth.user = null;
      if (kind === "loading") controls.auth.loading = true;
      if (kind === "auth-error") controls.auth.error = new Error("auth failed");
      if (kind === "workspace-missing")
        controls.auth.user!.defaultWorkspaceId = 0;
      render(<OperationsReadOnlyOverview />);
      expect(controls.inventory).not.toHaveBeenCalled();
      expect(controls.financial).not.toHaveBeenCalled();
      expect(
        screen.queryByLabelText("选择本地月报文件")
      ).not.toBeInTheDocument();
      expect(screen.queryByLabelText("完整成本表入口")).not.toBeInTheDocument();
    }
  );
  it("calls only two existing query methods with abort signals and refreshes on explicit request", async () => {
    const { unmount } = render(<OperationsReadOnlyOverview />);
    await screen.findByText("接口产品");
    expect(screen.getByLabelText("完整成本表入口")).toBeVisible();
    expect(controls.inventory).toHaveBeenCalledTimes(1);
    expect(controls.financial).toHaveBeenCalledTimes(1);
    expect(controls.inventory.mock.calls[0][0]).toEqual({ marketplace: "ALL" });
    expect(controls.financial.mock.calls[0][0]).toBeUndefined();
    const signal = controls.inventory.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "重新读取已有数据" }));
    await waitFor(() => expect(controls.inventory).toHaveBeenCalledTimes(2));
    expect(signal.aborted).toBe(true);
    const secondSignal = controls.inventory.mock.calls[1][1]
      .signal as AbortSignal;
    unmount();
    expect(secondSignal.aborted).toBe(true);
  });
  it.each(["user", "workspace"])(
    "never displays late prior %s responses after an identity switch",
    async kind => {
      const old = deferred<{ asOfDate: string; rows: InventoryReadRecord[] }>();
      const fresh = deferred<{
        asOfDate: string;
        rows: InventoryReadRecord[];
      }>();
      controls.inventory
        .mockReset()
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(fresh.promise);
      const { rerender } = render(<OperationsReadOnlyOverview />);
      const oldSignal = controls.inventory.mock.calls[0][1]
        .signal as AbortSignal;
      const priorFileInput = screen.getByLabelText("选择本地月报文件");
      const priorCostEntry = screen.getByLabelText("完整成本表入口");
      controls.auth.user = {
        id: kind === "user" ? 2 : 1,
        defaultWorkspaceId: kind === "workspace" ? 20 : 10,
        role: "ops_specialist",
      };
      rerender(<OperationsReadOnlyOverview />);
      expect(oldSignal.aborted).toBe(true);
      expect(screen.getByLabelText("选择本地月报文件")).not.toBe(
        priorFileInput
      );
      expect(screen.getByLabelText("完整成本表入口")).not.toBe(priorCostEntry);
      await act(async () => {
        fresh.resolve({
          asOfDate: "2026-10-02",
          rows: [row({ productName: "新身份记录" })],
        });
      });
      expect(await screen.findByText("新身份记录")).toBeVisible();
      await act(async () => {
        old.resolve({
          asOfDate: "2026-10-01",
          rows: [row({ productName: "旧身份记录" })],
        });
      });
      expect(screen.queryByText("旧身份记录")).not.toBeInTheDocument();
      expect(screen.getByText("新身份记录")).toBeVisible();
    }
  );
  it("hides owned data during auth refresh and never substitutes prior success after a read failure", async () => {
    const { rerender } = render(<OperationsReadOnlyOverview />);
    await screen.findByText("接口产品");
    controls.auth.loading = true;
    rerender(<OperationsReadOnlyOverview />);
    expect(screen.queryByText("接口产品")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("完整成本表入口")).not.toBeInTheDocument();
    expect(controls.inventory).toHaveBeenCalledTimes(1);
    controls.inventory.mockRejectedValueOnce(new Error("permission revoked"));
    controls.auth.loading = false;
    rerender(<OperationsReadOnlyOverview />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "permission revoked"
    );
    expect(screen.queryByText("接口产品")).not.toBeInTheDocument();
  });
});
