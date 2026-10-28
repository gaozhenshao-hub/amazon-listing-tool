import {
  StoredKnowledgeVideoSchema,
  type KnowledgeVideo,
} from "../../../shared/knowledgeVideos";
import { parseStorageUri, resolveStoredObjectUrl } from "../../storage";

export function knowledgeVideoStorageKey(
  value: string | null,
  workspaceId: number,
  poster: boolean
) {
  if (!value || !Number.isSafeInteger(workspaceId) || workspaceId <= 0)
    return null;
  const parsed = parseStorageUri(value);
  const suffix = poster ? "poster\\.webp" : "mp4";
  if (
    !parsed ||
    !["local", "s3", "oss"].includes(parsed.provider) ||
    !new RegExp(
      `^acquisition/${workspaceId}/snapshots/[0-9]+/video/[0-9]+-[a-f0-9]{64}\\.${suffix}$`
    ).test(parsed.key)
  )
    return null;
  return value;
}

/** Resolve only videos inside the already-authorized collection workspace. */
export async function resolveKnowledgeVideos(
  value: unknown,
  workspaceId: number
): Promise<KnowledgeVideo[]> {
  if (!Array.isArray(value)) return [];
  const result: KnowledgeVideo[] = [];
  for (const item of value.slice(0, 21)) {
    const parsed = StoredKnowledgeVideoSchema.safeParse(item);
    if (!parsed.success) continue;
    const video = parsed.data;
    const resolve = async (reference: string | null, poster: boolean) => {
      const allowed = knowledgeVideoStorageKey(reference, workspaceId, poster);
      return allowed ? resolveStoredObjectUrl(allowed).catch(() => null) : null;
    };
    const [videoUrl, posterUrl] = await Promise.all([
      resolve(video.videoUrl, false),
      resolve(video.posterUrl, true),
    ]);
    result.push({
      ...video,
      videoUrl,
      posterUrl,
      status:
        videoUrl && posterUrl && video.status === "ready" ? "ready" : "failed",
    });
  }
  return result;
}
