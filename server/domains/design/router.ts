import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  designChatRequestSchema,
  designConfirmSchema,
  designRequestSchema,
  designReferenceLimit,
  defaultDesignParams,
  isDesignPending,
  type DesignChatPlan,
} from "../../../shared/designStudio";
import { protectedProcedure, router } from "../../_core/trpc";
import { authorizeDesign } from "./access";
import { assetDirectory } from "./assets";
import { designModel } from "./provider";
import { designChatModel } from "./chatProvider";
import { collectChatReferences } from "./chatReferences";
import {
  execute,
  ownAsset,
  ownConversation,
  presentGeneration,
  jsonValue,
  transaction,
  type Scope,
} from "./repository";

const missing = () => {
  throw new TRPCError({ code: "NOT_FOUND", message: "对话不存在或无权访问" });
};
const busy = (message: string) => {
  throw new TRPCError({ code: "CONFLICT", message });
};
async function requireConversation(
  id: string,
  scope: Scope,
  tx?: any,
  lock = false
) {
  return (await ownConversation(id, scope, tx, lock)) || missing();
}
const uuidInput = z.object({ id: z.string().uuid() });
async function validateReferences(ids: string[], s: Scope) {
  let bytes = 0;
  for (const id of ids) {
    const asset = await ownAsset(id, s);
    if (!asset)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "参考图不存在或无权使用",
      });
    if (Number(asset.bytes) > 10 * 1024 * 1024) busy("参考图单张不能超过 10MB");
    bytes += Number(asset.bytes);
  }
  if (bytes > 30 * 1024 * 1024) busy("参考图合计不能超过 30MB");
}
// Called inside the per-user submission lock for both confirmed and direct images.
async function enqueueImage(
  input: z.infer<typeof designRequestSchema>,
  s: Scope,
  tx: any
) {
  const pending = await execute(
    "SELECT conversationId FROM design_generations WHERE workspaceId=? AND userId=? AND status IN ('queued','submitting','running')",
    [s.workspaceId, s.userId],
    tx
  );
  if (pending.some((r: any) => r.conversationId === input.conversationId))
    busy("当前对话正在生成，请稍后继续");
  if (new Set(pending.map((r: any) => r.conversationId)).size >= 2)
    busy("已有两个生图任务进行中，请等待完成");
  await validateReferences(input.references, s);
  const model = await designModel(s, undefined, input.params.model);
  await assetDirectory();
  const id = randomUUID();
  const count = Number(input.params.count);
  // One durable job per image. Each has its own provider task ID and recovery
  // state, so partial failures never resubmit successful/ambiguous paid calls.
  // All jobs are inserted under the existing user lock in one transaction.
  for (let index = 0; index < count; index++) {
    await execute(
      "INSERT INTO design_generations(id,conversationId,workspaceId,userId,requestId,prompt,params,referenceIds,providerId) VALUES(?,?,?,?,?,?,?,?,?)",
      [
        index === 0 ? id : randomUUID(),
        input.conversationId,
        s.workspaceId,
        s.userId,
        index === 0 ? input.requestId : randomUUID(),
        input.prompt,
        JSON.stringify({
          ...input.params,
          count: "1",
          ...(count > 1
            ? {
                batch: { id, index: index + 1, total: count },
              }
            : {}),
        }),
        JSON.stringify(input.references),
        model.id,
      ],
      tx
    );
  }
  await execute(
    "UPDATE design_conversations SET title=IF(title='新对话',?,title),updatedAt=NOW(3) WHERE id=?",
    [input.prompt.slice(0, 60), input.conversationId],
    tx
  );
  return { id };
}
export const designStudioRouter = router({
  conversations: protectedProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(200).default(60) })
        .default({ limit: 60 })
    )
    .query(async ({ ctx, input }) => {
      const s = await authorizeDesign(ctx.user, "read");
      const rows: any[] = await execute(
        "SELECT id,title,updatedAt FROM design_conversations WHERE workspaceId=? AND userId=? AND deletedAt IS NULL ORDER BY updatedAt DESC,id DESC LIMIT ?",
        [s.workspaceId, s.userId, input.limit + 1]
      );
      return {
        items: rows.slice(0, input.limit).map((r: any) => ({
          id: String(r.id),
          title: String(r.title),
          updatedAt: new Date(r.updatedAt).toISOString(),
        })),
        hasMore: rows.length > input.limit,
      };
    }),
  create: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const s = await authorizeDesign(ctx.user, "edit");
      await execute(
        "INSERT IGNORE INTO design_conversations(id,workspaceId,userId,title) VALUES(?,?,?,?)",
        [input.id, s.workspaceId, s.userId, "新对话"]
      );
      await requireConversation(input.id, s);
      return { id: input.id };
    }),
  rename: protectedProcedure
    .input(uuidInput.extend({ title: z.string().trim().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const s = await authorizeDesign(ctx.user, "edit");
      await requireConversation(input.id, s);
      await execute(
        "UPDATE design_conversations SET title=?,updatedAt=NOW(3) WHERE id=? AND workspaceId=? AND userId=?",
        [input.title, input.id, s.workspaceId, s.userId]
      );
      return { ok: true };
    }),
  history: protectedProcedure
    .input(
      uuidInput.extend({ limit: z.number().int().min(1).max(500).default(60) })
    )
    .query(async ({ ctx, input }) => {
      const s = await authorizeDesign(ctx.user, "read");
      const conversation = await requireConversation(input.id, s);
      const rows: any[] = await execute(
        "SELECT * FROM design_generations WHERE conversationId=? AND workspaceId=? AND userId=? AND deletedAt IS NULL ORDER BY createdAt DESC,id DESC LIMIT ?",
        [input.id, s.workspaceId, s.userId, input.limit + 1]
      );
      const chats: any[] = await execute(
        "SELECT * FROM design_chat_turns WHERE conversationId=? AND workspaceId=? AND userId=? ORDER BY createdAt DESC,id DESC LIMIT ?",
        [input.id, s.workspaceId, s.userId, input.limit + 1]
      );
      return {
        title: String(conversation.title),
        hasMore: rows.length > input.limit || chats.length > input.limit,
        items: rows.slice(0, input.limit).reverse().map(presentGeneration),
        chats: chats
          .slice(0, input.limit)
          .reverse()
          .map((r: any) => ({
            id: String(r.id),
            prompt: String(r.userText),
            status: String(r.status),
            reply: r.reply as string | null,
            error: r.errorText as string | null,
            referenceIds: jsonValue<string[]>(r.referenceIds, []),
            params: { ...defaultDesignParams, ...jsonValue(r.params, {}) },
            plan: jsonValue<DesignChatPlan | null>(r.plan, null),
            generationId: r.generationId as string | null,
            createdAt: new Date(r.createdAt).toISOString(),
          })),
      };
    }),
  chat: protectedProcedure
    .input(designChatRequestSchema)
    .mutation(async ({ ctx, input }) => {
      const s = await authorizeDesign(ctx.user, "edit");
      return transaction(async tx => {
        await execute(
          "SELECT id FROM users WHERE id=? FOR UPDATE",
          [s.userId],
          tx
        );
        await requireConversation(input.conversationId, s, tx, true);
        const existing = (
          await execute(
            "SELECT id FROM design_chat_turns WHERE workspaceId=? AND userId=? AND requestId=?",
            [s.workspaceId, s.userId, input.requestId],
            tx
          )
        )[0];
        if (existing) return { id: String(existing.id) };
        const active = await execute(
          "SELECT id FROM design_chat_turns WHERE workspaceId=? AND userId=? AND status IN ('queued','submitting')",
          [s.workspaceId, s.userId],
          tx
        );
        if (active.length) busy("正在整理需求，请等待回答后继续");
        const previous = await execute(
          "SELECT referenceIds,createdAt,params,plan FROM design_chat_turns WHERE conversationId=? AND workspaceId=? AND userId=? AND status='succeeded' ORDER BY createdAt DESC,id DESC",
          [input.conversationId, s.workspaceId, s.userId],
          tx
        );
        const image = (
          await execute(
            "SELECT assetIds,createdAt FROM design_generations WHERE conversationId=? AND workspaceId=? AND userId=? AND status='succeeded' AND deletedAt IS NULL ORDER BY createdAt DESC,id DESC LIMIT 1",
            [input.conversationId, s.workspaceId, s.userId],
            tx
          )
        )[0];
        const latest = previous[0];
        const generated =
          input.referenceMode !== "replace" &&
          !input.references.length &&
          image &&
          (!latest || new Date(image.createdAt) > new Date(latest.createdAt))
            ? jsonValue<string[]>(image.assetIds, [])
            : [];
        const references = collectChatReferences(
          previous,
          [...generated, ...input.references],
          input.referenceMode === "replace"
        );
        if (references.length > designReferenceLimit(input.params))
          busy(
            `多轮参考图合计 ${references.length} 张，当前模型最多支持 ${designReferenceLimit(input.params)} 张。请勾选“仅使用本次参考图”，重新选择需要的图片，或新建对话。`
          );
        await validateReferences(references, s);
        const model = await designChatModel(s);
        const id = randomUUID();
        await execute(
          "INSERT INTO design_chat_turns(id,conversationId,workspaceId,userId,requestId,userText,referenceIds,params,providerId) VALUES(?,?,?,?,?,?,?,?,?)",
          [
            id,
            input.conversationId,
            s.workspaceId,
            s.userId,
            input.requestId,
            input.prompt,
            JSON.stringify(references),
            JSON.stringify({
              ...input.params,
              chatReferenceReset: input.referenceMode === "replace",
              chatNewReferenceIds: input.references,
            }),
            model.id,
          ],
          tx
        );
        await execute(
          "UPDATE design_conversations SET title=IF(title='新对话',?,title),updatedAt=NOW(3) WHERE id=?",
          [input.prompt.slice(0, 60), input.conversationId],
          tx
        );
        return { id };
      });
    }),
  generate: protectedProcedure
    .input(designConfirmSchema)
    .mutation(async ({ ctx, input }) => {
      const s = await authorizeDesign(ctx.user, "edit");
      // Serialize submissions per user, including concurrent tabs/conversations.
      return transaction(async tx => {
        await execute(
          "SELECT id FROM users WHERE id=? FOR UPDATE",
          [s.userId],
          tx
        );
        await requireConversation(input.conversationId, s, tx, true);
        const existing = (
          await execute(
            "SELECT id FROM design_generations WHERE workspaceId=? AND userId=? AND requestId=?",
            [s.workspaceId, s.userId, input.requestId],
            tx
          )
        )[0];
        if (existing) return { id: String(existing.id) };
        const planTurn = (
          await execute(
            "SELECT * FROM design_chat_turns WHERE conversationId=? AND workspaceId=? AND userId=? ORDER BY createdAt DESC,id DESC LIMIT 1 FOR UPDATE",
            [input.conversationId, s.workspaceId, s.userId],
            tx
          )
        )[0];
        const plan = jsonValue<DesignChatPlan | null>(planTurn?.plan, null);
        if (
          !planTurn ||
          planTurn.id !== input.planId ||
          planTurn.status !== "succeeded" ||
          !plan?.ready ||
          !plan.prompt
        )
          busy("方案已更新或尚未准备好，请确认最新方案");
        if (planTurn.generationId) return { id: String(planTurn.generationId) };
        const draft = input.draft || {
          prompt: plan!.prompt,
          params: jsonValue(planTurn.params, {}),
          references: plan!.referenceIds,
        };
        const accepted = designRequestSchema.parse({
          ...draft,
          conversationId: input.conversationId,
          requestId: input.requestId,
        });
        const result = await enqueueImage(accepted, s, tx);
        await execute(
          "UPDATE design_chat_turns SET generationId=?,plan=?,params=? WHERE id=?",
          [
            result.id,
            JSON.stringify({
              ready: true,
              prompt: accepted.prompt,
              promptTranslation:
                accepted.prompt === plan!.prompt
                  ? plan!.promptTranslation || ""
                  : "",
              referenceIds: accepted.references,
            }),
            JSON.stringify({
              ...jsonValue(planTurn.params, {}),
              ...accepted.params,
            }),
            planTurn.id,
          ],
          tx
        );
        return result;
      });
    }),
  generateDirect: protectedProcedure
    .input(designRequestSchema)
    .mutation(async ({ ctx, input }) => {
      const s = await authorizeDesign(ctx.user, "edit");
      return transaction(async tx => {
        await execute(
          "SELECT id FROM users WHERE id=? FOR UPDATE",
          [s.userId],
          tx
        );
        await requireConversation(input.conversationId, s, tx, true);
        const existing = (
          await execute(
            "SELECT id FROM design_generations WHERE workspaceId=? AND userId=? AND requestId=?",
            [s.workspaceId, s.userId, input.requestId],
            tx
          )
        )[0];
        if (existing) return { id: String(existing.id) };
        const chatting = await execute(
          "SELECT id FROM design_chat_turns WHERE conversationId=? AND status IN ('queued','submitting') LIMIT 1",
          [input.conversationId],
          tx
        );
        if (chatting.length) busy("正在整理需求，请等待回答后继续");
        return enqueueImage(input, s, tx);
      });
    }),
  remove: protectedProcedure
    .input(uuidInput.extend({ kind: z.enum(["conversation", "generation"]) }))
    .mutation(async ({ ctx, input }) => {
      const s = await authorizeDesign(ctx.user, "delete");
      await transaction(async tx => {
        await execute(
          "SELECT id FROM users WHERE id=? FOR UPDATE",
          [s.userId],
          tx
        );
        if (input.kind === "conversation") {
          await requireConversation(input.id, s, tx, true);
          if (
            (
              await execute(
                "SELECT id FROM design_chat_turns WHERE conversationId=? AND status IN ('queued','submitting') LIMIT 1",
                [input.id],
                tx
              )
            ).length
          )
            busy("请等待需求沟通完成后再删除对话");
          if (
            (
              await execute(
                "SELECT id FROM design_generations WHERE conversationId=? AND status IN ('queued','submitting','running') LIMIT 1",
                [input.id],
                tx
              )
            ).length
          )
            busy("请等待生成完成后再删除对话");
          await execute(
            "UPDATE design_conversations SET deletedAt=NOW(3) WHERE id=? AND userId=? AND workspaceId=?",
            [input.id, s.userId, s.workspaceId],
            tx
          );
        } else {
          const row = (
            await execute(
              "SELECT status,conversationId FROM design_generations WHERE id=? AND workspaceId=? AND userId=? AND deletedAt IS NULL FOR UPDATE",
              [input.id, s.workspaceId, s.userId],
              tx
            )
          )[0];
          if (!row) missing();
          await requireConversation(row.conversationId, s, tx);
          if (isDesignPending(row.status)) busy("请等待生成完成后再删除");
          await execute(
            "UPDATE design_generations SET deletedAt=NOW(3) WHERE id=?",
            [input.id],
            tx
          );
        }
      });
      return { ok: true };
    }),
  check: protectedProcedure
    .input(uuidInput)
    .mutation(async ({ ctx, input }) => {
      const s = await authorizeDesign(ctx.user, "edit");
      const result = await execute(
        "UPDATE design_generations g JOIN design_conversations c ON c.id=g.conversationId SET g.status='running',g.errorText=NULL,g.nextPollAt=NOW(3),g.submittedAt=NOW(3) WHERE g.id=? AND g.workspaceId=? AND g.userId=? AND g.status='unknown' AND g.providerTaskId IS NOT NULL AND g.deletedAt IS NULL AND c.deletedAt IS NULL",
        [input.id, s.workspaceId, s.userId]
      );
      if (!result.affectedRows) busy("这个任务无法检查进度");
      return { ok: true };
    }),
});
