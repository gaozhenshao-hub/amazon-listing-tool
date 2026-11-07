/** Only the device connection screen may survive a local login. No arbitrary redirects. */
export function researchExtensionReturn(value: string | null) {
  return value && /^\/dev\/library\/connect\?code=[A-F0-9]{10}$/.test(value)
    ? value
    : null;
}
export function researchExtensionLoginUrl(pathname: string, search: string) {
  if (pathname !== "/dev/library/connect") return "/login";
  const code = new URLSearchParams(search).get("code")?.toUpperCase();
  const target = researchExtensionReturn(
    `/dev/library/connect?code=${code || ""}`
  );
  return target ? `/login?returnTo=${encodeURIComponent(target)}` : "/login";
}
