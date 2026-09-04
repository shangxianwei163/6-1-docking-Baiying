ALTER TABLE "global_variable_mapping_draft" ADD CONSTRAINT "mapping_draft_payload_ck" CHECK (
    ("global_variable_mapping_draft"."change_type" = 'REMOVE' AND "global_variable_mapping_draft"."removal_reason" IS NOT NULL)
    OR
    ("global_variable_mapping_draft"."change_type" = 'UPSERT' AND "global_variable_mapping_draft"."transform_config" IS NOT NULL AND "global_variable_mapping_draft"."empty_policy" IS NOT NULL AND ("global_variable_mapping_draft"."erp_field" IS NOT NULL OR "global_variable_mapping_draft"."crm_field" IS NOT NULL))
  );--> statement-breakpoint
ALTER TABLE "global_variable_mapping" ADD CONSTRAINT "mapping_has_source_field_ck" CHECK ("global_variable_mapping"."status" = 'REMOVED' OR "global_variable_mapping"."erp_field" IS NOT NULL OR "global_variable_mapping"."crm_field" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "global_variable_mapping" ADD CONSTRAINT "mapping_default_value_ck" CHECK ("global_variable_mapping"."empty_policy" <> 'DEFAULT' OR "global_variable_mapping"."default_value" IS NOT NULL);