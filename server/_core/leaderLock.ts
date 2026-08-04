import mysql, { type Connection } from "mysql2/promise";

export type LeaderLockAcquireResult = {
  acquired: boolean;
  lockName: string;
  ownerId: string;
};

export class MysqlLeaderLock {
  private connection: Connection | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly lockName: string,
    private readonly ownerId: string,
    private readonly databaseUrl = process.env.DATABASE_URL || ""
  ) {}

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
        void this.connection?.ping().catch(error => {
          console.error(
            `[LeaderLock] Lost scheduler lock heartbeat for ${this.lockName}:`,
            error
          );
        });
      }, 30_000);
    }
    return { acquired, lockName: this.lockName, ownerId: this.ownerId };
  }

  async release() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (!this.connection) return;
    try {
      await this.connection.query("SELECT RELEASE_LOCK(?)", [this.lockName]);
    } finally {
      await this.connection.end();
      this.connection = null;
    }
  }
}

export function createSchedulerLeaderLock() {
  const lockName =
    process.env.SCHEDULER_LEADER_LOCK_NAME || "amazon-listing-tool:scheduler";
  const ownerId = `${process.env.HOSTNAME || "local"}:${process.pid}`;
  return new MysqlLeaderLock(lockName, ownerId);
}
