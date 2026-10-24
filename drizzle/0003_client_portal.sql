CREATE TABLE `client_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`client_id` text NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`must_change_password` integer DEFAULT true NOT NULL,
	`last_login_at` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_accounts_client_uq` ON `client_accounts` (`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `client_accounts_username_uq` ON `client_accounts` (`username`);--> statement-breakpoint
CREATE TABLE `client_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `client_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `client_sessions_account_idx` ON `client_sessions` (`account_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`client_id` text,
	`kind` text NOT NULL,
	`title_ar` text NOT NULL,
	`title_en` text NOT NULL,
	`body_ar` text DEFAULT '' NOT NULL,
	`body_en` text DEFAULT '' NOT NULL,
	`link` text DEFAULT '' NOT NULL,
	`ref_id` text,
	`read_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_client_idx` ON `notifications` (`client_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `order_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`number` integer NOT NULL,
	`client_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`fulfilment` text DEFAULT 'pickup' NOT NULL,
	`payment_choice` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`lines_json` text NOT NULL,
	`quoted_total` real NOT NULL,
	`currency` text NOT NULL,
	`items_count` integer DEFAULT 0 NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`decline_reason` text DEFAULT '' NOT NULL,
	`order_id` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_requests_number_uq` ON `order_requests` (`number`);--> statement-breakpoint
CREATE INDEX `order_requests_client_idx` ON `order_requests` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `order_requests_status_idx` ON `order_requests` (`status`);--> statement-breakpoint
CREATE TABLE `subscription_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`client_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`decline_reason` text DEFAULT '' NOT NULL,
	`subscription_id` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sub_requests_client_idx` ON `subscription_requests` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sub_requests_status_idx` ON `subscription_requests` (`status`);--> statement-breakpoint
ALTER TABLE `orders` ADD `source` text DEFAULT 'staff' NOT NULL;