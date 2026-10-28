import { and, eq, isNull, or, desc } from "drizzle-orm";
import { emperorModelProviders } from "../../../drizzle/schema";
import { getDb } from "../../repositories/dbClient";
import { resolveGovernedModelApiKey } from "../ai_os/services/teamorouterCatalog";
import { safeHttpRequest } from "../../infrastructure/http/safeHttpClient";

export const PARAFormer_MODEL = "paraformer-v2";
export function paraformerBaseUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.hostname === "dashscope.aliyuncs.com" ||
      /^ws-[a-z0-9]+\.cn-beijing\.maas\.aliyuncs\.com$/.test(url.hostname)
    ) ||
    ![
      "/",
      "/api/v1",
      "/api/v1/",
      "/compatible-mode/v1",
      "/compatible-mode/v1/",
    ].includes(url.pathname)
  )
    throw Error("请使用阿里云百炼北京地域的官方接口地址");
  return url.origin + "/api/v1";
}
export async function paraformerConfig(
  workspaceId: number,
  providerId?: number
) {
  const db = await getDb();
  if (!db) throw Error("会议服务暂不可用");
  const [row] = await db
    .select()
    .from(emperorModelProviders)
    .where(
      and(
        eq(emperorModelProviders.modelId, PARAFormer_MODEL),
        eq(emperorModelProviders.isActive, 1),
        or(
          eq(emperorModelProviders.workspaceId, workspaceId),
          isNull(emperorModelProviders.workspaceId)
        ),
        providerId ? eq(emperorModelProviders.id, providerId) : undefined
      )
    )
    .orderBy(
      desc(emperorModelProviders.workspaceId),
      desc(emperorModelProviders.id)
    )
    .limit(1);
  if (!row) throw Error("请先在大模型管理中配置并启用 Paraformer-v2");
  const key = resolveGovernedModelApiKey(row.apiKeyRef);
  if (!key) throw Error("请先在大模型管理中填写 Paraformer-v2 的 API Key");
  return {
    id: row.id,
    key,
    baseUrl: paraformerBaseUrl(row.baseUrl || "https://dashscope.aliyuncs.com"),
  };
}
export type ParaformerConfig = Awaited<ReturnType<typeof paraformerConfig>>;
export class SpeechServiceError extends Error {
  constructor(
    message: string,
    readonly definitive = false
  ) {
    super(message);
  }
}
export function speechError(code: string, status = 0) {
  if (status === 401 || /InvalidApiKey|AccessDenied|Unauthorized/i.test(code))
    return "百炼密钥无效或没有权限，请在大模型管理中更新北京地域的 API Key";
  if (/Arrearage|Balance|Payment|Quota|FreeTier/i.test(code) || status === 402)
    return "百炼额度不足或账号欠费，请检查免费额度及阿里云余额后再试";
  if (/InvalidFile|InvalidParameter|Unsupported/i.test(code))
    return "音频无法识别，请检查文件格式、时长以及录音是否完整";
  return "语音服务暂时无法处理，请稍后查看处理状态";
}
async function request(
  config: ParaformerConfig,
  suffix: string,
  body?: unknown
) {
  const response = await safeHttpRequest(config.baseUrl + suffix, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      ...(body ? { "X-DashScope-Async": "enable" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    timeoutMs: 30000,
    maxRedirects: 0,
    maxResponseBytes: 1024 * 1024,
    allowedHosts: [new URL(config.baseUrl).hostname],
    auditContext: { operation: "ops.meeting.speech" },
  });
  const data = response.json<any>();
  if (!response.ok)
    throw new SpeechServiceError(
      speechError(String(data?.code || ""), response.status),
      response.status >= 400 && response.status < 500 && response.status !== 408
    );
  return data;
}
// Submission is deliberately single-attempt: a lost response must not cause a second paid task.
export async function submitSpeech(config: ParaformerConfig, audioUrl: string) {
  const data = await request(config, "/services/audio/asr/transcription", {
    model: PARAFormer_MODEL,
    input: { file_urls: [audioUrl] },
    parameters: { channel_id: [0], language_hints: ["zh", "en"] },
  });
  const id = data?.output?.task_id;
  if (typeof id !== "string" || !/^[a-zA-Z0-9-]{8,100}$/.test(id))
    throw new SpeechServiceError(
      "提交结果暂时无法确认，请联系管理员核对，勿重复上传"
    );
  return id;
}
export function speechText(data: any, allowEmpty = false) {
  if (!Array.isArray(data?.transcripts))
    throw new SpeechServiceError("语音结果格式异常，录音已保留", true);
  const text = data.transcripts
    .map((t: any) => {
      if (Array.isArray(t.sentences) && t.sentences.length)
        return t.sentences
          .map((s: any) => (typeof s.text === "string" ? s.text : ""))
          .join("\n");
      return typeof t.text === "string" ? t.text : "";
    })
    .join("\n")
    .trim();
  if (!text && !allowEmpty)
    throw new SpeechServiceError(
      "没有识别到语音，请检查录音音量或上传其他录音",
      true
    );
  if (text.length > 100000)
    throw new SpeechServiceError(
      "录音文字过长，请分段上传，原录音已保留",
      true
    );
  return text;
}
export async function pollSpeech(config: ParaformerConfig, taskId: string, options: { allowEmpty?: boolean } = {}) {
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(taskId))
    throw new SpeechServiceError("语音任务记录无效", true);
  const data = await request(config, `/tasks/${taskId}`),
    out = data?.output;
  if (["RUNNING", "PENDING"].includes(out?.task_status)) return null;
  // Paraformer reports VAD/no-word results as failed subtasks. For video
  // analysis these are valid music/silence outcomes, not a failed file read.
  const noSpeechCodes=["SUCCESS_WITH_NO_VALID_FRAGMENT","ASR_RESPONSE_HAVE_NO_WORDS"];
  const resultCode=String(out?.code||data?.code||out?.results?.[0]?.code||"");
  if(options.allowEmpty && ["SUCCEEDED","FAILED"].includes(out?.task_status) && (!out?.results || out.results.length===1) && noSpeechCodes.includes(resultCode))
    return {text:"",sentences:[],duration:Number(data.usage?.duration||0)};
  if (out?.task_status !== "SUCCEEDED")
    throw new SpeechServiceError(
      speechError(String(out?.code || data?.code || "")),
      true
    );
  const result = out.results?.[0];
  if (out.results?.length !== 1 || result.subtask_status !== "SUCCEEDED")
    throw new SpeechServiceError(speechError(String(result?.code || "")), true);
  const url = new URL(result.transcription_url);
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hostname !== "dashscope-result-bj.oss-cn-beijing.aliyuncs.com"
  )
    throw new SpeechServiceError("语音结果下载地址异常，录音已保留", true);
  const response = await safeHttpRequest(url.href, {
    allowedHosts: [url.hostname],
    maxRedirects: 0,
    timeoutMs: 30000,
    maxResponseBytes: 16 * 1024 * 1024,
    auditContext: { operation: "ops.meeting.speech.result" },
  });
  if (!response.ok)
    throw new SpeechServiceError("语音结果暂时无法下载，正在等待重试");
  const transcript = response.json<any>();
  return {
    text: speechText(transcript, options.allowEmpty),
    sentences: (Array.isArray(transcript?.transcripts) ? transcript.transcripts : []).flatMap((t: any) => Array.isArray(t.sentences) ? t.sentences : []).filter((s: any) => typeof s.text === "string" && Number.isFinite(s.begin_time) && Number.isFinite(s.end_time)).map((s: any) => ({ start: s.begin_time / 1000, end: s.end_time / 1000, text: s.text })),
    duration: Number(data.usage?.duration || 0),
  };
}
