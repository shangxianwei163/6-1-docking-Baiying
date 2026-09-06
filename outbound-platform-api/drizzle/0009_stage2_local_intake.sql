CREATE TABLE "api_request_nonce" (
	"integration_client_id" uuid NOT NULL,
	"nonce" varchar(128) NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "api_request_nonce_integration_client_id_nonce_pk" PRIMARY KEY("integration_client_id","nonce")
);
--> statement-breakpoint
ALTER TABLE "api_request_nonce" ADD CONSTRAINT "api_request_nonce_integration_client_id_integration_client_id_fk" FOREIGN KEY ("integration_client_id") REFERENCES "public"."integration_client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_request_nonce_expiry_idx" ON "api_request_nonce" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "api_request_nonce_rate_limit_idx" ON "api_request_nonce" USING btree ("integration_client_id","received_at");