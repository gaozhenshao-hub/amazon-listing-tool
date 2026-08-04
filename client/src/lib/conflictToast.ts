import { toast } from "sonner";
import { APP_ERROR_CODES } from "@shared/_core/errors";
import { getAppErrorInfo } from "./appError";

/**
 * Show a CONFLICT toast with a "点击跳转查看" action button.
 * @param error - Structured AppError returned by tRPC
 * @param onView - Callback to navigate to the existing item
 */
export function showConflictToast(
  error: unknown,
  onView: (id: number) => void
) {
  const info = getAppErrorInfo(error);
  const existingId = Number(info.details?.existingId);

  if (Number.isInteger(existingId) && existingId > 0) {
    toast.warning(info.message, {
      description: "点击下方按钮可直接跳转到该记录",
      duration: 6000,
      action: {
        label: "点击查看",
        onClick: () => onView(existingId),
      },
    });
  } else {
    toast.error(info.message);
  }
}

/**
 * Create an onError handler for import mutations that shows CONFLICT toast.
 * @param onView - Callback to navigate to the existing item (receives id)
 */
export function createImportOnError(onView: (id: number) => void) {
  return (e: any) => {
    const info = getAppErrorInfo(e);
    if (info.code === APP_ERROR_CODES.RESOURCE_CONFLICT) {
      showConflictToast(e, onView);
    } else {
      toast.error(info.message || "操作失败");
    }
  };
}
