/** 将领星负责人组合字段拆为标准名称，保留调用方的确认映射边界。 */
export function splitExternalOperatorNames(operator?: string | null): string[] {
  if (!operator) return [];
  return operator.split(/[\/、,，]+/).map((name) => name.trim()).filter(Boolean);
}

/**
 * 只有组合字段内每一位负责人都已有设置页确认映射时才返回系统人员名称。
 * 任何一位未知即返回null，确保“张三/未知”不会被错误显示为“张三”。
 */
export function resolveConfirmedExternalOperator(
  rawOperator: string | null | undefined,
  mappingLookup: Map<string, string>,
): string | null {
  const names = splitExternalOperatorNames(rawOperator);
  if (!names.length || names.some((name) => !mappingLookup.has(name))) return null;
  return names.map((name) => mappingLookup.get(name)!).join("/");
}
