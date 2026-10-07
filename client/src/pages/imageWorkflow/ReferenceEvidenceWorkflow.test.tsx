// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  myQuery: vi.fn(),
  reviewQuery: vi.fn(),
  policiesQuery: vi.fn(),
  mutation: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { role: "user" } }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ imageWorkflow: { createLicenseEvidencePreview: { fetch: mocks.fetch } } }),
    imageWorkflow: {
      listMyLicenseEvidence: { useQuery: mocks.myQuery },
      listLicenseEvidenceForReview: { useQuery: mocks.reviewQuery },
      listAssetPolicies: { useQuery: mocks.policiesQuery },
      registerReceiptAsset: { useMutation: mocks.mutation },
      reviewLicenseEvidence: { useMutation: mocks.mutation },
      reviewAssetPolicy: { useMutation: mocks.mutation },
    },
  },
}));

import { ReferenceEvidenceWorkflow, isControlledLedgerUnavailable } from "./ReferenceEvidenceWorkflow";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReferenceEvidenceWorkflow", () => {
  it("clearly blocks the controlled flow when the DRAFT ledger tables are unavailable", () => {
    mocks.myQuery.mockReturnValue({ data: undefined, error: new Error("可信素材账本所需数据表尚未就绪或不可用") });
    mocks.reviewQuery.mockReturnValue({ data: undefined, error: null });
    mocks.policiesQuery.mockReturnValue({ data: undefined, error: null });
    mocks.mutation.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    render(<ReferenceEvidenceWorkflow projectId={51} receipts={[]} />);
    expect(screen.getByText("受控素材流程暂不可用")).toBeInTheDocument();
    expect(screen.getByText(/0207 可信账本仍为 DRAFT/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "提交 PDF 证明" })).not.toBeInTheDocument();
  });

  it("recognizes only controlled ledger-unavailable errors for the fail-closed state", () => {
    expect(isControlledLedgerUnavailable(new Error("数据表尚未就绪"))).toBe(true);
    expect(isControlledLedgerUnavailable(new Error("network timeout"))).toBe(false);
  });
});
