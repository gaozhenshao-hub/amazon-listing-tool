import { and, eq } from "drizzle-orm";
import { acquisitionProviderProfiles } from "../../../drizzle/schema/acquisition";
import type { DbExecutor } from "../../repositories/dbClient";
import { BASIC_AMAZON_PROVIDER } from "./basicAmazonProvider";

/** Reuse only the administrator-enabled legacy profile; never create or enable one implicitly. */
export async function getBasicImagesProfile(db: DbExecutor, workspaceId: number) {
  const [profile] = await db.select().from(acquisitionProviderProfiles).where(and(
    eq(acquisitionProviderProfiles.workspaceId, workspaceId),
    eq(acquisitionProviderProfiles.profileKey, "builtin-amazon-images"),
    eq(acquisitionProviderProfiles.providerCode, BASIC_AMAZON_PROVIDER),
    eq(acquisitionProviderProfiles.status, "active"),
  )).limit(1);
  return profile ?? null;
}
