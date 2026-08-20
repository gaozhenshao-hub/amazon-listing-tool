export function resolveListenHost(value = process.env.HOST): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
