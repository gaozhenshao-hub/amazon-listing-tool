// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StepProgressBar } from "./StepProgressBar";

afterEach(cleanup);

describe("StepProgressBar", () => {
  it("keeps later image workflow steps locked until prior confirmation", () => {
    const onStepClick = vi.fn();
    render(<StepProgressBar currentStep={0} session={null} onStepClick={onStepClick} />);

    fireEvent.click(screen.getByRole("button", { name: /图片建议/ }));
    expect(onStepClick).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /图片建议/ })).toBeDisabled();
  });

  it("allows revisiting a confirmed step", () => {
    const onStepClick = vi.fn();
    render(
      <StepProgressBar
        currentStep={2}
        session={{ step0Confirmed: true, step1Confirmed: true }}
        onStepClick={onStepClick}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /卖点梳理/ }));
    expect(onStepClick).toHaveBeenCalledWith(1);
  });
});
