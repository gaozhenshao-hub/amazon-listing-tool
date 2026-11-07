import { it, expect } from "vitest";
import {
  researchExtensionReturn,
  researchExtensionLoginUrl,
} from "./researchExtensionReturn";
it("未登录的收藏插件连接页在登录后返回原确认页，普通页面保持原登录行为", () => {
  const target = "/dev/library/connect?code=ABCDEF1234";
  const login = researchExtensionLoginUrl(
    "/dev/library/connect",
    "?code=abcdef1234"
  );
  expect(
    researchExtensionReturn(
      new URLSearchParams(login.split("?")[1]).get("returnTo")
    )
  ).toBe(target);
  expect(researchExtensionLoginUrl("/listing", "?projectId=1")).toBe("/login");
});
it("拒绝外站、协议相对地址、控制字符、任意页面与额外参数", () => {
  for (const value of [
    "https://evil.invalid/dev/library/connect?code=ABCDEF1234",
    "//evil.invalid",
    "/dev/library",
    "/dev/library/connect?code=ABCDEF1234&next=https://evil.invalid",
    "/dev/library/connect?code=ABCDEF1234\n",
    "/dev/library/connect?code=invalid",
    null,
  ])
    expect(researchExtensionReturn(value)).toBeNull();
});
