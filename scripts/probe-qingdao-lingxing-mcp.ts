import { invokeEmperorTool } from "../server/domains/ai_os/services/toolGateway/executors";

function describe(value: unknown, depth = 0): unknown {
  if (depth > 3 || value === null || value === undefined) return value === null ? "null" : "undefined";
  if (typeof value === "string") {
    try { return describe(JSON.parse(value), depth + 1); } catch { return { type: "string", length: value.length }; }
  }
  if (Array.isArray(value)) return {
    type: "array",
    length: value.length,
    itemKeys: value[0] && typeof value[0] === "object" && !Array.isArray(value[0]) ? Object.keys(value[0] as Record<string, unknown>).sort() : [],
    firstItem: value[0] && typeof value[0] === "object" ? describe(value[0], depth + 1) : undefined,
  };
  if (typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, describe(nested, depth + 1)]));
  return typeof value;
}

async function main() {
  const execution = await invokeEmperorTool({
    toolSlug: "internal.lingxing.read",
    params: { capability: "get_my_sids", arguments: {} },
    userId: 1,
    userRole: "super_admin",
    workspaceId: 1,
    nodeId: "qingdao_lingxing_protocol_probe",
  });
  console.log(JSON.stringify({
    status: "ok",
    responseShape: describe(execution.output),
    toolRunId: execution.metadata.toolRunId,
    traceId: execution.metadata.traceId,
  }));
}

void main().then(() => process.exit(0)).catch((error) => {
  console.error(JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
