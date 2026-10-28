import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { assetBytes } from "./assets";
import {
  designChatModel,
  parseDesignChatResponse,
  requestDesignChat,
} from "./chatProvider";
import {
  execute,
  jsonValue,
  ownAsset,
  ownConversation,
  transaction,
} from "./repository";

export function buildChatHistory(turns: any[], references: string[] = []) {
  return turns.flatMap(turn => [
    {
      role: "user",
      parts: [
        {
          text: `${String(turn.userText)}\n本轮上传图片（本次统一编号）：${
            jsonValue<string[]>(
              jsonValue<any>(turn.params, {}).chatNewReferenceIds ??
                turn.referenceIds,
              []
            )
              .map(id => references.indexOf(id) + 1)
              .filter(index => index > 0)
              .join("、") || "无可用图片"
          }`,
        },
      ],
    },
    {
      role: "model",
      parts: [
        {
          text: JSON.stringify({
            reply: turn.reply,
            plan: jsonValue(turn.plan, null),
            planReferenceIndexes: jsonValue<any>(
              turn.plan,
              {}
            ).referenceIds?.map((id: string) => references.indexOf(id) + 1),
          }),
        },
      ],
    },
  ]);
}
export async function runDesignChatStep() {
  const token = randomUUID();
  const job = await transaction(async tx => {
    const row = (
      await execute(
        "SELECT * FROM design_chat_turns WHERE status IN ('queued','submitting') AND (leaseUntil IS NULL OR leaseUntil<NOW(3)) ORDER BY createdAt,id LIMIT 1 FOR UPDATE SKIP LOCKED",
        [],
        tx
      )
    )[0];
    if (!row) return null;
    await execute(
      "UPDATE design_chat_turns SET leaseToken=?,leaseUntil=DATE_ADD(NOW(3),INTERVAL 240 SECOND) WHERE id=?",
      [token, row.id],
      tx
    );
    return row;
  });
  if (!job) return;
  const update = (sets: string, values: unknown[] = []) =>
    execute(
      `UPDATE design_chat_turns SET ${sets},leaseToken=NULL,leaseUntil=NULL,finishedAt=NOW(3) WHERE id=? AND leaseToken=?`,
      [...values, job.id, token]
    );
  if (job.status === "submitting") {
    await update("status='failed',errorText=?", [
      "上次沟通被中断，请重新发送；不会自动重复调用或生图",
    ]);
    return;
  }
  const scope = {
    userId: Number(job.userId),
    workspaceId: Number(job.workspaceId),
  };
  try {
    if (!(await ownConversation(job.conversationId, scope)))
      throw new Error("对话已删除");
    if (
      !(
        await execute("SELECT id FROM users WHERE id=? AND status='active'", [
          scope.userId,
        ])
      ).length
    )
      throw new Error("账号已停用");
    const model = await designChatModel(scope, Number(job.providerId));
    const history = await execute(
      "SELECT userText,reply,plan,referenceIds,params FROM design_chat_turns WHERE conversationId=? AND workspaceId=? AND userId=? AND status='succeeded' AND createdAt<=? ORDER BY createdAt DESC,id DESC LIMIT 40",
      [job.conversationId, scope.workspaceId, scope.userId, job.createdAt]
    );
    // A bounded recent context is intentional; preserve the complete latest plan.
    const refs = jsonValue<string[]>(job.referenceIds, []);
    const contents: any[] = buildChatHistory(history.reverse(), refs);
    const parts: any[] = [
      {
        text: `${job.userText}\n\n界面生图参数：${JSON.stringify(jsonValue(job.params, {}))}\n本对话可用参考图共${refs.length}张，下方统一编号，包含此前上传的图片。本轮新上传图号：${
          jsonValue<string[]>(
            jsonValue<any>(job.params, {}).chatNewReferenceIds,
            []
          )
            .map(id => refs.indexOf(id) + 1)
            .join("、") || "无"
        }。请结合历史需求使用，不要只参考最后一张。`,
      },
    ];
    for (let i = 0; i < refs.length; i++) {
      const asset = await ownAsset(refs[i], scope);
      if (!asset) throw new Error("参考图不可用");
      // Vision-sized copy only; original private image goes to Image 2.5.
      const image = await sharp(await assetBytes(asset))
        .rotate()
        .resize({
          width: 1536,
          height: 1536,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer();
      parts.push(
        { text: `参考图 ${i + 1}` },
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: image.toString("base64"),
          },
        }
      );
    }
    contents.push({ role: "user", parts });
    await execute(
      "UPDATE design_chat_turns SET status='submitting' WHERE id=? AND leaseToken=?",
      [job.id, token]
    );
    const response = await requestDesignChat(model, contents);
    const result = parseDesignChatResponse(response, refs);
    await update(
      "status='succeeded',reply=?,plan=?,usageInfo=?,errorText=NULL",
      [
        result.reply,
        JSON.stringify(result.plan),
        JSON.stringify(response.usageMetadata || {}),
      ]
    );
  } catch (error) {
    console.warn("[Design Chat] turn failed", {
      id: job.id,
      type: (error as Error).name,
    });
    await update("status='failed',errorText=?", [
      "本次需求沟通未完成，请重新发送。请检查模型额度、网络或参考图；没有触发生图。",
    ]);
  }
}
