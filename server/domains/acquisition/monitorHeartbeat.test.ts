import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authenticateRequest,
  requireDb,
  getMonitorScheduleByTaskUid,
  loadMonitorTarget,
  markMonitorScheduleError,
  markMonitorScheduleQueued,
  startAmazonMonitorJob,
} = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  requireDb: vi.fn(),
  getMonitorScheduleByTaskUid: vi.fn(),
  loadMonitorTarget: vi.fn(),
  markMonitorScheduleError: vi.fn(),
  markMonitorScheduleQueued: vi.fn(),
  startAmazonMonitorJob: vi.fn(),
}));

vi.mock("../../_core/sdk", () => ({ sdk: { authenticateRequest } }));
vi.mock("../../repositories/dbClient", () => ({ requireDb }));
vi.mock("./monitorRepository", () => ({
  getMonitorScheduleByTaskUid,
  loadMonitorTarget,
  markMonitorScheduleError,
  markMonitorScheduleQueued,
}));
vi.mock("./monitorJob", () => ({ startAmazonMonitorJob }));

import { amazonMonitorHeartbeatHandler } from "./monitorHeartbeat";

function responseMock() {
  const response = {
    statusCode: 200,
    payload: undefined as unknown,
    status: vi.fn((code: number) => { response.statusCode = code; return response; }),
    json: vi.fn((payload: unknown) => { response.payload = payload; return response; }),
  };
  return response;
}

const request = { originalUrl: "/api/scheduled/amazon-monitor" };
const schedule = { id: 7, workspaceId: 2, monitorKind: "competitor" as const, monitorId: 9, ownerUserId: 11, frequency: "daily" as const, status: "active" };

describe("amazonMonitorHeartbeatHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    requireDb.mockResolvedValue({});
  });

  it("rejects ordinary users before reading any schedule", async () => {
    authenticateRequest.mockResolvedValue({ id: 11, isCron: false });
    const response = responseMock();
    await amazonMonitorHeartbeatHandler(request as never, response as never);
    expect(response.statusCode).toBe(403);
    expect(requireDb).not.toHaveBeenCalled();
  });

  it("treats an unknown taskUid as an orphan without trusting request payload", async () => {
    authenticateRequest.mockResolvedValue({ id: -1, isCron: true, taskUid: "task-orphan" });
    getMonitorScheduleByTaskUid.mockResolvedValue(null);
    const response = responseMock();
    await amazonMonitorHeartbeatHandler(request as never, response as never);
    expect(response.payload).toEqual({ ok: true, skipped: "orphan" });
    expect(startAmazonMonitorJob).not.toHaveBeenCalled();
  });

  it("fails closed when the persisted schedule owner does not match the monitor target", async () => {
    authenticateRequest.mockResolvedValue({ id: -1, isCron: true, taskUid: "task-7" });
    getMonitorScheduleByTaskUid.mockResolvedValue(schedule);
    loadMonitorTarget.mockResolvedValue({ active: true, ownerUserId: 99 });
    const response = responseMock();
    await amazonMonitorHeartbeatHandler(request as never, response as never);
    expect(response.statusCode).toBe(409);
    expect(markMonitorScheduleError).toHaveBeenCalledWith(expect.objectContaining({ scheduleId: 7 }));
    expect(startAmazonMonitorJob).not.toHaveBeenCalled();
  });

  it("queues a persistent Job with a taskUid daily idempotency bucket and returns immediately", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-13T01:02:03Z"));
    authenticateRequest.mockResolvedValue({ id: -1, isCron: true, taskUid: "task-7" });
    getMonitorScheduleByTaskUid.mockResolvedValue(schedule);
    loadMonitorTarget.mockResolvedValue({ active: true, ownerUserId: 11 });
    startAmazonMonitorJob.mockResolvedValue({ monitorRunId: 21, aiJobRunId: "job-21", reused: false });
    const response = responseMock();
    await amazonMonitorHeartbeatHandler(request as never, response as never);
    expect(startAmazonMonitorJob).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 2,
      userId: 11,
      kind: "competitor",
      monitorId: 9,
      triggerType: "schedule",
      idempotencyKey: "heartbeat-task-7-2026-09-13",
    }));
    expect(markMonitorScheduleQueued).toHaveBeenCalledWith(expect.objectContaining({ scheduleId: 7, runId: 21 }));
    expect(response.payload).toEqual({ ok: true, queued: true, monitorRunId: 21, reused: false });
  });
});
