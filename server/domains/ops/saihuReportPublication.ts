import type { DbExecutor } from "../../repositories/dbClient";
import {
  MonthlyFinancialApiPreparedSchema,
  MonthlyFinancialApiManifestSchema,
  type MonthlyFinancialApiPrepared,
  type MonthlyFinancialApiManifest,
} from "../../../shared/monthlyFinancialApiSource";
import {
  saihuReportHash,
  type SaihuReportCapturePreview,
} from "../../../shared/saihuReportSync";
import {
  readSaihuReportPublication,
  saihuReportArtifactId,
} from "./saihuReportProtocol";
import {
  saihuReportFail,
  saihuReportConfiguration,
} from "./saihuReportContract";
import {
  parseMonthlyFinancialBatch,
  type MonthlyFinancialBatchRecord,
} from "../../../shared/monthlyFinancialRead";

const publications = new WeakMap<
  object,
  { runId: string; sourceHash: string; action: "confirm" | "revoke" }
>();
/** Only the dedicated apply transaction can update both the monthly consumer
 * and its capture receipt. Ordinary file RPCs cannot bypass the capture fence. */
export async function withSaihuMonthlyTransition<T>(
  tx: DbExecutor,
  prepared: MonthlyFinancialApiPrepared,
  action: "confirm" | "revoke",
  body: () => Promise<T>
): Promise<T> {
  if (publications.has(tx)) return saihuReportFail("NESTED_MONTH_PUBLICATION");
  await boundPublication(tx, prepared);
  publications.set(tx, {
    runId: prepared.runId,
    sourceHash: prepared.sourceHash,
    action,
  });
  try {
    return await body();
  } finally {
    publications.delete(tx);
  }
}

export function saihuMonthlyPayload(preview: SaihuReportCapturePreview) {
  if (
    preview.scope.kind !== "monthly" ||
    !preview.coverage.complete ||
    preview.coverage.observed.some(value => value.rowCount === 0)
  )
    return saihuReportFail("MONTH_SCOPE_NOT_REPRESENTABLE");
  return preview.monthlyRows.map(row => ({
    yearMonth: row.period,
    parentAsin: row.parentAsin,
    asin: row.asin,
    sku: row.sku,
    title: row.title,
    storeName: row.shop.storeName,
    site: row.shop.country,
    operator: row.operator,
    raw: {
      source: "sellfox_monthly_api",
      currency: "USD",
      profitCaliberType: "settlement",
      sourceHash: preview.sourceHash,
      contractHash: preview.contractHash,
      api: row.raw,
    },
    ...row.metrics,
  }));
}
/** A complete set of pages cannot silently remove known nonzero ASINs from
 * the current month/shop/site snapshot. Real returned zero rows do replace. */
export function assertSaihuMonthlyReplacement(
  target: MonthlyFinancialBatchRecord,
  completed: MonthlyFinancialBatchRecord[]
) {
  const incoming = parseMonthlyFinancialBatch(target),
    scopeKey = (row: {
      yearMonth: string;
      storeName: string;
      country: string;
    }) => JSON.stringify([row.yearMonth, row.storeName, row.country]),
    keys = new Set(
      incoming.rows.map(row => JSON.stringify([scopeKey(row), row.asin]))
    ),
    scopes = new Set(incoming.rows.map(scopeKey)),
    winners = new Map<string, ReturnType<typeof parseMonthlyFinancialBatch>>();
  for (const record of [...completed].sort((a, b) => b.id - a.id)) {
    const batch = parseMonthlyFinancialBatch(record);
    for (const row of batch.rows)
      if (scopes.has(scopeKey(row)) && !winners.has(scopeKey(row)))
        winners.set(scopeKey(row), batch);
  }
  for (const [scope, batch] of winners)
    for (const row of batch.rows) {
      if (
        scopeKey(row) !== scope ||
        !Object.values(row.metrics).some(value => value !== null && value !== 0)
      )
        continue;
      if (!/^[A-Z0-9]{10}$/u.test(row.asin))
        saihuReportFail("PREVIOUS_FINANCIAL_IDENTITY_UNVERIFIED");
      if (!keys.has(JSON.stringify([scope, row.asin])))
        saihuReportFail("MISSING_PREVIOUS_NONZERO_IDENTITY");
    }
}
async function boundPublication(
  tx: DbExecutor,
  rawPrepared: MonthlyFinancialApiPrepared
) {
  const prepared = MonthlyFinancialApiPreparedSchema.parse(rawPrepared),
    proof = await readSaihuReportPublication(
      tx,
      prepared.identity,
      prepared.operationId
    );
  if (
    prepared.sourceRunId !== proof.run.id ||
    prepared.runId !== proof.run.runId ||
    prepared.sourceArtifactId !==
      saihuReportArtifactId(
        prepared.identity,
        prepared.operationId,
        "source"
      ) ||
    prepared.connectionVersion !== proof.run.input.connectionVersion ||
    prepared.contractHash !== proof.preview.contractHash ||
    prepared.sourceHash !== proof.preview.sourceHash ||
    !["running", "preview"].includes(proof.run.output.state)
  )
    return saihuReportFail("MONTH_SOURCE_REPLAY_MISMATCH");
  return { prepared, proof };
}
export async function verifySaihuMonthlyArtifact(
  tx: DbExecutor,
  rawPrepared: MonthlyFinancialApiPrepared,
  rawManifest: MonthlyFinancialApiManifest,
  payload: unknown,
  purpose: "prepare" | "confirm" | "revoke" = "confirm",
  configuration = saihuReportConfiguration
) {
  const { prepared, proof } = await boundPublication(tx, rawPrepared),
    manifest = MonthlyFinancialApiManifestSchema.parse(rawManifest),
    expected = saihuMonthlyPayload(proof.preview);
  if (
    manifest.sourceHash !== prepared.sourceHash ||
    manifest.sourceRunId !== prepared.sourceRunId ||
    manifest.contractHash !== prepared.contractHash ||
    manifest.payloadHash !== saihuReportHash(expected) ||
    manifest.payloadHash !== saihuReportHash(payload) ||
    manifest.counts.normalizedRows !== expected.length ||
    saihuReportHash(manifest.coverage) !==
      saihuReportHash(proof.preview.coverage) ||
    manifest.blockingReasons.length
  )
    return saihuReportFail("MONTH_SOURCE_REPLAY_MISMATCH");
  if (purpose === "confirm" || purpose === "revoke") {
    const grant = publications.get(tx);
    if (
      !grant ||
      grant.runId !== prepared.runId ||
      grant.sourceHash !== prepared.sourceHash ||
      grant.action !== purpose
    )
      return saihuReportFail("USE_CONTROLLED_SAIHU_REPORT_LANE");
  }
  if (purpose === "confirm") {
    const current = await configuration(
      tx,
      prepared.identity.workspaceId,
      "monthly"
    );
    if (
      current.connectionVersion !== prepared.connectionVersion ||
      current.contractHash !== prepared.contractHash
    )
      return saihuReportFail("CONFIGURATION_CHANGED");
  }
}
