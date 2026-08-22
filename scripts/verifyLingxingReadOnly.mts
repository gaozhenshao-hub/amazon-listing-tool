import { invokeEmperorTool } from "../server/domains/ai_os/services/toolGateway/executors";
import { normalizeMcpPayload, pickRecords } from "../server/routers/lingxingSync";

function shape(value: unknown, depth = 0): unknown {
  if (depth > 3 || value === null || value === undefined) return value === null ? "null" : "undefined";
  if (Array.isArray(value)) return { type: "array", length: value.length, first: shape(value[0], depth + 1) };
  if (typeof value === "object") return { type: "object", keys: Object.keys(value as Record<string, unknown>).slice(0, 20), values: Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 10).map(([key, nested]) => [key, shape(nested, depth + 1)])) };
  if (typeof value === "string") return { type: "string", length: value.length, jsonLike: /^[\[{]/.test(value.trim()) };
  return typeof value;
}

async function main() {
  if (!process.env.LINGXING_MCP_KEY) throw new Error("LINGXING_MCP_KEY is not configured");
  const result = await invokeEmperorTool({
    toolSlug: "internal.lingxing.read",
    params: { capability: "get_my_sids", arguments: {} },
    userId: 1,
    userRole: "super_admin",
    workspaceId: 1,
  });
  const normalized = normalizeMcpPayload(result.output);
  const storeCount = pickRecords(normalized).length;
  const outputRecord = result.output && typeof result.output === "object" ? result.output as Record<string, unknown> : {};
  const content = Array.isArray(outputRecord.content) ? outputRecord.content : [];
  const rawText = typeof result.output === "string" ? result.output : typeof (content[0] as Record<string, unknown> | undefined)?.text === "string" ? String((content[0] as Record<string, unknown>).text) : "";
  console.log(JSON.stringify({
    success: result.success,
    httpStatus: result.metadata.status,
    toolRunId: result.metadata.toolRunId,
    storeCount,
    rawOutputShape: shape(result.output),
    normalizedShape: shape(normalized),
    textEnvelope: rawText ? {
      lineCount: rawText.split(/\r?\n/).length,
      hasSseDataLine: /^data:/m.test(rawText),
      hasMarkdownTable: /^\s*\|.*\|\s*$/m.test(rawText),
      hasChinese: /[\u4e00-\u9fff]/.test(rawText),
      hasXmlLikeTag: /<[^>]+>/.test(rawText),
      hasJsonToken: /[\[{]/.test(rawText),
      labels: [...new Set(rawText.split(/\r?\n/).map((line) => line.match(/^\s*(?:[-*•\d.、]+\s*)?([^:：]{1,30})[:：]/)?.[1]?.trim()).filter(Boolean))].slice(0, 30),
    } : null,
  }));
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "LingXing read-only verification failed");
  process.exitCode = 1;
});
