import { TRPCError, buildWorkspaceScopeFilter, EmperorToolType, ToolRunStatus, toolRunStoreState, rawExecute, parseJson, sanitizeForAudit, buildToolSecretRef, encryptToolSecretValue, decryptToolSecretValue, assertNoPlaintextSecrets, isMissingDatabase } from "./governanceCore";
import { BUILTIN_TOOLS } from "./registry";
export async function listEmperorToolRuns(input: {
  userId?: number;
  isAdmin?: boolean;
  toolSlug?: string;
  agentRunId?: string;
  nodeId?: string;
  status?: ToolRunStatus;
  limit?: number;
  workspaceId?: number | null;
} = {}) {
  if (!toolRunStoreState.available) return [];
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (!input.isAdmin && input.userId) {
    clauses.push("userId=?");
    params.push(input.userId);
  }
  if (input.toolSlug) {
    clauses.push("toolSlug=?");
    params.push(input.toolSlug);
  }
  if (input.agentRunId) {
    clauses.push("agentRunId=?");
    params.push(input.agentRunId);
  }
  if (input.nodeId) {
    clauses.push("nodeId=?");
    params.push(input.nodeId);
  }
  if (input.status) {
    clauses.push("status=?");
    params.push(input.status);
  }
  if (input.workspaceId !== undefined) {
    const scope = buildWorkspaceScopeFilter(input.workspaceId);
    clauses.push(scope.clause);
    params.push(...scope.params);
  }
  params.push(Math.min(Math.max(input.limit || 50, 1), 200));
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const rows = await rawExecute(
      `SELECT * FROM emperor_tool_runs ${where} ORDER BY createdAt DESC LIMIT ?`,
      params,
    );
    return rows.map((row) => ({
      ...row,
      input: parseJson(row.input, null),
      output: parseJson(row.output, null),
      normalizedOutput: parseJson(row.normalizedOutput, null),
      governanceDecision: parseJson(row.governanceDecision, null),
      secretRefs: parseJson(row.secretRefs, []),
    }));
  } catch (error) {
    toolRunStoreState.available = false;
    if (!isMissingDatabase(error)) console.warn("[Tool Gateway] Failed to list tool runs:", error);
    return [];
  }
}

export async function upsertEmperorTool(input: {
  workspaceId?: number | null;
  slug: string;
  name: string;
  description?: string | null;
  type: EmperorToolType;
  config?: unknown;
  governancePolicy?: unknown;
  permissionPolicy?: unknown;
  rateLimitPolicy?: unknown;
  circuitBreakerPolicy?: unknown;
  secretRefs?: unknown;
  outputPolicy?: unknown;
  inputSchema?: unknown;
  outputSchema?: unknown;
  isActive?: boolean;
}) {
  assertNoPlaintextSecrets(input.config, "tool.config");
  assertNoPlaintextSecrets(input.secretRefs, "tool.secretRefs");
  await rawExecute(
    `INSERT INTO emperor_tools (workspaceId,slug,name,description,type,config,governancePolicy,permissionPolicy,rateLimitPolicy,circuitBreakerPolicy,secretRefs,outputPolicy,inputSchema,outputSchema,isActive)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE workspaceId=VALUES(workspaceId),name=VALUES(name),description=VALUES(description),type=VALUES(type),config=VALUES(config),governancePolicy=VALUES(governancePolicy),permissionPolicy=VALUES(permissionPolicy),rateLimitPolicy=VALUES(rateLimitPolicy),circuitBreakerPolicy=VALUES(circuitBreakerPolicy),secretRefs=VALUES(secretRefs),outputPolicy=VALUES(outputPolicy),inputSchema=VALUES(inputSchema),outputSchema=VALUES(outputSchema),isActive=VALUES(isActive),updatedAt=NOW()`,
    [
      input.workspaceId ?? null,
      input.slug,
      input.name,
      input.description || null,
      input.type,
      input.config === undefined ? null : JSON.stringify(input.config),
      input.governancePolicy === undefined ? null : JSON.stringify(input.governancePolicy),
      input.permissionPolicy === undefined ? null : JSON.stringify(input.permissionPolicy),
      input.rateLimitPolicy === undefined ? null : JSON.stringify(input.rateLimitPolicy),
      input.circuitBreakerPolicy === undefined ? null : JSON.stringify(input.circuitBreakerPolicy),
      input.secretRefs === undefined ? null : JSON.stringify(input.secretRefs),
      input.outputPolicy === undefined ? null : JSON.stringify(input.outputPolicy),
      input.inputSchema === undefined ? null : JSON.stringify(input.inputSchema),
      input.outputSchema === undefined ? null : JSON.stringify(input.outputSchema),
      input.isActive === false ? 0 : 1,
    ],
  );
  return { success: true, slug: input.slug };
}

export async function upsertEmperorToolSecret(input: {
  slug: string;
  value: string;
  description?: string | null;
  metadata?: unknown;
  userId?: number | null;
  workspaceId?: number | null;
}) {
  const scope = buildWorkspaceScopeFilter(input.workspaceId);
  const existing = await rawExecute(
    `SELECT keyVersion
     FROM emperor_tool_secrets
     WHERE slug=? AND ${scope.clause}
     ORDER BY workspaceId IS NULL ASC
     LIMIT 1`,
    [input.slug, ...scope.params],
  );
  const encrypted = encryptToolSecretValue(input.value);
  await rawExecute(
    `INSERT INTO emperor_tool_secrets (workspaceId,slug,description,encryptedValue,iv,authTag,keyVersion,previousKeyVersion,status,rotatedAt,metadata,createdBy,updatedBy)
     VALUES (?,?,?,?,?,?,?,?,'active',NOW(),?,?,?)
     ON DUPLICATE KEY UPDATE workspaceId=VALUES(workspaceId),description=VALUES(description),encryptedValue=VALUES(encryptedValue),iv=VALUES(iv),authTag=VALUES(authTag),previousKeyVersion=VALUES(previousKeyVersion),keyVersion=VALUES(keyVersion),status='active',rotatedAt=NOW(),metadata=VALUES(metadata),updatedBy=VALUES(updatedBy),updatedAt=NOW()`,
    [
      input.workspaceId ?? null,
      input.slug,
      input.description || null,
      encrypted.encryptedValue,
      encrypted.iv,
      encrypted.authTag,
      encrypted.keyVersion,
      existing[0]?.keyVersion || null,
      input.metadata === undefined ? null : JSON.stringify(sanitizeForAudit(input.metadata)),
      input.userId || null,
      input.userId || null,
    ],
  );
  return { success: true, ref: buildToolSecretRef(input.slug), slug: input.slug };
}

export async function rotateEmperorToolSecret(input: {
  slug: string;
  userId?: number | null;
  workspaceId?: number | null;
}) {
  const rows = await rawExecute(
    `SELECT encryptedValue,iv,authTag,keyVersion,description,metadata
     FROM emperor_tool_secrets
     WHERE slug=? AND status <> 'retired' AND ${buildWorkspaceScopeFilter(input.workspaceId).clause}
     ORDER BY workspaceId IS NULL ASC
     LIMIT 1`,
    [input.slug, ...buildWorkspaceScopeFilter(input.workspaceId).params],
  );
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Tool secret not found" });
  const plaintext = decryptToolSecretValue(rows[0]);
  const encrypted = encryptToolSecretValue(plaintext);
  await rawExecute(
    `UPDATE emperor_tool_secrets
     SET workspaceId=COALESCE(?,workspaceId),encryptedValue=?,iv=?,authTag=?,previousKeyVersion=?,keyVersion=?,status='active',rotatedAt=NOW(),updatedBy=?,updatedAt=NOW()
     WHERE slug=?`,
    [
      input.workspaceId ?? null,
      encrypted.encryptedValue,
      encrypted.iv,
      encrypted.authTag,
      rows[0].keyVersion || null,
      encrypted.keyVersion,
      input.userId || null,
      input.slug,
    ],
  );
  await rawExecute(
    `INSERT INTO emperor_secret_key_versions (scope,keyVersion,status,activatedAt,metadata,createdBy)
     VALUES ('tool',?,'active',NOW(),?,?)
     ON DUPLICATE KEY UPDATE status=VALUES(status),updatedAt=NOW()`,
    [
      encrypted.keyVersion,
      JSON.stringify({ rotatedSecretSlug: input.slug }),
      input.userId || null,
    ],
  );
  return {
    success: true,
    ref: buildToolSecretRef(input.slug),
    slug: input.slug,
    keyVersion: encrypted.keyVersion,
    previousKeyVersion: rows[0].keyVersion || null,
  };
}

export async function seedBuiltinTools() {
  for (const tool of BUILTIN_TOOLS) {
    await upsertEmperorTool({
      slug: tool.slug,
      name: tool.name,
      description: tool.description,
      type: tool.type,
      config: tool.config,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      isActive: true,
    });
  }
  return { success: true, tools: BUILTIN_TOOLS };
}
