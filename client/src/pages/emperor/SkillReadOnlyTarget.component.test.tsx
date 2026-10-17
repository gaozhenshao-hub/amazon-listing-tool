// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SkillReadOnlyTarget, { skillReadOnlyRoute } from "./SkillReadOnlyTarget";

const controls = vi.hoisted(() => {
  const query = vi.fn();
  return {
    auth: { loading: false, error: null as Error | null, user: { id: 7, defaultWorkspaceId: 11 as number | null | undefined, role: "admin" } as { id: number; defaultWorkspaceId: number | null | undefined; role: string } | null },
    permissions: { isLoading: false, canRead: vi.fn() }, query,
    client: { emperor: { skills: { getReadonly: { query } } } },
  };
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => controls.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => controls.permissions }));
// No shared useQuery, mutations, legacy get or model clients exist in this fixture.
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: controls.client }) } }));

function detail(slug = "listing.copy") {
  return { identity: { userId: controls.auth.user!.id, workspaceId: controls.auth.user!.defaultWorkspaceId },
    skill: { slug, name: "当前精确技能", description: "原始描述", category: "Listing", status: "Released", scope: "private", version: "v3",
      sourceWorkspaceId: controls.auth.user!.defaultWorkspaceId, systemPrompt: "私人系统提示词", userPromptTemplate: "原始模板 {{context}}" },
    provenance: { kind: "current_registry", pinnedVersion: false } };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settled = () => waitFor(() => expect(screen.getByRole("button", { name: "重新读取详情" })).toHaveAttribute("aria-busy", "false"));
beforeEach(() => {
  controls.auth = { loading: false, error: null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } };
  controls.permissions.isLoading = false;
  controls.permissions.canRead.mockReset().mockReturnValue(true);
  controls.query.mockReset().mockResolvedValue(detail());
});
afterEach(cleanup);

describe("exact Skill query target", () => {
  it.each(["", "?q=listing.copy", "other=1"])("leaves the original management route for %s", search => {
    expect(skillReadOnlyRoute(search)).toEqual({ kind: "management" });
  });
  it.each(["skill", "skill=", "skill=a&skill=b", "skill=a&skill=a", "skill=%20listing.copy", "skill=listing.copy%20", "skill=../private", "skill=%3Cscript%3E", "skill=a%00b", "skill=a%2Fb", "skill=" + "a".repeat(129)])("does not fall back on malformed or ambiguous target %s", search => {
    expect(skillReadOnlyRoute(search)).toEqual({ kind: "invalid" });
  });
  it("preserves exact case and decoded slug without trimming or fuzzy selection", () => {
    expect(skillReadOnlyRoute("?skill=Listing%2Ecopy_v3-x&other=1")).toEqual({ kind: "detail", slug: "Listing.copy_v3-x" });
  });
  it.each([null, "", "not/a/slug", " leading"])("does not query for invalid direct target %s", slug => {
    render(<SkillReadOnlyTarget slug={slug} />);
    expect(screen.getByRole("alert")).toHaveTextContent("链接目标为空、重复或格式无效");
    expect(controls.query).not.toHaveBeenCalled();
  });
});

describe("authenticated read-only Skill detail", () => {
  it.each([
    ["auth pending", () => { controls.auth.loading = true; }], ["auth error", () => { controls.auth.error = new Error("secret-auth-error"); }],
    ["no user", () => { controls.auth.user = null; }], ["bad user", () => { controls.auth.user!.id = 0; }],
    ["missing workspace", () => { controls.auth.user!.defaultWorkspaceId = undefined; }],
    ["bad workspace", () => { controls.auth.user!.defaultWorkspaceId = -1; }],
    ["unsafe workspace", () => { controls.auth.user!.defaultWorkspaceId = Number.MAX_SAFE_INTEGER + 1; }],
    ["out-of-range workspace", () => { controls.auth.user!.defaultWorkspaceId = 2_147_483_648; }],
    ["missing role", () => { controls.auth.user!.role = ""; }],
    ["permissions pending", () => { controls.permissions.isLoading = true; }],
    ["read denied", () => { controls.permissions.canRead.mockReturnValue(false); }],
  ] as const)("does not read when %s", (_name, arrange) => {
    arrange(); render(<SkillReadOnlyTarget slug="listing.copy" />);
    expect(controls.query).not.toHaveBeenCalled();
    expect(screen.queryByText("secret-auth-error")).not.toBeInTheDocument();
  });

  it("fresh-reads only the exact new endpoint and displays complete literal text with no action controls", async () => {
    const value = detail();
    value.skill.systemPrompt = "<script>alert(1)</script>\n" + "完整原文".repeat(2200) + "原文结尾";
    value.skill.userPromptTemplate = "<img src=x onerror=alert(1)> {{context}}\n模板结尾";
    controls.query.mockResolvedValue(value);
    const view = render(<SkillReadOnlyTarget slug="listing.copy" />); await settled();
    expect(controls.query).toHaveBeenCalledTimes(1);
    expect(controls.query).toHaveBeenCalledWith({ slug: "listing.copy", expectedWorkspaceId: 11 }, { signal: expect.any(AbortSignal) });
    expect(controls.permissions.canRead).toHaveBeenCalledWith("emperor", "emperor_skills");
    expect(screen.getByRole("region", { name: "系统提示词（完整纯文本）" }).querySelector("pre")?.textContent).toBe(value.skill.systemPrompt);
    expect(screen.getByRole("region", { name: "用户提示词模板（完整纯文本）" }).querySelector("pre")?.textContent).toBe(value.skill.userPromptTemplate);
    expect(view.container.querySelector("script,img,input,textarea,select")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /运行|保存|编辑|批准|删除/ })).not.toBeInTheDocument();
    expect(screen.getByText(/来源：current_registry/)).toHaveTextContent("目录归类不等于绑定或授权");
    expect(screen.getByRole("link", { name: "返回原 Skill 库管理入口" })).toHaveAttribute("href", "/emperor/skills");
    expect(view.container.querySelector("main")).toHaveClass("manus-no-record");
  });
  it("accepts legacy NULL identity only with a global source and distinguishes null vs empty prompts", async () => {
    controls.auth.user!.defaultWorkspaceId = null;
    const value = detail(); value.skill.scope = "global"; value.skill.systemPrompt = null as unknown as string; value.skill.userPromptTemplate = "";
    controls.query.mockResolvedValue(value);
    render(<SkillReadOnlyTarget slug="listing.copy" />); await settled();
    expect(controls.query).toHaveBeenCalledWith({ slug: "listing.copy", expectedWorkspaceId: null }, { signal: expect.any(AbortSignal) });
    expect(screen.getByText("全局注册表（NULL）")).toBeVisible();
    expect(screen.getByText("注册表未提供此字段。")).toBeVisible();
    expect(screen.getByText("此字段为空文本，与未提供字段不同。")).toBeVisible();
  });

  it.each([
    ["user", (value: ReturnType<typeof detail>) => { value.identity.userId = 99; }],
    ["workspace", (value: ReturnType<typeof detail>) => { value.identity.workspaceId = 99; }],
    ["slug", (value: ReturnType<typeof detail>) => { value.skill.slug = "listing.nearby"; }],
    ["source workspace", (value: ReturnType<typeof detail>) => { value.skill.sourceWorkspaceId = 99; }],
    ["private global source", (value: ReturnType<typeof detail>) => { value.skill.sourceWorkspaceId = null; }],
    ["status", (value: ReturnType<typeof detail>) => { value.skill.status = "Draft"; }],
    ["pinned claim", (value: ReturnType<typeof detail>) => { value.provenance.pinnedVersion = true; }],
    ["extra raw field", (value: ReturnType<typeof detail>) => { Object.assign(value.skill, { manifest: { secret: "private raw" } }); }],
  ] as const)("rejects mismatched or invalid %s instead of displaying or falling back", async (_name, change) => {
    const value = detail(); change(value); controls.query.mockResolvedValue(value);
    render(<SkillReadOnlyTarget slug="listing.copy" />); await settled();
    expect(screen.getByRole("alert")).toHaveTextContent("详情读取失败或返回的身份");
    expect(screen.queryByText("私人系统提示词")).not.toBeInTheDocument();
    expect(controls.query).toHaveBeenCalledTimes(1);
  });
  it.each(["NOT_FOUND", "FORBIDDEN", "UNAUTHORIZED", "PRECONDITION_FAILED", "INTERNAL_SERVER_ERROR"])("clears old detail on refresh failure %s without cache fallback", async code => {
    render(<SkillReadOnlyTarget slug="listing.copy" />); await settled();
    expect(screen.getByText("私人系统提示词")).toBeVisible();
    controls.query.mockRejectedValue({ data: { code }, message: "private server diagnostic" });
    fireEvent.click(screen.getByRole("button", { name: "重新读取详情" }));
    expect(screen.queryByText("私人系统提示词")).not.toBeInTheDocument();
    await settled();
    expect(screen.getByRole("alert")).toHaveTextContent(code === "NOT_FOUND" ? "未找到此精确 Skill" : ["FORBIDDEN", "UNAUTHORIZED"].includes(code) ? "已不允许查看" : "详情读取失败");
    expect(screen.queryByText("private server diagnostic")).not.toBeInTheDocument();
    expect(controls.query).toHaveBeenCalledTimes(2);
  });
  it("also clears detail when the read client throws before returning a promise", async () => {
    render(<SkillReadOnlyTarget slug="listing.copy" />); await settled();
    controls.query.mockImplementation(() => { throw new Error("private synchronous detail"); });
    fireEvent.click(screen.getByRole("button", { name: "重新读取详情" })); await settled();
    expect(screen.getByRole("alert")).toHaveTextContent("详情读取失败");
    expect(screen.queryByText("私人系统提示词")).not.toBeInTheDocument();
    expect(screen.queryByText("private synchronous detail")).not.toBeInTheDocument();
  });
});

describe("owned detail lifetime", () => {
  it.each(["user", "workspace", "role", "slug"])("immediately removes old content and aborts old %s owner", async field => {
    const view = render(<SkillReadOnlyTarget slug="listing.copy" />); await settled();
    const oldSignal = controls.query.mock.calls[0][1].signal, next = deferred<ReturnType<typeof detail>>();
    controls.query.mockReturnValueOnce(next.promise);
    if (field === "user") controls.auth.user!.id = 8;
    if (field === "workspace") controls.auth.user!.defaultWorkspaceId = 12;
    if (field === "role") controls.auth.user!.role = "readonly";
    const slug = field === "slug" ? "listing.other" : "listing.copy";
    view.rerender(<SkillReadOnlyTarget slug={slug} />);
    expect(screen.queryByText("私人系统提示词")).not.toBeInTheDocument();
    expect(oldSignal.aborted).toBe(true);
    const value = detail(slug); value.skill.systemPrompt = "新范围内容";
    await act(async () => next.resolve(value)); await settled();
    expect(screen.getByText("新范围内容")).toBeVisible();
  });
  it("ignores late old responses even when transport disregards cancellation", async () => {
    const old = deferred<ReturnType<typeof detail>>(), oldValue = detail(); controls.query.mockReturnValueOnce(old.promise);
    const view = render(<SkillReadOnlyTarget slug="listing.copy" />);
    controls.auth.user = { id: 8, defaultWorkspaceId: 12, role: "readonly" };
    const value = detail("listing.other"); value.skill.systemPrompt = "当前范围内容"; controls.query.mockResolvedValue(value);
    view.rerender(<SkillReadOnlyTarget slug="listing.other" />); await settled();
    await act(async () => old.resolve(oldValue));
    expect(screen.getByText("当前范围内容")).toBeVisible();
    expect(screen.queryByText("私人系统提示词")).not.toBeInTheDocument();
    expect(controls.query.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it.each(["auth pending", "auth error", "logout", "permission pending", "permission revoked"])("unmounts private content immediately on %s", async change => {
    const view = render(<SkillReadOnlyTarget slug="listing.copy" />); await settled();
    if (change === "auth pending") controls.auth.loading = true;
    if (change === "auth error") controls.auth.error = new Error("secret");
    if (change === "logout") controls.auth.user = null;
    if (change === "permission pending") controls.permissions.isLoading = true;
    if (change === "permission revoked") controls.permissions.canRead.mockReturnValue(false);
    view.rerender(<SkillReadOnlyTarget slug="listing.copy" />);
    expect(screen.queryByText("私人系统提示词")).not.toBeInTheDocument();
    expect(controls.query.mock.calls[0][1].signal.aborted).toBe(true);
    expect(controls.query).toHaveBeenCalledTimes(1);
  });
  it("latest refresh wins and discards both older resolution and rejection", async () => {
    const first = deferred<ReturnType<typeof detail>>(), second = deferred<ReturnType<typeof detail>>();
    const latest = detail(); latest.skill.systemPrompt = "最后刷新内容";
    controls.query.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValueOnce(latest);
    render(<SkillReadOnlyTarget slug="listing.copy" />);
    fireEvent.click(screen.getByRole("button", { name: "重新读取详情" }));
    fireEvent.click(screen.getByRole("button", { name: "重新读取详情" })); await settled();
    await act(async () => { first.resolve(detail()); second.reject({ data: { code: "FORBIDDEN" } }); });
    expect(screen.getByText("最后刷新内容")).toBeVisible(); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(controls.query.mock.calls[0][1].signal.aborted).toBe(true); expect(controls.query.mock.calls[1][1].signal.aborted).toBe(true);
  });
  it("aborts unmounted reads without presenting later data or errors", async () => {
    const pending = deferred<ReturnType<typeof detail>>(); controls.query.mockReturnValueOnce(pending.promise);
    const view = render(<SkillReadOnlyTarget slug="listing.copy" />); view.unmount();
    expect(controls.query.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => pending.reject(new Error("late")));
    expect(screen.queryByRole("main")).not.toBeInTheDocument();
  });
});
