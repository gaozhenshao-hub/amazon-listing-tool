-- SOURCE-DERIVED PROJECTION ONLY; NOT A PRODUCTION CLONE OR MIGRATION LEDGER.
-- source-schema-projection/1.0; excludes dedicated 0206/0207 tables; no business data or seeds.
CREATE TABLE `emperor_assistant_configuration_versions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`agentKey` varchar(32) NOT NULL,
	`revision` int NOT NULL,
	`config` json NOT NULL,
	`configHash` char(64) NOT NULL,
	`sourceRevision` int,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emperor_assistant_configuration_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_assistant_configuration_version_scope` UNIQUE(`workspaceId`,`agentKey`,`revision`)
);

CREATE TABLE `emperor_assistant_configurations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workspaceId` int NOT NULL,
	`agentKey` varchar(32) NOT NULL,
	`revision` int NOT NULL,
	`config` json NOT NULL,
	`configHash` char(64) NOT NULL,
	`updatedBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emperor_assistant_configurations_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_assistant_configuration_scope` UNIQUE(`workspaceId`,`agentKey`)
);
