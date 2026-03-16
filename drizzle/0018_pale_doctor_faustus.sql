ALTER TABLE `dev_uploaded_files` ADD `confirmed` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `dev_uploaded_files` ADD `confirmedAt` timestamp;