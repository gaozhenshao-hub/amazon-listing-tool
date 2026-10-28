import { hasCompleteSetTags, type SetTags } from "../../../shared/imageSetTags";
import { sql } from "drizzle-orm";
import { requireDb } from "../../repositories/dbClient";
import { imageTaggingUnits, hasCompleteImageTags } from "../../../shared/imageTaggingUnits";
import type { KbImage } from "../../../drizzle/schema/image";

export async function readAutomaticTaggingStatus(workspaceId: number, userId: number, imageSetId: number) {
  const db = await requireDb("image tagging progress");
  const [records] = await db.execute(sql`SELECT i.id,i.imagePosition,i.sourceUrlHash,i.positionIndex,i.tagsConfirmed,i.analysisConfirmed,
    i.tagCategory,i.tagImageTypeMain,i.tagComposition,i.tagDesignStyleV2,i.tagColorSchemeV2,s.sourceLayout,s.setCategory,s.setStyle,s.setPrimaryColor,s.setAccentColor
    FROM kb_images i JOIN kb_image_sets s ON s.id=i.imageSetId
    WHERE s.id=${imageSetId} AND s.workspaceId=${workspaceId} AND s.userId=${userId} AND i.imagePosition<>'brand_story'`);
  const images = records as unknown as Array<KbImage & SetTags & {sourceLayout:unknown}>;
  const units = imageTaggingUnits(images,images[0]?.sourceLayout);
  const total = units.length, completed = units.filter(unit=>unit.complete && hasCompleteImageTags(unit.primary)).length;
  const [jobs] = await db.execute(sql`SELECT status FROM ai_jobs WHERE workspaceId=${workspaceId} AND userId=${userId}
    AND kind='knowledge.images.autotag' AND JSON_EXTRACT(input,'$.imageSetId')=${imageSetId} ORDER BY id DESC LIMIT 1`);
  const job = (jobs as unknown as Array<{ status: string }>)[0];
  const setCompleted = hasCompleteSetTags(images[0]);
  const status = setCompleted && completed >= total ? "completed" : job?.status === "queued" ? "queued" : job?.status === "running" ? "running"
    : job && ["failed", "canceled", "succeeded"].includes(job.status) ? "failed" : "waiting";
  return { status, total, completed, setCompleted, pending: total - completed };
}
