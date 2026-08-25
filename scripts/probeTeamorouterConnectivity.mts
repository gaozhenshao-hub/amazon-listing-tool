import { lookup } from "node:dns/promises";
import { sql } from "drizzle-orm";
import { getDb } from "../server/repositories/dbClient";
import { SafeHttpError, safeHttpRequest, type ResolvedAddress } from "../server/infrastructure/http/safeHttpClient";

type ProbeOutcome = {
  family: number;
  status?: number;
  latencyMs: number;
  errorReason?: string;
  causeCode?: string;
};

async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.execute(sql.raw(`
    SELECT apiKeyRef
    FROM emperor_model_providers
    WHERE modelId = 'gpt-5.6-sol' AND isActive = 1
    LIMIT 1
  `));
  const rows = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  const apiKey = (rows as Array<{ apiKeyRef?: unknown }>)[0]?.apiKeyRef;
  if (typeof apiKey !== "string" || !apiKey) throw new Error("Active gpt-5.6-sol provider credential missing");

  const addresses = await lookup("api.teamorouter.com", { all: true, verbatim: true });
  const probes = await Promise.all(addresses.map(async (address): Promise<ProbeOutcome> => {
    const startedAt = Date.now();
    try {
      const response = await safeHttpRequest("https://api.teamorouter.com/v1/models", {
        headers: { authorization: `Bearer ${apiKey}` },
        timeoutMs: 12_000,
        maxResponseBytes: 2 * 1024 * 1024,
        allowedHosts: ["api.teamorouter.com"],
        resolver: async () => [{ address: address.address, family: address.family as 4 | 6 }] satisfies ResolvedAddress[],
        auditContext: { operation: "ai_os.gpt56.network_diagnostic" },
      });
      return { family: address.family, status: response.status, latencyMs: Date.now() - startedAt };
    } catch (error) {
      const safeError = error instanceof SafeHttpError ? error : null;
      const cause = safeError?.cause as { code?: unknown } | undefined;
      return {
        family: address.family,
        latencyMs: Date.now() - startedAt,
        errorReason: safeError?.reason || "unknown",
        causeCode: typeof cause?.code === "string" ? cause.code : undefined,
      };
    }
  }));

  console.log(JSON.stringify({ addressFamilies: addresses.map((address) => address.family), probes }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Teamorouter connectivity probe failed");
  process.exitCode = 1;
});
