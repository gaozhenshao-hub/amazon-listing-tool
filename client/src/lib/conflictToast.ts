import { toast } from "sonner";

/**
 * Parse CONFLICT error message to extract existingId.
 * Server embeds id in format: "ASIN B0XXX 已存在于xxx知识库中 [id:123]"
 */
export function parseConflictId(message: string): number | null {
  const match = message.match(/\[id:(\d+)\]/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Show a CONFLICT toast with a "点击跳转查看" action button.
 * @param message - The CONFLICT error message from server
 * @param onView - Callback to navigate to the existing item
 */
export function showConflictToast(
  message: string,
  onView: (id: number) => void
) {
  const existingId = parseConflictId(message);
  // Strip the [id:xxx] suffix from the display message
  const displayMsg = message.replace(/\s*\[id:\d+\]/, "");

  if (existingId !== null) {
    toast.warning(displayMsg, {
      description: "点击下方按钮可直接跳转到该记录",
      duration: 6000,
      action: {
        label: "点击查看",
        onClick: () => onView(existingId),
      },
    });
  } else {
    toast.error(displayMsg);
  }
}

/**
 * Create an onError handler for import mutations that shows CONFLICT toast.
 * @param onView - Callback to navigate to the existing item (receives id)
 */
export function createImportOnError(onView: (id: number) => void) {
  return (e: any) => {
    const code = e?.data?.code || e?.shape?.data?.code;
    if (code === "CONFLICT") {
      showConflictToast(e.message, onView);
    } else {
      toast.error(e.message || "操作失败");
    }
  };
}
