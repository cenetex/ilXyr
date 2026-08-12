CREATE TABLE `forecasts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`proposal_id` text NOT NULL,
	`forecaster_id` text NOT NULL,
	`forecaster_name` text NOT NULL,
	`success_probability` real NOT NULL,
	`stake` integer NOT NULL,
	`rationale` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_forecasts_proposal_forecaster` ON `forecasts` (`proposal_id`,`forecaster_id`);--> statement-breakpoint
CREATE TABLE `funding_commitments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`proposal_id` text NOT NULL,
	`funder_id` text NOT NULL,
	`funder_name` text NOT NULL,
	`compute_credits` integer NOT NULL,
	`rationale` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_funding_proposal_funder` ON `funding_commitments` (`proposal_id`,`funder_id`);--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`owner_name` text NOT NULL,
	`status` text DEFAULT 'review' NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`hypothesis` text NOT NULL,
	`family` text NOT NULL,
	`baseline` text NOT NULL,
	`dataset_refs` text NOT NULL,
	`primary_metric` text NOT NULL,
	`success_threshold` real NOT NULL,
	`seeds` text NOT NULL,
	`compute_credits` integer NOT NULL,
	`evidence_level` text NOT NULL,
	`export_policy` text NOT NULL,
	`novelty` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_proposals_status_updated` ON `proposals` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`proposal_id` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`reviewer_name` text NOT NULL,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`comment` text NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_reviews_proposal_resolved` ON `reviews` (`proposal_id`,`resolved`);