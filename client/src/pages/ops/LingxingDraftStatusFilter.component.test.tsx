/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LingxingDraftStatusFilter } from "./LingxingDraftStatusFilter";
import { filterLingxingDraftRows } from "./lingxingSyncViewModel";

function FilteredTableFixture() {
  const [status, setStatus] = useState("all");
  const rows = [{ id: 1, rowStatus: "new" }, { id: 2, rowStatus: "needs_review" }, { id: 3, rowStatus: "skipped" }];
  return <><LingxingDraftStatusFilter value={status} total={rows.length} onChange={setStatus} /><table><tbody>{filterLingxingDraftRows(rows, status).map((row) => <tr key={row.id}><td>{row.rowStatus}</td></tr>)}</tbody></table></>;
}

describe("领星同步预览状态筛选控件", () => {
  it("切换下拉选项后仅渲染对应状态的草稿行", async () => {
    const user = userEvent.setup({ document });
    render(<FilteredTableFixture />);
    expect(screen.getByText("new")).toBeInTheDocument();
    expect(screen.getByText("needs_review")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("草稿状态筛选"), "needs_review");
    expect(screen.queryByText("new")).not.toBeInTheDocument();
    expect(screen.getByText("needs_review")).toBeInTheDocument();
    expect(screen.queryByText("skipped")).not.toBeInTheDocument();
  });
});
