import type { MonthlyFinancialReportPreview } from "@shared/monthlyFinancialReportPreview";

export type MonthlyPreviewFormat = "xlsx" | "csv";
export type MonthlyPreviewReply =
  | { ok: true; preview: MonthlyFinancialReportPreview }
  | { ok: false; message: string };

export interface PreviewWorker {
  onmessage: ((event: MessageEvent<MonthlyPreviewReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: { file: File; format: MonthlyPreviewFormat }): void;
  terminate(): void;
}

/** One bounded, disposable worker per file; no upload, cache, retry or persistence. */
export function startMonthlyFinancialPreview(
  file: File,
  format: MonthlyPreviewFormat,
  options: { createWorker?: () => PreviewWorker; timeoutMs?: number } = {},
) {
  let worker: PreviewWorker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let rejectTask!: (error: Error) => void;
  const dispose = () => {
    if (timer) clearTimeout(timer);
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
  };
  const promise = new Promise<MonthlyFinancialReportPreview>((resolve, reject) => {
    rejectTask = reject;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      dispose();
      reject(new Error(message));
    };
    try {
      worker = options.createWorker?.() ?? new Worker(
        new URL("./monthlyFinancialPreview.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = ({ data }) => {
        if (settled) return;
        if (data?.ok !== true) {
          fail(data?.message || "文件预览失败，未上传或保存任何内容。");
          return;
        }
        settled = true;
        dispose();
        resolve(data.preview);
      };
      worker.onerror = () => fail("文件解析进程异常，未上传或保存任何内容。");
      timer = setTimeout(() => fail("文件解析超时，已停止本地预览进程。"), options.timeoutMs ?? 20_000);
      worker.postMessage({ file, format });
    } catch {
      fail("此浏览器无法启动本地文件预览进程。");
    }
  });
  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      dispose();
      const error = new Error("本地预览已取消。");
      error.name = "AbortError";
      rejectTask(error);
    },
  };
}
