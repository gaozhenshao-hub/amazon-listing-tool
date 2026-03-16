ALTER TABLE `dev_products` ADD `parentAsin` varchar(20);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `sku` varchar(100);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `productLink` text;--> statement-breakpoint
ALTER TABLE `dev_products` ADD `categoryPath` text;--> statement-breakpoint
ALTER TABLE `dev_products` ADD `bsrLarge` int;--> statement-breakpoint
ALTER TABLE `dev_products` ADD `bsrSmall` int;--> statement-breakpoint
ALTER TABLE `dev_products` ADD `bsrGrowthRate` varchar(50);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `fbaFee` varchar(50);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `grossMargin` varchar(50);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `monthlySalesGrowth` varchar(50);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `childSales` int;--> statement-breakpoint
ALTER TABLE `dev_products` ADD `childRevenue` decimal(12,2);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `monthlyNewReviews` int;--> statement-breakpoint
ALTER TABLE `dev_products` ADD `reviewRate` varchar(50);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `lqs` int;--> statement-breakpoint
ALTER TABLE `dev_products` ADD `sellerCount` int;--> statement-breakpoint
ALTER TABLE `dev_products` ADD `listingDays` int;--> statement-breakpoint
ALTER TABLE `dev_products` ADD `buyboxSeller` varchar(255);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `buyboxType` varchar(50);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `hasAPlus` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `dev_products` ADD `hasVideo` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `dev_products` ADD `hasBrandStory` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `dev_products` ADD `hasAmazonChoice` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `dev_products` ADD `productWeight` varchar(100);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `productSize` varchar(200);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `packageWeight` varchar(100);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `packageSize` varchar(200);--> statement-breakpoint
ALTER TABLE `dev_products` ADD `packageSizeTier` varchar(100);