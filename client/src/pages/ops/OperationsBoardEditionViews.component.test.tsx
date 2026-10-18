// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProductBoardReadOnly, { ProductEditionContent } from "./ProductBoardReadOnly";
import ProfitBoardReadOnly, { ProfitEditionContent } from "./ProfitBoardReadOnly";
import { syntheticOperationsBoardEdition } from "./operationsBoardEditionView.fixture";

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ loading: false, error: null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isLoading: false, canRead: () => true }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: {} }) } }));
vi.mock("./OperationsBoardEditionWorkspace", () => ({ OperationsBoardEditionWorkspace: ({ scope }: { scope: unknown }) => <section aria-label="真实归档控制层入口">{JSON.stringify(scope)}</section> }));
vi.mock("./ProfitAnalysisWorkflow", () => ({ default: () => <section aria-label="当前产品利润工具" /> }));
vi.mock("./OperationsCostSheetActions", () => ({ OperationsCostSheetEmbeddedActions: () => <section aria-label="当前产品成本工具" /> }));
vi.mock("./ProductTasksReadOnly", () => ({ ProductTasksEmbeddedReadOnly: () => <section aria-label="当前产品任务工具" /> }));
const renderNote = (parent: string) => <button type="button">版本备注 {parent}</button>;
afterEach(cleanup);

describe("real edition sources in complete existing boards", () => {
  it("keeps all product sections, original source proof and complete child/history details", () => {
    render(<ProductEditionContent read={syntheticOperationsBoardEdition()} renderNote={renderNote} />);
    for (const name of ["高退货率产品", "高利润产品", "亏损产品", "全部产品"]) expect(screen.getByRole("region", { name })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "归档完整历史来源" })).toHaveTextContent("2024-01");
    expect(screen.queryByText("SYNTHETIC-NOT-ARCHIVED.xlsx")).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("region", { name: "全部产品" })).getByRole("button", { name: "展开 P00 全部子体与原行" }));
    const history = screen.getByRole("region", { name: "产品完整历史月报" });
    fireEvent.click(within(history).getAllByRole("button", { name: "月表下一页" })[0]);
    expect(history).toHaveTextContent("2024-01");
    expect(screen.getByRole("region", { name: "产品完整钻取" })).toHaveTextContent("CHILD-0");
    expect(screen.getByRole("region", { name: "当前授权产品工具" })).toHaveTextContent("不是此归档版本");
    expect(screen.getByLabelText("当前产品任务工具")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "版本备注 P00" }).length).toBeGreaterThan(0);
    expect(document.querySelector("img[src=x]")).toBeNull();
  });
  it("filters whole product groups before pagination without changing edition month", () => {
    render(<ProductEditionContent read={syntheticOperationsBoardEdition({ groups: 25 })} renderNote={renderNote} />);
    const all = screen.getByRole("region", { name: "全部产品" });
    expect(all).toHaveTextContent("全筛选 25 组");
    fireEvent.click(within(all).getByRole("button", { name: "全部产品下一页" }));
    expect(screen.getByRole("region", { name: "全部产品" })).toHaveTextContent("偏移 10");
    fireEvent.change(screen.getByLabelText("版本内产品搜索"), { target: { value: "CHILD-48" } });
    fireEvent.click(screen.getByRole("button", { name: "筛选完整父组" }));
    const filtered = screen.getByRole("region", { name: "全部产品" });
    expect(filtered).toHaveTextContent("全筛选 1 组"); expect(filtered).toHaveTextContent("偏移 0");
    fireEvent.click(within(filtered).getByRole("button", { name: "展开 P24 全部子体与原行" }));
    expect(screen.getByRole("region", { name: "产品完整钻取" })).toHaveTextContent("CHILD-49");
    expect(screen.getByText(/基准月 2026-10/)).toBeInTheDocument();
  });
  it("preserves six-month trends, top-five notes, cross-page rank drilldown and full financial columns", () => {
    render(<ProfitEditionContent read={syntheticOperationsBoardEdition({ groups: 25 })} renderNote={renderNote} />);
    expect(screen.getByRole("region", { name: "六个月数据入口" })).toHaveTextContent("2026-05");
    expect(screen.getByRole("region", { name: "币种与汇总依据分区" })).toHaveTextContent("利润增长前五名");
    const list = screen.getByRole("region", { name: "完整父体列表" });
    fireEvent.click(within(list).getByRole("button", { name: "父体下一页" }));
    fireEvent.click(screen.getAllByRole("button", { name: "查看 P00 完整父子明细" })[0]);
    expect(screen.getByRole("region", { name: "选中产品完整钻取" })).toHaveTextContent("CHILD-0");
    for (const label of ["退款金额", "仓储费", "广告费", "头程费用"]) expect(screen.getByRole("region", { name: "选中产品完整钻取" })).toHaveTextContent(label);
    expect(screen.getByRole("region", { name: "当前授权产品工具" })).toHaveTextContent("不是此归档版本");
    expect(screen.getAllByRole("button", { name: "版本备注 P00" }).length).toBeGreaterThan(1);
    expect(screen.queryByRole("button", { name: /为基准重新读取/ })).not.toBeInTheDocument();
  });
  it("current-empty retains the current month and missing source instead of falling back", () => {
    render(<ProfitEditionContent read={syntheticOperationsBoardEdition({ archived: false, currentEmpty: true })} renderNote={renderNote} />);
    expect(screen.getByText(/基准月 2026-10 对比 2026-09/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "2026-10 归档来源证据" })).toHaveTextContent("没有此月原行");
    expect(screen.getByRole("region", { name: "币种与汇总依据分区" })).toHaveTextContent("未知");
  });
  it.each(["products", "profit"])("%s opens the archive control with exact canonical shop/site and no arbitrary live month", kind => {
    render(kind === "products" ? <ProductBoardReadOnly /> : <ProfitBoardReadOnly />);
    const prefix = kind === "products" ? "产品看板" : "利润看板";
    fireEvent.change(screen.getByLabelText(`${prefix}店铺`), { target: { value: "SYNTHETIC 合成店铺" } });
    fireEvent.change(screen.getByLabelText(`${prefix}站点 / 国家代码`), { target: { value: "美国" } });
    fireEvent.click(screen.getByRole("button", { name: "打开当前／历史归档看板" }));
    expect(screen.getByRole("region", { name: "真实归档控制层入口" })).toHaveTextContent('{"storeName":"SYNTHETIC 合成店铺","country":"US"}');
    expect(screen.queryByRole("button", { name: /读取已有.*看板/ })).not.toBeInTheDocument();
  });
});
