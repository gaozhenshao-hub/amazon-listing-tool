import { afterEach, describe, expect, it, vi } from "vitest";
import { startMonthlyFinancialPreview, type PreviewWorker } from "./monthlyFinancialPreviewTask";

function fakeWorker() {
  const worker: PreviewWorker = {
    onmessage: null, onerror: null, postMessage: vi.fn(), terminate: vi.fn(),
  };
  return worker;
}
afterEach(() => vi.useRealTimers());
const file = { name: "local.csv", size: 10 } as File;

describe("bounded disposable monthly preview worker", () => {
  it("passes only the file to its worker and terminates after success", async () => {
    const worker = fakeWorker();
    const task = startMonthlyFinancialPreview(file, "csv", { createWorker: () => worker });
    expect(worker.postMessage).toHaveBeenCalledWith({ file, format: "csv" });
    const preview = { test: "not persisted" };
    worker.onmessage!({ data: { ok: true, preview } } as unknown as Parameters<NonNullable<PreviewWorker["onmessage"]>>[0]);
    await expect(task.promise).resolves.toBe(preview);
    expect(worker.terminate).toHaveBeenCalledOnce();
    task.cancel();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("terminates on parser rejection and does not retry", async () => {
    const worker = fakeWorker();
    const task = startMonthlyFinancialPreview(file, "xlsx", { createWorker: () => worker });
    const check = expect(task.promise).rejects.toThrow("Bad header");
    worker.onmessage!({ data: { ok: false, message: "Bad header" } } as MessageEvent);
    await check;
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("kills a stuck read or parse at the budget boundary", async () => {
    vi.useFakeTimers();
    const worker = fakeWorker();
    const task = startMonthlyFinancialPreview(file, "csv", { createWorker: () => worker, timeoutMs: 100 });
    const check = expect(task.promise).rejects.toThrow("超时");
    await vi.advanceTimersByTimeAsync(100);
    await check;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("cancels and rejects late messages without accepting another file's result", async () => {
    const worker = fakeWorker();
    const task = startMonthlyFinancialPreview(file, "csv", { createWorker: () => worker });
    const lateMessage = worker.onmessage!;
    const check = expect(task.promise).rejects.toMatchObject({ name: "AbortError" });
    task.cancel();
    lateMessage({ data: { ok: true, preview: {} } } as MessageEvent);
    await check;
    expect(worker.onmessage).toBeNull();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("handles worker creation failure without a fallback upload", async () => {
    const task = startMonthlyFinancialPreview(file, "csv", { createWorker: () => { throw new Error("No Worker"); } });
    await expect(task.promise).rejects.toThrow("无法启动");
  });
  it("terminates on runtime error without exposing arbitrary error content", async () => {
    const worker = fakeWorker();
    const task = startMonthlyFinancialPreview(file, "csv", { createWorker: () => worker });
    const check = expect(task.promise).rejects.toThrow("解析进程异常");
    worker.onerror!({ message: "untrusted content" } as ErrorEvent);
    await check;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
