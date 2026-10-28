// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_TABS_STORAGE_KEY, closeCurrentWorkspaceTabAndNavigate } from "./workspaceTabState";
import { act } from "@testing-library/react";
import { WorkspaceTabs } from "./WorkspaceTabs";

const router = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: "/listing/comparison",
}));

vi.mock("wouter", () => ({
  useLocation: () => [router.location, router.navigate],
}));

describe("WorkspaceTabs component", () => {
  beforeEach(() => {
    router.navigate.mockReset();
    router.location = "/listing/comparison";
    window.history.replaceState({}, "", "/listing/comparison");
    localStorage.setItem(WORKSPACE_TABS_STORAGE_KEY, JSON.stringify([
      { href: "/listing/comparison", label: "竞品对比", lastActiveAt: 1 },
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
    expect(screen.getByRole("tab", { name: "竞品对比" })).toBeInTheDocument();
  });

  it("closes a background page while keeping the active page open", () => {
    render(<WorkspaceTabs />);

    fireEvent.click(screen.getByRole("button", { name: "关闭 广告优化" }));
    expect(screen.queryByRole("tab", { name: "广告优化" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "竞品对比" })).toHaveAttribute("aria-selected", "true");
    expect(router.navigate).not.toHaveBeenCalled();
  });
  it("returns to the library while closing only the current internal tab", () => {
    router.location = "/knowledge/images/70";
    window.history.replaceState({}, "", router.location);
    localStorage.setItem(WORKSPACE_TABS_STORAGE_KEY, JSON.stringify([
      {href:"/knowledge/images",label:"智能图片知识库",lastActiveAt:1},
      {href:"/knowledge/images/69",label:"另一套图",lastActiveAt:2},
      {href:router.location,label:"当前套图",lastActiveAt:3},
    ]));
    render(<WorkspaceTabs />);
    act(()=>closeCurrentWorkspaceTabAndNavigate("/knowledge/images"));
    expect(router.navigate).toHaveBeenCalledWith("/knowledge/images");
    expect(screen.getByRole("tab",{name:"另一套图"})).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(WORKSPACE_TABS_STORAGE_KEY)! ).some((t:any)=>t.href===router.location)).toBe(false);
  });
});
