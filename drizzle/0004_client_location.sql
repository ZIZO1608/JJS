ALTER TABLE `clients` ADD `lat` real;--> statement-breakpoint
ALTER TABLE `clients` ADD `lng` real;--> statement-breakpoint
ALTER TABLE `clients` ADD `map_url` text DEFAULT '' NOT NULL;