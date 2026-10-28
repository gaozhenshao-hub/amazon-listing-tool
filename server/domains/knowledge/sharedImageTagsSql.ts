import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { kbImages, kbImageSets } from "../../../drizzle/schema/image";

export const tagOwner = alias(kbImages, "kb_tag_owner");
// Derive the owner before filtering/pagination, so a module member matches its
// shared labels without loading the complete library or duplicating stored tags.
const firstHash = sql`(SELECT JSON_UNQUOTE(JSON_EXTRACT(m.body, '$.cards[0].images[0].hash'))
  FROM JSON_TABLE(${kbImageSets.sourceLayout}, '$.modules[*]' COLUMNS(body JSON PATH '$')) AS m
  WHERE JSON_UNQUOTE(JSON_EXTRACT(m.body, '$.section'))='aplus'
    AND JSON_UNQUOTE(JSON_EXTRACT(m.body, '$.kind'))<>'carousel'
    AND JSON_CONTAINS(JSON_EXTRACT(m.body, '$.cards[*].images[*].hash'), JSON_QUOTE(${kbImages.sourceUrlHash}))
  LIMIT 1)`;
export const tagOwnerJoin = and(sql`${tagOwner.recycleId} IS NULL`,sql`${tagOwner.imageSetId} <=> ${kbImages.imageSetId}`, sql`CASE
  WHEN ${kbImages.imagePosition}='aplus' AND ${kbImages.sourceUrlHash} IS NOT NULL
  THEN ${tagOwner.sourceUrlHash}=COALESCE(${firstHash}, ${kbImages.sourceUrlHash}) AND ${tagOwner.imagePosition}='aplus'
  ELSE ${tagOwner.id}=${kbImages.id} END`);
