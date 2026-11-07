// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import {
  RESEARCH_EXTENSION_ORIGIN,
  RESEARCH_EXTENSION_API,
  RESEARCH_EXTENSION_LIBRARY,
  RESEARCH_EXTENSION_HOST_PERMISSION,
} from "../../../extensions/research-collector/origin.mjs";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("青岛扩展的登录、收藏、页面和主机权限固定指向同一站点", () => {
  expect(RESEARCH_EXTENSION_ORIGIN).toBe("https://www.kuahaixing.com");
  expect(RESEARCH_EXTENSION_API).toBe(`${RESEARCH_EXTENSION_ORIGIN}/api/research-extension`);
  expect(RESEARCH_EXTENSION_LIBRARY).toBe(`${RESEARCH_EXTENSION_ORIGIN}/dev/library`);
  expect(RESEARCH_EXTENSION_HOST_PERMISSION).toBe(`${RESEARCH_EXTENSION_ORIGIN}/*`);
  for (const target of [RESEARCH_EXTENSION_API, RESEARCH_EXTENSION_LIBRARY]) {
    const url = new URL(target);
    expect(url.origin).toBe(RESEARCH_EXTENSION_ORIGIN);
    expect(url.username).toBe("");
    expect(url.password).toBe("");
  }
});

it("插件打开待调研产品库时使用青岛站", async () => {
  vi.resetModules();
  document.body.innerHTML = `
    <span id="status"></span><button id="login"></button><button id="logout"></button>
    <dialog id="login-dialog"><form id="login-form">
      <input id="identifier"><input id="password"><span id="login-error"></span>
      <button id="submit"></button><button id="cancel"></button>
    </form></dialog><button id="check"></button><button id="library"></button>`;
  const create = vi.fn();
  vi.stubGlobal("chrome", {
    runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, connected: false }) },
    tabs: { create },
  });
  await import("../../../extensions/research-collector/popup");
  document.getElementById("library")!.click();
  expect(create).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledWith({
    url: "https://www.kuahaixing.com/dev/library",
  });
});

it("打包清单使用共享主机权限，发布入口不保留朋友站地址", () => {
  const script = readFileSync("scripts/build-research-extension.mjs", "utf8");
  expect(script).toContain('from "../extensions/research-collector/origin.mjs"');
  expect(script).toMatch(/host_permissions:\s*\[RESEARCH_EXTENSION_HOST_PERMISSION\]/);
  for (const source of [
    script,
    readFileSync("extensions/research-collector/background.ts", "utf8"),
    readFileSync("extensions/research-collector/popup.ts", "utf8"),
  ]) {
    expect(source).not.toContain("xingqimaoyi.vip");
  }
});
