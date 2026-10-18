// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ChecklistPanel from "./ChecklistPanel";
afterEach(cleanup);
it("keeps complete report rationale and evidence escaped without applying suggested text", () => {
  const run = vi.fn(); render(<ChecklistPanel dimensions={[{ key: "first", code: "A1", label: "完整检查", labelEn: "Complete", description: "Description" }]} panelTitle="合成辅助报告" onRunCheck={run} checkListScores={{ first: { pass: false, notes: "原说明", reason: "完整原因", suggestion: "完整建议", evidenceQuote: "<img src=x onerror=alert(1)>", suggestedRevision: "Full proposed revision, not applied" } }} />);
  fireEvent.click(screen.getByRole("button", { name: /Check List/ }));
  for (const text of ["完整原因", "完整建议", "<img src=x onerror=alert(1)>", "Full proposed revision, not applied"]) expect(screen.getByText(text)).toBeInTheDocument();
  expect(document.querySelector("img")).toBeNull(); expect(run).not.toHaveBeenCalled();
});
