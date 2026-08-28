import { describe, expect, it } from "vitest";
import { resolveConfirmedExternalOperator, splitExternalOperatorNames } from "./operatorNameResolution";

describe("operatorNameResolution", () => {
  it("可拆分领星的斜杠和中文逗号组合负责人", () => {
    expect(splitExternalOperatorNames("XM-1、 张三/李四，王五")).toEqual(["XM-1", "张三", "李四", "王五"]);
  });

  it("所有外部名称已确认时才返回系统人员组合", () => {
    const mappings = new Map([["XM-1", "赵寒"], ["XM-2", "邹梓昂"]]);
    expect(resolveConfirmedExternalOperator("XM-1 / XM-2", mappings)).toBe("赵寒/邹梓昂");
  });

  it("组合负责人中有任何未确认名称时拒绝部分自动归属", () => {
    const mappings = new Map([["XM-1", "赵寒"]]);
    expect(resolveConfirmedExternalOperator("XM-1/未知负责人", mappings)).toBeNull();
  });
});
