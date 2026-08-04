import { TRPCError, CheckpointRow, rawExecute, stringifyJson, checkpointPayload } from "./runtimeCore";
async function addEvent(runId: string, agentSlug: string, nodeId: string | null, eventType: string, message: string, payload?: unknown) {
  await rawExecute(
    `INSERT INTO emperor_agent_events (workspaceId,runId,agentSlug,nodeId,eventType,message,payload)
     SELECT workspaceId,?,?,?,?,?,?
     FROM emperor_agent_runs
     WHERE runId=?
     LIMIT 1`,
    [runId, agentSlug, nodeId, eventType, message, payload === undefined ? null : stringifyJson(payload), runId],
  );
}

async function getCheckpoints(runId: string): Promise<CheckpointRow[]> {
  const rows = await rawExecute("SELECT * FROM emperor_agent_checkpoints WHERE runId=? ORDER BY id ASC", [runId]);
  return rows.map(checkpointPayload);
}

async function getCheckpoint(runId: string, nodeId: string): Promise<CheckpointRow> {
  const rows = await rawExecute("SELECT * FROM emperor_agent_checkpoints WHERE runId=? AND nodeId=? LIMIT 1", [runId, nodeId]);
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Checkpoint not found" });
  return checkpointPayload(rows[0]);
}

export { addEvent, getCheckpoints, getCheckpoint };
