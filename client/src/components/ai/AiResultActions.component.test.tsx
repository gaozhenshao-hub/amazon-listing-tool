// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  AiResultActions,
  type AiResultImprovementContext,
} from "./AiResultActions";
afterEach(cleanup);
it("sends complete evidence to improvement without changing the original result", async () => {
  const context: AiResultImprovementContext = {
    businessModule: "listing",
    sourceResultId: "result",
    productAsin: "B000000001",
    input: "原资料",
    originalResult: "原输出",
    editedResult: "人工修订",
    feedback: "补证据",
    targetType: "skill",
    targetKey: "review",
    scope: "current_result",
  };
  const adjust = vi.fn(),
    improve = vi.fn();
  render(
    <AiResultActions context={context} onAdjust={adjust} onImprove={improve} />
  );
  fireEvent.click(screen.getByRole("button", { name: "用于改进" }));
  await waitFor(() => expect(improve).toHaveBeenCalledWith(context));
  expect(adjust).not.toHaveBeenCalled();
  expect(context.originalResult).toBe("原输出");
});
