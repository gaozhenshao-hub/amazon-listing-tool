// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReferenceImagesHeader } from "./ReferenceImagesHeader";

afterEach(cleanup);

const baseProps = {
  hasData: true,
  isConfirmed: false,
  isGenerating: false,
  generationProgress: 0,
  isRegeneratingAll: false,
  isConfirming: false,
  isResetting: false,
  onGenerate: vi.fn(),
  onRegenerateAll: vi.fn(),
  onConfirm: vi.fn(),
  onUnlock: vi.fn(),
};

describe("ReferenceImagesHeader Step3 前置条件", () => {
  it("未确认视觉风格时禁用重新推荐并提供可操作提示", () => {
    render(
      <ReferenceImagesHeader
        {...baseProps}
        canGenerate={false}
        generationBlockedReason="请先在 Step 3 确认视觉风格，再生成或重新推荐参考图"
      />,
    );

    const button = screen.getByRole("button", { name: "重新推荐" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toContain("确认视觉风格");
    fireEvent.click(button);
    expect(baseProps.onGenerate).not.toHaveBeenCalled();
  });

  it("确认视觉风格后允许重新推荐", () => {
    const onGenerate = vi.fn();
    render(<ReferenceImagesHeader {...baseProps} onGenerate={onGenerate} canGenerate />);

    const button = screen.getByRole("button", { name: "重新推荐" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });
});
