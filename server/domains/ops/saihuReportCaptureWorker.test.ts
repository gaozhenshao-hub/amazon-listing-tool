import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSaihuReportCaptureExecution as createRealSaihuReportCaptureExecution,
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
import {
  createSaihuReportExecutionLock,
  type SaihuReportExecutionLease,
} from "./saihuReportExecutionLock";

const createSaihuReportCaptureExecution = (
  deps: Parameters<typeof createRealSaihuReportCaptureExecution>[0]
) =>
  createRealSaihuReportCaptureExecution({
    acquireLock: async () => ({
      signal: new AbortController().signal,
      assertOwned: async () => undefined,
      assertDatabase: async () => undefined,
      release: async () => undefined,
    }),
    ...deps,
  });
function executionLock() {
  const state = {
    owner: null as number | null,
    nextId: 1,
    latest: null as SaihuReportExecutionLease | null,
    releases: [] as number[],
  };
  const acquire = createSaihuReportExecutionLock({
    connect: async () => {
      const id = state.nextId++;
      return {
        async query(
          options: { sql: string; timeout: number },
          _values: unknown[]
        ) {
          const metadata = {
            connectionId: id,
            serverUuid: "00000000-0000-0000-0000-000000000001",
            databaseName: "synthetic",
          };
          if (options.sql.includes("GET_LOCK")) {
            if (state.owner !== null)
              return [[{ ...metadata, acquired: 0 }], []];
            state.owner = id;
            return [[{ ...metadata, acquired: 1 }], []];
          }
          if (options.sql.includes("IS_USED_LOCK"))
            return [[{ ...metadata, owner: state.owner }], []];
          if (options.sql.includes("RELEASE_LOCK")) {
            if (state.owner !== id) throw new Error("not the owned session");
            state.releases.push(id);
            state.owner = null;
            return [[{ released: 1 }], []];
          }
          throw new Error("unexpected lock SQL");
        },
        destroy() {
          if (state.owner === id) state.owner = null;
        },
        async end() {
          if (state.owner === id) state.owner = null;
        },
      };
    },
  });
  return {
    state,
    acquire: async () => {
      const lease = await acquire();
      if (lease) state.latest = lease;
      return lease;
    },
  };
}

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
  it("a competing process cannot claim or read while the same original executor lock is held", async () => {
    const first = await queued(),
      second = await queued(),
      lock = executionLock();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(done => {
        entered = done;
      }),
      blocked = new Promise<void>(done => {
        release = done;
      });
    let firstReads = 0,
      secondReads = 0;
    const transport: typeof createSaihuReportTransport =
      (_credentials, _contract, _signal, options) => async period => {
        await options?.beforeRead?.();
        firstReads++;
        entered();
        await blocked;
        return syntheticSaihuRead([syntheticSaihuRow(period)]);
      };
    const other: typeof createSaihuReportTransport =
      (_credentials, _contract, _signal, options) => async period => {
        await options?.beforeRead?.();
        secondReads++;
        return syntheticSaihuRead([syntheticSaihuRow(period)]);
      };
    const a = createSaihuReportCaptureExecution({
      repository: first.f.repository,
      enabled: () => true,
      transport,
      acquireLock: lock.acquire,
    });
    const b = createSaihuReportCaptureExecution({
      repository: second.f.repository,
      enabled: () => true,
      transport: other,
      acquireLock: lock.acquire,
    });
    const pending = a(first.input);
    await started;
    await b(second.input);
    expect(second.f.state.jobs[0].status).toBe("queued");
    expect(secondReads).toBe(0);
    release();
    await pending;
    await b(second.input);
    expect(firstReads).toBe(1);
    expect(secondReads).toBe(1);
    expect(lock.state.releases).toHaveLength(2);
  });
  it("same environment text is not proof that the actual transaction is on the lock's server", async () => {
    const { f, input } = await queued(),
      lock = executionLock(),
      transport = vi.fn<typeof createSaihuReportTransport>();
    f.control.serverUuid = "00000000-0000-0000-0000-000000000002";
    await createSaihuReportCaptureExecution({
      repository: f.repository,
      enabled: () => true,
      transport,
      acquireLock: lock.acquire,
    })(input);
    expect(f.state.jobs[0].status).toBe("queued");
    expect(transport).not.toHaveBeenCalled();
  });
  it("losing the session during an outbound read aborts it, keeps unknown recovery on the original UUID and never retries", async () => {
    const { f, input } = await queued(),
      lock = executionLock(),
      failure = vi.spyOn(f.repository, "failure");
    let started!: () => void,
      reads = 0;
    const entered = new Promise<void>(done => {
      started = done;
    });
    const transport: typeof createSaihuReportTransport =
      (_credentials, _contract, signal, options) => async () => {
        await options?.beforeRead?.();
        reads++;
        started();
        return new Promise((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new SaihuReportError("CANCELLED")),
            { once: true }
          )
        );
      };
    const process = createSaihuReportCaptureExecution({
      repository: f.repository,
      enabled: () => true,
      transport,
      acquireLock: lock.acquire,
    });
    const pending = process(input);
    await entered;
    lock.state.owner = 999;
    await expect(lock.state.latest!.assertOwned()).rejects.toThrow(
      "EXECUTION_LOCK_LOST"
    );
    await pending;
    expect(failure).not.toHaveBeenCalled();
    expect(f.state.artifacts).toHaveLength(0);
    expect(reads).toBe(1);
    lock.state.owner = null;
    f.control.now += 121000;
    await process(input);
    expect(
      (
        await f.repository.check(f.identity, {
          expectedWorkspaceId: 7,
          operationId: input.operationId,
        })
      ).run?.state
    ).toBe("unknown");
    expect(reads).toBe(1);
  });
  it("a fully received original response can be saved as a preview after lock loss, without another HTTP call or automatic apply", async () => {
    const { f, input } = await queued(),
      lock = executionLock(),
      failure = vi.spyOn(f.repository, "failure");
    let reads = 0;
    const transport: typeof createSaihuReportTransport =
      (_credentials, _contract, _signal, options) => async period => {
        await options?.beforeRead?.();
        reads++;
        const result = syntheticSaihuRead([syntheticSaihuRow(period)]);
        lock.state.owner = 999;
        await lock.state.latest!.assertOwned().catch(() => undefined);
        return result;
      };
    await createSaihuReportCaptureExecution({
      repository: f.repository,
      enabled: () => true,
      transport,
      acquireLock: lock.acquire,
    })(input);
    expect(reads).toBe(1);
    expect(failure).not.toHaveBeenCalled();
    expect(f.state.artifacts).toHaveLength(2);
    expect(f.state.daily[0].status).toBe("previewing");
    expect(JSON.parse(String(f.state.jobs[0].output)).applied).toBe(false);
    expect(lock.state.owner).toBe(999);
    expect(lock.state.releases).toHaveLength(0);
  });
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
