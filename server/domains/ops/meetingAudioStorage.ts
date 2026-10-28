import path from "node:path";
import { mkdir, lstat, realpath, open } from "node:fs/promises";
import { createHmac, timingSafeEqual } from "node:crypto";
import { ENV } from "../../_core/env";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { meetingAudioSeconds } from "../../../shared/meetingAudio";

const runFile = promisify(execFile);
export async function normalizeMeetingAudio(
  source: string,
  destination: string
) {
  // Decode only a local upload, downmix all channels, and cap work and output duration.
  await runFile(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      "-threads",
      "1",
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      source,
      "-map",
      "0:a:0",
      "-vn",
      "-t",
      String(meetingAudioSeconds + 1),
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "flac",
      "-threads",
      "1",
      "-n",
      destination,
    ],
    { timeout: 180000, maxBuffer: 65536, windowsHide: true }
  );
  const { stdout } = await runFile(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      destination,
    ],
    { timeout: 10000, maxBuffer: 65536, windowsHide: true }
  );
  const seconds = Number(stdout.trim());
  if (
    !Number.isFinite(seconds) ||
    seconds < 0.2 ||
    seconds > meetingAudioSeconds
  )
    throw Error("请选择两小时以内的完整录音，超长会议请分段上传");
  return Math.ceil(seconds);
}

export async function meetingAudioDirectory() {
  const root =
    process.env.MEETING_AUDIO_STORAGE_ROOT ||
    (process.env.LISTING_SUPPLEMENT_LOCAL_ROOT
      ? path.join(process.env.LISTING_SUPPLEMENT_LOCAL_ROOT, "meeting-audio")
      : "");
  if (!root || !path.isAbsolute(root)) throw Error("会议录音存储尚未配置");
  await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink()) throw Error("会议录音存储无效");
  return realpath(root);
}
export async function meetingAudioPath(name: string) {
  if (!/^[0-9a-f-]{36}\.(wav|mp3|m4a|aac|ogg|webm|flac)$/.test(name))
    throw Error("录音文件无效");
  const file = path.join(await meetingAudioDirectory(), name);
  const info = await lstat(file);
  if (info.isSymbolicLink() || !info.isFile()) throw Error("录音文件无效");
  return file;
}
export async function identifyAudio(file: string) {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(32);
    const { bytesRead } = await handle.read(buffer, 0, 32, 0);
    if (bytesRead < 12) throw Error("录音不完整");
    if (
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WAVE"
    )
      return { extension: "wav", mime: "audio/wav" };
    if (buffer.toString("ascii", 4, 8) === "ftyp")
      return { extension: "m4a", mime: "audio/mp4" };
    if (buffer.toString("ascii", 0, 4) === "fLaC")
      return { extension: "flac", mime: "audio/flac" };
    if (buffer.toString("ascii", 0, 4) === "OggS")
      return { extension: "ogg", mime: "audio/ogg" };
    if (buffer.readUInt32BE(0) === 0x1a45dfa3)
      return { extension: "webm", mime: "audio/webm" };
    if (
      buffer.toString("ascii", 0, 3) === "ID3" ||
      (buffer[0] === 255 &&
        (buffer[1] & 0xe0) === 0xe0 &&
        (buffer[1] & 6) !== 0)
    )
      return { extension: "mp3", mime: "audio/mpeg" };
    if (buffer[0] === 255 && (buffer[1] & 0xf6) === 0xf0)
      return { extension: "aac", mime: "audio/aac" };
    throw Error("请选择有效的音频文件");
  } finally {
    await handle.close();
  }
}
function signature(id: number, expires: number) {
  if (ENV.cookieSecret.length < 32) throw Error("录音安全访问尚未配置");
  return createHmac("sha256", ENV.cookieSecret)
    .update(`meeting-audio-v1:${id}:${expires}`)
    .digest("hex");
}
export function audioTokenValid(
  id: number,
  expires: number,
  token: string,
  now = Date.now()
) {
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !Number.isSafeInteger(expires) ||
    expires < now ||
    expires > now + 25 * 3600 * 1000 ||
    !/^[a-f0-9]{64}$/.test(token)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(token, "hex"),
    Buffer.from(signature(id, expires), "hex")
  );
}
export function signedAudioUrl(id: number) {
  const base = new URL(
    process.env.MEETING_AUDIO_PUBLIC_ORIGIN ||
      process.env.APP_BASE_URL ||
      "https://www.xingqimaoyi.vip"
  );
  if (
    base.protocol !== "https:" ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw Error("录音服务公网地址配置无效");
  const expires = Date.now() + 24 * 3600 * 1000;
  return `${base.origin}/api/meeting-audio/provider/${id}?expires=${expires}&token=${signature(id, expires)}`;
}
