CREATE TABLE `order_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`request_id` text NOT NULL,
	`client_id` text NOT NULL,
	`category` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`reply` text DEFAULT '' NOT NULL,
	`resolved_by` text,
	`resolved_at` text,
	FOREIGN KEY (`request_id`) REFERENCES `order_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `order_reports_request_idx` ON `order_reports` (`request_id`);--> statement-breakpoint
CREATE INDEX `order_reports_status_idx` ON `order_reports` (`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `client_tiers` ADD `discount_amount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `client_tiers` ADD `discount_currency` text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE `employees` ADD `staff_discount_amount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivered_at` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivered_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_collected` real DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`,`assigned_to`);--> statement-breakpoint
ALTER TABLE `subscription_plans` ADD `discount_amount` real DEFAULT 0 NOT NULL;