ALTER TABLE `dev_product_manuals` ADD `coverImageUrl` text;--> statement-breakpoint
ALTER TABLE `dev_product_manuals` ADD `qrCodeUrl` text;--> statement-breakpoint
ALTER TABLE `dev_product_manuals` ADD `spanishContent` text;--> statement-breakpoint
ALTER TABLE `dev_product_manuals` ADD `brandAssets` text;--> statement-breakpoint
ALTER TABLE `dev_product_manuals` ADD `htmlEnUrl` text;--> statement-breakpoint
ALTER TABLE `dev_product_manuals` ADD `htmlEsUrl` text;--> statement-breakpoint
ALTER TABLE `dev_product_manuals` ADD `pdfEnUrl` text;--> statement-breakpoint
ALTER TABLE `dev_product_manuals` ADD `pdfEsUrl` text;--> statement-breakpoint
ALTER TABLE `dev_product_profiles` ADD `appearanceAiSuggestion` text;--> statement-breakpoint
ALTER TABLE `dev_product_profiles` ADD `appearanceConfirmed` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `dev_product_profiles` ADD `functionsAiSuggestion` text;--> statement-breakpoint
ALTER TABLE `dev_product_profiles` ADD `functionsConfirmed` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `dev_product_profiles` ADD `costAiSuggestion` text;--> statement-breakpoint
ALTER TABLE `dev_product_profiles` ADD `costConfirmed` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `dev_product_profiles` ADD `packageAiSuggestion` text;--> statement-breakpoint
ALTER TABLE `dev_product_profiles` ADD `packageConfirmed` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `dev_product_profiles` ADD `packageDesignAiSuggestion` text;--> statement-breakpoint
ALTER TABLE `dev_product_profiles` ADD `packageDesignConfirmed` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `dev_product_profiles` ADD `userPersonaAiSuggestion` text;--> statement-breakpoint
ALTER TABLE `dev_product_profiles` ADD `userPersonaConfirmed` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `dev_product_profiles` ADD `usageScenariosAiSuggestion` text;--> statement-breakpoint
ALTER TABLE `dev_product_profiles` ADD `usageScenariosConfirmed` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `dev_product_profiles` ADD `productMapAiSuggestion` text;--> statement-breakpoint
ALTER TABLE `dev_product_profiles` ADD `productMapConfirmed` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `dev_projects` ADD `phase` enum('market_analysis','project_execution') DEFAULT 'market_analysis' NOT NULL;--> statement-breakpoint
ALTER TABLE `dev_projects` ADD `approvedAt` timestamp;--> statement-breakpoint
ALTER TABLE `dev_projects` ADD `approvedScore` int;--> statement-breakpoint
ALTER TABLE `dev_test_reports` ADD `excelUrl` text;