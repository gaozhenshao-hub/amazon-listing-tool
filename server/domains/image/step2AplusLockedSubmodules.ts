export function preserveLockedAplusSubmodules(
  currentModule: Record<string, any>,
  optimizedModule: Record<string, any>,
) {
  const existing = Array.isArray(currentModule?.subModules) ? currentModule.subModules : [];
  const optimized = Array.isArray(optimizedModule?.subModules) ? optimizedModule.subModules : [];
  const lockedByNumber = new Map<number, Record<string, any>>(
    existing
      .filter((child: Record<string, any>) => child?.isLocked)
      .map((child: Record<string, any>, index: number) => [Number(child.subModuleNumber ?? index + 1), child]),
  );

  const includedLocked = new Set<number>();
  const subModules = optimized.map((candidate: Record<string, any>, index: number) => {
    const number = Number(candidate?.subModuleNumber ?? index + 1);
    const locked = lockedByNumber.get(number);
    if (!locked) return candidate;
    includedLocked.add(number);
    return locked;
  });

  for (const [number, locked] of lockedByNumber) {
    if (!includedLocked.has(number)) subModules.push(locked);
  }

  return {
    ...optimizedModule,
    // 备注和目标数量是人工意图，模块样式重新优化不可覆盖。
    subModuleRemark: currentModule?.subModuleRemark ?? optimizedModule?.subModuleRemark,
    subModuleCount: currentModule?.subModuleCount ?? optimizedModule?.subModuleCount,
    subModules: subModules.sort((a: Record<string, any>, b: Record<string, any>) =>
      Number(a?.subModuleNumber ?? 0) - Number(b?.subModuleNumber ?? 0),
    ),
  };
}
