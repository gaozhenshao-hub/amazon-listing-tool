import { TRPCError, rawExecute } from "./runtimeCore";

export async function getRunRow(runId: string) {
  const rows = await rawExecute("SELECT * FROM emperor_agent_runs WHERE runId=? LIMIT 1", [runId]);
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Agent run not found" });
  return rows[0];
}
