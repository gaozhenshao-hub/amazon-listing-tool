CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('review_submitted','review_approved','review_rejected','project_assigned','system_alert') NOT NULL,
	`title` varchar(200) NOT NULL,
	`content` text,
	`relatedType` varchar(50),
	`relatedId` int,
	`isRead` int NOT NULL DEFAULT 0,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
