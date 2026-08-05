// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_TABS_STORAGE_KEY } from "./workspaceTabState";
import { WorkspaceTabs } from "./WorkspaceTabs";

const router = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: "/listing/canvas",
}));

vi.mock("wouter", () => ({
  useLocation: () => [router.location, router.navigate],
}));

describe("WorkspaceTabs component", () => {
  beforeEach(() => {
    router.navigate.mockReset();
    router.location = "/listing/canvas";
    window.history.replaceState({}, "", "/listing/canvas");
    localStorage.setItem(WORKSPACE_TABS_STORAGE_KEY, JSON.stringify([
      { href: "/listing/canvas", label: "工作流画布", lastActiveAt: 1 },
      { href: "/ops/ads", label: "广告优化", lastActiveAt: 2 },
    ]));
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("switches between open pages without removing either tab", () => {
    expect(WorkspaceTabs).toBeTypeOf("function");
    render(<WorkspaceTabs />);

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    fireEvent.click(screen.getByRole("tab", { name: "广告优化" }));
    expect(router.navigate).toHaveBeenCalledWith("/ops/ads");
    expect(screen.getByRole("tab", { name: "工作流画布" })).toBeInTheDocument();
  });

  it("closes a background page while keeping the active page open", () => {
    render(<WorkspaceTabs />);

    fireEvent.click(screen.getByRole("button", { name: "关闭 广告优化" }));
    expect(screen.queryByRole("tab", { name: "广告优化" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "工作流画布" })).toHaveAttribute("aria-selected", "true");
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
