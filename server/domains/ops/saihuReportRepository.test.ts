import { describe, expect, it } from "vitest";
import { collectSaihuReport } from "./saihuReportCoverage";
import {
  createSaihuReportTestFixture,
  fixtureUuid,
  syntheticSaihuRead,
  syntheticSaihuRow,
} from "./saihuReportTestFixture";
import { readSaihuReportPublication } from "./saihuReportProtocol";
import {
  saihuReportHash,
  type SaihuReportScope,
} from "../../../shared/saihuReportSync";
import { monthlyFinancialBatchVersion } from "../../../shared/monthlyFinancialWrite";
import type { TrpcContext } from "../../_core/context";

async function captured(
  f: ReturnType<typeof createSaihuReportTestFixture>,
  n = 1,
  scope: SaihuReportScope = f.scope,
  rowPatch: Record<string, unknown> = {}
) {
  const operationId = fixtureUuid(n),
    options = await f.repository.preview(f.identity, scope),
    input = {
      expectedWorkspaceId: 7,
      operationId,
      scope,
      expectedConfigurationHash: options.configurationHash!,
      expectedHistoryHash: options.historyHash,
    };
  await f.repository.start(f.identity, input);
  const lease = await f.repository.claim(f.identity, {
    expectedWorkspaceId: 7,
    operationId,
  });
  expect(lease).not.toBeNull();
  const frozen = await f.repository.dispatch(lease!);
  const result = await collectSaihuReport(
    {
      version: 1,
      identity: f.identity,
      operationId,
      scope,
      connectionVersion: frozen.connectionVersion,
      contractHash: frozen.contractHash,
      shops: frozen.contract.shops,
    },
    frozen.contract,
    async period =>
      syntheticSaihuRead([syntheticSaihuRow(period, scope.kind, rowPatch)]),
    new AbortController().signal
  );
  await f.repository.finish(lease!, result.source);
  return {
    operationId,
    input,
    source: result.source,
    lease: lease!,
    view: await f.repository.inspect(f.identity, {
      expectedWorkspaceId: 7,
      operationId,
    }),
  };
}
async function transitionInput(
  f: ReturnType<typeof createSaihuReportTestFixture>,
  runOperationId: string,
  n: number
) {
  const view = await f.repository.inspect(f.identity, {
    expectedWorkspaceId: 7,
    operationId: runOperationId,
  });
  return {
    expectedWorkspaceId: 7,
    operationId: fixtureUuid(n),
    runOperationId,
    expectedPreviewHash: view.run.previewHash!,
    expectedHistoryHash: view.historyHash,
    fullScopeAcknowledged: true as const,
  };
}

describe("Saihu manual controlled capture → durable preview → explicit apply (real SQL protocol fixture)", () => {
  it("admits actual table shapes, freezes one UUID and saves complete original bytes without applying", async () => {
    const f = createSaihuReportTestFixture(),
      run = await captured(f);
    expect(f.state.jobs).toHaveLength(1);
    expect(f.state.artifacts).toHaveLength(2);
    expect(f.state.daily[0].status).toBe("previewing");
    expect(f.state.monthly).toHaveLength(0);
    expect(run.view.rows).toHaveLength(1);
    expect(run.view.canApply).toBe(true);
    expect(f.state.artifacts[0].contentJson).toContain("originalUtf8");
    expect(await f.repository.start(f.identity, run.input)).toMatchObject({
      status: "committed",
    });
    expect(f.state.jobs).toHaveLength(1);
    expect(
      f.calls.some(call => call.sql.includes("information_schema.COLUMNS"))
    ).toBe(true);
    expect(
      f.calls.every(call => !/^(?:CREATE|ALTER|DROP) /u.test(call.sql))
    ).toBe(true);
  });
  it("applies zero corrections append-only and revoke restores the prior complete version", async () => {
    const f = createSaihuReportTestFixture(),
      first = await captured(f);
    await f.repository.apply(
      f.identity,
      await transitionInput(f, first.operationId, 2)
    );
    const zeroMetrics = {
        ...syntheticSaihuRow().metrics,
        salesQty: 0,
        orderQty: 0,
        salesAmount: 0,
        grossProfit: 0,
      },
      second = await captured(f, 3, f.scope, { metrics: zeroMetrics });
    await f.repository.apply(
      f.identity,
      await transitionInput(f, second.operationId, 4)
    );
    let current = await f.repository.dailyOverview(f.identity);
    expect(
      (current.products[0].weeks as Array<Record<string, unknown>>)[0].salesQty
    ).toBe(0);
    expect(f.state.daily).toHaveLength(2);
    expect(f.state.daily.every(row => row.status === "completed")).toBe(true);
    await f.repository.revoke(
      f.identity,
      await transitionInput(f, second.operationId, 5)
    );
    current = await f.repository.dailyOverview(f.identity);
    expect(
      (current.products[0].weeks as Array<Record<string, unknown>>)[0].salesQty
    ).toBe(2);
    expect(f.state.daily.map(row => row.status)).toEqual([
      "completed",
      "revoked",
    ]);
    expect(f.calls.every(call => !call.sql.startsWith("DELETE "))).toBe(true);
  });
  it("commits API monthly previews via the existing transactional monthly kernel and archive participant", async () => {
    const f = createSaihuReportTestFixture(),
      scope: SaihuReportScope = {
        kind: "monthly",
        start: "2026-09",
        end: "2026-09",
      },
      run = await captured(f, 1, scope);
    expect(f.state.monthly[0]).toMatchObject({
      status: "previewing",
      fileReferenceKind: "saihu_sync_run",
      skippedRows: 0,
    });
    expect(f.state.monthly[0].fileName).toMatch(/\.json$/u);
    expect(JSON.parse(f.state.monthlyArtifacts[0].prepared).kind).toBe(
      "saihu_api_v1"
    );
    expect(JSON.parse(f.state.monthlyArtifacts[0].manifest).format).toBe(
      "saihu_api_json"
    );
    await f.repository.apply(
      f.identity,
      await transitionInput(f, run.operationId, 2)
    );
    expect(f.state.monthly[0].status).toBe("completed");
    expect(f.state.board).toEqual([
      { action: "confirm", batchId: 200, completedIds: [200] },
    ]);
    await f.repository.revoke(
      f.identity,
      await transitionInput(f, run.operationId, 3)
    );
    expect(f.state.monthly[0].status).toBe("deleted");
    expect(f.state.board[1]).toEqual({
      action: "revoke",
      batchId: 200,
      completedIds: [],
    });
    expect(f.state.artifacts).toHaveLength(2);
  });
  it("ordinary monthly file confirmation cannot bypass the dedicated capture cancel/apply fence", async () => {
    const f = createSaihuReportTestFixture(),
      run = await captured(f, 1, {
        kind: "monthly",
        start: "2026-09",
        end: "2026-09",
      });
    const ctx = {
      user: { id: 3, role: "super_admin", defaultWorkspaceId: 7 },
      workspaceId: 7,
    } as TrpcContext;
    const state = await f.transaction(async tx =>
      f.monthly.server.inspectInTransaction(
        {
          tx,
          identity: f.identity,
          role: "super_admin",
          actor: { id: 3, role: "super_admin", defaultWorkspaceId: 7 },
        },
        run.view.run.batchId!
      )
    );
    await expect(
      f.monthly.confirm(ctx, {
        expectedWorkspaceId: 7,
        operationId: fixtureUuid(2),
        batchId: state.record.id,
        expectedBatchVersion: monthlyFinancialBatchVersion(
          state.record,
          state.artifact
        ),
        expectedImpactKey: state.impact.key,
        fullScopeAcknowledged: true,
      })
    ).resolves.toMatchObject({ status: "unknown" });
    expect(f.state.monthly[0].status).toBe("previewing");
    expect(f.state.board).toHaveLength(0);
  });
  it("lost dispatch ACK never grants HTTP dispatch or permits a new scope UUID", async () => {
    const f = createSaihuReportTestFixture(),
      options = await f.repository.preview(f.identity, f.scope),
      operationId = fixtureUuid(1);
    await f.repository.start(f.identity, {
      expectedWorkspaceId: 7,
      operationId,
      scope: f.scope,
      expectedConfigurationHash: options.configurationHash!,
      expectedHistoryHash: options.historyHash,
    });
    const lease = await f.repository.claim(f.identity, {
      expectedWorkspaceId: 7,
      operationId,
    });
    f.control.commitLost = 1;
    await expect(f.repository.dispatch(lease!)).rejects.toThrow("ACK lost");
    await expect(f.repository.dispatch(lease!)).rejects.toThrow(
      "ALREADY_DISPATCHED"
    );
    f.control.now += 121000;
    expect(
      await f.repository.claim(f.identity, {
        expectedWorkspaceId: 7,
        operationId,
      })
    ).toBeNull();
    expect(
      (
        await f.repository.check(f.identity, {
          expectedWorkspaceId: 7,
          operationId,
        })
      ).run?.state
    ).toBe("unknown");
    await expect(
      f.repository.start(f.identity, {
        expectedWorkspaceId: 7,
        operationId: fixtureUuid(2),
        scope: f.scope,
        expectedConfigurationHash: options.configurationHash!,
        expectedHistoryHash: options.historyHash,
      })
    ).rejects.toThrow("RESOLVE_PENDING_SCOPE_FIRST");
    await f.repository.cancel(f.identity, {
      expectedWorkspaceId: 7,
      operationId,
    });
    expect(
      (
        await f.repository.check(f.identity, {
          expectedWorkspaceId: 7,
          operationId,
        })
      ).receipt?.status
    ).toBe("cancelled");
  });
  it("lost apply commit is recovered using the original UUID without a second transition", async () => {
    const f = createSaihuReportTestFixture(),
      run = await captured(f),
      input = await transitionInput(f, run.operationId, 2);
    f.control.commitLost = 1;
    await expect(f.repository.apply(f.identity, input)).rejects.toThrow(
      "ACK lost"
    );
    expect(f.state.daily[0].status).toBe("completed");
    f.control.enabled = false;
    const recovery = {
      expectedWorkspaceId: 7,
      operationId: input.operationId,
      runOperationId: input.runOperationId,
    };
    const receipt = await f.repository.applyCheck(f.identity, recovery);
    expect(receipt).toMatchObject({
      status: "committed",
      operationId: input.operationId,
    });
    expect(await f.repository.applyCancel(f.identity, recovery)).toEqual(
      receipt
    );
    const writes = f.calls.filter(call =>
      call.sql.startsWith("UPDATE ops_saihu_daily_report_batches")
    ).length;
    f.control.enabled = true;
    expect(await f.repository.apply(f.identity, input)).toEqual(receipt);
    expect(
      f.calls.filter(call =>
        call.sql.startsWith("UPDATE ops_saihu_daily_report_batches")
      )
    ).toHaveLength(writes);
  });
  it("late finish and original start replay cannot cross a durable cancellation fence", async () => {
    const f = createSaihuReportTestFixture(),
      run = await captured(f);
    f.control.enabled = false;
    const cancelled = await f.repository.cancel(f.identity, {
      expectedWorkspaceId: 7,
      operationId: run.operationId,
    });
    expect(cancelled).toMatchObject({ status: "cancelled" });
    f.control.enabled = true;
    expect(await f.repository.start(f.identity, run.input)).toMatchObject({
      status: "cancelled",
    });
    await expect(f.repository.finish(run.lease, run.source)).rejects.toThrow(
      "LEASE_OR_CANCEL_CHANGED"
    );
    expect(f.state.daily[0].status).toBe("previewing");
  });
  it("apply cancellation before a delayed request fences the same UUID after gate rollback", async () => {
    const f = createSaihuReportTestFixture(),
      run = await captured(f),
      input = await transitionInput(f, run.operationId, 2);
    f.control.enabled = false;
    await f.repository.applyCancel(f.identity, {
      expectedWorkspaceId: 7,
      operationId: input.operationId,
      runOperationId: input.runOperationId,
    });
    f.control.enabled = true;
    expect(await f.repository.apply(f.identity, input)).toMatchObject({
      status: "cancelled",
    });
    expect(f.state.daily[0].status).toBe("previewing");
  });
  it("workspace/actor/member/config/history/source tampering fails closed with no old-success mutation", async () => {
    const f = createSaihuReportTestFixture(),
      run = await captured(f),
      input = await transitionInput(f, run.operationId, 2);
    await expect(
      f.repository.check(f.identity, {
        expectedWorkspaceId: 8,
        operationId: run.operationId,
      })
    ).rejects.toThrow("WORKSPACE_CHANGED");
    f.control.memberActive = false;
    await expect(f.repository.apply(f.identity, input)).rejects.toThrow(
      "ACCESS_DENIED"
    );
    f.control.memberActive = true;
    f.control.connectionVersion = "b".repeat(64);
    await expect(f.repository.apply(f.identity, input)).rejects.toThrow(
      "CONFIGURATION_CHANGED"
    );
    f.control.connectionVersion = "a".repeat(64);
    f.state.legacy.push({ id: 91, workspaceId: 7, userId: 3 });
    await expect(f.repository.apply(f.identity, input)).rejects.toThrow(
      "HISTORY_CHANGED"
    );
    f.state.legacy = [];
    const artifact = f.state.artifacts[0],
      changed = JSON.parse(artifact.contentJson);
    changed.pages[0].body.data.rows[0].period = "2026-09-30";
    artifact.contentJson = JSON.stringify(changed);
    artifact.contentHash = saihuReportHash(changed);
    await expect(
      f.transaction(tx =>
        readSaihuReportPublication(tx, f.identity, run.operationId)
      )
    ).rejects.toThrow("SOURCE_BYTES_INVALID");
    expect(f.state.daily[0].status).toBe("previewing");
  });
  it("monthly archive failure rolls back status, run flags and both final receipts", async () => {
    const f = createSaihuReportTestFixture(),
      run = await captured(f, 1, {
        kind: "monthly",
        start: "2026-09",
        end: "2026-09",
      }),
      input = await transitionInput(f, run.operationId, 2);
    f.control.failBoard = true;
    await expect(f.repository.apply(f.identity, input)).rejects.toThrow(
      "board failure"
    );
    expect(f.state.monthly[0].status).toBe("previewing");
    expect(f.state.board).toHaveLength(0);
    expect(
      (
        await f.repository.check(f.identity, {
          expectedWorkspaceId: 7,
          operationId: run.operationId,
        })
      ).run?.applied
    ).toBe(false);
    expect(
      await f.repository.applyCheck(f.identity, {
        expectedWorkspaceId: 7,
        operationId: input.operationId,
        runOperationId: input.runOperationId,
      })
    ).toMatchObject({
      status: "unknown",
    });
  });
  it("prepares no real vendor request without both write gate and approved source config", async () => {
    const f = createSaihuReportTestFixture();
    f.control.enabled = false;
    const options = await f.repository.preview(f.identity, f.scope);
    expect(options.capability).toEqual({
      status: "unavailable",
      reasonCode: "WRITES_NOT_ENABLED",
    });
    await expect(
      f.repository.start(f.identity, {
        expectedWorkspaceId: 7,
        operationId: fixtureUuid(1),
        scope: f.scope,
        expectedConfigurationHash: options.configurationHash!,
        expectedHistoryHash: options.historyHash,
      })
    ).rejects.toThrow("WRITES_NOT_ENABLED");
    expect(f.state.jobs).toHaveLength(0);
    f.control.enabled = true;
    f.control.badEngine = "ai_jobs";
    await expect(f.repository.preview(f.identity, f.scope)).rejects.toThrow(
      "SCHEMA_UNAVAILABLE"
    );
  });
});
