import { createHash } from "node:crypto";
import type { CheerioAPI } from "cheerio";
import type { AmazonVideoReference } from "../../../shared/knowledgeVideos";

export type SourceAmazonVideo = AmazonVideoReference & { url: string; poster: string | null };
export const AMAZON_MEDIA_HOSTS = ["media-amazon.com", "ssl-images-amazon.com"];
export function amazonMediaUrl(raw: unknown, kind: "video" | "poster") {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443"
      || !AMAZON_MEDIA_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    if (!(kind === "video" ? /\.(mp4|m3u8)$/i : /\.(jpe?g|png|webp|gif)$/i).test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

/** Decode a string literal as data. Never evaluate scripts from the source page. */
export function readPageString(source: string, offset: number): { value: string; end: number } | null {
  const quote = source[offset];
  if (quote !== '"' && quote !== "'") return null;
  let value = "";
  for (let i = offset + 1; i < source.length; i++) {
    const c = source[i];
    if (c === quote) return { value, end: i + 1 };
    if (c !== "\\") { value += c; continue; }
    const escaped = source[++i];
    if (!escaped) return null;
    if (escaped === "u" || escaped === "x") {
      const n = escaped === "u" ? 4 : 2, hex = source.slice(i + 1, i + n + 1);
      if (!new RegExp(`^[a-f0-9]{${n}}$`, "i").test(hex)) return null;
      value += String.fromCharCode(parseInt(hex, 16)); i += n;
    } else value += ({n:"\n",r:"\r",t:"\t",b:"\b",f:"\f"} as Record<string,string>)[escaped] ?? escaped;
  }
  return null;
}

function video(raw: unknown, role: "main" | "aplus", position: number, moduleId: string | null): SourceAmazonVideo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>, url = amazonMediaUrl(r.url ?? r.videoUrl ?? r.videoURL, "video");
  if (!url) return null;
  const duration = Number(r.durationSeconds);
  return { hash: createHash("sha256").update(url).digest("hex"), url, role, position, moduleId,
    poster: amazonMediaUrl(r.slateUrl ?? r.poster ?? r.thumbUrl ?? r.thumb, "poster"),
    title: typeof r.title === "string" ? r.title.slice(0,500) : "",
    duration: Number.isFinite(duration) && duration > 0 && duration <= 7200 ? duration : null };
}

export function mainAmazonVideo($: CheerioAPI): SourceAmazonVideo[] {
  // A page can also contain review/recommendation video arrays. Only accept
  // the product gallery's own data when its video thumbnail is present.
  if (!$("#altImages .videoThumbnail").length) return [];
  const position = Number($("#altImages .videoThumbnail [data-thumb-action]").first().attr("data-thumb-action")?.match(/"thumbnailIndex"\s*:\s*(\d+)/)?.[1] ?? 6);
  let first: SourceAmazonVideo | null = null;
  $("script").each((_, el) => {
    if (first) return;
    const source = $(el).html() || "";
    if (!$(el).closest("#imageBlock_feature_div").length
      && !/\bImageBlock(?:ATF|BTF)\b|\b(?:var|let|const)\s+imageBlock\s*=/i.test(source)) return;
    for (const match of source.matchAll(/["']videos["']\s*:\s*(?:(?:A\.\$\.parseJSON|JSON\.parse)\s*\(\s*)?/g)) {
      const offset = match.index! + match[0].length;
      const literal = readPageString(source, offset);
      let data: unknown;
      try {
        if (literal) data = JSON.parse(literal.value);
        else if (source[offset] === "[") {
          // JSON arrays in script data: balance objects/strings without executing them.
          let depth=0, end=offset;
          for (; end<source.length; end++) { if (source[end] === '"') { const s=readPageString(source,end);if(!s)break;end=s.end-1; }
            else if(source[end]==='[')depth++; else if(source[end]===']' && --depth===0){end++;break;} }
          data = JSON.parse(source.slice(offset,end));
        }
      } catch { continue; }
      if (!Array.isArray(data)) continue;
      // Deliberately take the first source entry, never replace it with a later review video.
      first = video(data[0], "main", Math.min(100, position), null);
      if (first) break;
    }
  });
  return first ? [first] : [];
}

export function aplusAmazonVideos($: CheerioAPI, node: Parameters<CheerioAPI>[0], moduleId: string, position: number): SourceAmazonVideo[] {
  const found: SourceAmazonVideo[] = [];
  const add = (raw: unknown) => { const item=video(raw,"aplus",position,moduleId);if(item && !found.some(v=>v.hash===item.hash))found.push(item); };
  $(node).find("script").each((_, el) => {
    if ($(el).closest("#aplusBrandStory_feature_div, #aplusBrandStory").length) return;
    const source=$(el).html() || "";
    for(const init of source.matchAll(/initVideo\s*\(\s*\{/g)) {
      const part=source.slice(init.index!+init[0].length).split(/\}\s*\)/,1)[0];
      const values: Record<string,string>={};
      for(const match of part.matchAll(/\b(videoUrl|poster|title)\s*:\s*/g)) {
        const parsed=readPageString(part,match.index!+match[0].length);if(parsed)values[match[1]]=parsed.value;
      }
      add(values);
    }
  });
  $(node).find("video").each((_, el)=>{
    if (!$(el).closest("#aplusBrandStory_feature_div, #aplusBrandStory").length)
      add({url:$(el).attr("src") || $(el).find("source").first().attr("src"),poster:$(el).attr("poster")});
  });
  return found.slice(0,20);
}

/** A known Amazon HLS template can have a downloadable MP4 sibling.
 * It is only accepted after the download's MP4 signature is verified. */
export function downloadableAmazonVideo(url: string) {
  const valid=amazonMediaUrl(url,"video");if(!valid)throw new Error("视频来源不可用");
  const parsed=new URL(valid);
  if (parsed.pathname.endsWith("/default.jobtemplate.hls.m3u8")) parsed.pathname=parsed.pathname.replace(/default\.jobtemplate\.hls\.m3u8$/, "default.jobtemplate.mp4.480.mp4");
  if (!parsed.pathname.endsWith(".mp4")) throw new Error("此视频格式暂不能保存");
  return parsed.href;
}
