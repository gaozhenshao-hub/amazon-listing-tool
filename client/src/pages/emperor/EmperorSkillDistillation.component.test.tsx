// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: 1, defaultWorkspaceId: 1, role: "super_admin" },
  catalog: vi.fn(() => ({
    data: {
      automaticDistillation: false,
      automaticPublish: false,
      catalog: [
        { skillTypeKey: "knowledge.evidence.curate", name: "知识证据筛选", group: "蒸馏治理", priority: "P0", workflowNodes: ["蒸馏工作台：来源与证据"] },
        { skillTypeKey: "listing.image.claim-ledger", name: "文图主张账本", group: "协同治理", priority: "P1", workflowNodes: ["Listing与图片：主张账本"] },
      ],
    },
    isLoading: false,
  })),
  emptyQuery: vi.fn(() => ({ data: [], isLoading: false, isFetching: false, refetch: vi.fn() })),
  emptyOptionalQuery: vi.fn(() => ({ data: undefined, isLoading: false, isFetching: false, refetch: vi.fn() })),
  detail: vi.fn(() => ({ data: undefined, isLoading: false, refetch: vi.fn() })),
  mutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user, isLoading: false }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/emperor/skill-distillation", vi.fn()] }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ skillDistillation: { projects: { invalidate: vi.fn() } } }),
    skillDistillation: {
      catalog: { useQuery: mocks.catalog },
      projects: { useQuery: mocks.emptyQuery },
      projectDetail: { useQuery: mocks.detail },
      eligibleSources: { useQuery: mocks.emptyQuery },
      claimLedgers: { useQuery: mocks.emptyQuery },
      publishedSkillVersions: { useQuery: mocks.emptyQuery },
      feedback: { useQuery: mocks.emptyQuery },
      feedbackSummary: { useQuery: mocks.emptyQuery },
      consistencyMatrix: { useQuery: mocks.emptyOptionalQuery },
      createProject: { useMutation: mocks.mutation },
      addSource: { useMutation: mocks.mutation },
      createEvidence: { useMutation: mocks.mutation },
      reviewEvidence: { useMutation: mocks.mutation },
      createDraft: { useMutation: mocks.mutation },
      runManualDistillation: { useMutation: mocks.mutation },
      revalidateSources: { useMutation: mocks.mutation },
      transitionDraft: { useMutation: mocks.mutation },
      updateDraft: { useMutation: mocks.mutation },
      publishDraft: { useMutation: mocks.mutation },
      restoreSnapshot: { useMutation: mocks.mutation },
      createNextDraftFromFeedback: { useMutation: mocks.mutation },
      recordConsistencyDecision: { useMutation: mocks.mutation },
      createClaimLedger: { useMutation: mocks.mutation },
    },
  },
}));

import EmperorSkillDistillation from "./EmperorSkillDistillation";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.user = { id: 1, defaultWorkspaceId: 1, role: "super_admin" };
});

describe("EmperorSkillDistillation", () => {
  it("shows the blueprint catalog but clearly keeps automatic distillation and publication off", () => {
    render(<EmperorSkillDistillation />);
    expect(screen.getByRole("heading", { name: "先建立受控底座，再在知识充分时启动蒸馏" })).toBeInTheDocument();
    expect(screen.getByText("自动蒸馏关闭")).toBeInTheDocument();
    expect(screen.getByText("自动蒸馏任务").previousElementSibling).toHaveTextContent("0");
    expect(screen.getByText("自动发布规则").previousElementSibling).toHaveTextContent("0");
    expect(screen.getByText("知识证据筛选")).toBeInTheDocument();
    expect(screen.getByText("文图主张账本")).toBeInTheDocument();
  });

  it("does not expose source, evidence, draft or ledger controls to non-super-administrators", () => {
    mocks.user = { id: 2, defaultWorkspaceId: 1, role: "ops_specialist" };
    render(<EmperorSkillDistillation />);
    expect(screen.getByText("该工作台仅对超级管理员开放。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "建立空蒸馏项目" })).not.toBeInTheDocument();
    expect(screen.queryByText("一、可信来源池")).not.toBeInTheDocument();
  });
});
