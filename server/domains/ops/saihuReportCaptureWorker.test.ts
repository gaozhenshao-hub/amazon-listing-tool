import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSaihuReportCaptureExecution,
  drainSaihuReportCapture,
} from "./saihuReportCaptureWorker";
import {
  createSaihuReportTestFixture,
  fixtureUuid,
  syntheticSaihuRead,
  syntheticSaihuRow,
} from "./saihuReportTestFixture";
import { SaihuReportError } from "./saihuReportContract";
import type { createSaihuReportTransport } from "./saihuReportTransport";

async function queued() {
  const f = createSaihuReportTestFixture(),
    operationId = fixtureUuid(1),
    preview = await f.repository.preview(f.identity, f.scope);
  await f.repository.start(f.identity, {
    expectedWorkspaceId: 7,
    operationId,
    scope: f.scope,
    expectedConfigurationHash: preview.configurationHash!,
    expectedHistoryHash: preview.historyHash,
  });
  // Real durable job/lease/dispatch/replay path; no real credential decrypt or HTTP.
  vi.spyOn(f.repository, "credentials").mockResolvedValue({
    workspaceId: 7,
    appId: "synthetic",
    secret: "synthetic-not-a-secret",
    connectionVersion: f.control.connectionVersion,
  });
  return {
    f,
    input: {
      identity: f.identity,
      operationId,
      signal: new AbortController().signal,
    },
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Saihu capture actual repository execution boundaries", () => {
  it("does not claim or touch a provider while worker is default off", async () => {
    const { f, input } = await queued(),
      claim = vi.spyOn(f.repository, "claim"),
      transport = vi.fn<typeof createSaihuReportTransport>();
    await createSaihuReportCaptureExecution({
      repository: f.repository,
      enabled: () => false,
      transport,
    })(input);
    expect(claim).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
  it("dispatch commit ACK loss never starts transport and cannot be automatically redispatched", async () => {
    const { f, input } = await queued(),
      dispatch = f.repository.dispatch.bind(f.repository),
      transport = vi.fn<typeof createSaihuReportTransport>();
    vi.spyOn(f.repository, "dispatch").mockImplementation(async lease => {
      f.control.commitLost = 1;
      return dispatch(lease);
    });
    const process = createSaihuReportCaptureExecution({
      repository: f.repository,
      enabled: () => true,
      transport,
    });
    await process(input);
    await process(input);
    expect(transport).not.toHaveBeenCalled();
    expect(f.state.artifacts).toHaveLength(0);
    f.control.now += 121000;
    await process(input);
    expect(transport).not.toHaveBeenCalled();
    expect(
      (
        await f.repository.check(f.identity, {
          expectedWorkspaceId: 7,
          operationId: input.operationId,
        })
      ).run?.state
    ).toBe("unknown");
  });
  it("fresh beforeRead gate stops new outbound reads, but already completed source is saved after worker shuts off", async () => {
    const { f, input } = await queued();
    let enabled = true,
      reads = 0;
    const transport: typeof createSaihuReportTransport =
      (_credentials, _contract, _signal, options) => async period => {
        await options?.beforeRead?.();
        reads++;
        enabled = false;
        return syntheticSaihuRead([syntheticSaihuRow(period)]);
      };
    await createSaihuReportCaptureExecution({
      repository: f.repository,
      enabled: () => enabled,
      transport,
    })(input);
    expect(reads).toBe(1);
    expect(f.state.artifacts).toHaveLength(2);
    expect(f.state.daily[0].status).toBe("previewing");
    const second = await queued();
    const denied: typeof createSaihuReportTransport =
      (_credentials, _contract, _signal, options) => async () => {
        enabled = false;
        await options?.beforeRead?.();
        throw new SaihuReportError("UNREACHABLE");
      };
    enabled = true;
    await createSaihuReportCaptureExecution({
      repository: second.f.repository,
      enabled: () => enabled,
      transport: denied,
    })(second.input);
    expect(second.f.state.artifacts).toHaveLength(0);
  });
  it("does not downgrade a completed preview after final commit ACK is unknown", async () => {
    const { f, input } = await queued(),
      finish = f.repository.finish.bind(f.repository),
      failure = vi.spyOn(f.repository, "failure");
    vi.spyOn(f.repository, "finish").mockImplementation(async (...args) => {
      f.control.commitLost = 1;
      return finish(...args);
    });
    const transport: typeof createSaihuReportTransport =
      (_credentials, _contract, _signal, options) => async period => {
        await options?.beforeRead?.();
        return syntheticSaihuRead([syntheticSaihuRow(period)]);
      };
    await createSaihuReportCaptureExecution({
      repository: f.repository,
      enabled: () => true,
      transport,
    })(input);
    expect(failure).not.toHaveBeenCalled();
    expect(f.state.artifacts).toHaveLength(2);
    expect(
      (
        await f.repository.check(f.identity, {
          expectedWorkspaceId: 7,
          operationId: input.operationId,
        })
      ).run?.state
    ).toBe("preview");
  });
  it("local stop leaves dispatched work unresolved until original UUID lease recovery, never a certain failure or new read", async () => {
    const { f, input } = await queued(),
      controller = new AbortController(),
      failure = vi.spyOn(f.repository, "failure");
    let reads = 0,
      markStarted!: () => void;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    const transport: typeof createSaihuReportTransport =
      (_credentials, _contract, signal, options) => async () => {
        await options?.beforeRead?.();
        reads++;
        markStarted();
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new SaihuReportError("CANCELLED")),
            { once: true }
          );
        });
      };
    const process = createSaihuReportCaptureExecution({
        repository: f.repository,
        enabled: () => true,
        transport,
      }),
      operation = { ...input, signal: controller.signal },
      pending = process(operation);
    await started;
    controller.abort();
    await pending;
    expect(failure).not.toHaveBeenCalled();
    expect(reads).toBe(1);
    await process(input);
    expect(reads).toBe(1);
    f.control.now += 121000;
    await process(input);
    expect(reads).toBe(1);
    expect(failure).not.toHaveBeenCalled();
    expect(
      (
        await f.repository.check(f.identity, {
          expectedWorkspaceId: 7,
          operationId: input.operationId,
        })
      ).run?.state
    ).toBe("unknown");
    expect(f.state.artifacts).toHaveLength(0);
  });
  it("bounds shutdown drain and does not invent completion for unresolved reads", async () => {
    vi.useFakeTimers();
    const drain = drainSaihuReportCapture(new Promise<void>(() => {}), 25);
    await vi.advanceTimersByTimeAsync(25);
    expect(await drain).toBe(false);
    expect(await drainSaihuReportCapture(Promise.resolve())).toBe(true);
  });
});
