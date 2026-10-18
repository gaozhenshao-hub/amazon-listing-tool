import mysql from "mysql2/promise";
import { SaihuReportError } from "./saihuReportContract";
import { saihuReportRows, type SaihuReportExecutor } from "./saihuReportStore";

/** Same lock domain as the original Sellfox executor. This is a dedicated
 * connection/session lock, never a transaction held across an HTTP request. */
export const SAIHU_REPORT_EXECUTION_LOCK = "saihu_sync_executor_v1";
export interface SaihuReportLockConnection {
  query(
    options: { sql: string; timeout: number },
    values: unknown[]
  ): Promise<unknown>;
  destroy(): void;
  end(): Promise<void>;
  on?(event: string, listener: () => void): unknown;
  removeListener?(event: string, listener: () => void): unknown;
}
export type SaihuReportExecutionLease = {
  signal: AbortSignal;
  assertOwned(): Promise<void>;
  assertDatabase(tx: SaihuReportExecutor): Promise<void>;
  release(): Promise<void>;
};

export function createSaihuReportExecutionLock(
  dependencies: {
    connect?: () => Promise<SaihuReportLockConnection>;
    queryTimeoutMs?: number;
    heartbeatMs?: number;
  } = {}
) {
  const timeout = dependencies.queryTimeoutMs ?? 5000;
  if (
    !Number.isInteger(timeout) ||
    timeout < 1 ||
    timeout > 60000 ||
    (dependencies.heartbeatMs !== undefined &&
      (!Number.isInteger(dependencies.heartbeatMs) ||
        dependencies.heartbeatMs < 1 ||
        dependencies.heartbeatMs > 60000))
  )
    throw new SaihuReportError("EXECUTION_LOCK_UNAVAILABLE");
  const connect =
    dependencies.connect ??
    (async () => {
      if (!process.env.DATABASE_URL)
        throw new SaihuReportError("EXECUTION_LOCK_UNAVAILABLE");
      return mysql.createConnection({
        uri: process.env.DATABASE_URL,
        connectTimeout: timeout,
      });
    });
  return async function acquire(): Promise<SaihuReportExecutionLease | null> {
    const abort = new AbortController();
    let connection: SaihuReportLockConnection | null = null;
    let owned = false,
      released = false,
      connectFinished = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let pending = Promise.resolve();
    const lost = () => {
      owned = false;
      abort.abort();
      connection?.destroy();
    };
    async function bounded<T>(operation: Promise<T>) {
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          operation,
          new Promise<never>((_resolve, reject) => {
            deadline = setTimeout(() => {
              lost();
              reject(new SaihuReportError("EXECUTION_LOCK_UNAVAILABLE"));
            }, timeout);
          }),
        ]);
      } finally {
        if (deadline) clearTimeout(deadline);
      }
    }
    async function query(sql: string) {
      const result = await bounded(
        connection!.query({ sql, timeout }, [SAIHU_REPORT_EXECUTION_LOCK])
      );
      if (
        !Array.isArray(result) ||
        !Array.isArray(result[0]) ||
        result[0].length !== 1
      )
        throw new SaihuReportError("EXECUTION_LOCK_UNAVAILABLE");
      return result[0][0] as Record<string, unknown>;
    }
    let connectionId: number;
    let serverUuid: string, databaseName: string;
    async function assertOwned() {
      if (!owned || released || abort.signal.aborted)
        throw new SaihuReportError("EXECUTION_LOCK_LOST");
      try {
        const row = await query(
          "SELECT IS_USED_LOCK(?) AS owner,CONNECTION_ID() AS connectionId,@@server_uuid AS serverUuid,DATABASE() AS databaseName"
        );
        if (
          row.connectionId !== connectionId ||
          row.owner !== connectionId ||
          row.serverUuid !== serverUuid ||
          row.databaseName !== databaseName
        )
          throw new SaihuReportError("EXECUTION_LOCK_LOST");
      } catch {
        lost();
        throw new SaihuReportError("EXECUTION_LOCK_LOST");
      }
    }
    async function assertDatabase(tx: SaihuReportExecutor) {
      await assertOwned();
      const rows = await saihuReportRows(
        tx,
        "SELECT @@server_uuid AS serverUuid,DATABASE() AS databaseName",
        [],
        1
      );
      if (
        rows.length !== 1 ||
        rows[0].serverUuid !== serverUuid ||
        rows[0].databaseName !== databaseName
      ) {
        lost();
        throw new SaihuReportError("EXECUTION_DATABASE_MISMATCH");
      }
    }
    async function release() {
      if (released) return;
      if (timer) clearInterval(timer);
      timer = null;
      await pending;
      try {
        // Never release another session's lock, including after reconnection.
        if (owned && !abort.signal.aborted) {
          await assertOwned();
          const result = await query("SELECT RELEASE_LOCK(?) AS released");
          if (result.released !== 1) lost();
        }
      } catch {
        lost();
      } finally {
        released = true;
        owned = false;
        if (connection) {
          connection.removeListener?.("error", lost);
          connection.removeListener?.("end", lost);
          try {
            await bounded(connection.end());
          } catch {
            connection.destroy();
          }
        }
      }
    }
    try {
      const connected = await bounded(
        connect().then(value => {
          // A timed-out TCP handshake may still resolve later. It must not leave
          // a session behind or ever issue GET_LOCK after the caller has ended.
          if (connectFinished || abort.signal.aborted) value.destroy();
          return value;
        })
      );
      connection = connected;
      connectFinished = true;
      connected.on?.("error", lost);
      connected.on?.("end", lost);
      const row = await query(
        "SELECT GET_LOCK(?,0) AS acquired,CONNECTION_ID() AS connectionId,@@server_uuid AS serverUuid,DATABASE() AS databaseName"
      );
      if (row.acquired === 0) {
        await release();
        return null;
      }
      if (
        row.acquired !== 1 ||
        typeof row.connectionId !== "number" ||
        !Number.isSafeInteger(row.connectionId) ||
        row.connectionId < 1 ||
        typeof row.serverUuid !== "string" ||
        !/^[a-f0-9-]{36}$/iu.test(row.serverUuid) ||
        typeof row.databaseName !== "string" ||
        !/^[A-Za-z0-9_$-]{1,64}$/u.test(row.databaseName)
      )
        throw new SaihuReportError("EXECUTION_LOCK_UNAVAILABLE");
      connectionId = row.connectionId;
      serverUuid = row.serverUuid;
      databaseName = row.databaseName;
      owned = true;
      await assertOwned();
      timer = setInterval(() => {
        pending = pending
          .then(() => assertOwned())
          .catch(() => {
            lost();
          });
      }, dependencies.heartbeatMs ?? 5000);
      timer.unref?.();
      return { signal: abort.signal, assertOwned, assertDatabase, release };
    } catch {
      connectFinished = true;
      lost();
      await release();
      throw new SaihuReportError("EXECUTION_LOCK_UNAVAILABLE");
    }
  };
}

export const acquireSaihuReportExecutionLock = createSaihuReportExecutionLock();
