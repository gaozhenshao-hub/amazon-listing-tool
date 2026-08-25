import { describe, expect, it } from "vitest";
import { asFiniteMetric, formatMetricFixed } from "./productOverviewMetricSafety";

describe("产品总览可空指标格式化", () => {
  it("将null、undefined、NaN和非数值转换为缺失值，而非传入toFixed", () => {
    expect(asFiniteMetric(null)).toBeNull();
    expect(asFiniteMetric(undefined)).toBeNull();
    expect(asFiniteMetric(Number.NaN)).toBeNull();
    expect(asFiniteMetric("13.6")).toBeNull();
    expect(formatMetricFixed(null, 1)).toBe("—");
  });

  it("保留有效数值的精度格式", () => {
    expect(asFiniteMetric(13.64)).toBe(13.64);
    expect(formatMetricFixed(13.64, 1)).toBe("13.6");
  });
});
