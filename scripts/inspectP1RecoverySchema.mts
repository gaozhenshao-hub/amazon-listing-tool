import { rawExecute } from "../server/domains/ai_os/routerContext";

async function main() {
  const [stateVersion, recoverySnapshotId, snapshots, recoveries] = await Promise.all([
    rawExecute("SHOW COLUMNS FROM emperor_conversation_plan_steps LIKE 'stateVersion'"),
    rawExecute("SHOW COLUMNS FROM emperor_conversation_plan_steps LIKE 'recoverySnapshotId'"),
    rawExecute("SHOW TABLES LIKE 'emperor_execution_state_snapshots'"),
    rawExecute("SHOW TABLES LIKE 'emperor_execution_recovery_requests'"),
  ]);
  console.log(JSON.stringify({
    stateVersionColumnPresent: stateVersion.length > 0,
    recoverySnapshotIdColumnPresent: recoverySnapshotId.length > 0,
    snapshotsTablePresent: snapshots.length > 0,
    recoveriesTablePresent: recoveries.length > 0,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "P1 schema inspection failed");
  process.exitCode = 1;
});
