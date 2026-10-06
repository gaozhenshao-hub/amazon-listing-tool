import { useEffect, useState } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NetworkStatusBanner() {
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);

  useEffect(() => {
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (!offline) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[100] border-b border-amber-300 bg-amber-50 px-4 py-2 text-amber-950 shadow-sm dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50" role="status">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-2"><WifiOff className="h-4 w-4 shrink-0" />网络连接暂时中断，已加载的内容仍可查看；恢复网络后会自动继续请求。</span>
        <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => window.location.reload()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />重试</Button>
      </div>
    </div>
  );
}
