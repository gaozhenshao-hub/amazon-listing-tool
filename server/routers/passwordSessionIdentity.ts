export type PasswordSessionUser = {
  id: number;
  openId?: string | null;
  name?: string | null;
  email?: string | null;
};

export function buildPasswordSessionIdentity(
  user: PasswordSessionUser,
  configuredAppId?: string
) {
  return {
    openId: user.openId || `pwd_${user.id}`,
    // 独立环境通常没有Manus应用ID；JWT校验仍要求非空应用标识。
    appId: configuredAppId?.trim() || "local",
    name: user.name?.trim() || user.email?.trim() || "local-user",
  };
}
