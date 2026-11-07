import {
  amazonResearchHost,
  researchIdentity,
  researchBookmarkSchema,
} from "../../shared/researchLibrary";
import { RESEARCH_EXTENSION_API } from "./origin.mjs";
declare const chrome: any;
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}
async function api(path: string, data?: unknown, token?: string) {
  const response = await fetch(RESEARCH_EXTENSION_API + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Research-Extension-Id": chrome.runtime.id,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    credentials: "omit",
    redirect: "error",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      result.error || "连接暂时失败，请稍后重试",
      response.status
    );
  return result;
}
async function handle(message: any, sender: any) {
  if (sender.id !== chrome.runtime.id) throw new Error("不接受外部消息");
  const popup = String(sender.url || "").startsWith(
    `chrome-extension://${chrome.runtime.id}/popup.html`
  );
  const stored = await chrome.storage.local.get([
    "token",
    "pendingToken",
    "name",
    "expiresAt",
  ]);
  if (message.type === "login") {
    if (!popup) throw new Error("请从插件面板登录");
    const identifier = String(message.identifier || "").trim(),
      password = String(message.password || "");
    if (!identifier || !password) throw new Error("请输入系统账号和密码");
    const session = await api("/login", { identifier, password });
    await chrome.storage.local.set({
      token: session.token,
      name: session.name,
      expiresAt: session.expiresAt,
    });
    await chrome.storage.local.remove("pendingToken");
    return {
      connected: true,
      name: session.name,
      expiresAt: session.expiresAt,
    };
  }
  if (message.type === "poll") {
    if (!popup) throw new Error("请从插件面板查看登录状态");
    if (stored.token) {
      try {
        const profile = await api("/profile", undefined, stored.token);
        await chrome.storage.local.set({ name: profile.name });
        return {
          connected: true,
          name: profile.name,
          expiresAt: stored.expiresAt,
        };
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await chrome.storage.local.remove([
            "token",
            "name",
            "expiresAt",
            "pendingToken",
          ]);
          return { connected: false, notice: "登录已到期或已退出，请重新登录" };
        }
        // A sleeping service worker or a temporary outage is not a logout.
        return {
          connected: true,
          name: stored.name || "当前用户",
          expiresAt: stored.expiresAt,
          notice: "暂时无法验证连接，请稍后重试",
          unavailable: true,
        };
      }
    }
    if (!stored.pendingToken) return { connected: false };
    const status = await api("/pair/status", {
      deviceToken: stored.pendingToken,
    });
    if (status.connected) {
      await chrome.storage.local.set({
        token: stored.pendingToken,
        name: status.name,
      });
      await chrome.storage.local.remove("pendingToken");
    }
    return status;
  }
  if (message.type === "logout") {
    if (!popup) throw new Error("请从插件面板退出登录");
    try {
      if (stored.token) await api("/logout", {}, stored.token);
    } finally {
      await chrome.storage.local.remove([
        "token",
        "pendingToken",
        "name",
        "expiresAt",
      ]);
    }
    return { ok: true };
  }
  if (!["collect", "lookup"].includes(message.type) || !sender.tab?.url)
    throw new Error("不支持的插件操作");
  if (!amazonResearchHost(new URL(sender.tab.url).hostname))
    throw new Error("请在亚马逊商品或店铺页面使用收藏");
  if (!stored.token) throw new Error("请点击浏览器工具栏中的插件，先登录系统");
  const input = researchBookmarkSchema.parse(message.data),
    expected = researchIdentity(input.kind, sender.tab.url),
    actual = researchIdentity(input.kind, input.url);
  if (expected.key !== actual.key)
    throw new Error("页面已变化，请刷新后再收藏");
  return api(
    message.type === "collect" ? "/collect" : "/lookup",
    message.type === "collect" ? input : { kind: input.kind, url: input.url },
    stored.token
  );
}
chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
chrome.runtime.onMessage.addListener(
  (message: any, sender: any, respond: any) => {
    handle(message, sender)
      .then(result => respond({ ok: true, ...result }))
      .catch(error =>
        respond({
          ok: false,
          error: error instanceof Error ? error.message : "收藏暂未完成",
        })
      );
    return true;
  }
);
