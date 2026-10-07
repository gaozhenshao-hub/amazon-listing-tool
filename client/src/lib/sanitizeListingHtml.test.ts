// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizeListingHtml } from "./sanitizeListingHtml";

describe("Listing富文本预览安全门禁", () => {
  it("保留合法段落/加粗/列表而剔除标签属性", () => {
    const value = sanitizeListingHtml('<p class="heading"><strong>Clear benefit</strong><br><em>Supported</em></p><ul><li>fact</li></ul>');
    expect(value).toContain("<strong>Clear benefit</strong>");
    expect(value).toContain("<li>fact</li>");
    expect(value).not.toContain('class=');
  });
  it("去除脚本、可执行图像/矢量及事件处理属性", () => {
    const value = sanitizeListingHtml('<p onclick="alert(1)">Text</p><script>alert(2)</script><img src=x onerror="alert(3)"><svg onload="alert(4)"><circle /></svg>');
    expect(value).toContain("Text");
    expect(value).not.toMatch(/<script|<img|<svg|<circle|onclick|onerror|onload|alert\(/i);
  });
  it("对空值返回空白、去掉不在白名单内的外链", () => {
    expect(sanitizeListingHtml(undefined)).toBe("");
    expect(sanitizeListingHtml('<a href="javascript:alert(1)">click</a>')).toBe("click");
  });
});
