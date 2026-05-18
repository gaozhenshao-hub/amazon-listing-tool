export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Deployment configuration
  companyName: process.env.COMPANY_NAME ?? "跨海\uD83D\uDC4D",
  companyLogo: process.env.COMPANY_LOGO ?? "",
  erpType: process.env.ERP_TYPE ?? "excel", // Changed from "lingxing" - data now imported via Excel
  instanceId: process.env.INSTANCE_ID ?? "instance-a",
  // Peer sync configuration
  peerSyncEnabled: process.env.PEER_SYNC_ENABLED === "true",
  peerApiUrl: process.env.PEER_API_URL ?? "",
  peerApiKey: process.env.PEER_API_KEY ?? "",
  // Usage reporting
  usageReportEnabled: process.env.USAGE_REPORT_ENABLED === "true",
  usageReportUrl: process.env.USAGE_REPORT_URL ?? "",
};
