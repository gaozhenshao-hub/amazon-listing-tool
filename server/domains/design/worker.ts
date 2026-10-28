import { randomUUID } from "node:crypto";
import { designParamsSchema } from "../../../shared/designStudio";
import { execute, jsonValue, ownAsset, transaction } from "./repository";
import { assetBytes, saveAsset } from "./assets";
import { runDesignChatStep } from "./chatWorker";
import {
  designGenerationPayload,
  designModel,
  downloadResult,
  parseProviderTaskId,
  providerRequest,
  ProviderRejected,
  resultUrls,
} from "./provider";

// Expired submissions must never be automatically POSTed again: the provider
// may have accepted and charged the request before the process was interrupted.
export const recoveryStatus = (status: string, taskId: string | null) =>
  status === "submitting" ? (taskId ? "running" : "unknown") : status;

export async function runDesignStep() {
  const token = randomUUID();
  const job = await transaction(async tx => {
    const rows = await execute(
      "SELECT * FROM design_generations WHERE status IN ('queued','submitting','running') AND nextPollAt<=NOW(3) AND (leaseUntil IS NULL OR leaseUntil<NOW(3)) AND deletedAt IS NULL ORDER BY nextPollAt,createdAt LIMIT 1 FOR UPDATE SKIP LOCKED",
      [],
      tx
    );
    const row = rows[0];
    if (!row) return null;
    await execute(
      "UPDATE design_generations SET leaseToken=?,leaseUntil=DATE_ADD(NOW(3),INTERVAL 180 SECOND) WHERE id=?",
      [token, row.id],
      tx
    );
    return row;
  });
  if (!job) return;
  const update = (sets: string, values: unknown[] = []) =>
    execute(
      `UPDATE design_generations SET ${sets},leaseUntil=NULL,leaseToken=NULL WHERE id=? AND leaseToken=?`,
      [...values, job.id, token]
    );
  const scope = {
    userId: Number(job.userId),
    workspaceId: Number(job.workspaceId),
  };
  if (job.status === "submitting") {
    await update("status=?,errorText=?", [
      recoveryStatus(job.status, job.providerTaskId),
      "上次提交被中断，结果可能已生成；请核对后再决定是否重新生成",
    ]);
    return;
  }
  let submitted = false;
  try {
    const params = designParamsSchema.parse(jsonValue(job.params, {}));
    const model = await designModel(
      scope,
      Number(job.providerId),
      params.model
    );
    if (job.status === "queued") {
      const user = (
        await execute("SELECT id FROM users WHERE id=? AND status='active'", [
          scope.userId,
        ])
      )[0];
      if (!user) throw new Error("账号已停用");
      const images: string[] = [];
      for (const id of jsonValue<string[]>(job.referenceIds, [])) {
        const asset = await ownAsset(id, scope);
        if (!asset) throw new Error("参考图不可用");
        images.push(
          `data:${asset.mime};base64,${(await assetBytes(asset)).toString("base64")}`
        );
      }
      const changed = await execute(
        "UPDATE design_generations SET status='submitting',submittedAt=NOW(3) WHERE id=? AND leaseToken=? AND status='queued'",
        [job.id, token]
      );
      if (!changed.affectedRows) return;
      submitted = true;
      const response = await providerRequest(
        model,
        "generate",
        designGenerationPayload(job.prompt, params, images)
      );
      const taskId = parseProviderTaskId(response);
      // This commit is deliberately immediate, before any image/status work.
      await update(
        "status='running',providerTaskId=?,nextPollAt=DATE_ADD(NOW(3),INTERVAL 8 SECOND),errorText=NULL",
        [taskId]
      );
      return;
    }
    const response = await providerRequest(
      model,
      `status?task_id=${encodeURIComponent(job.providerTaskId)}`
    );
    if (response.is_final === true && response.state === "failed") {
      await update("status='failed',finishedAt=NOW(3),errorText=?", [
        "图片生成失败，请检查提示词、参考图或服务额度后再试",
      ]);
    } else if (response.is_final === true && response.state === "success") {
      const ids: string[] = [];
      for (const url of resultUrls(response)) {
        const saved = await saveAsset(
          scope,
          await downloadResult(url),
          `生成图片-${job.id}.png`,
          "generated"
        );
        ids.push(saved.id);
      }
      await update(
        "status='succeeded',assetIds=?,usageInfo=?,progress=100,errorText=NULL,finishedAt=NOW(3)",
        [
          JSON.stringify(ids),
          JSON.stringify({
            cost: response.cost ?? null,
            input_tokens: response.input_tokens ?? null,
            output_tokens: response.output_tokens ?? null,
          }),
        ]
      );
    } else if (Date.now() - new Date(job.submittedAt).getTime() > 30 * 60_000) {
      await update("status='unknown',errorText=?", [
        "服务处理时间较长，可以点击检查进度继续查询，不会重复提交",
      ]);
    } else {
      const progress = Math.max(
        0,
        Math.min(99, parseInt(response.progress, 10) || 0)
      );
      await update("progress=?,nextPollAt=DATE_ADD(NOW(3),INTERVAL 8 SECOND)", [
        progress,
      ]);
    }
  } catch (error) {
    const diagnostic = error as { name?: string; reason?: string };
    console.warn("[Design Worker] task step incomplete", {
      jobId: job.id,
      phase: submitted ? "submit" : job.status,
      reason: diagnostic.reason || diagnostic.name || "unknown",
    });
    if (submitted) {
      await update("status=?,errorText=?", [
        error instanceof ProviderRejected ? "failed" : "unknown",
        error instanceof ProviderRejected
          ? error.message
          : "提交结果暂无法确认，可能已产生费用。请先核对服务记录，避免重复生成",
      ]);
    } else if (job.status === "queued") {
      await update("status='failed',errorText=?,finishedAt=NOW(3)", [
        "生成准备失败，请检查模型、参考图和存储配置",
      ]);
    } else if (Date.now() - new Date(job.submittedAt).getTime() > 30 * 60_000) {
      await update("status='unknown',errorText=?", [
        "暂时无法获取或保存结果。可点击检查进度重试查询，不会重复生成",
      ]);
    } else {
      await update(
        "nextPollAt=DATE_ADD(NOW(3),INTERVAL 15 SECOND),errorText=?",
        ["正在重试获取或保存图片结果"]
      );
    }
  }
}
export function startDesignWorker() {
  let stopped = false;
  let active: Promise<void> | null = null;
  let chatActive: Promise<void> | null = null;
  const chatTick = () => {
    if (stopped || chatActive) return;
    chatActive = runDesignChatStep()
      .catch(() => console.error("[Design Chat] queue step failed"))
      .finally(() => {
        chatActive = null;
      });
  };
  const tick = () => {
    if (stopped || active) return;
    active = runDesignStep()
      .catch(() => console.error("[Design Worker] queue step failed"))
      .finally(() => {
        active = null;
      });
  };
  const interval = setInterval(() => {
    tick();
    chatTick();
  }, 2000);
  tick();
  chatTick();
  return async () => {
    stopped = true;
    clearInterval(interval);
    await active;
    await chatActive;
  };
}
