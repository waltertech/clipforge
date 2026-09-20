CREATE TABLE `garment_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`garment_ids` text NOT NULL,
	`character_id` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `garments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`view` text DEFAULT 'flat' NOT NULL,
	`front_path` text NOT NULL,
	`back_path` text,
	`color_tags` text DEFAULT '[]',
	`notes` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `looks` (
	`id` text PRIMARY KEY NOT NULL,
	`garment_set_id` text NOT NULL,
	`character_id` text NOT NULL,
	`character_snapshot` text,
	`pose_id` text NOT NULL,
	`look_preset_id` text,
	`route` text NOT NULL,
	`provider` text,
	`model` text,
	`prompt` text,
	`image_path` text,
	`ai_task_id` text,
	`score` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`garment_set_id`) REFERENCES `garment_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
