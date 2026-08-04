-- Link DSP report rows to the governed product dimension before 0113 indexes it.
-- The conditional DDL supports databases where the column was added manually.

SET @dspProductIdExists = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'ad_dsp_reports'
    AND column_name = 'product_id'
);

SET @dspProductIdSql = IF(
  @dspProductIdExists = 0,
  'ALTER TABLE `ad_dsp_reports` ADD COLUMN `product_id` int NULL AFTER `upload_id`',
  'SELECT 1'
);

PREPARE dsp_product_id_statement FROM @dspProductIdSql;
EXECUTE dsp_product_id_statement;
DEALLOCATE PREPARE dsp_product_id_statement;
