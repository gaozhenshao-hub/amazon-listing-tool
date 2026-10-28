// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnchorHTMLAttributes } from "react";
const state = vi.hoisted(() => ({ path: "/listing/comparison", project: 17 as number | null, loading: false, denied: "" }));
vi.mock("wouter", () => ({ useLocation: () => [state.path, vi.fn()], Link: (p: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...p} /> }));
vi.mock("@/contexts/ProjectContext", () => ({ useProject: () => ({ selectedProjectId: state.project }) }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => ({ isLoading: state.loading, canRead: (_: string, directory: string) => directory !== state.denied }) }));
import ListingWorkspace from "./ListingWorkspace";
afterEach(() => { cleanup(); state.path = "/listing/comparison"; state.project = 17; state.loading = false; state.denied = ""; });
describe("contextual listing navigation", () => {
  it("places buyer and review evidence beside analysis with the selected project", () => {
    render(<ListingWorkspace><p>原文与分析</p></ListingWorkspace>);
    expect(screen.getByRole("link", { name: "评论证据" })).toHaveAttribute("href", "/listing/review-aggregation?projectId=17");
    expect(screen.getByRole("link", { name: "买家问题证据" })).toHaveAttribute("href", "/listing/buyer-questions?projectId=17");
    expect(screen.getByText("原文与分析")).toBeInTheDocument();
  });
  it("hides unauthorized and not-yet-authorized links without unmounting the guarded page", () => {
    state.denied = "listing_review_aggregation";
    const ui = render(<ListingWorkspace><p>内容</p></ListingWorkspace>);
    expect(screen.queryByRole("link", { name: "评论证据" })).not.toBeInTheDocument();
    state.loading = true; ui.rerender(<ListingWorkspace><p>内容</p></ListingWorkspace>);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
  it("keeps result inspection within generation and never invents a project", () => {
    state.path = "/listing/preview"; state.project = null;
    render(<ListingWorkspace><p>预览</p></ListingWorkspace>);
    expect(screen.getByRole("link", { name: "智能 Listing 生成" })).toHaveAttribute("href", "/listing/generate");
    expect(screen.getByRole("link", { name: "生成结果与预览" })).toHaveAttribute("aria-current", "page");
  });
});
