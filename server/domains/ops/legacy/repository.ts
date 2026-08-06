import { databaseUnavailableError } from "../../../_core/domainError";
import { getDb } from "../../../repositories/dbClient";

export async function requireOpsDb() {
  const db = await getDb();
  if (!db) throw databaseUnavailableError("ops");
  return db;
}
