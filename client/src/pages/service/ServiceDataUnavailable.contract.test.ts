import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

describe("售后数据源故障不能伪装为零值", () => {
  it("故障态明确说明数据尚不可用，提供人工重试", () => {
    const component = source("ServiceDataUnavailable.tsx");
    expect(component).toContain("售后业务数据暂不可用");
    expect(component).toContain("不能据此判断 Review、退货或邮件数量为零");
    expect(component).toContain("onClick={onRetry}");
  });

  it("仪表盘、评价、退货分别拦截失败分支", () => {
    expect(source("ServiceDashboard.tsx")).toContain("dashQuery.isError || !dashQuery.data");
    expect(source("ServiceReviews.tsx")).toContain("reviewsQuery.isError || statsQuery.isError");
    expect(source("ServiceReturns.tsx")).toContain("returnsQuery.isError || !returnsQuery.data");
  });

  it("邮件收件箱显示故障，但不隐藏独立模板标签", () => {
    const emails = source("ServiceEmails.tsx");
    expect(emails).toContain("emailsQuery.isError ? (");
    expect(emails).toContain('<TabsTrigger value="templates"');
    expect(emails).toContain("<ServiceDataUnavailable onRetry={() => void emailsQuery.refetch()}");
  });
});
