// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentLibraryKey } from "@shared/agentLibraryContracts";
import AgentLibraryPanel from "./AgentLibraryPanel";

afterEach(cleanup);

function ReadOnlyLibrary() {
  const [selected, onSelect] = useState<AgentLibraryKey>("listing");
  return <AgentLibraryPanel selected={selected} onSelect={onSelect}
    workflows={{ status: "ready", rows: [{ id: 1, slug: "listing.saved", name: "保存的 Listing 编排", status: "active", triggerType: "manual", dagDefinition: { nodes: [], edges: [] } }] }}
    skills={{ status: "ready", rows: [{ slug: "listing.copy", name: "Listing 文案 Skill" }, { slug: "image.plan", name: "图片策划 Skill" }] }}
    models={{ status: "ready", rows: [] }} />;
}

describe("Agent library role navigation", () => {
  it("switches between seven roles without starting a task or changing resource data", () => {
    render(<ReadOnlyLibrary />);
    expect(screen.getAllByRole("button")).toHaveLength(7);
    expect(screen.getByRole("button", { name: /爱分析的小L/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Listing 文案 Skill")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /图片策划助手/ }));
    expect(screen.getByRole("button", { name: /图片策划助手/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("图片策划 Skill")).toBeVisible();
    expect(screen.queryByText("Listing 文案 Skill")).not.toBeInTheDocument();
    expect(screen.getByText(/没有归入此角色的编排记录/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /爱分析的小L/ }));
    expect(screen.getByText("保存的 Listing 编排")).toBeVisible();
  });

  it("keeps original management navigation while exposing no save, run or chat control", () => {
    render(<ReadOnlyLibrary />);
    expect(screen.getByRole("link", { name: "打开原编排画布" })).toHaveAttribute("href", "/emperor/agents/listing.saved/canvas");
    expect(screen.getByRole("link", { name: "打开原 Skill 库" })).toHaveAttribute("href", "/emperor/skills");
    expect(screen.queryByRole("button", { name: /运行|保存|聊天|执行/ })).not.toBeInTheDocument();
    expect(screen.getByText("未知，未设置默认值")).toBeVisible();
    expect(screen.getByText("未知，不显示为已启用")).toBeVisible();
  });

  it("replaces the old configuration placeholder with its slot and keeps saved DAGs and resource directories", () => {
    render(<AgentLibraryPanel selected="listing" onSelect={() => {}}
      configurationSlot={<section aria-label="真实配置插槽"><h3>助手真实配置版本 7</h3><button type="button">保存专属配置</button></section>}
      workflows={{ status: "ready", rows: [
        { id: 1, slug: "listing.saved", name: "保存的 Listing 编排", status: "active", triggerType: "manual", dagDefinition: {
          nodes: [{ id: "collect", label: "收集来源" }, { id: "write", label: "保存的文案节点", skillSlug: "listing.copy", skillVersionRef: "v2", modelSlug: "registry-model", humanGate: true }],
          edges: [{ source: "collect", target: "write" }],
        } },
        { id: 2, slug: "listing.amazon.competitor-analysis", name: "已有业务竞品分析", status: "active", triggerType: "manual", dagDefinition: { nodes: [], edges: [] } },
      ] }}
      skills={{ status: "ready", rows: [{ slug: "listing.copy", name: "Listing 文案 Skill" }] }}
      models={{ status: "ready", rows: [{ slug: "registry-model", name: "注册表模型", provider: "provider", modelId: "model-id", isDefault: true }] }} />);
    expect(screen.getByRole("region", { name: "真实配置插槽" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "助手真实配置版本 7" })).toBeVisible();
    expect(screen.getByRole("button", { name: "保存专属配置" })).toBeVisible();
    expect(screen.queryByText("未知，未设置默认值")).not.toBeInTheDocument();
    expect(screen.queryByText(/当前后端没有 Agent 库专属配置读取接口/)).not.toBeInTheDocument();
    expect(screen.queryByText("仅角色目录 · 专属配置待读取")).not.toBeInTheDocument();
    expect(screen.getAllByText("查看真实配置状态")).toHaveLength(7);
    expect(screen.getByText(/本页提供助手专属配置与版本入口/)).toHaveTextContent("尚未提供聊天、Skill 执行或自动任务");
    expect(screen.getByText("前置节点：collect")).toBeVisible();
    expect(screen.getByText(/版本引用：v2/)).toHaveTextContent("Skill：listing.copy · 版本引用：v2");
    expect(screen.getByText("节点显式模型：registry-model（不是助手级绑定）")).toBeVisible();
    expect(screen.getByText("配置了人工确认")).toBeVisible();
    expect(screen.getByRole("link", { name: "打开原编排画布" })).toHaveAttribute("href", "/emperor/agents/listing.saved/canvas");
    expect(screen.getByRole("link", { name: "已有业务竞品分析" })).toHaveAttribute("href", "/emperor/agents/listing.amazon.competitor-analysis/canvas");
    expect(screen.getByText("Listing 文案 Skill")).toBeVisible();
    expect(screen.getByRole("link", { name: "打开原 Skill 库" })).toHaveAttribute("href", "/emperor/skills");
    expect(screen.getByText("注册表模型")).toBeVisible();
    expect(screen.getByText("注册表默认标记（非助手绑定）")).toBeVisible();
  });

  it("shows validated DAG order and metadata without promising optional edges bypass runtime", () => {
    render(<AgentLibraryPanel selected="listing" onSelect={() => {}}
      workflows={{ status: "ready", rows: [{ id: 1, slug: "listing.flow", name: "真实依赖", status: "draft", triggerType: "manual",
        dagDefinition: { nodes: [{ id: "end", label: "输出", nodeType: "skill_node", skillSlug: "listing.exact /?+", required: true, scheduler: "manual", humanGate: true },
          { id: "start", label: "模型节点", nodeType: "llm_node", required: false, scheduler: "auto", humanGate: false }],
        edges: [{ source: "start", target: "end", kind: "optional", required: false }] },
        validation: { valid: true, errors: [], warnings: [{ code: "note", message: "真实校验警告" }], topologicalNodeIds: ["start", "end"] },
      }] }} skills={{ status: "ready", rows: [] }} models={{ status: "ready", rows: [] }} />);
    const nodes = within(screen.getByRole("list", { name: "真实依赖 节点" })).getAllByRole("listitem");
    expect(nodes[0]).toHaveTextContent("模型节点");
    expect(nodes[0]).toHaveTextContent("节点类型：llm_node");
    expect(nodes[0]).toHaveTextContent("required）：否");
    expect(nodes[0]).toHaveTextContent("scheduler）：auto");
    expect(nodes[0]).toHaveTextContent("humanGate）：否");
    expect(nodes[0]).toHaveTextContent("不能据此判断是否调用模型或工具");
    expect(nodes[1]).toHaveTextContent("输出");
    expect(screen.getByRole("list", { name: "end 入边配置" })).toHaveTextContent("start → end · 边类型（kind）：optional · 必需边（required）：否");
    expect(screen.getByRole("list", { name: "编排校验警告" })).toHaveTextContent("真实校验警告");
    expect(screen.getByText(/当前执行器对全部入边/)).toHaveTextContent("也不能据此认为可跳过上游门禁");
    expect(screen.getByText(/按服务端校验的完整拓扑顺序/)).toHaveTextContent("同层节点可并列");
    expect(screen.getByRole("link", { name: "listing.exact /?+" })).toHaveAttribute("href", "/emperor/skills?skill=listing.exact%20%2F%3F%2B");
    expect(screen.queryByText(/无需.*模型/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /运行|保存|执行|启动/ })).not.toBeInTheDocument();
  });

  it("shows static source order and errors when server validation fails", () => {
    render(<AgentLibraryPanel selected="listing" onSelect={() => {}}
      workflows={{ status: "ready", rows: [{ id: 1, slug: "listing.flow", name: "错误流程", status: "draft", triggerType: "manual",
        dagDefinition: { nodes: [{ id: "b", label: "原第一项" }, { id: "a", label: "原第二项" }], edges: [] },
        validation: { valid: false, errors: [{ code: "invalid", message: "节点类型不支持" }], warnings: [], topologicalNodeIds: ["a", "b"] },
      }] }} skills={{ status: "ready", rows: [] }} models={{ status: "ready", rows: [] }} />);
    const nodes = within(screen.getByRole("list", { name: "错误流程 节点" })).getAllByRole("listitem");
    expect(nodes[0]).toHaveTextContent("原第一项");
    expect(screen.getByText(/服务端校验未通过或信息不完整/)).toBeVisible();
    expect(screen.getByRole("list", { name: "编排校验错误" })).toHaveTextContent("节点类型不支持");
  });
});
