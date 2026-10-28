import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
vi.mock("../../_core/env", () => ({
  ENV: { cookieSecret: "test-only-signing-secret-that-is-long-enough" },
}));
import {
  audioTokenValid,
  signedAudioUrl,
  identifyAudio,
  meetingAudioPath,
} from "./meetingAudioStorage";
let temp = "";
afterEach(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
  temp = "";
});
describe("meeting recording storage protection", () => {
  it("limits provider access to the signed recording and expiry", () => {
    const url = new URL(signedAudioUrl(23));
    const expiry = Number(url.searchParams.get("expires"));
    const token = url.searchParams.get("token")!;
    expect(audioTokenValid(23, expiry, token)).toBe(true);
    expect(audioTokenValid(24, expiry, token)).toBe(false);
    expect(audioTokenValid(23, expiry + 1, token)).toBe(false);
    expect(audioTokenValid(23, expiry, token, expiry + 1)).toBe(false);
    expect(audioTokenValid(23, expiry, "invalid")).toBe(false);
  });
  it("rejects traversal before accessing storage", async () => {
    await expect(meetingAudioPath("../../secret.wav")).rejects.toThrow("无效");
  });
  it("identifies actual audio headers and rejects renamed non-audio", async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), "meeting-audio-test-"));
    const file = path.join(temp, "sample.mp3");
    await writeFile(file, "<html>this is not audio</html>");
    await expect(identifyAudio(file)).rejects.toThrow("有效的音频");
    await writeFile(
      file,
      Buffer.from(
        "524946462400000057415645666d74201000000001000100803e0000007d0000",
        "hex"
      )
    );
    expect(await identifyAudio(file)).toEqual({
      extension: "wav",
      mime: "audio/wav",
    });
  });
});
