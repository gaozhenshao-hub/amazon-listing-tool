import { expect, it } from "vitest";
import { questionAnswerIssues } from "./questionAnswerGrounding";
it("rejects a competitor's sizing margin and invented preshrinking or lifetime", () => {
  expect(
    questionAnswerIssues(
      "经过预缩处理，可使用数年；胸围应加8-10英寸。",
      "本品有六组尺码、详细选码说明，面料厚实。"
    )
  ).toEqual(
    expect.arrayContaining([
      expect.stringContaining("8-10英寸"),
      expect.stringContaining("预缩"),
      expect.stringContaining("数年"),
    ])
  );
});
it("accepts confirmed measurements and grounded positive guidance", () => {
  expect(
    questionAnswerIssues(
      "可按8–10英寸活动余量选择，配合六组尺码表测量。",
      "运营确认胸围预留8-10英寸活动余量，本品六组尺码。"
    )
  ).toEqual([]);
  expect(
    questionAnswerIssues(
      "提供六组尺码和详细选码说明，可对照测量结果选择合适尺码。",
      "提供六组尺码及详细说明。"
    )
  ).toEqual([]);
});
it("does not turn an unlisted bag into a definite absence claim", () => {
  expect(
    questionAnswerIssues("本品未附带收纳袋。", "配备两款面罩与手套。")
  ).toHaveLength(1);
  expect(
    questionAnswerIssues(
      "已确认包含两款面罩和手套；收纳时可用透气布袋分开存放。",
      "配备两款面罩与手套。"
    )
  ).toEqual([]);
});
