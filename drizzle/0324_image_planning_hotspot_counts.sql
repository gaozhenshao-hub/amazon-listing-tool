-- One desktop image plus 2–6 mobile detail images. Only system specification
-- metadata is corrected; no image tags or existing library assets are rewritten.
UPDATE kb_tag_definitions
SET metadata=JSON_SET(COALESCE(metadata,JSON_OBJECT()),'$.min',3,'$.max',7,'$.defaultCount',4)
WHERE dimension='imageBelong' AND parentValue='高级A+' AND value IN ('热点图片','热点图文') AND isSystem=1;
