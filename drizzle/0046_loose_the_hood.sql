CREATE TABLE `asin_permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`asin` varchar(20) NOT NULL,
	`msku` varchar(100),
	`marketplace` varchar(10) DEFAULT 'US',
	`permission_level` enum('read','write','admin') NOT NULL DEFAULT 'read',
	`granted_by` int,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `asin_permissions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `asin_status_cache` (
	`id` int AUTO_INCREMENT NOT NULL,
	`asin` varchar(20) NOT NULL,
	`msku` varchar(100),
	`sid` varchar(20),
	`marketplace` varchar(10) DEFAULT 'US',
	`listing_status` enum('active','inactive','deleted','manual_inactive') NOT NULL DEFAULT 'active',
	`last_synced_at` bigint,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `asin_status_cache_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`setting_key` varchar(100) NOT NULL,
	`setting_value` text,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `user_settings_id` PRIMARY KEY(`id`)
);
