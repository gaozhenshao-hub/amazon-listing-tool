import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { devAnalysisStages, type InsertDevAnalysisStage } from "../../../../drizzle/schema/project";
import { withDbTransaction, type DbExecutor } from "../../../repositories/dbClient";
import {
  registerDevAnalysisArtifact,
  resolveCurrentDevAnalysisArtifact,
} from "../../ai_os/services/businessArtifactRegistry";

export type DevAnalysisStageType = InsertDevAnalysisStage["stageType"];

export class StaleDevAnalysisRunError extends Error {
  readonly code = "DEV_STAGE_STALE_RUN";

  constructor() {
    super("当前分析已由更新的任务接管，旧任务结果已丢弃");
  }
}

export function downstreamDevAnalysisStages(stageType: DevAnalysisStageType): DevAnalysisStageType[] {
  if (stageType === "attribute_tagging") {
    return ["attribute_cross", "information_summary", "decision_dashboard"];
  }
  if (["market_overview", "attribute_cross", "price_analysis", "brand_competition", "review_kano"].includes(stageType)) {
    return ["information_summary", "decision_dashboard"];
  }
  if (stageType === "information_summary") return ["decision_dashboard"];
  return [];
}

function contentMutationKey(prefix: string, stageId: number, content: string) {
  const digest = createHash("sha256").update(content).digest("hex").slice(0, 48);
  return `${prefix}:${stageId}:${digest}`;
}

async function lockStage(tx: DbExecutor, projectId: number, stageType: DevAnalysisStageType) {
  await tx.execute(sql`
    SELECT ${devAnalysisStages.id}
    FROM ${devAnalysisStages}
    WHERE ${devAnalysisStages.projectId} = ${projectId}
      AND ${devAnalysisStages.stageType} = ${stageType}
    FOR UPDATE
  `);
  const [stage] = await tx.select().from(devAnalysisStages).where(and(
    eq(devAnalysisStages.projectId, projectId),
    eq(devAnalysisStages.stageType, stageType),
  )).limit(1);
  return stage || null;
}

async function lockDownstreamStages(
  tx: DbExecutor,
  projectId: number,
  stageTypes: DevAnalysisStageType[],
) {
  if (stageTypes.length === 0) return [];
  await tx.execute(sql`
    SELECT ${devAnalysisStages.id}
    FROM ${devAnalysisStages}
    WHERE ${devAnalysisStages.projectId} = ${projectId}
      AND ${devAnalysisStages.stageType} IN (${sql.join(stageTypes.map((stageType) => sql`${stageType}`), sql`, `)})
    ORDER BY ${devAnalysisStages.stageType}
    FOR UPDATE
  `);
  return tx.select().from(devAnalysisStages).where(and(
    eq(devAnalysisStages.projectId, projectId),
    inArray(devAnalysisStages.stageType, stageTypes),
  ));
}

async function registerStageArtifactStrict(
  tx: DbExecutor,
  stageId: number,
  sourceType: "ai_output" | "user_edit",
) {
  const artifact = await registerDevAnalysisArtifact(stageId, sourceType, {
    executor: tx,
    failOnError: true,
  });
  if (!artifact) throw new Error(`分析阶段 ${stageId} Artifact 注册失败`);
  return artifact;
}

async function invalidateDownstreamInTransaction(
  tx: DbExecutor,
  projectId: number,
  sourceStageId: number,
  mutationKey: string,
  stageTypes: DevAnalysisStageType[],
) {
  const downstream = await lockDownstreamStages(tx, projectId, stageTypes);
  if (downstream.length === 0) return [];
  const invalidated = downstream.filter((stage: any) => (
    stage.status !== "generated" || stage.confirmedAt !== null || stage.runId !== null
  ));
  for (const stage of invalidated) {
    const hasContent = Boolean(stage.editedResult || stage.rawResult);
    await tx.update(devAnalysisStages).set({
      status: hasContent ? "generated" : "pending",
      confirmedAt: null,
      runId: null,
      runProgress: 0,
      runError: stage.runId ? "上游分析已更新，当前任务结果已失效" : null,
      runCompletedAt: stage.runId ? new Date() : stage.runCompletedAt,
      rowVersion: sql`${devAnalysisStages.rowVersion} + 1`,
      lastMutationKey: `invalidate:${sourceStageId}:${mutationKey}`.slice(0, 128),
    }).where(eq(devAnalysisStages.id, stage.id));
    if (hasContent) {
      await registerStageArtifactStrict(tx, stage.id, stage.editedResult ? "user_edit" : "ai_output");
    }
  }
  return invalidated.map((stage: any) => stage.stageType as DevAnalysisStageType);
}

function assertStageIsMutable(stage: { status?: string | null }) {
  if (stage.status === "running" || stage.status === "generating") {
    throw new Error("当前阶段正在分析，完成或取消后才能编辑、确认或解锁");
  }
}

export async function confirmDevAnalysisStageConsistently(input: {
  projectId: number;
  stageType: DevAnalysisStageType;
  editedResult?: string;
}) {
  return withDbTransaction("Confirm product-development analysis stage", async (tx) => {
    const stage = await lockStage(tx, input.projectId, input.stageType);
    if (!stage) throw new Error("请先生成阶段结果");
    assertStageIsMutable(stage);
    const content = input.editedResult ?? stage.editedResult ?? stage.rawResult;
    if (!content) throw new Error("请先生成阶段结果");
    const mutationKey = contentMutationKey("confirm", stage.id, content);

    if (stage.status === "confirmed" && stage.lastMutationKey === mutationKey) {
      const current = await resolveCurrentDevAnalysisArtifact(stage.id, { executor: tx });
      const artifact = current || await registerStageArtifactStrict(
        tx,
        stage.id,
        input.editedResult !== undefined || stage.editedResult ? "user_edit" : "ai_output",
      );
      return { stage, artifact, invalidated: [] as DevAnalysisStageType[], idempotent: true };
    }

    await tx.update(devAnalysisStages).set({
      status: "confirmed",
      editedResult: input.editedResult,
      confirmedAt: new Date(),
      rowVersion: sql`${devAnalysisStages.rowVersion} + 1`,
      lastMutationKey: mutationKey,
    }).where(eq(devAnalysisStages.id, stage.id));

    const artifact = await registerStageArtifactStrict(
      tx,
      stage.id,
      input.editedResult !== undefined || stage.editedResult ? "user_edit" : "ai_output",
    );
    const invalidated = await invalidateDownstreamInTransaction(
      tx,
      input.projectId,
      stage.id,
      mutationKey,
      downstreamDevAnalysisStages(input.stageType),
    );
    const [updated] = await tx.select().from(devAnalysisStages).where(eq(devAnalysisStages.id, stage.id)).limit(1);
    return { stage: updated, artifact, invalidated, idempotent: false };
  });
}

export async function unlockDevAnalysisStageConsistently(input: {
  projectId: number;
  stageType: DevAnalysisStageType;
}) {
  return withDbTransaction("Unlock product-development analysis stage", async (tx) => {
    const stage = await lockStage(tx, input.projectId, input.stageType);
    if (!stage) throw new Error("分析阶段不存在");
    assertStageIsMutable(stage);
    if (
      stage.status === "generated" &&
      stage.confirmedAt === null &&
      String(stage.lastMutationKey || "").startsWith(`unlock:${stage.id}:`)
    ) {
      return { stage, invalidated: [] as DevAnalysisStageType[], idempotent: true };
    }

    const mutationKey = `unlock:${stage.id}:${stage.rowVersion}`.slice(0, 128);
    await tx.update(devAnalysisStages).set({
      status: "generated",
      confirmedAt: null,
      rowVersion: sql`${devAnalysisStages.rowVersion} + 1`,
      lastMutationKey: mutationKey,
    }).where(eq(devAnalysisStages.id, stage.id));
    await registerStageArtifactStrict(tx, stage.id, "user_edit");
    const invalidated = await invalidateDownstreamInTransaction(
      tx,
      input.projectId,
      stage.id,
      mutationKey,
      downstreamDevAnalysisStages(input.stageType),
    );
    const [updated] = await tx.select().from(devAnalysisStages).where(eq(devAnalysisStages.id, stage.id)).limit(1);
    return { stage: updated, invalidated, idempotent: false };
  });
}

export async function editDevAnalysisStageConsistently(input: {
  projectId: number;
  stageType: DevAnalysisStageType;
  editedResult: string;
}) {
  return withDbTransaction("Edit product-development analysis stage", async (tx) => {
    const stage = await lockStage(tx, input.projectId, input.stageType);
    if (!stage?.rawResult && !stage?.editedResult) throw new Error("请先生成阶段结果后再编辑");
    assertStageIsMutable(stage);
    const mutationKey = contentMutationKey("edit", stage.id, input.editedResult);
    if (stage.status === "editing" && stage.lastMutationKey === mutationKey) {
      return { stage, invalidated: [] as DevAnalysisStageType[], idempotent: true };
    }

    await tx.update(devAnalysisStages).set({
      status: "editing",
      editedResult: input.editedResult,
      confirmedAt: null,
      rowVersion: sql`${devAnalysisStages.rowVersion} + 1`,
      lastMutationKey: mutationKey,
    }).where(eq(devAnalysisStages.id, stage.id));
    await registerStageArtifactStrict(tx, stage.id, "user_edit");
    const invalidated = await invalidateDownstreamInTransaction(
      tx,
      input.projectId,
      stage.id,
      mutationKey,
      downstreamDevAnalysisStages(input.stageType),
    );
    const [updated] = await tx.select().from(devAnalysisStages).where(eq(devAnalysisStages.id, stage.id)).limit(1);
    return { stage: updated, invalidated, idempotent: false };
  });
}

export async function completeDevAnalysisStageRunConsistently(input: {
  projectId: number;
  stageType: DevAnalysisStageType;
  runId: string;
  rawResult: string;
  runError?: string | null;
}) {
  return withDbTransaction("Complete product-development analysis stage", async (tx) => {
    const stage = await lockStage(tx, input.projectId, input.stageType);
    if (!stage || stage.runId !== input.runId) throw new StaleDevAnalysisRunError();
    const mutationKey = `complete:${input.runId}`.slice(0, 128);
    if (stage.status === "completed" && stage.lastMutationKey === mutationKey) {
      return { stage, idempotent: true };
    }
    await tx.update(devAnalysisStages).set({
      status: "completed",
      rawResult: input.rawResult,
      editedResult: null,
      runProgress: 100,
      runError: input.runError ?? null,
      runCompletedAt: new Date(),
      confirmedAt: null,
      rowVersion: sql`${devAnalysisStages.rowVersion} + 1`,
      lastMutationKey: mutationKey,
    }).where(and(
      eq(devAnalysisStages.id, stage.id),
      eq(devAnalysisStages.runId, input.runId),
    ));
    await registerStageArtifactStrict(tx, stage.id, "ai_output");
    const invalidated = await invalidateDownstreamInTransaction(
      tx,
      input.projectId,
      stage.id,
      mutationKey,
      downstreamDevAnalysisStages(input.stageType),
    );
    const [updated] = await tx.select().from(devAnalysisStages).where(eq(devAnalysisStages.id, stage.id)).limit(1);
    return { stage: updated, invalidated, idempotent: false };
  });
}
