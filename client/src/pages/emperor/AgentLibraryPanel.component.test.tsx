// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentLibraryKey } from "@shared/agentLibraryContracts";
import AgentLibraryPanel from "./AgentLibraryPanel";

afterEach(cleanup);
const resources = {
  workflows: {
    status: "ready" as const,
    rows: [
      {
        id: 1,
        slug: "listing.saved",
        name: "保存的 Listing 编排",
        status: "active",
        triggerType: "manual",
        dagDefinition: { nodes: [], edges: [] },
      },
    ],
  },
  skills: {
    status: "ready" as const,
    rows: [
      { slug: "listing.copy", name: "Listing 文案 Skill" },
      { slug: "image.plan", name: "图片策划 Skill" },
    ],
  },
  models: { status: "ready" as const, rows: [] },
};
function TestLibrary() {
  const [selected, onSelect] = useState<AgentLibraryKey>("listing");
  return (
    <AgentLibraryPanel
      {...resources}
      selected={selected}
      onSelect={onSelect}
      conversationSlot={
        <textarea aria-label="尚未发送的对话" defaultValue="正在调教的内容" />
      }
      configurationSlot={
        <input aria-label="尚未保存的职责" defaultValue="用户的工作要求" />
      }
    />
  );
}
describe("Agent workbench", () => {
  it("opens conversation first and keeps drafts mounted when changing sections", () => {
    render(<TestLibrary />);
    expect(
      screen.getByRole("textbox", { name: "尚未发送的对话" })
    ).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "尚未发送的对话" }), {
      target: { value: "新反馈" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "职责与技能" }));
    expect(
      screen.getByRole("textbox", { name: "尚未保存的职责" })
    ).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "尚未保存的职责" }), {
      target: { value: "新职责" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "对话与测试" }));
    expect(screen.getByRole("textbox", { name: "尚未发送的对话" })).toHaveValue(
      "新反馈"
    );
    fireEvent.click(screen.getByRole("tab", { name: "资料与记忆" }));
    expect(screen.getByRole("textbox", { name: "尚未保存的职责" })).toHaveValue(
      "新职责"
    );
  });
  it("filters available skills by the selected role and keeps advanced navigation", () => {
    render(<TestLibrary />);
    fireEvent.click(screen.getByRole("tab", { name: "职责与技能" }));
    expect(
      screen.getByRole("link", { name: "Listing 文案 Skill" })
    ).toHaveAttribute("href", "/emperor/skills?workbench=listing.copy");
    expect(screen.getByText("高级：业务编排")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /图片策划助手/ }));
    expect(screen.getByRole("link", { name: "图片策划 Skill" })).toBeVisible();
    expect(screen.queryByText("Listing 文案 Skill")).not.toBeInTheDocument();
  });
  it("does not mark directory entries enabled or start work on navigation", () => {
    const select = vi.fn();
    render(
      <AgentLibraryPanel {...resources} selected="listing" onSelect={select} />
    );
    fireEvent.click(screen.getByRole("button", { name: /打标签的小酷/ }));
    expect(select).toHaveBeenCalledWith("tagger");
    expect(screen.queryByText(/已启用/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /执行|运行|发布/ })
    ).not.toBeInTheDocument();
  });
});
