import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { canManageDeploymentSync } from "@shared/deploymentSyncAuthorization";

// Real tRPC authentication/error middleware and route bodies; no live DB,
// environment secrets, peer service or model. This is not full T24 acceptance.
const mocks = vi.hoisted(() => ({
  getDb: vi.fn(), http: vi.fn(), envRead: vi.fn(), envWrite: vi.fn(),
  selectRows: vi.fn(), updateWhere: vi.fn(), insertValues: vi.fn(),
  settings: { peerSyncEnabled: true, peerApiUrl: "https://peer.example.test", peerApiKey: "synthetic-peer-key" },
}));
vi.mock("./repositories/dbClient", () => ({ getDb: mocks.getDb }));
vi.mock("./infrastructure/http/safeHttpClient", () => ({ safeHttpRequest: mocks.http }));
vi.mock("./_core/env", () => ({ ENV: new Proxy(mocks.settings, {
  get(target, key) { mocks.envRead(key); return Reflect.get(target, key); },
  set(target, key, value) { mocks.envWrite(key, value); return Reflect.set(target, key, value); },
}) }));

import { deploymentConfigRouter } from "./routers/deploymentConfig";

type Role = NonNullable<TrpcContext["user"]>["role"];
function context(role: Role | null): TrpcContext {
  return {
    user: role === null ? null : {
      id: 7, role, status: "active", defaultWorkspaceId: 42, organizationId: 3,
      openId: "pwd_7", email: "sync-test@example.test", name: "Synthetic sync caller",
      loginMethod: "local", createdAt: new Date(0), updatedAt: new Date(0), lastSignedIn: new Date(0),
    } as NonNullable<TrpcContext["user"]>,
    workspaceId: 42,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}
const db = {
  select: vi.fn(() => ({ from: () => ({ where: mocks.selectRows }) })),
  update: vi.fn(() => ({ set: (value: unknown) => ({ where: () => mocks.updateWhere(value) }) })),
  insert: vi.fn(() => ({ values: mocks.insertValues })),
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.settings, { peerSyncEnabled: true, peerApiUrl: "https://peer.example.test", peerApiKey: "synthetic-peer-key" });
  mocks.getDb.mockResolvedValue(null);
  mocks.selectRows.mockResolvedValue([]);
  mocks.http.mockResolvedValue({ ok: true, status: 200, json: () => ({ instanceId: "synthetic-peer", companyName: "Fixture" }) });
});

function expectNoEffects() {
  for (const spy of [mocks.getDb, mocks.http, mocks.envRead, mocks.envWrite,
    db.select, db.update, db.insert, mocks.updateWhere, mocks.insertValues]) {
    expect(spy).not.toHaveBeenCalled();
  }
}

describe("deployment peer sync follows existing configuration-admin policy", () => {
  it.each([
    { label: "anonymous", role: null, code: "UNAUTHORIZED" },
    { label: "ordinary user", role: "ops_specialist", code: "FORBIDDEN" },
    { label: "admin_sync read-only grant", role: "ops_specialist", code: "FORBIDDEN" },
    { label: "operations manager", role: "ops_manager", code: "FORBIDDEN" },
    { label: "finance", role: "finance", code: "FORBIDDEN" },
    { label: "designer", role: "designer", code: "FORBIDDEN" },
    { label: "product development", role: "product_dev", code: "FORBIDDEN" },
    { label: "purchaser", role: "purchaser", code: "FORBIDDEN" },
  ] as const)("rejects $label before configuration, DB or HTTP access", async ({ label, role, code }) => {
    // The page-level role grant is deliberately not consulted: it cannot make
    // an ordinary account an administrator or permit an instance-wide action.
    if (label === "admin_sync read-only grant") mocks.selectRows.mockResolvedValue([{
      modules: '["admin"]',
      detailedPermissions: '[{"moduleId":"admin","operations":["read"],"subModules":[{"subModuleId":"admin_sync","operations":["read"]}]}]',
    }]);
    const caller = deploymentConfigRouter.createCaller(context(role));
    for (const action of [
      () => caller.triggerSync(), () => caller.testPeerConnection(),
      () => caller.updateSyncConfig({ peerSyncEnabled: true }),
    ]) {
      await expect(action()).rejects.toMatchObject({ code });
      expectNoEffects();
    }
  });

  it.each(["admin", "super_admin"] as const)("keeps valid %s trigger, connection test and masked-key save paths", async role => {
    const caller = deploymentConfigRouter.createCaller(context(role));
    await expect(caller.triggerSync()).resolves.toMatchObject({ success: true });
    expect(mocks.http).toHaveBeenLastCalledWith(expect.any(URL), expect.objectContaining({
      method: "POST", headers: expect.objectContaining({ "x-sync-api-key": "synthetic-peer-key" }),
      auditContext: { operation: "deployment.sync_trigger" },
    }));
    expect(mocks.http.mock.calls[0][0].pathname).toBe("/api/sync/trigger");
    expect(mocks.getDb).not.toHaveBeenCalled();

    mocks.getDb.mockResolvedValue(db);
    mocks.selectRows.mockResolvedValue([
      { settingKey: "peer_api_url", settingValue: "https://configured-peer.example.test" },
      { settingKey: "peer_api_key", settingValue: "synthetic-db-key" },
    ]);
    await expect(caller.testPeerConnection()).resolves.toMatchObject({ success: true, peerInfo: { instanceId: "synthetic-peer" } });
    expect(mocks.http).toHaveBeenLastCalledWith(new URL("https://configured-peer.example.test/api/sync/status"), expect.objectContaining({
      method: "GET", headers: expect.objectContaining({ "x-sync-api-key": "synthetic-db-key" }),
    }));

    await expect(caller.updateSyncConfig({ peerSyncEnabled: false, peerApiKey: "••••••••" })).resolves.toEqual({ success: true });
    expect(mocks.updateWhere).toHaveBeenCalledOnce();
    expect(mocks.updateWhere).toHaveBeenCalledWith({ settingValue: "false", updatedBy: 7, category: "sync" });
    expect(mocks.settings.peerApiKey).toBe("synthetic-peer-key");
    expect(mocks.envWrite).toHaveBeenCalledOnce();
    expect(mocks.envWrite).toHaveBeenCalledWith("peerSyncEnabled", false);
    expect(mocks.http).toHaveBeenCalledTimes(2);
  });

  it("keeps disabled sync disabled and does not call a peer", async () => {
    mocks.settings.peerSyncEnabled = false;
    await expect(deploymentConfigRouter.createCaller(context("admin")).triggerSync())
      .resolves.toEqual({ success: false, error: "对端同步未配置" });
    expect(mocks.http).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.envWrite).not.toHaveBeenCalled();
  });

  it("retains authenticated read-only status, logs and masked configuration access", async () => {
    const caller = deploymentConfigRouter.createCaller(context("ops_specialist"));
    await expect(caller.getSyncStatus()).resolves.toMatchObject({ enabled: false });
    await expect(caller.getSyncLogs({ page: 1, limit: 20 })).resolves.toEqual({ logs: [], total: 0 });
    await expect(caller.getSyncConfig()).resolves.toMatchObject({ peerApiKey: "••••••••", source: "env" });
    expect(mocks.http).not.toHaveBeenCalled();
    expect(mocks.envWrite).not.toHaveBeenCalled();
  });

  it("shared UI/server policy grants only the two established administrator roles", () => {
    for (const role of [null, undefined, "", "user", "ops_manager", "ops_specialist", "admin_sync", "Admin", "admin "]) {
      expect(canManageDeploymentSync(role)).toBe(false);
    }
    expect(canManageDeploymentSync("admin")).toBe(true);
    expect(canManageDeploymentSync("super_admin")).toBe(true);
  });
});
