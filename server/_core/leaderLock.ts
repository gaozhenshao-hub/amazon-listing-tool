import mysql, { type Connection } from "mysql2/promise";

export type LeaderLockAcquireResult = {
  acquired: boolean;
  lockName: string;
  ownerId: string;
};

export type MysqlLeaderLockOptions = {
  onConnectionLost?: (error: unknown) => void;
};

export class MysqlLeaderLock {
  private connection: Connection | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly lockName: string,
    private readonly ownerId: string,
    private readonly databaseUrl = process.env.DATABASE_URL || "",
    private readonly options: MysqlLeaderLockOptions = {}
  ) {}

  private stopHeartbeat() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private handleHeartbeatFailure(connection: Connection, error: unknown) {
    if (this.connection !== connection) return;
    this.stopHeartbeat();
    this.connection = null;
    console.error(
      `[LeaderLock] Lost scheduler lock heartbeat for ${this.lockName}:`,
      error
    );
    this.options.onConnectionLost?.(error);
  }

  async acquire(timeoutSeconds = 0): Promise<LeaderLockAcquireResult> {
    if (!this.databaseUrl) {
      throw new Error(
        "DATABASE_URL is required to acquire scheduler leader lock."
      );
    }
    if (!this.connection) {
      this.connection = await mysql.createConnection(this.databaseUrl);
    }

    const [rows] = await this.connection.query<any[]>(
      "SELECT GET_LOCK(?, ?) AS acquired",
      [this.lockName, timeoutSeconds]
    );
    const acquired = Number(rows?.[0]?.acquired || 0) === 1;
    if (acquired && !this.heartbeat) {
      this.heartbeat = setInterval(() => {
        const connection = this.connection;
        if (!connection) return;
        void connection.ping().catch(error => this.handleHeartbeatFailure(connection, error));
      }, 30_000);
    }
    return { acquired, lockName: this.lockName, ownerId: this.ownerId };
  }

  async release() {
    this.stopHeartbeat();
    const connection = this.connection;
    this.connection = null;
    if (!connection) return;
    try {
      await connection.query("SELECT RELEASE_LOCK(?)", [this.lockName]);
    } catch (error) {
      console.warn(
        `[LeaderLock] Could not release scheduler lock ${this.lockName}; connection was already unavailable.`,
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      await connection.end().catch(error => {
        console.warn(
          `[LeaderLock] Could not close scheduler lock connection ${this.lockName}; it was already unavailable.`,
          error instanceof Error ? error.message : String(error)
        );
      });
    }
  }
}

export function createSchedulerLeaderLock(options?: MysqlLeaderLockOptions) {
  const lockName =
    process.env.SCHEDULER_LEADER_LOCK_NAME || "amazon-listing-tool:scheduler";
  const ownerId = `${process.env.HOSTNAME || "local"}:${process.pid}`;
  return new MysqlLeaderLock(lockName, ownerId, undefined, options);
}
