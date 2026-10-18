// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomSellingPointForm } from "./CustomSellingPointForm";

const actions = { expand: vi.fn(), manual: vi.fn(), confirm: vi.fn() };
const result = {
  theme: "SYNTHETIC EN", themeZh: "合成中文", description: "合成描述",
  fabeDirection: { feature: "原特征", advantage: "原优势", benefit: "原利益", evidence: "原证据" },
  targetKeywords: ["synthetic keyword", "second keyword"], addressesGap: "合成竞品缺口",
  evidenceSource: "preserve-unrendered-parent-data",
};
function Harness({ initialMode = false, initialResult = null, pending = false }: {
  initialMode?: boolean; initialResult?: typeof result | null; pending?: boolean;
}) {
  const [visible, setShowAddForm] = useState(true), [aiAssistMode, setAiAssistMode] = useState(initialMode);
  const [aiResult, setAiResult] = useState<any>(initialResult), [aiKeyword, setAiKeyword] = useState("");
  const [newCoreTheme, setNewCoreTheme] = useState(""), [newCoreThemeZh, setNewCoreThemeZh] = useState("");
  const [newCoreDescription, setNewCoreDescription] = useState("");
  return <>
    {visible && <CustomSellingPointForm totalCoresCount={7} aiAssistMode={aiAssistMode} setAiAssistMode={setAiAssistMode}
      aiKeyword={aiKeyword} setAiKeyword={setAiKeyword} aiResult={aiResult} setAiResult={setAiResult}
      newCoreTheme={newCoreTheme} setNewCoreTheme={setNewCoreTheme} newCoreThemeZh={newCoreThemeZh} setNewCoreThemeZh={setNewCoreThemeZh}
      newCoreDescription={newCoreDescription} setNewCoreDescription={setNewCoreDescription} setShowAddForm={setShowAddForm}
      isExpanding={pending} handleAiExpand={() => actions.expand(aiKeyword)} handleConfirmAiResult={() => actions.confirm(aiResult)}
      handleAddManualCore={() => actions.manual({ newCoreTheme, newCoreThemeZh, newCoreDescription })} />}
    <output data-testid="parent-draft">{JSON.stringify({ visible, aiAssistMode, aiKeyword, aiResult, newCoreTheme, newCoreThemeZh, newCoreDescription })}</output>
  </>;
}
const draft = () => JSON.parse(screen.getByTestId("parent-draft").textContent!);
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("controlled custom selling-point form", () => {
  it("keeps the manual draft in the parent, requires an English theme and only adds on explicit click", () => {
    render(<Harness />);
    expect(screen.getByText("添加自定义卖点 (还可添加 2 条)")).toBeTruthy();
    expect((screen.getByRole("button", { name: "添加" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("例如: Eco-Friendly Design"), { target: { value: "  " } });
    expect((screen.getByRole("button", { name: "添加" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("例如: Eco-Friendly Design"), { target: { value: "Manual EN" } });
    fireEvent.change(screen.getByPlaceholderText("例如: 环保设计"), { target: { value: "手动中文" } });
    fireEvent.change(screen.getByPlaceholderText("简要描述这条卖点应该传达什么信息..."), { target: { value: "人工描述" } });
    expect(actions.manual).not.toHaveBeenCalled(); expect(actions.expand).not.toHaveBeenCalled(); expect(actions.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    expect(actions.manual).toHaveBeenCalledWith({ newCoreTheme: "Manual EN", newCoreThemeZh: "手动中文", newCoreDescription: "人工描述" });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(draft()).toMatchObject({ visible: false, newCoreTheme: "Manual EN", newCoreDescription: "人工描述" });
  });
  it("does not expand on mount or blank input; click and Enter retain the existing explicit expand handler", () => {
    render(<Harness initialMode />);
    const input = screen.getByPlaceholderText(/例如: waterproof/);
    expect((screen.getByRole("button", { name: "AI生成FABE" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" }); expect(actions.expand).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "synthetic topic" } }); expect(actions.expand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "AI生成FABE" }));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(actions.expand).toHaveBeenCalledTimes(2); expect(actions.expand).toHaveBeenLastCalledWith("synthetic topic");
  });
  it("shows parent pending state and disables the AI generation button", () => {
    render(<Harness initialMode pending />);
    fireEvent.change(screen.getByPlaceholderText(/例如: waterproof/), { target: { value: "topic" } });
    const button = screen.getByRole("button", { name: "AI生成中..." }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); fireEvent.click(button); expect(actions.expand).not.toHaveBeenCalled();
  });
  it("retains the full editable bilingual description/FABE/keywords/gap and does not automatically confirm", () => {
    render(<Harness initialMode initialResult={result} />);
    expect(screen.getByText("synthetic keyword")).toBeTruthy(); expect(screen.getByText("second keyword")).toBeTruthy();
    expect(screen.getByText("合成竞品缺口")).toBeTruthy();
    const fields = screen.getAllByRole("textbox");
    expect(fields).toHaveLength(7);
    ["edited EN", "编辑中文", "编辑描述", "编辑特征", "编辑优势", "编辑利益", "编辑证据"].forEach((value, index) => {
      fireEvent.change(fields[index], { target: { value } });
    });
    expect(actions.confirm).not.toHaveBeenCalled(); expect(actions.expand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认添加" }));
    expect(actions.confirm).toHaveBeenCalledWith({ ...result, theme: "edited EN", themeZh: "编辑中文", description: "编辑描述",
      fabeDirection: { feature: "编辑特征", advantage: "编辑优势", benefit: "编辑利益", evidence: "编辑证据" } });
  });
  it("switching modes clears AI result but preserves the parent's manual draft", () => {
    render(<Harness initialMode initialResult={result} />);
    fireEvent.click(screen.getByRole("button", { name: "手动填写" }));
    expect(draft()).toMatchObject({ aiAssistMode: false, aiResult: null });
    fireEvent.change(screen.getByPlaceholderText("例如: Eco-Friendly Design"), { target: { value: "retained" } });
    fireEvent.click(screen.getByRole("button", { name: "AI辅助" }));
    expect(draft()).toMatchObject({ aiAssistMode: true, aiResult: null, newCoreTheme: "retained" });
    expect(actions.expand).not.toHaveBeenCalled(); expect(actions.confirm).not.toHaveBeenCalled();
  });
  it("AI reset only clears its preview; close with no result clears keyword and mode without saving", () => {
    render(<Harness initialMode initialResult={result} />);
    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
    expect(draft()).toMatchObject({ visible: true, aiAssistMode: true, aiResult: null });
    fireEvent.change(screen.getByPlaceholderText(/例如: waterproof/), { target: { value: "unsent" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(draft()).toMatchObject({ visible: false, aiAssistMode: false, aiKeyword: "" });
    expect(actions.expand).not.toHaveBeenCalled(); expect(actions.confirm).not.toHaveBeenCalled();
  });
  it("canceling an AI result returns to AI input instead of adding or closing the form", () => {
    render(<Harness initialMode initialResult={result} />);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(draft()).toMatchObject({ visible: true, aiAssistMode: true, aiKeyword: "", aiResult: null });
    expect(actions.expand).not.toHaveBeenCalled(); expect(actions.confirm).not.toHaveBeenCalled(); expect(actions.manual).not.toHaveBeenCalled();
  });
});
