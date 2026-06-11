CREATE TABLE `asin_tag_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`tag_id` int NOT NULL,
	`asin` varchar(20) NOT NULL,
	`msku` varchar(100),
	`sid` varchar(20),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `asin_tag_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `asin_tag_definitions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`name` varchar(50) NOT NULL,
	`color` varchar(20) NOT NULL DEFAULT '#6366f1',
	`is_system` int NOT NULL DEFAULT 0,
	`hide_from_inventory` int NOT NULL DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `asin_tag_definitions_id` PRIMARY KEY(`id`)
);
