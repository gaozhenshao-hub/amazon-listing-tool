import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./repositories/dbClient", async importOriginal => {
  const original = await importOriginal<typeof import("./repositories/dbClient")>();
  return { ...original, getDb: mocks.getDb };
});

import { createImageAssetPolicyService } from "./domains/image/services/imageAssetPolicyService";
import { createImageAssetTrustLedgerService } from "./domains/image/services/imageAssetTrustLedgerService";

const scope = { workspaceId: 7, projectId: 51, actorId: 17, actorRole: "admin" };

describe("图片资产受治理事务适配器", () => {
  it("图片用途读写入口无事务驱动时失败关闭", async () => {
    const select = vi.fn();
    mocks.getDb.mockResolvedValueOnce({ select });
    await expect(createImageAssetPolicyService().listCurrentPolicies(scope))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(select).not.toHaveBeenCalled();
  });

  it("可信账本证据人审无事务驱动时失败关闭", async () => {
    const select = vi.fn();
    mocks.getDb.mockResolvedValueOnce({ select });
    await expect(createImageAssetTrustLedgerService().reviewLicenseEvidence({
      ...scope,
      evidenceRecordId: "license_00000000-0000-4000-8000-000000000001",
      expectedVersion: 1,
      decision: "verify",
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(select).not.toHaveBeenCalled();
  });
});
