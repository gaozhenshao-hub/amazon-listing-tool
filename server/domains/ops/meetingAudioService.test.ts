import { beforeEach, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({
  row: null as any,
  submit: vi.fn(),
  poll: vi.fn(),
  analyze: vi.fn(),
  config: vi.fn(),
}));
vi.mock("../../repositories/dbClient", () => ({ getDb: async () => db }));
vi.mock("./paraformer", async importOriginal => ({
  ...(await importOriginal<any>()),
  paraformerConfig: state.config,
  submitSpeech: state.submit,
  pollSpeech: state.poll,
}));
vi.mock("./meetingNotes", () => ({ analyzeMeetingNotes: state.analyze }));
vi.mock("./meetingAudioStorage", () => ({
  signedAudioUrl: () => "https://example.com/signed-test",
}));
const db: any = {
  transaction: async (fn: any) => fn(db),
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => ({
          for: async () => (state.row ? [{ ...state.row }] : []),
        }),
      }),
    }),
  }),
  update: () => ({
    set: (patch: any) => ({
      where: async () => Object.assign(state.row, patch),
    }),
  }),
};
import { processMeetingAudio, resumeMeetingAudio } from "./meetingAudioService";
const data = () => JSON.parse(state.row.extractedTasks);
beforeEach(() => {
  vi.clearAllMocks();
  state.row = {
    id: 1,
    userId: 2,
    workspaceId: 3,
    transcript: null,
    status: "uploading",
    extractedTasks: JSON.stringify({
      version: 2,
      date: "2026-10-22",
      summary: "",
      tasks: [],
      tasksExtracted: false,
      audio: { operationId: "test", state: "queued" },
    }),
  };
  state.config.mockResolvedValue({ id: 4 });
  state.submit.mockResolvedValue("provider-task-123");
  state.poll.mockResolvedValue(null);
  state.analyze.mockResolvedValue({});
});
it("persists a provider task before polling and never submits it twice", async () => {
  await processMeetingAudio(1);
  expect(data().audio.taskId).toBe("provider-task-123");
  const next = data();
  next.audio.nextPollAt = 0;
  state.row.extractedTasks = JSON.stringify(next);
  await processMeetingAudio(1);
  expect(state.submit).toHaveBeenCalledTimes(1);
  expect(state.poll).toHaveBeenCalledTimes(1);
});
it("leaves an ambiguous submit for reconciliation without automatic second charge", async () => {
  state.submit.mockRejectedValue(Error("timeout"));
  await processMeetingAudio(1);
  expect(data().audio.state).toBe("unknown");
  await processMeetingAudio(1);
  expect(state.submit).toHaveBeenCalledTimes(1);
  await expect(resumeMeetingAudio(3, 1)).rejects.toThrow("避免重复计费");
});
it("recovers crashed submission as unknown, not queued", async () => {
  const next = data();
  next.audio.state = "submitting";
  next.audio.leaseUntil = Date.now() - 1;
  state.row.extractedTasks = JSON.stringify(next);
  await processMeetingAudio(1);
  expect(data().audio.state).toBe("unknown");
  expect(state.submit).not.toHaveBeenCalled();
});
it("saves transcription before generating minutes", async () => {
  await processMeetingAudio(1);
  const next = data();
  next.audio.nextPollAt = 0;
  state.row.extractedTasks = JSON.stringify(next);
  state.poll.mockResolvedValue({ text: "李宇航明天检查库存", duration: 4 });
  await processMeetingAudio(1);
  expect(state.row.transcript).toBe("李宇航明天检查库存");
  expect(data().audio.state).toBe("transcribed");
  expect(state.analyze).not.toHaveBeenCalled();
  await processMeetingAudio(1);
  expect(state.analyze).toHaveBeenCalledWith(
    { workspaceId: 3, userId: 2 },
    1,
    "summary"
  );
  expect(data().audio.state).toBe("complete");
});
it("keeps polling on temporary errors with the same provider task", async () => {
  await processMeetingAudio(1);
  const next = data();
  next.audio.nextPollAt = 0;
  state.row.extractedTasks = JSON.stringify(next);
  state.poll.mockRejectedValue(Error("connection lost"));
  await processMeetingAudio(1);
  expect(data().audio.state).toBe("polling");
  expect(data().audio.taskId).toBe("provider-task-123");
  expect(state.submit).toHaveBeenCalledTimes(1);
});
it("respects an active lease", async () => {
  const next = data();
  next.audio.leaseUntil = Date.now() + 60000;
  state.row.extractedTasks = JSON.stringify(next);
  await processMeetingAudio(1);
  expect(state.submit).not.toHaveBeenCalled();
});
it("does not charge when the configuration is missing", async () => {
  state.config.mockRejectedValue(Error("missing"));
  await processMeetingAudio(1);
  expect(state.submit).not.toHaveBeenCalled();
  expect(data().audio.state).toBe("failed");
});
