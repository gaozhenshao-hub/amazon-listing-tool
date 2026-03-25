CREATE TABLE `asin_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(255) NOT NULL,
	`user_name` varchar(255),
	`asin` varchar(50) NOT NULL,
	`content` text NOT NULL,
	`log_type` varchar(50) DEFAULT 'manual',
	`batch_id` int,
	`batch_name` varchar(255),
	`created_at` bigint NOT NULL,
	CONSTRAINT `asin_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `shipping_batches` ADD `fba_shipment_id` varchar(255);--> statement-breakpoint
ALTER TABLE `step_time_templates` ADD `step10_days` int DEFAULT 1 NOT NULL;