// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const f = vi.hoisted(() => ({
  listener: null as any,
  storage: {} as Record<string, unknown>,
  fetch: vi.fn(),
  open: vi.fn(),
}));
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  f.storage = { token: "old-expired-token", name: "旧登录" };
  vi.stubGlobal("fetch", f.fetch);
  vi.stubGlobal("chrome", {
    runtime: {
      id: "a".repeat(32),
      onMessage: { addListener: (fn: any) => (f.listener = fn) },
    },
    tabs: { create: f.open },
    storage: {
      local: {
        get: async () => ({ ...f.storage }),
        set: async (v: any) => Object.assign(f.storage, v),
        remove: async (keys: string[] | string) =>
          (Array.isArray(keys) ? keys : [keys]).forEach(
            k => delete f.storage[k]
          ),
        setAccessLevel: vi.fn(),
      },
    },
  });
  await import("../../../extensions/research-collector/background");
});
afterEach(() => vi.unstubAllGlobals());
const sender = {
  id: "a".repeat(32),
  url: `chrome-extension://${"a".repeat(32)}/popup.html`,
};
const send = (type: string, source = sender, data = {}) =>
  new Promise<any>(resolve => f.listener({ type, ...data }, source, resolve));
it("在插件中直接登录，持久保存30天会话而不保存密码、不打开网页", async () => {
  f.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      token: "new-token",
      name: "运营",
      expiresAt: "2026-12-03T00:00:00Z",
    }),
  });
  expect(
    (
      await send("login", sender, {
        identifier: "operator",
        password: "test-only",
      })
    ).ok
  ).toBe(true);
  expect(f.storage).toMatchObject({
    token: "new-token",
    name: "运营",
    expiresAt: "2026-12-03T00:00:00Z",
  });
  expect(f.storage.password).toBeUndefined();
  expect(f.open).not.toHaveBeenCalled();
  expect(f.fetch.mock.calls[0][0]).toBe(
    "https://www.kuahaixing.com/api/research-extension/login"
  );
  expect(f.fetch.mock.calls[0][1].headers["X-Research-Extension-Id"]).toBe(
    sender.id
  );
  // Recreate the service worker (popup/browser refresh) with persistent storage.
  vi.resetModules();
  await import("../../../extensions/research-collector/background");
  f.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ name: "运营" }),
  });
  expect(await send("poll")).toMatchObject({ connected: true, name: "运营" });
  expect(f.fetch.mock.calls[1][0]).toBe(
    "https://www.kuahaixing.com/api/research-extension/profile"
  );
  expect(f.fetch.mock.calls[1][1].headers.Authorization).toBe(
    "Bearer new-token"
  );
});
it("离线或服务故障保留现有登录，只有明确失效的401才清除会话", async () => {
  f.fetch.mockRejectedValueOnce(Error("offline"));
  expect(await send("poll")).toMatchObject({
    connected: true,
    unavailable: true,
  });
  expect(f.storage.token).toBe("old-expired-token");
  f.fetch.mockResolvedValueOnce({
    ok: false,
    status: 502,
    json: async () => ({}),
  });
  expect(await send("poll")).toMatchObject({ connected: true });
  expect(f.storage.token).toBe("old-expired-token");
  f.fetch.mockResolvedValueOnce({
    ok: false,
    status: 401,
    json: async () => ({ error: "expired" }),
  });
  expect(await send("poll")).toMatchObject({ connected: false });
  expect(f.storage.token).toBeUndefined();
});
it("重新登录失败保留旧会话，商品页面不能发起账号登录", async () => {
  f.fetch.mockResolvedValueOnce({
    ok: false,
    status: 401,
    json: async () => ({ error: "密码不正确" }),
  });
  expect(
    (await send("login", sender, { identifier: "operator", password: "wrong" }))
      .ok
  ).toBe(false);
  expect(f.storage.token).toBe("old-expired-token");
  expect(
    (
      await send("login", {
        id: sender.id,
        url: "https://www.amazon.com/dp/B000000001",
      })
    ).ok
  ).toBe(false);
  expect(f.open).not.toHaveBeenCalled();
});
it("网络失败也能退出本机登录", async () => {
  f.fetch.mockRejectedValueOnce(Error("离线"));
  await send("logout");
  expect(f.storage.token).toBeUndefined();
});
it("亚马逊页面收藏只提交到青岛接口，不向原站发送令牌和资料", async () => {
  f.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ collected: true }) });
  const url = "https://www.amazon.com/dp/B000000001";
  expect(await send("collect", { ...sender, url, tab: { url } } as any, {
    data: { kind: "product", url, title: "Test product" },
  })).toMatchObject({ ok: true, collected: true });
  expect(f.fetch).toHaveBeenCalledTimes(1);
  expect(f.fetch.mock.calls[0][0]).toBe(
    "https://www.kuahaixing.com/api/research-extension/collect"
  );
  expect(f.fetch.mock.calls[0][1]).toMatchObject({
    credentials: "omit",
    redirect: "error",
    headers: { Authorization: "Bearer old-expired-token" },
  });
});
