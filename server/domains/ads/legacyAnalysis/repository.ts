import { databaseUnavailableError } from "../../../_core/domainError";
import { getDb } from "../../../repositories/dbClient";

export async function requireAdsDb() {
  const db = await getDb();
  if (!db) throw databaseUnavailableError("ads");
  return db;
}
