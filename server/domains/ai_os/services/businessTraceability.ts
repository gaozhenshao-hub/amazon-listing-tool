import { listUnifiedArtifactVersions, type ArtifactDomain } from "./artifactLifecycle";

export type BusinessResourceTraceRef = {
  workspaceId: number | null;
  domain: ArtifactDomain;
  resourceType: string;
  resourceId: string | number;
  version?: number | null;
};

/** 统一资源引用格式：domain:resourceType:resourceId[:vN]。workspaceId不编码在字符串中，必须由查询上下文强制传入。 */
export function buildBusinessResourceRef(input: BusinessResourceTraceRef) {
  const version = input.version ? `:v${input.version}` : "";
  return `${input.domain}:${input.resourceType}:${input.resourceId}${version}`;
}

export async function listBusinessArtifactTrace(input: {
  workspaceId: number | null;
  domain: ArtifactDomain;
  artifactKey: string;
  projectId?: number | null;
  limit?: number;
}) {
  return listUnifiedArtifactVersions({
    workspaceId: input.workspaceId,
    domain: input.domain,
    artifactKey: input.artifactKey,
    projectId: input.projectId ?? null,
    includeContent: false,
    limit: input.limit ?? 50,
  });
}
