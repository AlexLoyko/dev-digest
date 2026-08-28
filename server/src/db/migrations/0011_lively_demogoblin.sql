CREATE TABLE "agent_context_documents" (
	"agent_id" uuid NOT NULL,
	"path" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_context_documents_agent_id_path_pk" PRIMARY KEY("agent_id","path")
);
--> statement-breakpoint
CREATE TABLE "repo_context_documents" (
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"root" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"tokens" integer DEFAULT 0 NOT NULL,
	"tokens_approximate" boolean DEFAULT false NOT NULL,
	"threat_level" text DEFAULT 'unknown' NOT NULL,
	"excluded_reason" text,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_context_documents_repo_id_path_pk" PRIMARY KEY("repo_id","path")
);
--> statement-breakpoint
CREATE TABLE "repo_context_scans" (
	"repo_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"commit_sha" text,
	"duration_ms" integer,
	"message" text,
	"scanned_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "skill_context_documents" (
	"skill_id" uuid NOT NULL,
	"path" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "skill_context_documents_skill_id_path_pk" PRIMARY KEY("skill_id","path")
);
--> statement-breakpoint
ALTER TABLE "agent_context_documents" ADD CONSTRAINT "agent_context_documents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_context_documents" ADD CONSTRAINT "repo_context_documents_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_context_scans" ADD CONSTRAINT "repo_context_scans_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_context_documents" ADD CONSTRAINT "skill_context_documents_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;