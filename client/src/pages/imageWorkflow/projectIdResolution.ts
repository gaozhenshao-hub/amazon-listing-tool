export function resolveImageWorkflowProjectId(search: string, selectedProjectId: number | null) {
  const queryValue = new URLSearchParams(search).get("projectId");
  const queryProjectId = queryValue && /^\d+$/.test(queryValue) ? Number(queryValue) : null;
  return queryProjectId || selectedProjectId;
}
