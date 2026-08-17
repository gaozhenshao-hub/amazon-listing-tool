// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Step2AplusSubmoduleEditor } from "./ImageOutlineStep";

afterEach(cleanup);

describe("Step2AplusSubmoduleEditor", () => {
  const editableSubmodule = {
    title: "车库",
    purpose: "展示车库场景",
    contentBrief: "车库内容",
    expressionType: "场景展示",
    whyThisWay: "验证场景价值",
  };

  it("允许编辑未锁定子图", () => {
    const onChange = vi.fn();
    render(<Step2AplusSubmoduleEditor submodule={editableSubmodule} onChange={onChange} />);

    const title = screen.getByPlaceholderText("子图标题");
    expect((title as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(title, { target: { value: "更新后的车库" } });
    expect(onChange).toHaveBeenCalledWith("title", "更新后的车库");
  });

  it("禁用已锁定子图的全部内容编辑控件", () => {
    render(<Step2AplusSubmoduleEditor submodule={{ ...editableSubmodule, isLocked: true }} onChange={vi.fn()} />);

    expect((screen.getByPlaceholderText("子图标题") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByPlaceholderText("子图目的") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByPlaceholderText("子图独立大纲") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByPlaceholderText("表达方式") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByPlaceholderText("安排理由") as HTMLInputElement).disabled).toBe(true);
  });
});
