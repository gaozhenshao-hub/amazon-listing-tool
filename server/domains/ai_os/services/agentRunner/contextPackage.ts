import { TRPCError, withAgentStateMachine, AgentRunStatus, recordAiOsEvaluation, recordAiOsMetric, EmperorAgentNode, EmperorAgentDag, AgentContextArtifactRef, AgentContextResourceKind, AgentContextResourceRef, AgentContextBudgetSection, AgentContextBudgetReport, AgentContextProvenanceSource, AgentContextPackage, AgentContextPackageOptions, CheckpointRow, hashArtifactContent, parseStoredAgentRunInputs, rawExecute, parseJson, parentIds, childIds, isConfirmedStatus } from "./runtimeCore";
import { addEvent, getCheckpoints } from "./checkpointStore";
import { normalizeArtifactType, inferArtifactType, contextStringLimit, contextNumberLimit, estimateAgentContextTokens, pushUnique, ContextTrimStats, trimContextValueWithOptions, summarizeContextValue, fitValueToTokenBudget, parseAgentArtifactRow, buildAgentArtifactRef, isCurrentAgentArtifact, buildAgentResourceRef, compactArtifactForContext } from "./artifactStore";
async function getRunRow(runId: string) {
  const rows = await rawExecute("SELECT * FROM emperor_agent_runs WHERE runId=? LIMIT 1", [runId]);
  if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Agent run not found" });
  return rows[0];
}

function calculateProgress(checkpoints: CheckpointRow[]): number {
  if (!checkpoints.length) return 0;
  const done = checkpoints.filter((checkpoint) => isConfirmedStatus(checkpoint.status)).length;
  return Math.round((done / checkpoints.length) * 100);
}

function effectiveCheckpointOutput(checkpoint: CheckpointRow): unknown {
  return checkpoint.userEdit !== undefined && checkpoint.userEdit !== null
    ? checkpoint.userEdit
    : checkpoint.output;
}

function chooseCurrentAgentArtifacts(artifacts: any[]) {
  const byKey = new Map<string, any>();
  for (const rawArtifact of artifacts || []) {
    const artifact = rawArtifact?.ref ? rawArtifact : parseAgentArtifactRow(rawArtifact);
    if (!["final", "superseded"].includes(String(artifact.status))) continue;
    const key = `${artifact.runId}:${artifact.nodeId}:${artifact.artifactKey}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, artifact);
      continue;
    }
    const score = (item: any) => (isCurrentAgentArtifact(item) ? 1_000_000 : 0) + Number(item.version || 0);
    if (score(artifact) > score(existing)) byKey.set(key, artifact);
  }
  return [...byKey.values()].filter(isCurrentAgentArtifact);
}

type AgentContextSectionKey = "runInputs" | "parentOutputs" | "confirmedOutputs" | "artifacts";

const CONTEXT_SECTION_KEYS: AgentContextSectionKey[] = ["runInputs", "parentOutputs", "confirmedOutputs", "artifacts"];

type NormalizedContextOptions = {
  maxStringLength: number;
  maxArtifactContentLength: number;
  includeArtifactContent: boolean;
  maxTokens: number;
  maxArrayItems: number;
  maxObjectKeys: number;
  summaryStringLength: number;
  sectionTokenBudgets: Partial<Record<AgentContextSectionKey, number>>;
};

export type AgentContextPackageBuilderInput = {
  run: any;
  dag: EmperorAgentDag;
  node: EmperorAgentNode;
  checkpoints: any[];
  artifacts?: any[];
  options?: AgentContextPackageOptions;
};

function normalizeContextPackageOptions(options?: AgentContextPackageOptions): NormalizedContextOptions {
  const maxTokens = contextNumberLimit(options?.maxTokens, 32000, 1000, 200000);
  return {
    maxStringLength: contextStringLimit(options?.maxStringLength),
    maxArtifactContentLength: contextStringLimit(options?.maxArtifactContentLength, 8000),
    includeArtifactContent: options?.includeArtifactContent !== false,
    maxTokens,
    maxArrayItems: contextNumberLimit(options?.maxArrayItems, 80, 5, 1000),
    maxObjectKeys: contextNumberLimit(options?.maxObjectKeys, 120, 10, 2000),
    summaryStringLength: contextStringLimit(options?.summaryStringLength, 1200),
    sectionTokenBudgets: Object.fromEntries(
      Object.entries(options?.sectionTokenBudgets || {}).map(([key, value]) => [
        key,
        contextNumberLimit(value, Math.floor(maxTokens / CONTEXT_SECTION_KEYS.length), 100, maxTokens),
      ]),
    ) as Partial<Record<AgentContextSectionKey, number>>,
  };
}

function defaultSectionTokenBudget(section: AgentContextSectionKey, maxTokens: number): number {
  const ratios: Record<AgentContextSectionKey, number> = {
    runInputs: 0.16,
    parentOutputs: 0.30,
    confirmedOutputs: 0.26,
    artifacts: 0.14,
  };
  return Math.max(100, Math.floor(maxTokens * ratios[section]));
}

function normalizeContextArtifact(rawArtifact: any): AgentContextArtifactRef {
  const artifact = rawArtifact?.ref && rawArtifact?.currentRef ? rawArtifact : parseAgentArtifactRow(rawArtifact);
  const metadata = parseJson(artifact.metadata, {}) as Record<string, unknown>;
  const artifactType = normalizeArtifactType(artifact.artifactType) || inferArtifactType(artifact.content, metadata);
  return {
    ...artifact,
    artifactId: artifact.artifactId ?? artifact.id,
    artifactType,
    version: Number(artifact.version || 1),
    status: String(artifact.status || "final"),
    isCurrent: isCurrentAgentArtifact(artifact),
    content: artifact.content,
    metadata,
    contentHash: artifact.contentHash || hashArtifactContent(artifact.content),
    mimeType: artifact.mimeType || (metadata.mimeType as string | undefined) || null,
    fileName: artifact.fileName || (metadata.fileName as string | undefined) || null,
    fileSizeBytes: artifact.fileSizeBytes === undefined || artifact.fileSizeBytes === null ? (metadata.fileSizeBytes as number | undefined) ?? null : Number(artifact.fileSizeBytes),
    storageUri: artifact.storageUri || (metadata.storageUri as string | undefined) || null,
    ref: artifact.ref || buildAgentArtifactRef(artifact),
    currentRef: artifact.currentRef || buildAgentArtifactRef(artifact, "current"),
  };
}

export class AgentContextPackageBuilder {
  private readonly run: any;
  private readonly dag: EmperorAgentDag;
  private readonly node: EmperorAgentNode;
  private readonly checkpoints: CheckpointRow[];
  private readonly options: NormalizedContextOptions;
  private readonly allArtifacts: AgentContextArtifactRef[];
  private readonly currentArtifacts: AgentContextArtifactRef[];
  private readonly artifactByRef = new Map<string, AgentContextArtifactRef>();
  private readonly stats: ContextTrimStats & { resolvedArtifactRefs: string[] } = {
    truncatedFields: [],
    summarizedFields: [],
    resolvedArtifactRefs: [],
  };
  private readonly resourceRefs: Record<AgentContextResourceKind, AgentContextResourceRef[]> = {
    file: [],
    image: [],
    table: [],
  };
  private readonly sources: AgentContextProvenanceSource[] = [];

  constructor(input: AgentContextPackageBuilderInput) {
    this.run = input.run;
    this.dag = input.dag;
    this.node = input.node;
    this.checkpoints = (input.checkpoints || []) as CheckpointRow[];
    this.options = normalizeContextPackageOptions(input.options);
    this.allArtifacts = (input.artifacts || []).filter(Boolean).map(normalizeContextArtifact);
    this.currentArtifacts = chooseCurrentAgentArtifacts(this.allArtifacts).map(normalizeContextArtifact);
    this.indexArtifacts();
  }

  build(): AgentContextPackage {
    const parents = parentIds(this.dag, this.node.id);
    const rawRunInputs = parseStoredAgentRunInputs(this.run.inputs).inputs;
    this.addRunInputSources(rawRunInputs);
    const runInputs = this.prepareSection("runInputs", rawRunInputs, "runInputs");
    const parentOutputs = this.prepareSection("parentOutputs", this.buildOutputs(
      this.checkpoints.filter((checkpoint) => parents.includes(checkpoint.nodeId)),
      "parentOutputs",
    ), "parentOutputs");
    const confirmedOutputs = this.prepareSection("confirmedOutputs", this.buildOutputs(
      this.checkpoints.filter((checkpoint) => isConfirmedStatus(checkpoint.status)),
      "confirmedOutputs",
    ), "confirmedOutputs");
    const artifacts = this.prepareArtifactsSection(this.buildArtifactsSection());
    const nodeParams = this.prepareSection("runInputs", this.node.toolParams ?? null, "node.params");
    const budget = this.buildBudgetReport({ runInputs, parentOutputs, confirmedOutputs, artifacts }, nodeParams);
    const artifactRefs = this.currentArtifacts.map((artifact) => artifact.ref || buildAgentArtifactRef(artifact));
    const currentArtifactRefs = this.currentArtifacts.map((artifact) => artifact.currentRef || buildAgentArtifactRef(artifact, "current"));

    return {
      version: "1.0",
      schema: {
        name: "agent.context_package",
        version: "1.1",
        sections: ["runInputs", "parentOutputs", "confirmedOutputs", "artifacts", "resourceRefs", "contextBudget", "provenance"],
      },
      agentRunId: this.run.runId,
      agentSlug: this.run.agentSlug,
      projectId: this.run.projectId ?? null,
      parentOutputs: parentOutputs as Record<string, unknown>,
      confirmedOutputs: confirmedOutputs as Record<string, unknown>,
      artifacts,
      resourceRefs: this.resourceRefs,
      contextBudget: budget,
      node: {
        id: this.node.id,
        label: this.node.label,
        skillSlug: this.node.skillSlug,
        skillVersion: this.node.skillVersion,
        skillVersionRef: this.node.skillVersionRef,
        skillVersionPolicy: this.node.skillVersionPolicy,
        toolSlug: this.node.toolSlug,
        outputKey: this.node.outputKey,
        nodeType: this.node.nodeType,
        params: nodeParams,
      },
      runInputs: runInputs as Record<string, unknown>,
      provenance: {
        parentNodeIds: parents,
        confirmedNodeIds: this.checkpoints.filter((checkpoint) => isConfirmedStatus(checkpoint.status)).map((checkpoint) => checkpoint.nodeId),
        artifactRefs,
        currentArtifactRefs,
        sources: this.sources,
        builtAt: new Date().toISOString(),
      },
    };
  }

  private indexArtifacts() {
    for (const artifact of this.allArtifacts) {
      const versionRef = artifact.ref || buildAgentArtifactRef(artifact);
      const currentRef = artifact.currentRef || buildAgentArtifactRef(artifact, "current");
      this.artifactByRef.set(versionRef, artifact);
      this.artifactByRef.set(`artifact://${artifact.runId}/${artifact.nodeId}/${artifact.artifactKey}`, artifact);
      if (isCurrentAgentArtifact(artifact)) this.artifactByRef.set(currentRef, artifact);
    }
  }

  private sectionLimit(section: AgentContextSectionKey): number {
    return this.options.sectionTokenBudgets[section] || defaultSectionTokenBudget(section, this.options.maxTokens);
  }

  private prepareSection(section: AgentContextSectionKey, value: unknown, path: string): unknown {
    const resolved = this.resolveArtifactRefs(value, path);
    const trimmed = trimContextValueWithOptions(resolved, {
      maxStringLength: section === "artifacts" ? this.options.maxArtifactContentLength : this.options.maxStringLength,
      maxArrayItems: this.options.maxArrayItems,
      maxObjectKeys: this.options.maxObjectKeys,
      path,
      stats: this.stats,
    });
    const sectionLimited = fitValueToTokenBudget(trimmed, this.sectionLimit(section), path, this.stats);
    if (estimateAgentContextTokens(sectionLimited) <= this.sectionLimit(section)) return sectionLimited;
    return summarizeContextValue(sectionLimited, this.options.summaryStringLength, path, this.stats);
  }

  private prepareArtifactsSection(value: AgentContextArtifactRef[]): AgentContextArtifactRef[] {
    const trimmed = trimContextValueWithOptions(this.resolveArtifactRefs(value, "artifacts"), {
      maxStringLength: this.options.maxArtifactContentLength,
      maxArrayItems: this.options.maxArrayItems,
      maxObjectKeys: this.options.maxObjectKeys,
      path: "artifacts",
      stats: this.stats,
    }) as AgentContextArtifactRef[];
    const limit = this.sectionLimit("artifacts");
    if (estimateAgentContextTokens(trimmed) <= limit) return trimmed;
    const perArtifactChars = Math.max(400, Math.floor((limit * 4) / Math.max(trimmed.length, 1)));
    return trimmed.map((artifact, index) => ({
      ...artifact,
      content: summarizeContextValue(artifact.content, perArtifactChars, `artifacts[${index}].content`, this.stats),
    }));
  }

  private buildOutputs(checkpoints: CheckpointRow[], pathPrefix: "parentOutputs" | "confirmedOutputs"): Record<string, unknown> {
    const outputs: Record<string, unknown> = {};
    for (const checkpoint of checkpoints) {
      const sourceNode = this.dag.nodes.find((item) => item.id === checkpoint.nodeId);
      const key = sourceNode?.outputKey || checkpoint.nodeId;
      const artifact = this.currentArtifactForNode(sourceNode);
      if (artifact) {
        outputs[key] = this.artifactContextValue(artifact, `${pathPrefix}.${key}`);
        this.addSource({
          path: `${pathPrefix}.${key}`,
          sourceType: "artifact",
          nodeId: artifact.nodeId,
          artifactRef: artifact.currentRef || buildAgentArtifactRef(artifact, "current"),
          artifactVersion: artifact.version,
        });
      } else {
        outputs[key] = effectiveCheckpointOutput(checkpoint);
        this.addSource({
          path: `${pathPrefix}.${key}`,
          sourceType: "checkpoint",
          nodeId: checkpoint.nodeId,
          checkpointStatus: checkpoint.status,
        });
      }
    }
    return outputs;
  }

  private buildArtifactsSection(): AgentContextArtifactRef[] {
    return this.currentArtifacts.map((artifact, index) => {
      this.addResourceRef(artifact);
      this.addSource({
        path: `artifacts[${index}]`,
        sourceType: "artifact",
        nodeId: artifact.nodeId,
        artifactRef: artifact.currentRef || buildAgentArtifactRef(artifact, "current"),
        artifactVersion: artifact.version,
      });
      return {
        artifactId: artifact.artifactId,
        runId: artifact.runId,
        nodeId: artifact.nodeId,
        artifactKey: artifact.artifactKey,
        artifactType: artifact.artifactType,
        version: Number(artifact.version || 1),
        status: artifact.status,
        isCurrent: isCurrentAgentArtifact(artifact),
        ref: artifact.ref || buildAgentArtifactRef(artifact),
        currentRef: artifact.currentRef || buildAgentArtifactRef(artifact, "current"),
        content: this.artifactContextValue(artifact, `artifacts[${index}].content`),
        metadata: artifact.metadata || {},
        contentHash: artifact.contentHash || null,
        mimeType: artifact.mimeType || null,
        fileName: artifact.fileName || null,
        fileSizeBytes: artifact.fileSizeBytes ?? null,
        storageUri: artifact.storageUri || null,
        sourceSkillRunId: artifact.sourceSkillRunId || null,
        sourceAiJobRunId: artifact.sourceAiJobRunId || null,
      };
    });
  }

  private addRunInputSources(runInputs: Record<string, unknown>) {
    for (const key of Object.keys(runInputs || {})) {
      this.addSource({
        path: `runInputs.${key}`,
        sourceType: "run_input",
      });
    }
  }

  private currentArtifactForNode(node: EmperorAgentNode | undefined): AgentContextArtifactRef | undefined {
    if (!node) return undefined;
    const preferredKey = node.outputKey || node.id;
    return this.currentArtifacts.find((item) => item.nodeId === node.id && item.artifactKey === preferredKey)
      || this.currentArtifacts.find((item) => item.nodeId === node.id);
  }

  private artifactContextValue(artifact: AgentContextArtifactRef, path: string): unknown {
    this.addResourceRef(artifact);
    return compactArtifactForContext(
      artifact,
      this.options.includeArtifactContent,
      this.options.maxArtifactContentLength,
      this.stats,
      path,
    );
  }

  private resolveArtifactRefs(value: unknown, path: string): unknown {
    if (typeof value === "string") {
      const trimmed = value.trim();
      const exact = this.artifactByRef.get(trimmed);
      if (exact) {
        pushUnique(this.stats.resolvedArtifactRefs, trimmed);
        this.addSource({
          path,
          sourceType: "artifact_ref",
          nodeId: exact.nodeId,
          artifactRef: trimmed,
          artifactVersion: exact.version,
        });
        return {
          __resolvedArtifactRef: trimmed,
          content: this.artifactContextValue(exact, path),
        };
      }
      for (const match of value.matchAll(/artifact:\/\/[^/\s"'<>]+\/[^/\s"'<>]+\/[^@\s"'<>]+(?:@(?:\d+|current))?/g)) {
        if (this.artifactByRef.has(match[0])) pushUnique(this.stats.resolvedArtifactRefs, match[0]);
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item, index) => this.resolveArtifactRefs(item, `${path}[${index}]`));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => {
          if (key === "ref" || key === "currentRef" || key === "__artifactRef") return [key, item];
          return [key, this.resolveArtifactRefs(item, `${path}.${key}`)];
        }),
      );
    }
    return value;
  }

  private addResourceRef(artifact: AgentContextArtifactRef) {
    const resource = buildAgentResourceRef(artifact);
    if (!resource) return;
    const exists = this.resourceRefs[resource.kind].some((item) => item.currentRef === resource.currentRef && item.ref === resource.ref);
    if (exists) return;
    const nextIndex = this.resourceRefs[resource.kind].length;
    this.resourceRefs[resource.kind].push({
      ...resource,
      metadata: trimContextValueWithOptions(resource.metadata || {}, {
        maxStringLength: 1000,
        maxArrayItems: 20,
        maxObjectKeys: 40,
        path: `resourceRefs.${resource.kind}[${nextIndex}].metadata`,
        stats: this.stats,
      }),
    });
  }

  private addSource(source: AgentContextProvenanceSource) {
    const key = `${source.path}:${source.sourceType}:${source.artifactRef || ""}:${source.nodeId || ""}`;
    if (!this.sources.some((item) => `${item.path}:${item.sourceType}:${item.artifactRef || ""}:${item.nodeId || ""}` === key)) {
      this.sources.push(source);
    }
  }

  private buildBudgetReport(sections: Record<AgentContextSectionKey, unknown>, nodeParams: unknown): AgentContextBudgetReport {
    const sectionReports = Object.fromEntries(CONTEXT_SECTION_KEYS.map((section) => [
      section,
      {
        estimatedTokens: estimateAgentContextTokens(sections[section]),
        limitTokens: this.sectionLimit(section),
      },
    ])) as Record<string, AgentContextBudgetSection>;
    const estimatedTokens = estimateAgentContextTokens({
      node: {
        ...this.node,
        params: nodeParams,
      },
      runInputs: sections.runInputs,
      parentOutputs: sections.parentOutputs,
      confirmedOutputs: sections.confirmedOutputs,
      artifacts: sections.artifacts,
      resourceRefs: this.resourceRefs,
    });
    return {
      maxTokens: this.options.maxTokens,
      estimatedTokens,
      overBudget: estimatedTokens > this.options.maxTokens,
      sections: sectionReports,
      truncatedFields: [...this.stats.truncatedFields],
      summarizedFields: [...this.stats.summarizedFields],
      resolvedArtifactRefs: [...this.stats.resolvedArtifactRefs],
      resourceCounts: {
        file: this.resourceRefs.file.length,
        image: this.resourceRefs.image.length,
        table: this.resourceRefs.table.length,
      },
    };
  }
}

async function refreshRunAfterCheckpoint(runId: string, dag: EmperorAgentDag) {
  const runRow = await getRunRow(runId);
  const checkpoints = await getCheckpoints(runId);
  const progress = calculateProgress(checkpoints);
  if (runRow.status === "canceled") {
    return { checkpoints, status: "canceled" as AgentRunStatus, progress };
  }
  if (runRow.status === "paused") {
    return { checkpoints, status: "paused" as AgentRunStatus, progress };
  }

  const allDone = checkpoints.length > 0 && checkpoints.every((checkpoint) => isConfirmedStatus(checkpoint.status));
  const failed = checkpoints.find((checkpoint) => checkpoint.status === "failed");
  const running = checkpoints.find((checkpoint) => checkpoint.status === "running");
  const waiting = checkpoints.find((checkpoint) => checkpoint.status === "waiting_human");
  const nextReady = checkpoints.find((checkpoint) => checkpoint.status === "ready");
  const anyRunning = checkpoints.some((checkpoint) => checkpoint.status === "running");
  const anyWaiting = checkpoints.some((checkpoint) => checkpoint.status === "waiting_human");
  const status: AgentRunStatus = allDone ? "completed" : anyRunning ? "running" : failed && !nextReady && !anyWaiting ? "failed" : "waiting_human";
  const currentNodeId = running?.nodeId || waiting?.nodeId || nextReady?.nodeId || failed?.nodeId || null;
  const outputMap = checkpoints.reduce<Record<string, unknown>>((acc, checkpoint) => {
    const node = dag.nodes.find((item) => item.id === checkpoint.nodeId);
    const key = node?.outputKey || checkpoint.nodeId;
    if (checkpoint.output !== undefined && checkpoint.output !== null) acc[key] = checkpoint.output;
    if (checkpoint.userEdit !== undefined && checkpoint.userEdit !== null) acc[`${key}UserEdit`] = checkpoint.userEdit;
    const effective = effectiveCheckpointOutput(checkpoint);
    if (effective !== undefined && effective !== null) acc[`${key}Final`] = effective;
    return acc;
  }, {});

  await withAgentStateMachine((stateMachine) => stateMachine.refreshRun({
    runId,
    to: status,
    currentNodeId,
    progress,
    outputs: outputMap,
    completedAt: allDone ? new Date() : null,
  }));

  if (runRow.status !== status && ["completed", "failed", "canceled"].includes(status)) {
    const durationMs = runRow.startedAt ? Date.now() - new Date(runRow.startedAt).getTime() : null;
    void recordAiOsEvaluation({
      entityType: "agent_run",
      entityId: runId,
      output: outputMap,
      status,
      workspaceId: runRow.workspaceId ?? null,
      userId: runRow.userId,
      projectId: runRow.projectId ?? null,
      agentSlug: runRow.agentSlug,
      retryCount: checkpoints.reduce((sum, checkpoint) => sum + Number(checkpoint.retryCount || 0), 0),
      metadata: {
        progress,
        checkpointCount: checkpoints.length,
        confirmedCount: checkpoints.filter((checkpoint) => isConfirmedStatus(checkpoint.status)).length,
        durationMs,
      },
    });
    void recordAiOsMetric({
      entityType: "agent_run",
      entityId: runId,
      metricName: `agent_run.${status}`,
      metricValue: durationMs,
      status,
      workspaceId: runRow.workspaceId ?? null,
      userId: runRow.userId,
      projectId: runRow.projectId ?? null,
      agentSlug: runRow.agentSlug,
      metadata: {
        progress,
        checkpointCount: checkpoints.length,
        retryCount: checkpoints.reduce((sum, checkpoint) => sum + Number(checkpoint.retryCount || 0), 0),
      },
    });
  }

  if (!anyRunning && !anyWaiting && nextReady) {
    await addEvent(runId, checkpoints[0]?.agentSlug || "", nextReady.nodeId, "node.ready", `节点 ${nextReady.nodeLabel || nextReady.nodeId} 已就绪`);
  }

  return { checkpoints, status, progress };
}

async function unlockChildren(runId: string, dag: EmperorAgentDag, nodeId: string) {
  const checkpoints = await getCheckpoints(runId);
  const byNode = new Map(checkpoints.map((checkpoint) => [checkpoint.nodeId, checkpoint]));
  for (const childId of childIds(dag, nodeId)) {
    const child = byNode.get(childId);
    if (!child || child.status !== "pending") continue;
    const parents = parentIds(dag, childId);
    const ready = parents.every((parentId) => isConfirmedStatus(byNode.get(parentId)?.status || ""));
    if (!ready) continue;
    await withAgentStateMachine((stateMachine) => stateMachine.markNodeReady({ runId, nodeId: childId, action: "unlock child" }));
  }
}

export function buildAgentContextPackage(input: {
  run: any;
  dag: EmperorAgentDag;
  node: EmperorAgentNode;
  checkpoints: CheckpointRow[];
  artifacts?: any[];
  options?: AgentContextPackageOptions;
}): AgentContextPackage {
  return new AgentContextPackageBuilder(input).build();
}

function buildNodeInput(run: any, dag: EmperorAgentDag, node: EmperorAgentNode, checkpoints: CheckpointRow[], artifacts?: any[]) {
  const contextOptions = node.contextPackageOptions && typeof node.contextPackageOptions === "object"
    ? node.contextPackageOptions as AgentContextPackageOptions
    : node.contextBudget && typeof node.contextBudget === "object"
      ? node.contextBudget as AgentContextPackageOptions
      : undefined;
  const contextPackage = buildAgentContextPackage({ run, dag, node, checkpoints, artifacts, options: contextOptions });
  return {
    ...contextPackage,
    contextPackage,
  };
}

function buildSkillContext(node: EmperorAgentNode, nodeInput: unknown): string {
  return [
    `Agent 节点：${node.id} ${node.label}`,
    node.subtitle ? `节点说明：${node.subtitle}` : "",
    "请基于 runInputs 与 parentOutputs 完成本节点任务。输出严格 JSON。",
    "",
    JSON.stringify(nodeInput, null, 2),
  ].filter(Boolean).join("\n");
}

export { getRunRow, calculateProgress, effectiveCheckpointOutput, chooseCurrentAgentArtifacts, AgentContextSectionKey, CONTEXT_SECTION_KEYS, NormalizedContextOptions, normalizeContextPackageOptions, defaultSectionTokenBudget, normalizeContextArtifact, refreshRunAfterCheckpoint, unlockChildren, buildNodeInput, buildSkillContext };
