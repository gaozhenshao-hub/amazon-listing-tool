export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export const isLocalAuthMode = () =>
  String(import.meta.env.VITE_AUTH_MODE ?? "manus").trim().toLowerCase() === "local";

// Generate login URL at runtime so redirect URI reflects the current origin.
export const getLoginUrl = () => {
  if (isLocalAuthMode()) {
    return "/login";
  }
  const oauthPortalUrl = String(import.meta.env.VITE_OAUTH_PORTAL_URL ?? "").trim();
  const appId = String(import.meta.env.VITE_APP_ID ?? "").trim();
  if (!oauthPortalUrl || !appId) {
    return "/login";
  }

  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  let url: URL;
  try {
    const portalBase = oauthPortalUrl.endsWith("/")
      ? oauthPortalUrl
      : `${oauthPortalUrl}/`;
    url = new URL("app-auth", portalBase);
  } catch {
    return "/login";
  }

  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};
