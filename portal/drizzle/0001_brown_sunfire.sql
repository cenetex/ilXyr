ALTER TABLE `reviews` ADD `addressed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `reviews` ADD `response` text;--> statement-breakpoint
ALTER TABLE `reviews` ADD `resolved_at` text;