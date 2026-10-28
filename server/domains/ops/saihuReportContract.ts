import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  MONTHLY_FINANCIAL_METRICS,
  MonthlyFinancialRawSchema,
} from "../../../shared/monthlyFinancialReadDetails";
import {
  SAIHU_DAILY_FIELDS,
  SaihuReportHash,
  SaihuReportShopSchema,
  saihuReportHash,
} from "../../../shared/saihuReportSync";
import {
  inventoryCollectionConfig,
  inventoryCollectionCredentials,
} from "./inventoryCollectionConfig";
import type { DbExecutor } from "../../repositories/dbClient";

export class SaihuReportError extends Error {
  readonly retryable = false;
  constructor(readonly code: string) {
    super(`SAIHU_REPORT_${code}`);
    this.name = "SaihuReportError";
  }
}
export function saihuReportFail(code: string): never {
  throw new SaihuReportError(code);
}
const path = z
  .array(
    z.union([
      z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,99}$/u),
      z.number().int().min(0).max(100),
    ])
  )
  .min(1)
  .max(8);
const terms = z
  .array(
    z
      .object({
        path,
        multiplier: z.union([z.literal(1), z.literal(-1)]),
        divisor: z.union([z.literal(1), z.literal(100)]),
      })
      .strict()
  )
  .min(1)
  .max(100);
const mapping = z
  .object({
    period: path,
    currency: path,
    caliber: z
      .object({
        path,
        expectedValue: z.union([
          z.string().min(1).max(100),
          z.number().finite(),
        ]),
      })
      .strict()
      .nullable(),
    asin: path,
    parentAsin: path,
    shopId: path,
    storeName: path,
    country: path,
    title: path.nullable(),
    sku: path.nullable(),
    operator: path.nullable(),
    metrics: z.record(z.string(), terms.nullable()),
  })
  .strict();
export const SaihuReportContractSchema = z
  .object({
    version: z.literal(1),
    workspaceId: z.number().int().positive(),
    kind: z.enum(["daily", "monthly"]),
    reviewedBy: z.string().min(1).max(100),
    reviewedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    documentation: z
      .array(
        z
          .object({
            url: z
              .string()
              .url()
              .refine(value => {
                const u = new URL(value);
                return (
                  u.protocol === "https:" &&
                  (u.hostname === "sellfox.com" ||
                    u.hostname.endsWith(".sellfox.com") ||
                    u.hostname === "sellfoxapi.apifox.cn") &&
                  !u.username &&
                  !u.password &&
                  !u.search &&
                  !u.hash
                );
              }),
            sha256: SaihuReportHash,
          })
          .strict()
      )
      .min(1)
      .max(10),
    endpoint: z.enum([
      "/api/productAnalyze/V2/pageList.json",
      "/api/financial/v2/monthProfit/asin.json",
    ]),
    periodFormat: z.enum(["YYYY-MM-DD", "YYYYMM"]),
    request: z
      .object({
        staticBody: MonthlyFinancialRawSchema,
        startField: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,99}$/u),
        endField: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,99}$/u),
        pageField: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,99}$/u),
        pageSizeField: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,99}$/u),
        currencyField: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,99}$/u),
      })
      .strict(),
    shops: z.array(SaihuReportShopSchema).min(1).max(100),
    response: z
      .object({
        rows: path,
        total: path,
        pageNo: path,
        pageCount: path,
        emptyShopIds: path.nullable(),
      })
      .strict(),
    mapping,
  })
  .strict()
  .superRefine((value, ctx) => {
    const keys =
      value.kind === "daily" ? SAIHU_DAILY_FIELDS : MONTHLY_FINANCIAL_METRICS;
    if (
      value.endpoint !==
        (value.kind === "daily"
          ? "/api/productAnalyze/V2/pageList.json"
          : "/api/financial/v2/monthProfit/asin.json") ||
      value.periodFormat !==
        (value.kind === "daily" ? "YYYY-MM-DD" : "YYYYMM") ||
      (value.kind === "monthly" && !value.mapping.caliber) ||
      new Set([
        value.request.startField,
        value.request.endField,
        value.request.pageField,
        value.request.pageSizeField,
        value.request.currencyField,
      ]).size !== 5 ||
      Object.keys(value.request.staticBody).some(key =>
        /^(?:access_?token|client_?secret|password|authorization|sign)$/iu.test(
          key
        )
      ) ||
      Object.keys(value.mapping.metrics).length !== keys.length ||
      keys.some(key => !(key in value.mapping.metrics)) ||
      new Set(value.shops.map(shop => shop.shopId)).size !==
        value.shops.length ||
      new Set(
        value.shops.map(shop => JSON.stringify([shop.storeName, shop.country]))
      ).size !== value.shops.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Complete exact report mapping required",
      });
  });
export type SaihuReportContract = z.infer<typeof SaihuReportContractSchema>;
/** Request fields and flags are approved evidence, not guessed from a legacy
 * mapper. The complete template/field selectors are frozen in contractHash. */
export function saihuReportRequestBody(
  contract: SaihuReportContract,
  period: string,
  pageNo: number
) {
  const request = contract.request,
    date =
      contract.periodFormat === "YYYYMM" ? period.replace("-", "") : period;
  return {
    ...structuredClone(request.staticBody),
    [request.startField]: date,
    [request.endField]: date,
    [request.pageField]: pageNo,
    [request.pageSizeField]: 100,
    [request.currencyField]: "USD",
  };
}
export type SaihuReportConfiguration = {
  connectionVersion: string;
  contractHash: string;
  configurationHash: string;
  contract: SaihuReportContract;
};

/** Approval is intentionally absent by default. A fixed friend mapper is not
 * evidence that an upstream date field or an empty-shop promise exists. */
export async function loadSaihuReportContract(
  workspaceId: number,
  kind: "daily" | "monthly",
  now = Date.now()
): Promise<SaihuReportContract> {
  const file = process.env.SAIHU_REPORT_CONTRACT_FILE,
    expected = process.env.SAIHU_REPORT_CONTRACT_SHA256;
  if (!file || !expected || !/^[a-f0-9]{64}$/u.test(expected))
    return saihuReportFail("SOURCE_CONTRACT_NOT_APPROVED");
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size > 262144)
      return saihuReportFail("SOURCE_CONTRACT_INVALID");
    const bytes = await readFile(file);
    if (
      bytes.length !== info.size ||
      createHash("sha256").update(bytes).digest("hex") !== expected
    )
      return saihuReportFail("SOURCE_CONTRACT_CHANGED");
    const source = z
      .object({
        version: z.literal(1),
        contracts: z.array(SaihuReportContractSchema).max(100),
      })
      .strict()
      .parse(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
      );
    const matches = source.contracts.filter(
      value => value.workspaceId === workspaceId && value.kind === kind
    );
    if (
      matches.length !== 1 ||
      Date.parse(matches[0].reviewedAt) > now ||
      Date.parse(matches[0].expiresAt) <= now
    )
      return saihuReportFail("SOURCE_CONTRACT_NOT_APPROVED");
    return matches[0];
  } catch (error) {
    if (error instanceof SaihuReportError) throw error;
    return saihuReportFail("SOURCE_CONTRACT_INVALID");
  }
}
export async function saihuReportConfiguration(
  tx: DbExecutor,
  workspaceId: number,
  kind: "daily" | "monthly"
): Promise<SaihuReportConfiguration> {
  const contract = await loadSaihuReportContract(workspaceId, kind),
    config = await inventoryCollectionConfig(tx, workspaceId);
  if (!config) return saihuReportFail("CONNECTION_NOT_CONFIGURED");
  const contractHash = saihuReportHash(contract);
  return {
    connectionVersion: config.connectionVersion,
    contractHash,
    configurationHash: saihuReportHash({
      connectionVersion: config.connectionVersion,
      contractHash,
    }),
    contract,
  };
}
export const saihuReportCredentials = inventoryCollectionCredentials;
export function saihuReportAt(
  value: unknown,
  keys: Array<string | number>
): unknown {
  for (const key of keys) {
    if (
      value === null ||
      typeof value !== "object" ||
      !Object.prototype.hasOwnProperty.call(value, key)
    )
      return undefined;
    value = (value as Record<string | number, unknown>)[key];
  }
  return value;
}
