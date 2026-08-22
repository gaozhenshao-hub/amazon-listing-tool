import { lingxingSyncRouter } from "../server/routers/lingxingSync";

const user = { id: 1, role: "super_admin", defaultWorkspaceId: 1, organizationId: null } as any;

async function main() {
  const batchId = Number(process.env.BATCH_ID || "4");
  const caller = lingxingSyncRouter.createCaller({ user, workspaceId: user.defaultWorkspaceId, requestId: "lingxing-ad-keyword-batch-confirm-apply", req: { headers: {}, header: () => undefined } as any, res: { locals: { requestId: "lingxing-ad-keyword-batch-confirm-apply" } } as any });
  const preview = await caller.get({ batchId });
  if (preview.batch.dataDomain !== "ad_keyword" || preview.batch.status !== "ready_for_review") throw new Error("Batch is not a ready-for-review ad keyword draft");
  const selectedRowIds = preview.rows.filter((row: any) => Boolean(row.selected) && row.rowStatus !== "needs_review").map((row: any) => row.id);
  if (!selectedRowIds.length) throw new Error("No selectable ad keyword rows found");
  const confirmation = await caller.confirm({ batchId, selectedRowIds });
  const applied = await caller.applyConfirmedAds({ batchId });
  console.log(JSON.stringify({ batchId, confirmedRows: selectedRowIds.length, confirmationStatus: confirmation.status, importId: applied.importId, importedRows: applied.importedRows, skippedRows: applied.skippedRows }));
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : "LingXing ad keyword batch confirmation/apply failed"); process.exitCode = 1; });
