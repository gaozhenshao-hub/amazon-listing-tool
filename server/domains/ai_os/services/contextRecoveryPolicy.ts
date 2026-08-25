export type InvalidatedContextSource = {
  sourceType: string;
  sourceKey: string;
};

export const CONTEXT_SOURCE_INVALIDATED_REASON = "context_source_invalidated";

/**
 * 仅判断恢复是否必须停止；调用方仍负责创建恢复请求与写入Ledger。
 * 任何失效来源都不能被自动忽略、替换或重新执行。
 */
export function contextRecoveryBlock(
  invalidatedSources: readonly InvalidatedContextSource[],
): { blocked: boolean; reasonCode?: typeof CONTEXT_SOURCE_INVALIDATED_REASON; message?: string } {
  if (!invalidatedSources.length) return { blocked: false };
  return {
    blocked: true,
    reasonCode: CONTEXT_SOURCE_INVALIDATED_REASON,
    message: "关联上下文来源已失效；请重新编译上下文并再次人工确认后再运行",
  };
}
