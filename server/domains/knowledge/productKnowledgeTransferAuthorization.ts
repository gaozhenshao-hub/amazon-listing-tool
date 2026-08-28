import { TRPCError } from "@trpc/server";

/** 完整知识包会携带实际附件，仅允许超级管理员从工作空间导出。 */
export function assertProductKnowledgeTransferExportAuthority(role: string | null | undefined): void {
  if (role !== "super_admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "仅超级管理员可导出产品知识库完整ZIP包",
    });
  }
}
