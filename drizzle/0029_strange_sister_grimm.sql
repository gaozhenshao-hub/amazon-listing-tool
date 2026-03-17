ALTER TABLE `image_workflow_sessions` ADD `step4CompositionRefs` text;--> statement-breakpoint
ALTER TABLE `image_workflow_sessions` ADD `step4EffectRefs` text;--> statement-breakpoint
ALTER TABLE `image_workflow_sessions` ADD `step5SelectedModule` text;--> statement-breakpoint
ALTER TABLE `image_workflow_sessions` ADD `step5OptimizedResult` text;--> statement-breakpoint
ALTER TABLE `image_workflow_sessions` ADD `step5OptimizedResultCn` text;--> statement-breakpoint
ALTER TABLE `image_workflow_sessions` ADD `step6AiResult` text;--> statement-breakpoint
ALTER TABLE `image_workflow_sessions` ADD `step6AiResultCn` text;--> statement-breakpoint
ALTER TABLE `image_workflow_sessions` ADD `step6UserEdit` text;--> statement-breakpoint
ALTER TABLE `image_workflow_sessions` ADD `step6Confirmed` int DEFAULT 0 NOT NULL;