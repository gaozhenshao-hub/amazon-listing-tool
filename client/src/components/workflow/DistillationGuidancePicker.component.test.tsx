// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ledgers: vi.fn(() => ({ data: [{ ledgerKey: "ledger-1", version: 2, status: "locked", claims: [{ claimKey: "c-1" }] }], isLoading: false })),
  skills: vi.fn(() => ({ data: [], isLoading: false })),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    skillDistillation: {
      claimLedgers: { useQuery: mocks.ledgers },
      consumableSkills: { useQuery: mocks.skills },
    },
  },
}));

import { DistillationGuidancePicker } from "./DistillationGuidancePicker";

afterEach(() => cleanup());

describe("DistillationGuidancePicker", () => {
  it("keeps the current workflow unchanged when no released distilled skill exists", () => {
    render(<DistillationGuidancePicker value={{ ledgerKey: null, skillSlugs: [] }} onChange={vi.fn()} />);
    expect(screen.getByText("暂无已发布蒸馏 Skill，继续使用原有生成规则。")).toBeInTheDocument();
    expect(screen.getByText("手动选择")).toBeInTheDocument();
  });

  it("exposes a locked claim ledger as an explicit selectable binding", () => {
    const onChange = vi.fn();
    render(<DistillationGuidancePicker value={{ ledgerKey: null, skillSlugs: [] }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByText("v2 · 1 项已锁定主张"));
    expect(onChange).toHaveBeenCalledWith({ ledgerKey: "ledger-1", skillSlugs: [] });
  });
});
