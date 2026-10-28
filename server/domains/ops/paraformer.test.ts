import { beforeEach, describe, it, expect, vi } from "vitest";
const http = vi.hoisted(() => vi.fn());
vi.mock("../../infrastructure/http/safeHttpClient", () => ({
  safeHttpRequest: http,
}));
import {
  paraformerBaseUrl,
  submitSpeech,
  pollSpeech,
  speechText,
  speechError,
} from "./paraformer";
const config = {
  id: 1,
  key: "test-private-key",
  baseUrl: "https://dashscope.aliyuncs.com/api/v1",
};
const response = (data: any, status = 200) => ({
  ok: status === 200,
  status,
  json: () => data,
});
beforeEach(() => {
  http.mockReset();
});
describe("Paraformer meeting adapter", () => {
  it.each([
    "https://evil.example/api/v1",
    "http://dashscope.aliyuncs.com",
    "https://dashscope.aliyuncs.com.evil.example",
    "https://x:secret@dashscope.aliyuncs.com",
    "https://dashscope.aliyuncs.com/api/v1?key=x",
  ])("refuses untrusted credential destination %s", url =>
    expect(() => paraformerBaseUrl(url)).toThrow()
  );
  it("normalizes the Beijing workspace endpoint", () =>
    expect(
      paraformerBaseUrl(
        "https://ws-abc123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
      )
    ).toBe("https://ws-abc123.cn-beijing.maas.aliyuncs.com/api/v1"));
  it("submits exactly once with asynchronous mode", async () => {
    http.mockResolvedValue(
      response({ output: { task_id: "test-task-123", task_status: "PENDING" } })
    );
    expect(await submitSpeech(config, "https://example.com/audio")).toBe(
      "test-task-123"
    );
    expect(http).toHaveBeenCalledTimes(1);
    const options = http.mock.calls[0][1];
    expect(options.headers["X-DashScope-Async"]).toBe("enable");
    expect(JSON.parse(options.body)).toEqual({
      model: "paraformer-v2",
      input: { file_urls: ["https://example.com/audio"] },
      parameters: { channel_id: [0], language_hints: ["zh", "en"] },
    });
  });
  it("does not automatically resubmit a lost response", async () => {
    http.mockRejectedValue(Error("timeout"));
    await expect(
      submitSpeech(config, "https://example.com/audio")
    ).rejects.toThrow();
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("treats subtask failure as failure even if parent succeeded", async () => {
    http.mockResolvedValue(
      response({
        output: {
          task_status: "SUCCEEDED",
          results: [
            { subtask_status: "FAILED", code: "InvalidFile.DownloadFailed" },
          ],
        },
      })
    );
    await expect(pollSpeech(config, "test-task-123")).rejects.toThrow(
      "音频无法识别"
    );
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("polls without creating a new paid task", async () => {
    http.mockResolvedValue(response({ output: { task_status: "RUNNING" } }));
    expect(await pollSpeech(config, "test-task-123")).toBeNull();
    expect(http.mock.calls[0][1].method).toBe("GET");
  });
  it("never leaks credentials to result downloads", async () => {
    http.mockResolvedValueOnce(
      response({
        output: {
          task_status: "SUCCEEDED",
          results: [
            {
              subtask_status: "SUCCEEDED",
              transcription_url:
                "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.json",
            },
          ],
        },
        usage: { duration: 5 },
      })
    );
    http.mockResolvedValueOnce(
      response({
        transcripts: [
          {
            text: "会议内容",
            sentences: [{ text: "先核对销量" }, { text: "明天提交结果" }],
          },
        ],
      })
    );
    expect(await pollSpeech(config, "test-task-123")).toEqual({
      text: "先核对销量\n明天提交结果",
      duration: 5,
      sentences: [],
    });
    expect(http.mock.calls[1][1].headers).toBeUndefined();
  });
  it("rejects an untrusted result address", async () => {
    http.mockResolvedValue(
      response({
        output: {
          task_status: "SUCCEEDED",
          results: [
            {
              subtask_status: "SUCCEEDED",
              transcription_url: "https://evil.example/result",
            },
          ],
        },
      })
    );
    await expect(pollSpeech(config, "test-task-123")).rejects.toThrow(
      "地址异常"
    );
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("provides useful billing and key errors without provider raw messages", () => {
    expect(speechError("Arrearage")).toContain("余额");
    expect(speechError("InvalidApiKey", 401)).toContain("北京");
  });
  it("rejects empty and oversize transcripts rather than truncating", () => {
    expect(() => speechText({ transcripts: [{ text: "" }] })).toThrow(
      "没有识别到"
    );
    expect(() =>
      speechText({ transcripts: [{ text: "字".repeat(100001) }] })
    ).toThrow("过长");
  });
  it("allows music-only video analysis without changing meeting defaults",()=>{
    expect(speechText({transcripts:[{text:""}]},true)).toBe("");
    expect(()=>speechText({transcripts:[{text:""}]})).toThrow();
  });
  it.each(["SUCCESS_WITH_NO_VALID_FRAGMENT","ASR_RESPONSE_HAVE_NO_WORDS"])("treats %s as no speech only when video explicitly allows it",async code=>{
    http.mockResolvedValue(response({output:{task_status:"SUCCEEDED",results:[{subtask_status:"FAILED",code}]},usage:{duration:0}}));
    expect(await pollSpeech(config,"test-task-123",{allowEmpty:true})).toEqual({text:"",sentences:[],duration:0});
    await expect(pollSpeech(config,"test-task-123")).rejects.toThrow();
  });
  it("never hides an actual media download failure behind the no-speech fallback",async()=>{
    http.mockResolvedValue(response({output:{task_status:"SUCCEEDED",results:[{subtask_status:"FAILED",code:"FILE_DOWNLOAD_FAILED"}]}}));
    await expect(pollSpeech(config,"test-task-123",{allowEmpty:true})).rejects.toThrow();
  });
});
