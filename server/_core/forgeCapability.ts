import { TRPCError } from "@trpc/server";
import { ENV } from "./env";

export type ForgeCapability =
  | "image_generation"
  | "voice_transcription"
  | "maps"
  | "data_api"
  | "heartbeat";

const capabilityLabels: Record<ForgeCapability, string> = {
  image_generation: "图片生成",
  voice_transcription: "语音转写",
  maps: "地图服务",
  data_api: "外部数据检索",
  heartbeat: "托管定时任务",
};

export class ForgeCapabilityUnavailableError extends TRPCError {
  readonly capabilityCode = "INDEPENDENT_CAPABILITY_UNAVAILABLE";
  readonly capability: ForgeCapability;

  constructor(capability: ForgeCapability) {
    super({
      code: "PRECONDITION_FAILED",
      message: `当前独立部署尚未配置${capabilityLabels[capability]}服务，无法执行此操作。`,
    });
    this.name = "ForgeCapabilityUnavailableError";
    this.capability = capability;
  }
}

export function isForgeCapabilityUnavailableInLocalMode(): boolean {
  return ENV.authMode === "local" && (!ENV.forgeApiUrl || !ENV.forgeApiKey);
}

export function assertForgeCapabilityAvailable(capability: ForgeCapability): void {
  if (isForgeCapabilityUnavailableInLocalMode()) {
    throw new ForgeCapabilityUnavailableError(capability);
  }
  if (!ENV.forgeApiUrl) {
    throw new Error("BUILT_IN_FORGE_API_URL is not configured");
  }
  if (!ENV.forgeApiKey) {
    throw new Error("BUILT_IN_FORGE_API_KEY is not configured");
  }
}
