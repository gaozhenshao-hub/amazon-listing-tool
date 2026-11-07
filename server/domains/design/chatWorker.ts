import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { productionConversationContext } from "../listing/imageProduction";
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
    const params = jsonValue<any>(job.params, {});
    if (params.productionSkill) {
      const current = await productionConversationContext(
        scope,
        job.conversationId
      );
      if (
        current.skill.version !== params.productionSkill.version ||
        current.skill.hash !== params.productionSkill.hash
      )
        throw new Error("制作技能已更新，请重新打开步骤");
    }
    const mode =
      params.designMode === "chat" || params.designMode === "scene"
        ? params.designMode
        : "studio";
    const contents: any[] =
      mode === "chat"
        ? history.reverse().flatMap((turn: any) => [
            { role: "user", parts: [{ text: String(turn.userText) }] },
            { role: "model", parts: [{ text: String(turn.reply) }] },
          ])
        : buildChatHistory(history.reverse(), refs);
    const parts: any[] = [
      {
        text:
          mode === "chat"
            ? String(job.userText)
            : `${job.userText}\n\n界面生图参数：${JSON.stringify(jsonValue(job.params, {}))}\n本对话可用参考图共${refs.length}张，下方统一编号，包含此前上传的图片。本轮新上传图号：${
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
    const scene = params.scene;
    if (mode === "scene" && (!scene || !params.sceneSkill?.instruction))
      throw new Error("场景策划配置不可用");
    const sceneInstruction =
      mode === "scene"
        ? `技能要求：${params.sceneSkill.instruction}\n${params.sceneSkill.bindingInstruction || ""}\n本次任务是生成场景图。产品主体参考图编号：${scene.products.map((id: string) => refs.indexOf(id) + 1).join("、")}；构图参考图编号：${refs.indexOf(scene.composition) + 1}；效果参考图编号：${refs.indexOf(scene.effect) + 1}。${scene.revision ? `待调整的已有结果是参考图${refs.indexOf(scene.revision) + 1}，按用户意见调整，并保留未要求修改的部分。` : ""}产品图决定产品本身，构图图决定位置和画面，效果图决定风格。将所有参考图按原顺序用于方案，使用选中后的对应编号，给出完整提示词。`
        : "";
    const productionInstruction = params.productionSkill?.instruction
      ? `本轮独立制作技能要求：${params.productionSkill.instruction}\n阶段：${params.productionStage}。只完成本步骤；用户在此对话的指导只调整当前结果，不自动发布或修改正式Skill。方案必须保留所有输入参考图片及编号顺序。`
      : "";
    const response = await requestDesignChat(
      model,
      contents,
      mode,
      [sceneInstruction, productionInstruction].filter(Boolean).join("\n")
    );
    if (mode === "chat" && response?.candidates?.[0]?.finishReason !== "STOP")
      throw new Error("模型回答未完整返回");
    const result =
      mode === "chat"
        ? {
            reply: (response?.candidates?.[0]?.content?.parts || [])
              .filter((p: any) => typeof p.text === "string" && !p.thought)
              .map((p: any) => p.text)
              .join("")
              .trim(),
            plan: null,
          }
        : parseDesignChatResponse(response, refs);
    if (!result.reply) throw new Error("模型未返回回答");
    if (
      (mode === "scene" || productionInstruction) &&
      result.plan?.ready &&
      (result.plan.referenceIds.length !== refs.length ||
        result.plan.referenceIds.some(
          (id: string, i: number) => id !== refs[i]
        ))
    )
      throw new Error("场景策划未保留完整参考图");
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
