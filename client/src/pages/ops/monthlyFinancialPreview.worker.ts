import { parseMonthlyFinancialReportPreview } from "@shared/monthlyFinancialReportPreview";
import type { MonthlyPreviewFormat, MonthlyPreviewReply } from "./monthlyFinancialPreviewTask";

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<{ file: File; format: MonthlyPreviewFormat }>) => void) | null;
  postMessage(reply: MonthlyPreviewReply): void;
};

workerScope.onmessage = async ({ data }) => {
  try {
    // File bytes stay in this disposable worker; the host can terminate both read and parse.
    if (data.file.size > 5 * 1024 * 1024) throw new Error("文件超过5MiB，未读取。");
    const bytes = await data.file.arrayBuffer();
    const preview = await parseMonthlyFinancialReportPreview({ bytes, format: data.format });
    workerScope.postMessage({ ok: true, preview });
  } catch (error) {
    workerScope.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : "文件无法解析，未上传或保存任何内容。",
    });
  }
};
