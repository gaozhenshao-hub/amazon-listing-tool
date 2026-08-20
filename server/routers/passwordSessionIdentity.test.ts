import { describe, expect, it } from "vitest";
import { buildPasswordSessionIdentity } from "./passwordSessionIdentity";

describe("buildPasswordSessionIdentity", () => {
  it("为无Manus应用ID的本地密码登录提供可校验的非空JWT载荷", () => {
    expect(buildPasswordSessionIdentity({ id: 7, name: "运营管理员" }, "")).toEqual({
      openId: "pwd_7",
      appId: "local",
      name: "运营管理员",
    });
  });

  it("保留既有身份并为缺失姓名提供邮箱回退", () => {
    expect(
      buildPasswordSessionIdentity(
        { id: 9, openId: "pwd_9", email: "owner@example.com" },
        "amz-local-app"
      )
    ).toEqual({
      openId: "pwd_9",
      appId: "amz-local-app",
      name: "owner@example.com",
    });
  });
});
