import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  withDbTransaction: vi.fn(),
}));
vi.mock("./repositories/dbClient", async importOriginal => ({
  ...await importOriginal<typeof import("./repositories/dbClient")>(),
  withDbTransaction: mocks.withDbTransaction,
}));

import { selectUnifiedArtifactVersion } from "./domains/ai_os/services/artifactLifecycle";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.withDbTransaction.mockImplementation(async (_label: string, fn: (tx: { execute: typeof mocks.execute }) => Promise<unknown>) =>
    fn({ execute: mocks.execute }));
});

describe("Listing受治理正式内容的Artifact指针防绕行", () => {
  it.each(["listing.content", "listing.complete_snapshot"])("拒绝 %s 的直接选版，事务中零写入", async artifactKey => {
    mocks.execute.mockResolvedValueOnce([[{
      artifactId: "art_listing_old", workspaceId: 11, projectId: 22,
      domain: "listing", artifactKey, status: "final", version: 1,
    }]]);
    await expect(selectUnifiedArtifactVersion({ artifactId: "art_listing_old", workspaceId: 11, userId: 33 }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.withDbTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});
