// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EmperorSkillLibrary from "./EmperorSkillLibrary";

const controls = vi.hoisted(() => ({ search: "", auth: vi.fn(), list: vi.fn(), categories: vi.fn(), models: vi.fn(), get: vi.fn(),
  runHook: vi.fn(), deleteHook: vi.fn(), createHook: vi.fn(), updateHook: vi.fn(), mutate: vi.fn(), utils: vi.fn() }));
vi.mock("wouter", () => ({ useSearch: () => controls.search }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: controls.auth }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: controls.utils, emperor: {
  skills: { list: { useQuery: controls.list }, categories: { useQuery: controls.categories }, get: { useQuery: controls.get },
    delete: { useMutation: controls.deleteHook }, create: { useMutation: controls.createHook }, update: { useMutation: controls.updateHook } },
  models: { list: { useQuery: controls.models } }, run: { run: { useMutation: controls.runHook } },
} } }));
vi.mock("./SkillReadOnlyTarget", async () => {
  const actual = await vi.importActual<typeof import("./SkillReadOnlyTarget")>("./SkillReadOnlyTarget");
  return { ...actual, default: ({ slug }: { slug: string | null }) => <section aria-label="独立只读目标">{slug === null ? "无效精确目标" : slug}</section> };
});
vi.mock("streamdown", () => ({ Streamdown: ({ children }: { children: string }) => <div>{children}</div> }));

beforeEach(() => {
  vi.clearAllMocks(); controls.search = "";
  controls.auth.mockReturnValue({ user: { id: 7, role: "readonly" } });
  controls.utils.mockReturnValue({ emperor: { skills: { list: { invalidate: vi.fn() }, categories: { invalidate: vi.fn() } } } });
  controls.list.mockReturnValue({ data: { skills: [], total: 0 }, isLoading: false });
  controls.categories.mockReturnValue({ data: [] }); controls.models.mockReturnValue({ data: [] }); controls.get.mockReturnValue({ data: undefined });
  for (const hook of [controls.runHook, controls.deleteHook, controls.createHook, controls.updateHook]) hook.mockReturnValue({ mutate: controls.mutate, isPending: false });
});
afterEach(cleanup);

describe("Skill route separation", () => {
  it.each(["skill=listing.copy", "skill=", "skill=a&skill=b", "skill=../private"])("explicit target %s mounts no legacy query, edit or run hooks", search => {
    controls.search = search; render(<EmperorSkillLibrary />);
    expect(screen.getByRole("region", { name: "独立只读目标" })).toBeVisible();
    for (const hook of [controls.auth, controls.utils, controls.list, controls.categories, controls.models, controls.get, controls.runHook, controls.deleteHook, controls.createHook, controls.updateHook]) expect(hook).not.toHaveBeenCalled();
    expect(controls.mutate).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("搜索 Skill 名称或描述...")).not.toBeInTheDocument();
  });
  it("keeps original management browsing only without the skill parameter and does not auto-select/run", () => {
    controls.search = "category=listing";
    const view = render(<EmperorSkillLibrary />);
    expect(screen.getByPlaceholderText("搜索 Skill 名称或描述...")).toBeVisible();
    expect(controls.list).toHaveBeenCalledWith({ category: undefined, search: undefined, page: 1, pageSize: 30 });
    expect(controls.get).toHaveBeenCalledWith({ slug: "" }, { enabled: false });
    expect(controls.runHook).toHaveBeenCalled(); expect(controls.mutate).not.toHaveBeenCalled();
    controls.search = "skill=listing.copy";
    view.rerender(<EmperorSkillLibrary />);
    expect(screen.queryByPlaceholderText("搜索 Skill 名称或描述...")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "独立只读目标" })).toHaveTextContent("listing.copy");
    expect(controls.mutate).not.toHaveBeenCalled();
  });
  it("reacts to an exact slug change and preserves invalid-target isolation", () => {
    controls.search = "skill=listing.first";
    const view = render(<EmperorSkillLibrary />);
    expect(screen.getByRole("region", { name: "独立只读目标" })).toHaveTextContent("listing.first");
    controls.search = "skill=listing.second"; view.rerender(<EmperorSkillLibrary />);
    expect(screen.queryByText("listing.first")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "独立只读目标" })).toHaveTextContent("listing.second");
    controls.search = "skill="; view.rerender(<EmperorSkillLibrary />);
    expect(screen.getByRole("region", { name: "独立只读目标" })).toHaveTextContent("无效精确目标");
    expect(controls.list).not.toHaveBeenCalled(); expect(controls.mutate).not.toHaveBeenCalled();
  });
});
