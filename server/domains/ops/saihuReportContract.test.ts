import { describe, expect, it } from "vitest";
import { SaihuReportContractSchema } from "./saihuReportContract";
import { syntheticSaihuContract } from "./saihuReportTestFixture";

describe("Saihu official documentation sources", () => {
  it.each([
    "https://sellfoxapi.apifox.cn/doc-8966970",
    "https://openapi.sellfox.com/docs/report",
  ])("accepts the official documentation host: %s", url => {
    const contract = syntheticSaihuContract("monthly");
    contract.documentation[0].url = url;
    expect(SaihuReportContractSchema.safeParse(contract).success).toBe(true);
  });

  it.each([
    "https://another.apifox.cn/doc-8966970",
    "https://sellfoxapi.apifox.cn.example.com/doc-8966970",
    "https://example.sellfoxapi.apifox.cn/doc-8966970",
    "http://sellfoxapi.apifox.cn/doc-8966970",
    "https://user:secret@sellfoxapi.apifox.cn/doc-8966970",
    "https://sellfoxapi.apifox.cn/doc-8966970?secret=example",
    "https://sellfoxapi.apifox.cn/doc-8966970#fragment",
  ])("rejects unrelated or credential-bearing sources: %s", url => {
    const contract = syntheticSaihuContract("monthly");
    contract.documentation[0].url = url;
    expect(SaihuReportContractSchema.safeParse(contract).success).toBe(false);
  });
});
