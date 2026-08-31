import { runLingxingScheduledDraft } from "../server/domains/ops/lingxingScheduledDrafts";

const taskUid = String(process.argv[2] || "").trim();
const nowText = String(process.argv[3] || "2026-08-31T09:10:00.000Z").trim();

if (!taskUid) {
  console.error("用法：pnpm exec tsx scripts/run-parent-weekly-rollup-now.ts <taskUid> [ISO时间]");
  process.exit(1);
}

const now = new Date(nowText);
if (Number.isNaN(now.getTime())) {
  console.error("ISO时间无效");
  process.exit(1);
}

runLingxingScheduledDraft(taskUid, now)
  .then((result) => { console.log(JSON.stringify(result)); process.exit(0); })
  .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
