/**
 * Cron Jobs - Legacy placeholder
 * 
 * All periodic tasks now use the Heartbeat system (HTTP cron via platform).
 * See /api/scheduled/* handlers for active periodic tasks.
 * 
 * This file is kept for backward compatibility with server/_core/index.ts import.
 */

/**
 * Initialize cron jobs - no-op since we use Heartbeat system
 */
export function initCronJobs() {
  console.log('[CronJobs] Using Heartbeat system for periodic tasks (no in-process timers)');
}

/**
 * Manual sync is no longer available - data comes from Excel uploads
 */
export async function triggerManualSync() {
  console.log('[CronJobs] Manual sync is no longer available. Please use Excel upload to import data.');
}

/**
 * Stop cron jobs - no-op
 */
export function stopCronJobs() {
  // No-op: Heartbeat crons are managed by the platform
}
