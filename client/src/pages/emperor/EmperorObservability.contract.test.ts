import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./EmperorObservability.tsx", import.meta.url)), "utf8");

describe("皇帝观测SLO前端契约", () => {
  it("只读取受保护的真实SLO摘要和趋势数据", () => {
    expect(source).toContain("emperor.observability.slo.useQuery");
    expect(source).toContain("emperor.observability.sloTrend.useQuery");
    expect(source).toContain("真实评测 SLO 趋势");
  });

  it("明确展示样本不足和真实数据来源，不生成自动动作", () => {
    expect(source).toContain("暂无样本");
    expect(source).toContain("系统不会补造评分或曲线");
    expect(source).toContain("仅作提示，不会自动发布、回退或重试");
    expect(source).toContain("emperor_ai_os_evaluations");
  });
});
