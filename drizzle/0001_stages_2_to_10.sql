CREATE TABLE `advances` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`employee_id` text NOT NULL,
	`date` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`fx_rate` real,
	`amount_usd` real NOT NULL,
	`remaining_usd` real NOT NULL,
	`box_id` text,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`box_id`) REFERENCES `cash_boxes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `advances_emp_idx` ON `advances` (`employee_id`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`price` real NOT NULL,
	`currency` text NOT NULL,
	`fx_rate` real,
	`price_usd` real NOT NULL,
	`purchase_date` text NOT NULL,
	`life_months` integer NOT NULL,
	`salvage_usd` real DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `batches` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`item_id` text NOT NULL,
	`location_id` text NOT NULL,
	`batch_code` text NOT NULL,
	`produced_at` text NOT NULL,
	`expires_at` text,
	`qty_in` real NOT NULL,
	`qty_left` real NOT NULL,
	`unit_cost_usd` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `batches_code_uq` ON `batches` (`batch_code`);--> statement-breakpoint
CREATE INDEX `batches_item_idx` ON `batches` (`item_id`,`qty_left`);--> statement-breakpoint
CREATE INDEX `batches_exp_idx` ON `batches` (`expires_at`);--> statement-breakpoint
CREATE TABLE `box_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`box_id` text NOT NULL,
	`type` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`fx_rate` real,
	`amount_usd` real NOT NULL,
	`ref_type` text,
	`ref_id` text,
	`note` text DEFAULT '' NOT NULL,
	`user_id` text,
	`business_date` text NOT NULL,
	FOREIGN KEY (`box_id`) REFERENCES `cash_boxes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `box_moves_box_idx` ON `box_moves` (`box_id`);--> statement-breakpoint
CREATE INDEX `box_moves_date_idx` ON `box_moves` (`business_date`);--> statement-breakpoint
CREATE TABLE `business_days` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`date` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`closed_at` text,
	`closed_by` text,
	`expected_cash_usd` real,
	`counted_cash_usd` real,
	`difference_usd` real,
	`totals_json` text,
	`reopened_at` text,
	`reopened_by` text,
	FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reopened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `business_days_date_unique` ON `business_days` (`date`);--> statement-breakpoint
CREATE TABLE `cash_boxes` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`kind` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`employee_id` text,
	`system_key` text,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `client_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`client_id` text NOT NULL,
	`type` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`fx_rate` real,
	`amount_usd` real NOT NULL,
	`order_id` text,
	`payment_id` text,
	`note` text DEFAULT '' NOT NULL,
	`user_id` text,
	`business_date` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `client_moves_client_idx` ON `client_moves` (`client_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `client_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`client_id` text NOT NULL,
	`product_id` text NOT NULL,
	`price` real NOT NULL,
	`currency` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `client_prices_idx` ON `client_prices` (`client_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `client_tiers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`discount_pct` real DEFAULT 0 NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`contact_person` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`tier_id` text,
	`tag_id` text,
	`receipt_language` text DEFAULT 'ar' NOT NULL,
	`credit_limit_usd` real DEFAULT 0 NOT NULL,
	`credit_block` integer DEFAULT false NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`converted_at` text,
	FOREIGN KEY (`tier_id`) REFERENCES `client_tiers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `lookups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `clients_name_idx` ON `clients` (`name`);--> statement-breakpoint
CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`name` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`job_title` text DEFAULT '' NOT NULL,
	`user_id` text,
	`pay_model` text DEFAULT 'fixed' NOT NULL,
	`base_salary` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`commission_per_client_usd` real DEFAULT 0 NOT NULL,
	`commission_pct` real DEFAULT 0 NOT NULL,
	`staff_discount_pct` real DEFAULT 30 NOT NULL,
	`is_delivery_rep` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`date` text NOT NULL,
	`category_id` text,
	`item_id` text,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`fx_rate` real,
	`amount_usd` real NOT NULL,
	`box_id` text,
	`asset_id` text,
	`note` text DEFAULT '' NOT NULL,
	`user_id` text,
	FOREIGN KEY (`category_id`) REFERENCES `lookups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `lookups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`box_id`) REFERENCES `cash_boxes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `expenses_date_idx` ON `expenses` (`date`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`kind` text NOT NULL,
	`product_id` text,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`unit_id` text,
	`unit_code` text DEFAULT 'pc' NOT NULL,
	`min_level` real DEFAULT 0 NOT NULL,
	`avg_cost_usd` real DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `lookups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `items_kind_idx` ON `items` (`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `items_product_uq` ON `items` (`product_id`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`warehouse_id` text NOT NULL,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `locations_wh_idx` ON `locations` (`warehouse_id`);--> statement-breakpoint
CREATE TABLE `option_group_links` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`group_id` text NOT NULL,
	`category_id` text,
	`product_id` text,
	FOREIGN KEY (`group_id`) REFERENCES `option_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ogl_group_idx` ON `option_group_links` (`group_id`);--> statement-breakpoint
CREATE TABLE `option_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`min_select` integer DEFAULT 0 NOT NULL,
	`max_select` integer DEFAULT 5 NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `options` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`group_id` text NOT NULL,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`price_delta` real DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `option_groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `options_group_idx` ON `options` (`group_id`);--> statement-breakpoint
CREATE TABLE `order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`order_id` text NOT NULL,
	`product_id` text NOT NULL,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`qty` integer NOT NULL,
	`free_qty` integer DEFAULT 0 NOT NULL,
	`unit_price` real NOT NULL,
	`options_json` text DEFAULT '[]' NOT NULL,
	`line_total` real NOT NULL,
	`unit_cost_usd` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `order_lines_order_idx` ON `order_lines` (`order_id`);--> statement-breakpoint
CREATE INDEX `order_lines_product_idx` ON `order_lines` (`product_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`number` integer NOT NULL,
	`business_date` text NOT NULL,
	`client_id` text,
	`type` text DEFAULT 'normal' NOT NULL,
	`employee_id` text,
	`fulfilment` text DEFAULT 'pickup' NOT NULL,
	`assigned_to` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`payment_status` text NOT NULL,
	`method_id` text,
	`currency` text NOT NULL,
	`fx_rate` real,
	`subtotal` real NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`discount_reason` text DEFAULT '' NOT NULL,
	`tax_total` real DEFAULT 0 NOT NULL,
	`taxes_json` text DEFAULT '[]' NOT NULL,
	`delivery_fee` real DEFAULT 0 NOT NULL,
	`total` real NOT NULL,
	`total_usd` real NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`items_count` integer DEFAULT 0 NOT NULL,
	`free_items` integer DEFAULT 0 NOT NULL,
	`loyalty_free` integer DEFAULT 0 NOT NULL,
	`sub_free` integer DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`user_id` text,
	`cancelled_at` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`method_id`) REFERENCES `payment_methods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_number_uq` ON `orders` (`number`);--> statement-breakpoint
CREATE INDEX `orders_date_idx` ON `orders` (`business_date`);--> statement-breakpoint
CREATE INDEX `orders_client_idx` ON `orders` (`client_id`,`business_date`);--> statement-breakpoint
CREATE TABLE `payment_methods` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`kind` text NOT NULL,
	`box_id` text,
	`system_key` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`box_id`) REFERENCES `cash_boxes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`kind` text NOT NULL,
	`order_id` text,
	`client_id` text,
	`method_id` text NOT NULL,
	`box_id` text,
	`amount` real NOT NULL,
	`currency` text NOT NULL,
	`fx_rate` real,
	`amount_usd` real NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`user_id` text,
	`business_date` text NOT NULL,
	FOREIGN KEY (`method_id`) REFERENCES `payment_methods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`box_id`) REFERENCES `cash_boxes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payments_date_idx` ON `payments` (`business_date`);--> statement-breakpoint
CREATE INDEX `payments_client_idx` ON `payments` (`client_id`);--> statement-breakpoint
CREATE TABLE `payroll_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`month` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`paid_at` text,
	`box_id` text,
	FOREIGN KEY (`box_id`) REFERENCES `cash_boxes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payroll_runs_month_unique` ON `payroll_runs` (`month`);--> statement-breakpoint
CREATE TABLE `payslips` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`run_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`base_usd` real NOT NULL,
	`commission_usd` real NOT NULL,
	`advances_usd` real NOT NULL,
	`staff_purchases_usd` real NOT NULL,
	`net_usd` real NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `payroll_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payslips_run_idx` ON `payslips` (`run_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`category_id` text NOT NULL,
	`code` text NOT NULL,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`price` real NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`shelf_life_hours` integer DEFAULT 24 NOT NULL,
	`allergens` text DEFAULT '' NOT NULL,
	`photo` text DEFAULT '' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_code_uq` ON `products` (`code`);--> statement-breakpoint
CREATE INDEX `products_category_idx` ON `products` (`category_id`);--> statement-breakpoint
CREATE TABLE `purchase_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`purchase_id` text NOT NULL,
	`item_id` text NOT NULL,
	`qty` real NOT NULL,
	`unit_price` real NOT NULL,
	`location_id` text NOT NULL,
	`expires_at` text,
	`batch_id` text,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pl_purchase_idx` ON `purchase_lines` (`purchase_id`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`number` integer NOT NULL,
	`supplier_id` text,
	`date` text NOT NULL,
	`currency` text NOT NULL,
	`fx_rate` real,
	`total` real NOT NULL,
	`total_usd` real NOT NULL,
	`paid` real DEFAULT 0 NOT NULL,
	`paid_from_box_id` text,
	`note` text DEFAULT '' NOT NULL,
	`user_id` text,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_number_uq` ON `purchases` (`number`);--> statement-breakpoint
CREATE INDEX `purchases_date_idx` ON `purchases` (`date`);--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`product_id` text,
	`option_id` text,
	`item_id` text NOT NULL,
	`qty` real NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`option_id`) REFERENCES `options`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recipes_product_idx` ON `recipes` (`product_id`);--> statement-breakpoint
CREATE INDEX `recipes_option_idx` ON `recipes` (`option_id`);--> statement-breakpoint
CREATE TABLE `recurring_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`client_id` text NOT NULL,
	`days` text NOT NULL,
	`lines_json` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recurring_client_idx` ON `recurring_orders` (`client_id`);--> statement-breakpoint
CREATE TABLE `sales_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`employee_id` text,
	`client_id` text,
	`prospect_name` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`date` text NOT NULL,
	`result` text NOT NULL,
	`next_follow_up` text,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sales_calls_date_idx` ON `sales_calls` (`date`);--> statement-breakpoint
CREATE TABLE `stock_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`item_id` text NOT NULL,
	`batch_id` text,
	`type` text NOT NULL,
	`qty` real NOT NULL,
	`location_id` text,
	`unit_cost_usd` real DEFAULT 0 NOT NULL,
	`ref_type` text,
	`ref_id` text,
	`reason_id` text,
	`note` text,
	`user_id` text,
	`business_date` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reason_id`) REFERENCES `lookups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `moves_item_idx` ON `stock_moves` (`item_id`);--> statement-breakpoint
CREATE INDEX `moves_ref_idx` ON `stock_moves` (`ref_type`,`ref_id`);--> statement-breakpoint
CREATE INDEX `moves_date_idx` ON `stock_moves` (`business_date`,`type`);--> statement-breakpoint
CREATE TABLE `subscription_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`monthly_fee` real NOT NULL,
	`currency` text NOT NULL,
	`discount_pct` real DEFAULT 0 NOT NULL,
	`included_items` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`client_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`auto_renew` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `subs_client_idx` ON `subscriptions` (`client_id`,`status`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`name` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `warehouses` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`synced_at` text,
	`name_ar` text NOT NULL,
	`name_en` text NOT NULL,
	`kind` text DEFAULT 'store' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
