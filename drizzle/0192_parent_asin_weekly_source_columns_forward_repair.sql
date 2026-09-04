-- 0190/0191均未实际落地字段，保持不可变；0192仅追加来源字段，不与索引操作混合。
ALTER TABLE `lingxing_product_weekly`
  ADD COLUMN `source_kind` varchar(48) NOT NULL DEFAULT 'uploaded_parent_asin_weekly',
  ADD COLUMN `source_batch_id` int NULL,
  ADD COLUMN `source_trace_id` varchar(128) NULL,
  ADD COLUMN `source_schema_version` varchar(32) NULL;
