DROP INDEX "supplier_pricing_tier_code_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_pricing_tier_version_uq" ON "supplier_pricing_tier" USING btree ("tier_code","effective_from");