import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "@/components/ui/button";

GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfReportPreview({ base64 }: { base64: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [renderedPage, setRenderedPage] = useState(0);
  const [pageError, setPageError] = useState(0);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    setPdf(undefined);
    setPage(1);
    setRenderedPage(0);
    setPageError(0);
    setLoadError(false);
    const data = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const loading = getDocument({ data, isEvalSupported: false });
    void loading.promise.then(
      document => {
        if (active) setPdf(document);
      },
      () => {
        if (active) setLoadError(true);
      }
    );
    return () => {
      active = false;
      void loading.destroy().catch(() => undefined);
    };
  }, [base64]);

  useEffect(() => {
    if (!pdf) return;
    let active = true;
    let rendering: RenderTask | undefined;
    void (async () => {
      try {
        const pdfPage = await pdf.getPage(page);
        const target = canvas.current;
        if (!active || !target) return;
        const size = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(1.6, 2800 / Math.max(size.width, size.height));
        const viewport = pdfPage.getViewport({ scale });
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        rendering = pdfPage.render({ canvas: target, viewport });
        await rendering.promise;
        if (active) setRenderedPage(page);
      } catch {
        if (active) setPageError(page);
      }
    })();
    return () => {
      active = false;
      rendering?.cancel();
    };
  }, [pdf, page]);

  if (loadError) {
    return <p role="alert" className="p-3 text-sm">无法打开此 PDF，请检查报告文件。</p>;
  }

  return (
    <div className="min-h-0 space-y-2">
      {pdf && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </Button>
          <span aria-live="polite">第 {page} 页，共 {pdf.numPages} 页</span>
          <Button size="sm" variant="outline" disabled={page >= pdf.numPages} onClick={() => setPage(page + 1)}>
            下一页
          </Button>
        </div>
      )}
      <div className="max-h-[65vh] overflow-auto rounded-md border bg-muted p-2">
        {renderedPage !== page && (
          <p className="p-2 text-sm" role={pageError === page ? "alert" : "status"}>
            {pageError === page ? "暂时无法显示这一页。" : "正在渲染 PDF…"}
          </p>
        )}
        <canvas ref={canvas} aria-label={`专利报告第 ${page} 页`} hidden={renderedPage !== page} className="mx-auto h-auto max-w-full bg-white" />
      </div>
    </div>
  );
}
