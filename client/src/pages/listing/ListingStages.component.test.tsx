// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { mergedListingWorkflowEnabled } from "@/lib/mergedListingWorkflow";

const state = vi.hoisted(() => ({ projectId: 17 as number | null, location: "/listing/comparison?projectId=99", select: vi.fn() }));
vi.mock("@/contexts/ProjectContext", () => ({ useProject: () => ({ selectedProjectId: state.projectId, setSelectedProjectId: state.select }) }));
vi.mock("wouter", () => ({
  useLocation: () => [state.location, vi.fn()],
  Link: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
}));
import ListingStages from "./ListingStages";

afterEach(() => { cleanup(); state.projectId = 17; state.location = "/listing/comparison?projectId=99"; vi.clearAllMocks(); });

describe("Listing workflow entry boundaries", () => {
  it("keeps the authenticated project context, not the URL project, on all three links", () => {
    render(<ListingStages />);
    const links = screen.getAllByRole("link");
    expect(links.map(link => link.getAttribute("href"))).toEqual([
      "/listing/analysis?projectId=17", "/listing/comparison?projectId=17", "/listing/generate?projectId=17",
    ]);
    expect(links.map(link => link.getAttribute("aria-current"))).toEqual([null, "step", null]);
    expect(state.select).not.toHaveBeenCalled();
  });

  it.each([null, 0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("does not invent a project from invalid context %s", projectId => {
    state.projectId = projectId;
    state.location = "/listing/generate#facts";
    render(<ListingStages />);
    expect(screen.getAllByRole("link").map(link => link.getAttribute("href"))).toEqual([
      "/listing/analysis", "/listing/comparison", "/listing/generate",
    ]);
    expect(screen.getByRole("link", { name: "3. 智能 Listing 生成" }).getAttribute("aria-current")).toBe("step");
    expect(state.select).not.toHaveBeenCalled();
  });

  it("requires an explicit 1 to enable the new workflow", () => {
    expect(mergedListingWorkflowEnabled("1")).toBe(true);
    for (const value of [undefined, null, "", "0", "true", true, 1]) expect(mergedListingWorkflowEnabled(value)).toBe(false);
  });
});
