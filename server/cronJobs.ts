/**
 * Cron Jobs - Periodic maintenance tasks
 * Lingxing API auto-sync has been removed - data is now imported via Excel uploads
 */
import * as cron from 'node-cron';

let cronTask: ReturnType<typeof cron.schedule> | null = null;

/**
 * Initialize the cron job
 * Currently a no-op placeholder since Lingxing API sync was removed.
 * Future periodic tasks (e.g., data cleanup, report generation) can be added here.
 */
export function initCronJobs() {
  if (cronTask) {
    cronTask.stop();
  }

  // Placeholder: future periodic tasks can be scheduled here
  console.log('[CronJobs] Initialized (no active cron tasks - Lingxing API sync removed)');
}

/**
 * Manually trigger sync - now a no-op since data comes from Excel uploads
 */
export async function triggerManualSync() {
  console.log('[CronJobs] Manual sync is no longer available. Please use Excel upload to import data.');
}

/**
 * Stop the cron job
 */
export function stopCronJobs() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log('[CronJobs] Cron job stopped');
  }
}
