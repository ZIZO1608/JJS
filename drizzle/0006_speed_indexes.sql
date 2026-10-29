CREATE INDEX `orders_created_idx` ON `orders` (`created_at`);--> statement-breakpoint
CREATE INDEX `returns_client_idx` ON `returns` (`client_id`,`business_date`);