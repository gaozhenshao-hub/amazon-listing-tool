// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KbAsinSetGrid } from "./KbAsinSetGrid";

afterEach(cleanup);

const statusMap = {
  completed: { label: "已完成", variant: "default" as const },
};

const sets = [
  {
    id: 17,
    asin: "B0TEST001",
    productTitle: "测试产品",
    brand: "Example",
    status: "completed",
    overallScore: 88,
    setCategory: "工业品",
    setStyle: "工业极简",
    setPrimaryColor: "黑色",
    setAccentColor: "金色",
    thumbnailImages: [{ id: 1, imageUrl: "/test.jpg" }],
  },
];

describe("KbAsinSetGrid", () => {
  it("renders existing ASIN set tags in fixed-width square cards", () => {
    const onOpen = vi.fn();
    const { container } = render(
      <KbAsinSetGrid
        sets={sets}
        groupBy="category"
        statusMap={statusMap}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByRole("button", { name: /工业品\s*1/ })).toBeInTheDocument();
    expect(screen.getByLabelText("ASIN 集标签")).toHaveTextContent("类目工业品风格工业极简主色黑色提亮金色");
    expect(container.querySelector("[style*='312px']")).toHaveStyle({ gridTemplateColumns: "repeat(auto-fill, 312px)" });
    expect(container.querySelector(".aspect-square")).toBeInTheDocument();

    fireEvent.click(screen.getByText("测试产品"));
    expect(onOpen).toHaveBeenCalledWith(17);
  });

  it("collapses and restores a group without losing its ASIN records", () => {
    render(
      <KbAsinSetGrid
        sets={sets}
        groupBy="category"
        statusMap={statusMap}
        onOpen={vi.fn()}
      />,
    );

    const groupButton = screen.getByRole("button", { name: /工业品\s*1/ });
    fireEvent.click(groupButton);
    expect(screen.queryByText("测试产品")).not.toBeInTheDocument();

    fireEvent.click(groupButton);
    expect(screen.getByText("测试产品")).toBeInTheDocument();
  });
});
