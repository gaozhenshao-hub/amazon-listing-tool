import { describe, expect, it } from "vitest";
import {
  createSaihuReportTestFixture,
  fixtureUuid,
  syntheticSaihuRead,
  syntheticSaihuRow,
} from "./saihuReportTestFixture";
import { collectSaihuReport } from "./saihuReportCoverage";
import { readSaihuDailyBatches } from "./saihuReportDaily";
import {
  saihuReportRunId,
  saihuReportArtifactId,
  saihuReportOperationKey,
} from "./saihuReportProtocol";
import {
  saihuReportCanonical,
  saihuReportHash,
} from "../../../shared/saihuReportSync";

/** Valid full protocol history, not metadata-only mocks: actual collection,
 * exact original bytes, source replay, original start journal and per-run IDs.
 * Seeding copies the same SQL row shapes that the real first capture produced. */
async function history(count: number) {
  const f = createSaihuReportTestFixture();
  const scope = {
    kind: "daily" as const,
    start: "2025-01-01",
    end: "2025-01-01",
  };
  const initial = await f.repository.preview(f.identity, scope);
  const operationId = fixtureUuid(1);
  await f.repository.start(f.identity, {
    expectedWorkspaceId: 7,
    operationId,
    scope,
    expectedHistoryHash: initial.historyHash,
    expectedConfigurationHash: initial.configurationHash!,
  });
  const lease = await f.repository.claim(f.identity, {
    expectedWorkspaceId: 7,
    operationId,
  });
  const frozen = await f.repository.dispatch(lease!);
  const capture = async (id: string, period: string) =>
    collectSaihuReport(
      {
        version: 1,
        identity: f.identity,
        operationId: id,
        scope: { kind: "daily", start: period, end: period },
        connectionVersion: frozen.connectionVersion,
        contractHash: frozen.contractHash,
        shops: frozen.contract.shops,
      },
      frozen.contract,
      async day => syntheticSaihuRead([syntheticSaihuRow(day)]),
      new AbortController().signal
    );
  await f.repository.finish(
    lease!,
    (await capture(operationId, scope.start)).source
  );
  const job = structuredClone(f.state.jobs[0]),
    batch = structuredClone(f.state.daily[0]);
  const artifacts = structuredClone(f.state.artifacts),
    journal = structuredClone(f.state.audits[0]);
  for (let index = 1; index < count; index++) {
    const id = fixtureUuid(index + 1),
      period = new Date(Date.parse(scope.start) + index * 86400000)
        .toISOString()
        .slice(0, 10);
    const { source, preview } = await capture(id, period);
    const request = { ...frozen.request, operationId: id, scope: source.scope };
    const input = {
      ...frozen,
      operationId: id,
      request,
      requestHash: saihuReportHash({ identity: f.identity, request }),
    };
    const runId = saihuReportRunId(f.identity, id),
      jobId = index + 1,
      batchId = 100 + index;
    const output = {
      ...JSON.parse(String(job.output)),
      batchId,
      sourceHash: preview.sourceHash,
      previewHash: preview.previewHash,
    };
    f.state.jobs.push({
      ...job,
      id: jobId,
      runId,
      input: saihuReportCanonical(input),
      output: saihuReportCanonical(output),
    });
    f.state.daily.push({
      ...batch,
      id: batchId,
      operationId: id,
      runId,
      scope: saihuReportCanonical(source.scope),
      sourceHash: preview.sourceHash,
      previewHash: preview.previewHash,
      coverage: saihuReportCanonical(preview.coverage),
      facts: saihuReportCanonical(preview.dailyRows),
    });
    for (const [kind, value] of [
      ["source", source],
      ["preview", preview],
    ] as const) {
      const base = artifacts.find(a =>
        String(a.artifactId).startsWith(
          kind === "source" ? "saihus_" : "saihup_"
        )
      )!;
      f.state.artifacts.push({
        ...base,
        artifactId: saihuReportArtifactId(f.identity, id, kind),
        sourceRowId: String(jobId),
        runId,
        contentJson: saihuReportCanonical(value),
        contentHash: saihuReportHash(value),
      });
    }
    const receipt = {
      ...JSON.parse(String(journal.metadata)),
      operationId: id,
      runOperationId: id,
      requestHash: input.requestHash,
      resultHash: saihuReportHash(input),
    };
    f.state.audits.push({
      ...journal,
      auditId: `saihu_operation_${saihuReportOperationKey(f.identity, id)}`,
      resourceId: id,
      metadata: saihuReportCanonical(receipt),
    });
  }
  return { f, scope };
}
describe("complete Saihu history windows, not a lifetime scan ceiling", () => {
  it("205 valid archived captures are fully enumerated while a one-day window loads only its original body", async () => {
    const { f, scope } = await history(205);
    f.calls.length = 0;
    const batches = await f.repository.server.withTransaction(
      f.identity,
      "read",
      current => readSaihuDailyBatches(current.tx, 7, scope)
    );
    expect(batches).toHaveLength(1);
    expect(batches[0].id).toBe(100);
    expect(
      f.calls.filter(
        q =>
          q.sql.includes("FROM ops_saihu_daily_report_batches") &&
          q.sql.includes("LIMIT 128")
      )
    ).toHaveLength(2);
    expect(
      f.calls.filter(q =>
        q.sql.includes("AS facts FROM ops_saihu_daily_report_batches")
      )
    ).toHaveLength(1);
    const all = await f.repository.server.withTransaction(
      f.identity,
      "read",
      current => readSaihuDailyBatches(current.tx, 7)
    );
    expect(all).toHaveLength(205);
    expect(new Set(all.map(batch => batch.id)).size).toBe(205);
  }, 20000);
  it("a mutated scope hint cannot move an old source outside the complete window scan", async () => {
    const { f, scope } = await history(2);
    f.state.daily[0].scope = JSON.stringify({
      kind: "daily",
      start: "2020-01-01",
      end: "2020-01-01",
    });
    await expect(f.repository.preview(f.identity, scope)).rejects.toThrow(
      "DAILY_REPLAY_MISMATCH"
    );
  });
  it("original frozen input must still match its durable start receipt even for an out-of-window source", async () => {
    const { f, scope } = await history(2);
    const input = JSON.parse(String(f.state.jobs[1].input));
    input.request.expectedHistoryHash = "f".repeat(64);
    input.requestHash = saihuReportHash({
      identity: f.identity,
      request: input.request,
    });
    f.state.jobs[1].input = JSON.stringify(input);
    await expect(f.repository.preview(f.identity, scope)).rejects.toThrow(
      "START_RECEIPT_INVALID"
    );
  });
});
