-- FRESH BOOTSTRAP ONLY. Never run against an existing application database.
-- The guarded fresh entry must prove the whole schema was initially empty,
-- and recheck all twelve table row counts are zero immediately before this file.
-- Complete CREATE definitions are copied verbatim from the pinned public
-- current-source projection; original workspace indexes come from immutable 0116.
-- No business rows are copied, renamed, inferred or seeded.

DROP TABLE `off_ai_analysis_logs`;
DROP TABLE `off_attribution_links`;
DROP TABLE `off_campaign_analytics`;
DROP TABLE `off_campaigns`;
DROP TABLE `off_collaborations`;
DROP TABLE `off_content_calendar`;
DROP TABLE `off_content_submissions`;
DROP TABLE `off_influencer_scores`;
DROP TABLE `off_influencers`;
DROP TABLE `off_matrix_groups`;
DROP TABLE `off_outreach_messages`;
DROP TABLE `off_social_accounts`;

CREATE TABLE `off_ai_analysis_logs` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`analysis_type` varchar(50) NOT NULL,
	`entity_type` varchar(50),
	`entity_id` int,
	`input_data` text,
	`output_data` text,
	`prompt_used` text,
	`tokens_used` int DEFAULT 0,
	`duration_ms` int DEFAULT 0,
	`status` varchar(30) DEFAULT 'completed',
	`error_message` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `off_ai_analysis_logs_id` PRIMARY KEY(`id`)
);
CREATE INDEX `idx_off_ai_analysis_logs_workspace` ON `off_ai_analysis_logs` (`workspaceId`);

CREATE TABLE `off_attribution_links` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`campaign_id` int,
	`collaboration_id` int,
	`influencer_id` int,
	`original_url` text NOT NULL,
	`short_url` varchar(500),
	`amazon_tag` varchar(100),
	`utm_source` varchar(100),
	`utm_medium` varchar(100),
	`utm_campaign` varchar(200),
	`utm_content` varchar(200),
	`click_count` int DEFAULT 0,
	`conversion_count` int DEFAULT 0,
	`revenue` decimal(12,2) DEFAULT '0',
	`brb_amount` decimal(12,2) DEFAULT '0',
	`last_click_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_attribution_links_id` PRIMARY KEY(`id`)
);
CREATE INDEX `idx_off_attribution_links_workspace` ON `off_attribution_links` (`workspaceId`);

CREATE TABLE `off_campaign_analytics` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`campaign_id` int NOT NULL,
	`date` varchar(20) NOT NULL,
	`impressions` int DEFAULT 0,
	`reach` int DEFAULT 0,
	`clicks` int DEFAULT 0,
	`conversions` int DEFAULT 0,
	`revenue` decimal(12,2) DEFAULT '0',
	`spend` decimal(12,2) DEFAULT '0',
	`engagements` int DEFAULT 0,
	`video_views` int DEFAULT 0,
	`shares` int DEFAULT 0,
	`comments` int DEFAULT 0,
	`saves` int DEFAULT 0,
	`brb_revenue` decimal(12,2) DEFAULT '0',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `off_campaign_analytics_id` PRIMARY KEY(`id`)
);
CREATE INDEX `idx_off_campaign_analytics_workspace` ON `off_campaign_analytics` (`workspaceId`);

CREATE TABLE `off_campaigns` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`name` varchar(300) NOT NULL,
	`description` text,
	`type` varchar(50) DEFAULT 'influencer',
	`status` varchar(30) DEFAULT 'draft',
	`target_marketplace` varchar(10),
	`target_asin` varchar(50),
	`target_product_name` varchar(300),
	`budget` decimal(12,2) DEFAULT '0',
	`spent_amount` decimal(12,2) DEFAULT '0',
	`start_date` varchar(20),
	`end_date` varchar(20),
	`goals` text,
	`kpi_targets` text,
	`tags` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_campaigns_id` PRIMARY KEY(`id`)
);
CREATE INDEX `idx_off_campaigns_workspace` ON `off_campaigns` (`workspaceId`);

CREATE TABLE `off_collaborations` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`campaign_id` int NOT NULL,
	`influencer_id` int NOT NULL,
	`user_id` int NOT NULL,
	`stage` varchar(30) DEFAULT 'contacted',
	`agreed_price` decimal(10,2) DEFAULT '0',
	`payment_status` varchar(30) DEFAULT 'pending',
	`deliverables` text,
	`deadline` varchar(20),
	`content_url` text,
	`tracking_link` text,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_collaborations_id` PRIMARY KEY(`id`)
);
CREATE INDEX `idx_off_collaborations_workspace` ON `off_collaborations` (`workspaceId`);

CREATE TABLE `off_content_calendar` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`social_account_id` int,
	`campaign_id` int,
	`title` varchar(300) NOT NULL,
	`content_type` varchar(50),
	`platform` varchar(50) NOT NULL,
	`status` varchar(30) DEFAULT 'draft',
	`scheduled_date` varchar(20) NOT NULL,
	`scheduled_time` varchar(10),
	`published_at` timestamp,
	`content` text,
	`media_urls` text,
	`hashtags` text,
	`ai_generated_content` text,
	`metrics` text,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_content_calendar_id` PRIMARY KEY(`id`)
);
CREATE INDEX `idx_off_content_calendar_workspace` ON `off_content_calendar` (`workspaceId`);

CREATE TABLE `off_content_submissions` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`collaboration_id` int,
	`influencer_id` int,
	`user_id` int NOT NULL,
	`content_type` varchar(30) DEFAULT 'post',
	`content_url` text,
	`thumbnail_url` text,
	`caption` text,
	`status` varchar(30) DEFAULT 'pending',
	`ai_review_result` text,
	`human_review_notes` text,
	`revision_count` int DEFAULT 0,
	`published_at` timestamp,
	`metrics` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_content_submissions_id` PRIMARY KEY(`id`)
);
CREATE INDEX `idx_off_content_submissions_workspace` ON `off_content_submissions` (`workspaceId`);

CREATE TABLE `off_influencer_scores` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`influencer_id` int NOT NULL,
	`overall_score` decimal(5,2) DEFAULT '0',
	`relevance_score` decimal(5,2) DEFAULT '0',
	`engagement_score` decimal(5,2) DEFAULT '0',
	`authenticity_score` decimal(5,2) DEFAULT '0',
	`cost_efficiency_score` decimal(5,2) DEFAULT '0',
	`audience_match_score` decimal(5,2) DEFAULT '0',
	`ai_analysis` text,
	`scored_for_product` varchar(200),
	`scored_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `off_influencer_scores_id` PRIMARY KEY(`id`)
);
CREATE INDEX `idx_off_influencer_scores_workspace` ON `off_influencer_scores` (`workspaceId`);

CREATE TABLE `off_influencers` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`platform` varchar(50) NOT NULL,
	`handle` varchar(200) NOT NULL,
	`display_name` varchar(200),
	`profile_url` varchar(500),
	`avatar_url` varchar(500),
	`email` varchar(320),
	`phone` varchar(50),
	`country` varchar(50),
	`language` varchar(50),
	`category` varchar(100),
	`tags` text,
	`follower_count` int DEFAULT 0,
	`avg_views` int DEFAULT 0,
	`avg_likes` int DEFAULT 0,
	`engagement_rate` decimal(5,2),
	`estimated_cpm` decimal(10,2),
	`price_range` varchar(100),
	`notes` text,
	`status` varchar(30) DEFAULT 'active',
	`source` varchar(50),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_influencers_id` PRIMARY KEY(`id`)
);
CREATE INDEX `idx_off_influencers_workspace` ON `off_influencers` (`workspaceId`);

CREATE TABLE `off_matrix_groups` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`name` varchar(200) NOT NULL,
	`description` text,
	`platform` varchar(50) DEFAULT 'tiktok',
	`strategy` text,
	`account_count` int DEFAULT 0,
	`total_followers` int DEFAULT 0,
	`total_views` int DEFAULT 0,
	`status` varchar(30) DEFAULT 'active',
	`ai_content_strategy` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_matrix_groups_id` PRIMARY KEY(`id`)
);
CREATE INDEX `idx_off_matrix_groups_workspace` ON `off_matrix_groups` (`workspaceId`);

CREATE TABLE `off_outreach_messages` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`influencer_id` int NOT NULL,
	`campaign_id` int,
	`collaboration_id` int,
	`channel` varchar(30) DEFAULT 'email',
	`direction` varchar(10) DEFAULT 'outbound',
	`subject` varchar(500),
	`body` text,
	`ai_generated` boolean DEFAULT false,
	`status` varchar(30) DEFAULT 'draft',
	`scheduled_at` timestamp,
	`sent_at` timestamp,
	`sequence_step` int,
	`template_id` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `off_outreach_messages_id` PRIMARY KEY(`id`)
);
CREATE INDEX `idx_off_outreach_messages_workspace` ON `off_outreach_messages` (`workspaceId`);

CREATE TABLE `off_social_accounts` (
	`workspaceId` int,
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`platform` varchar(50) NOT NULL,
	`account_name` varchar(200) NOT NULL,
	`account_id` varchar(200),
	`profile_url` varchar(500),
	`avatar_url` varchar(500),
	`follower_count` int DEFAULT 0,
	`following_count` int DEFAULT 0,
	`post_count` int DEFAULT 0,
	`matrix_group_id` int,
	`status` varchar(30) DEFAULT 'active',
	`access_token` text,
	`refresh_token` text,
	`token_expires_at` timestamp,
	`last_sync_at` timestamp,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `off_social_accounts_id` PRIMARY KEY(`id`)
);
CREATE INDEX `idx_off_social_accounts_workspace` ON `off_social_accounts` (`workspaceId`);
