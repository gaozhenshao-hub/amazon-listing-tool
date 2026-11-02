// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CharCountBadge, GeneratingProgress } from "./GenerationIndicators";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("GenerationIndicators", () => {
  it("advances through generation progress without replacing the page", () => {
    vi.useFakeTimers();
    render(<GeneratingProgress />);

    expect(screen.getByText("AI正在读取产品属性数据...")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2800));
    expect(screen.getByText("AI正在分析竞品Listing共性与缺口...")).toBeInTheDocument();
  });

  it("shows whether the generated text length is valid", () => {
    const { rerender } = render(<CharCountBadge count={180} min={160} max={200} />);
    expect(screen.getByText(/180 \/ 160-200/)).toHaveTextContent("✓");

    rerender(<CharCountBadge count={120} min={160} max={200} />);
    expect(screen.getByText(/120 \/ 160-200/)).toHaveTextContent("偏短");
  });
});
