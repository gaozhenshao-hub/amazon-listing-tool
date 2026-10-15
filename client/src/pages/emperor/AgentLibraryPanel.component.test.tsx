// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});
