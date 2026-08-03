import { drizzle } from "drizzle-orm/mysql2";

export type AppDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type DbExecutor = AppDb | any;

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function requireDb(context = "Database") {
  const db = await getDb();
  if (!db) throw new Error(`${context}: database not available`);
  return db;
}

export async function withDbTransaction<T>(
  context: string,
  callback: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  const db = await requireDb(context);
  const transactional = db as any;
  if (typeof transactional.transaction === "function") {
    return transactional.transaction((tx: DbExecutor) => callback(tx));
  }
  return callback(db);
}
