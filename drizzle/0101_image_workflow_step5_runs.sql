-- Persist Step 5 image suggestion generation status so long AI runs can be
-- resumed by runId after navigation or refresh.
ALTER TABLE `image_workflow_sessions`
  ADD COLUMN `step5RunId` varchar(80),
  ADD COLUMN `step5RunStatus` enum('idle','queued','running','succeeded','failed','canceled') NOT NULL DEFAULT 'idle',
  ADD COLUMN `step5RunProgress` int NOT NULL DEFAULT 0,
  ADD COLUMN `step5RunError` text,
  ADD COLUMN `step5RunStartedAt` timestamp NULL,
  ADD COLUMN `step5RunCompletedAt` timestamp NULL;

CREATE INDEX `idx_image_workflow_step5_run` ON `image_workflow_sessions` (`step5RunId`);
CREATE INDEX `idx_image_workflow_step5_status` ON `image_workflow_sessions` (`step5RunStatus`, `updatedAt`);
