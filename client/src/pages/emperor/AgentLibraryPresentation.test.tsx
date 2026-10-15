import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AGENT_LIBRARY_KEYS, AGENT_LIBRARY_ROLES } from "@shared/agentLibraryContracts";
import AgentLibraryPanel from "./AgentLibraryPanel";
import {
  firstVisibleBySlug, libraryDirectory, libraryReadState, libraryRoleForSkill,
  libraryRoleForWorkflow, libraryWorkflowNodes, workflowCanvasHref,
  type LibraryReadState, type LibraryWorkflow,
} from "./AgentLibraryPresentation";

const ready = <T,>(rows: T[]): LibraryReadState<T> => ({ status: "ready", rows });
const workflow: LibraryWorkflow = {
  id: 1, slug: "listing.custom", name: "真实保存的流程", status: "draft", triggerType: "manual",
  dagDefinition: { nodes: [{ id: "a", label: "审核", humanGate: true, skillSlug: "listing.copy", modelSlug: "registered-model" }], edges: [] },
};

describe("Agent library read-only presentation", () => {
  it("reuses exactly the seven existing roles without inventing saved config", () => {
    expect(new Set(AGENT_LIBRARY_ROLES.map(role => role.key))).toEqual(new Set(AGENT_LIBRARY_KEYS));
    for (const key of AGENT_LIBRARY_KEYS) expect(libraryDirectory(key).key).toBe(key);
  });

  it.each([
    ["finance.monthly.profit", "finance"], ["knowledge.images.tag", "tagger"],
    ["knowledge.images.tag.coach", "tagger"], ["image.plan", "images"], ["video.script", "video"],
    ["product.development.research", "development"], ["dev.research", "development"],
    ["listing.copy", "listing"], ["analysis.competitor", "listing"], ["keyword.research", "listing"],
    ["ad.structure.generate", "listing"], ["knowledge.qa", "knowledge"], ["kb.chat", "knowledge"],
    ["system.knowledge.chat", "knowledge"], ["arbitrary.private", null], ["agent.library.chat", null],
  ])("categorizes Skill %s only for display", (slug, key) => expect(libraryRoleForSkill(slug!)).toBe(key));

  it("does not turn the business acquisition workflow into another assistant binding", () => {
    expect(libraryRoleForWorkflow("listing.amazon.competitor-analysis")).toBeNull();
    expect(libraryRoleForWorkflow("listing.custom")).toBe("listing");
    expect(libraryRoleForWorkflow("image.plan")).toBe("images");
    expect(libraryRoleForWorkflow("product-development.market")).toBe("development");
    expect(libraryRoleForWorkflow("unknown")).toBeNull();
  });

  it("preserves workspace-first metadata without merging global defaults", () => {
    const rows = [{ slug: "model", name: "workspace" }, { slug: "model", name: "global" }, { slug: "other", name: "other" }];
    expect(firstVisibleBySlug(rows)).toEqual([rows[0], rows[2]]);
    expect(rows).toHaveLength(3);
  });

  it("separates loading, failure (even with cached data), and genuine empty state", () => {
    expect(libraryReadState({ isPending: true, error: null })).toEqual({ status: "loading" });
    expect(libraryReadState({ isPending: false, error: null, data: [] })).toEqual(ready([]));
    expect(libraryReadState({ isPending: false, error: { message: "Forbidden" }, data: [workflow] })).toEqual({ status: "error", message: "Forbidden" });
  });

  it("reads only explicit node configuration, never inventing model/version/rules", () => {
    const nodes = libraryWorkflowNodes({ nodes: [{ id: "a" }, { id: "b", label: "输出", skillSlug: "listing.copy", skillVersionRef: "released:v2" }], edges: [{ from: "a", to: "b" }] });
    expect(nodes[0]).toEqual({ id: "a", label: "a", skillSlug: null, modelSlug: null, skillVersionRef: null, humanGate: false, parentIds: [] });
    expect(nodes[1].parentIds).toEqual(["a"]);
    expect(nodes[1].skillVersionRef).toBe("released:v2");
    expect(libraryWorkflowNodes(null)).toEqual([]);
    expect(libraryWorkflowNodes({ nodes: [null, { label: "no id" }], edges: [] })).toEqual([]);
  });

  it("keeps workflow navigation within the existing encoded canvas route", () => {
    expect(workflowCanvasHref("a/b?x#y")).toBe("/emperor/agents/a%2Fb%3Fx%23y/canvas");
  });

  it("renders authentic records, distinct catalog/config labels, and no execution controls", () => {
    const html = renderToStaticMarkup(<AgentLibraryPanel selected="listing" onSelect={() => { throw new Error("render must not act"); }}
      workflows={ready([workflow, { ...workflow, id: 2, slug: "unknown", name: "未归类流程" }])}
      skills={ready([{ slug: "listing.copy", name: "真实 Skill" }])}
      models={ready([{ slug: "registered-model", name: "真实模型", provider: "provider", modelId: "model", isDefault: true }])} />);
    expect(html).toContain("真实保存的流程");
    expect(html).toContain("真实 Skill");
    expect(html).toContain("真实模型");
    expect(html).toContain("未归类流程");
    expect(html).toContain("尚未接入读取");
    expect(html).toContain("节点显式模型");
    expect(html).toContain("注册表默认标记（非助手绑定）");
    expect(html).not.toContain("revision");
    expect(html).not.toMatch(/<button[^>]*>[^<]*(运行|保存|聊天|执行)/);
  });

  it("does not conceal permission errors as empty or leak stale resource data", () => {
    const html = renderToStaticMarkup(<AgentLibraryPanel selected="listing" onSelect={() => {}}
      workflows={{ status: "error", message: "FORBIDDEN" }} skills={{ status: "loading" }} models={ready([])} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("FORBIDDEN");
    expect(html).not.toContain("没有归入此角色的编排记录");
    expect(html).toContain("正在读取Skill");
    expect(html).toContain("没有可见的启用模型记录");
  });

  it("escapes server text rather than interpreting workflow or Skill descriptions as HTML", () => {
    const html = renderToStaticMarkup(<AgentLibraryPanel selected="listing" onSelect={() => {}}
      workflows={ready([{ ...workflow, name: "<script>alert(1)</script>" }])} skills={ready([])} models={ready([])} />);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
