import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { safeHttpRequest } from "../../infrastructure/http/safeHttpClient";
import { storagePut } from "../../storage";
import { parseStorageUri } from "../../storage";
import { verifiedLocalObjectPath } from "../../infrastructure/localObjectStorage";
import { videoPoster } from "../knowledge/videoMedia";
import type { DbExecutor } from "../../repositories/dbClient";
import { createAssetCandidate } from "./repository";
import type { SourceAssetReference } from "./amazonNormalizer";
import { AMAZON_MEDIA_HOSTS, amazonMediaUrl, downloadableAmazonVideo } from "./amazonVideos";
import { createVideoDownloadSlot } from "./videoDownloadSlot";
const acquireVideoSlot = createVideoDownloadSlot();

export function isMp4(bytes: Buffer) {
  return bytes.length >= 24 && bytes.toString("ascii",4,8)==="ftyp" && bytes.readUInt32BE(0)>=16 && bytes.readUInt32BE(0)<=bytes.length;
}

/** Videos are bounded and downloaded sequentially, independently of image decoding. */
export async function downloadVideoAsset(...args: Parameters<typeof downloadVideoInSlot>) {
  const release = await acquireVideoSlot(args[0].signal);
  try { return await downloadVideoInSlot(...args); }
  finally { release(); }
}
async function downloadVideoInSlot(input: { workspaceId:number; snapshotId:number; signal?:AbortSignal }, asset:SourceAssetReference, existing?:{storageKey:string|null;thumbnailStorageKey:string|null;contentHash:string|null;sizeBytes:number|null}) {
  let storageKey=existing?.storageKey??null, thumbnailStorageKey=existing?.thumbnailStorageKey??null, contentHash=existing?.contentHash??null, sizeBytes=existing?.sizeBytes??null, attempts=0;
  let failureReason:string|null=null;
  const options={allowedHostSuffixes:AMAZON_MEDIA_HOSTS,maxRedirects:2,signal:input.signal,
    auditContext:{workspaceId:input.workspaceId,operation:"knowledge.amazon.video.fetch"}};
  async function savePoster(bytes:Buffer) {
    const preview=await sharp(bytes,{limitInputPixels:40_000_000}).rotate().resize({width:1600,height:1600,fit:"inside",withoutEnlargement:true}).webp({quality:82}).toBuffer();
    const hash=createHash("sha256").update(preview).digest("hex");
    thumbnailStorageKey=(await storagePut(`acquisition/${input.workspaceId}/snapshots/${input.snapshotId}/video/${asset.positionIndex}-${hash}.poster.webp`,preview,"image/webp")).storageUri;
  }
  for (let attempt=1; attempt<=2; attempt++) {
    attempts=attempt;
    try {
      input.signal?.throwIfAborted();
      if (!thumbnailStorageKey) {
        // A missing/broken source poster must not prevent the video download.
        try {const poster=amazonMediaUrl(asset.posterUrl,"poster");
          if(poster){const response=await safeHttpRequest(poster,{...options,timeoutMs:30_000,maxResponseBytes:15*1024*1024});if(response.ok)await savePoster(response.body);}
        } catch {input.signal?.throwIfAborted();}
      }
      if (!storageKey) {
        failureReason="video_source_unsupported";
        const url=downloadableAmazonVideo(asset.sourceUrl);
        failureReason="video_network";
        const response=await safeHttpRequest(url,{...options,responseBodyProfile:"amazon-video",timeoutMs:600_000,maxResponseBytes:200*1024*1024});
        if(!response.ok){failureReason=response.status===403||response.status===404?"video_link_unavailable":"video_http_error";throw new Error("视频下载失败");}
        if(!isMp4(response.body)){failureReason="video_invalid_file";throw new Error("视频格式不完整");}
        contentHash=createHash("sha256").update(response.body).digest("hex");sizeBytes=response.body.length;
        input.signal?.throwIfAborted();
        failureReason="video_storage_failed";
        storageKey=(await storagePut(`acquisition/${input.workspaceId}/snapshots/${input.snapshotId}/video/${asset.positionIndex}-${contentHash}.mp4`,response.body,"video/mp4")).storageUri;
      }
      if(!thumbnailStorageKey && (attempt===2 || !asset.posterUrl)) {
        failureReason="video_poster_failed";
        const ref=parseStorageUri(storageKey);
        if(ref?.provider==="local")await savePoster(await videoPoster(await verifiedLocalObjectPath(ref.key),input.signal));
      }
      if(!thumbnailStorageKey){failureReason="video_poster_failed";throw new Error("视频封面未取得");}
      failureReason=null;
      break;
    } catch (error) {
      input.signal?.throwIfAborted();
      const reason=(error as {reason?:string})?.reason;
      if(reason)failureReason=reason==="response_too_large"?"video_too_large":reason==="timeout"?"video_timeout":"video_network";
      if(attempt<2)await delay(500,undefined,{signal:input.signal});
    }
  }
  const stored=Boolean(storageKey && thumbnailStorageKey),fieldStatus=stored?"pending_review":"download_failed";
  return {storageKey,thumbnailStorageKey,contentHash,sizeBytes,stored,fieldStatus,attempts,failureReason:stored?null:failureReason||"video_unavailable"};
}
export async function ingestVideoAsset(input: {db:DbExecutor;workspaceId:number;snapshotId:number;rawArtifactId:number;signal?:AbortSignal},asset:SourceAssetReference) {
  const {storageKey,thumbnailStorageKey,contentHash,sizeBytes,stored,fieldStatus,attempts,failureReason}=await downloadVideoAsset(input,asset);
  const assetId=await createAssetCandidate(input.db,{workspaceId:input.workspaceId,snapshotId:input.snapshotId,sourceArtifactId:input.rawArtifactId,
    role:"video",positionIndex:asset.positionIndex,sourceJsonPath:asset.sourcePath,sourceUrlHash:asset.sourceUrlHash,storageKey,thumbnailStorageKey,
    contentHash,contentType:storageKey?"video/mp4":null,sizeBytes,width:null,height:null,moduleType:asset.moduleType,moduleClass:asset.moduleClass,
    fieldStatus,reviewStatus:"pending"});
  return {assetId,role:"video" as const,stored,fieldStatus,attempts,failureReason};
}
