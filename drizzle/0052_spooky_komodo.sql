CREATE TABLE `check_item_overrides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`check_item_id` int NOT NULL,
	`is_hidden` int DEFAULT 0,
	`custom_sub_dimension` varchar(200),
	`custom_standard` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `check_item_overrides_id` PRIMARY KEY(`id`)
);
