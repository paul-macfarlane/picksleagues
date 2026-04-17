CREATE TABLE "direct_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"invitee_user_id" text NOT NULL,
	"inviter_user_id" text,
	"role" "league_role" NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "direct_invites_league_invitee_uniq" UNIQUE("league_id","invitee_user_id")
);
--> statement-breakpoint
ALTER TABLE "direct_invites" ADD CONSTRAINT "direct_invites_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_invites" ADD CONSTRAINT "direct_invites_invitee_user_id_user_id_fk" FOREIGN KEY ("invitee_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_invites" ADD CONSTRAINT "direct_invites_inviter_user_id_user_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "direct_invites_invitee_user_id_idx" ON "direct_invites" USING btree ("invitee_user_id");--> statement-breakpoint
CREATE INDEX "direct_invites_league_id_idx" ON "direct_invites" USING btree ("league_id");