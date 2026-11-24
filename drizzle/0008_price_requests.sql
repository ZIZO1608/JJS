ALTER TABLE `client_accounts` ADD `show_prices` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `order_requests` ADD `needs_price` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `order_requests` ADD `quote_json` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `order_requests` ADD `quoted_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `order_requests` ADD `quoted_at` text;--> statement-breakpoint
ALTER TABLE `order_requests` ADD `approved_at` text;--> statement-breakpoint
ALTER TABLE `order_requests` ADD `client_reply` text DEFAULT '' NOT NULL;