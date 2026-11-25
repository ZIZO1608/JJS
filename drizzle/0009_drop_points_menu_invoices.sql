ALTER TABLE `clients` ADD `drop_point` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `drop_cut_type` text DEFAULT 'pct' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `drop_cut_value` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `drop_cut_currency` text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `drop_money` text DEFAULT 'cash' NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `invoice_template` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `show_on_menu` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `menu_desc_ar` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `menu_desc_en` text DEFAULT '' NOT NULL;