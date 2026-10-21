CREATE TABLE `consignment_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`consignment_id` text NOT NULL,
	`product_id` text NOT NULL,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`qty` integer NOT NULL,
	`unit_price` real NOT NULL,
	`unit_cost_usd` real DEFAULT 0 NOT NULL,
	`returned_qty` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`consignment_id`) REFERENCES `consignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `consign_lines_idx` ON `consignment_lines` (`consignment_id`);--> statement-breakpoint
CREATE TABLE `consignments` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`number` integer NOT NULL,
	`business_date` text NOT NULL,
	`client_id` text NOT NULL,
	`rep_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`currency` text NOT NULL,
	`fx_rate` real,
	`note` text DEFAULT '' NOT NULL,
	`user_id` text,
	`settled_at` text,
	`order_id` text,
	`return_id` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consign_number_uq` ON `consignments` (`number`);--> statement-breakpoint
CREATE INDEX `consign_client_idx` ON `consignments` (`client_id`,`status`);--> statement-breakpoint
CREATE TABLE `price_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`item_id` text NOT NULL,
	`old_cost_usd` real NOT NULL,
	`new_cost_usd` real NOT NULL,
	`change_pct` real NOT NULL,
	`purchase_id` text,
	`business_date` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `price_changes_date_idx` ON `price_changes` (`business_date`);--> statement-breakpoint
CREATE TABLE `price_list_items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`list_id` text NOT NULL,
	`product_id` text NOT NULL,
	`price` real NOT NULL,
	`currency` text NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `price_lists`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pli_list_idx` ON `price_list_items` (`list_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `price_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `production_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`number` integer NOT NULL,
	`business_date` text NOT NULL,
	`employee_id` text,
	`items_count` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`user_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_number_uq` ON `production_runs` (`number`);--> statement-breakpoint
CREATE INDEX `runs_date_idx` ON `production_runs` (`business_date`);--> statement-breakpoint
CREATE TABLE `recurring_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`category_id` text,
	`item_id` text,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`day_of_month` integer DEFAULT 1 NOT NULL,
	`beneficiary` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`last_month` text
);
--> statement-breakpoint
CREATE TABLE `return_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`return_id` text NOT NULL,
	`product_id` text NOT NULL,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`qty` integer NOT NULL,
	`unit_price` real NOT NULL,
	`line_total` real NOT NULL,
	`unit_cost_usd` real DEFAULT 0 NOT NULL,
	`action` text NOT NULL,
	`batch_id` text,
	FOREIGN KEY (`return_id`) REFERENCES `returns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `return_lines_idx` ON `return_lines` (`return_id`);--> statement-breakpoint
CREATE TABLE `returns` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`number` integer NOT NULL,
	`business_date` text NOT NULL,
	`client_id` text,
	`order_id` text,
	`consignment_id` text,
	`currency` text NOT NULL,
	`fx_rate` real,
	`total` real NOT NULL,
	`total_usd` real NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`settlement` text NOT NULL,
	`box_id` text,
	`rep_id` text,
	`note` text DEFAULT '' NOT NULL,
	`user_id` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `returns_number_uq` ON `returns` (`number`);--> statement-breakpoint
CREATE INDEX `returns_date_idx` ON `returns` (`business_date`);--> statement-breakpoint
ALTER TABLE `batches` ADD `run_id` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `area_id` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `payment_terms_days` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `price_list_id` text;--> statement-breakpoint
ALTER TABLE `clients` ADD `consignment` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `rep_id` text;--> statement-breakpoint
ALTER TABLE `expenses` ADD `status` text DEFAULT 'paid' NOT NULL;--> statement-breakpoint
ALTER TABLE `expenses` ADD `due_date` text;--> statement-breakpoint
ALTER TABLE `expenses` ADD `paid_date` text;--> statement-breakpoint
ALTER TABLE `expenses` ADD `paid_by` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `expenses` ADD `beneficiary` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `expenses` ADD `photo` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `expenses` ADD `employee_id` text;--> statement-breakpoint
ALTER TABLE `expenses` ADD `recurring_id` text;--> statement-breakpoint
ALTER TABLE `items` ADD `pack_unit` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `pack_size` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `supplier_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `cancel_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `paid_amount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `consignment_id` text;--> statement-breakpoint
ALTER TABLE `products` ADD `weight_g` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `extra_cost_usd` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `purchases` ADD `supplier_ref` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `purchases` ADD `discount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `purchases` ADD `transport` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `purchases` ADD `due_date` text;--> statement-breakpoint
ALTER TABLE `purchases` ADD `photo` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `recipes` ADD `waste_pct` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `opening_balance` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `opening_currency` text DEFAULT 'SYP' NOT NULL;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `opening_usd` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `opening_paid_usd` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `suppliers` ADD `payment_terms_days` integer DEFAULT 0 NOT NULL;