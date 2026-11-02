import { lingxingSyncRouter } from "../server/routers/lingxingSync";

const user = { id: 1, role: "super_admin", defaultWorkspaceId: 1, organizationId: null } as any;

async function main() {
  const batchId = Number(process.env.BATCH_ID || "1");
  const caller = lingxingSyncRouter.createCaller({
    user,
    workspaceId: user.defaultWorkspaceId,
    requestId: "lingxing-sync-draft-verification",
    req: { headers: {}, header: () => undefined } as any,
    res: { locals: { requestId: "lingxing-sync-draft-verification" } } as any,
  });
  const { batch, rows } = await caller.get({ batchId });
  const byStatus = rows.reduce<Record<string, number>>((accumulator, row: any) => {
    const status = String(row.rowStatus || "unknown");
    accumulator[status] = (accumulator[status] || 0) + 1;
    return accumulator;
  }, {});
  console.log(JSON.stringify({ batchId: batch.id, batchStatus: batch.status, dataDomain: batch.dataDomain, rowCount: rows.length, selectedCount: rows.filter((row: any) => Boolean(row.selected)).length, rowsWithDiffs: rows.filter((row: any) => Array.isArray(row.fieldDiffs) && row.fieldDiffs.length > 0).length, byStatus }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "LingXing draft verification failed"); process.exitCode = 1; });
