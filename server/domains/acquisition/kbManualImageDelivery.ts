import { TRPCError } from "@trpc/server";
import * as kbDb from "../../kbDb";
import { requireDb } from "../../repositories/dbClient";
import { acquisitionReviewCanonical } from "../../../shared/acquisitionReview";
import { readManualKbImageCoverage, type ManualKbImageCoverage } from "./kbManualImageCoverage";

type Owner = { userId: number; workspaceId: number };
type SetIdentity = Parameters<typeof readManualKbImageCoverage>[2];
type ImageIdentity = { id: number; imageSetId: number | null; imageUrl: string; imagePosition: string; positionIndex: number | null;
  aplusModuleType?: string | null; aplusModuleClass?: string | null };
const denied = (): never => { throw new TRPCError({ code: "FORBIDDEN", message: "MANUAL_KB_IMAGE_SCOPE_UNAVAILABLE" }); };
const unverified = (): never => { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "MANUAL_KB_IMAGE_SOURCE_UNVERIFIED" }); };
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** This factory is request-local. It never caches authority between requests.
 * Legacy direct sets keep their existing authorization/data; manual versions
 * additionally bind every selected thumbnail/export row to a complete proof. */
export function createManualKbImageDeliveryGate(owner: Owner, dependencies: {
  getSet?: typeof kbDb.getReadableImageSet; images?: typeof kbDb.listImagesBySetLight;
  database?: typeof requireDb; coverage?: typeof readManualKbImageCoverage;
} = {}) {
  if (!positive(owner.userId) || !positive(owner.workspaceId)) denied();
  const getSet = dependencies.getSet ?? kbDb.getReadableImageSet;
  const images = dependencies.images ?? kbDb.listImagesBySetLight;
  const database = dependencies.database ?? requireDb;
  const coverage = dependencies.coverage ?? readManualKbImageCoverage;
  const cache = new Map<number, Promise<{ sourceCoverage: ManualKbImageCoverage | null; fullImages: ImageIdentity[] }>>();
  function inspect(set: SetIdentity) {
    if (set.workspaceId !== owner.workspaceId) denied();
    if (set.originInstanceId !== "manual_acquisition_review_v1") return Promise.resolve({ sourceCoverage: null, fullImages: [] });
    if (set.userId !== owner.userId || set.visibility !== "private") denied();
    let promise = cache.get(set.id);
    if (!promise) {
      promise = (async () => {
        const fullImages = await images(set.id);
        if (fullImages.length > 300) return { sourceCoverage: { mode: "manual_revision" as const, status: "unavailable" as const,
          reasonCode: "MANUAL_VERSION_UNVERIFIED" as const }, fullImages: [] };
        const db = await database("manual image delivery coverage");
        return { sourceCoverage: await coverage(db, owner, set, fullImages), fullImages };
      })();
      cache.set(set.id, promise);
    }
    return promise;
  }
  async function forSet<T extends ImageIdentity>(set: SetIdentity, selected: T[]): Promise<{ images: T[]; sourceCoverage: ManualKbImageCoverage | null }> {
    const checked = await inspect(set);
    if (!checked.sourceCoverage) return { images: selected, sourceCoverage: null };
    if (checked.sourceCoverage.status !== "verified") return { images: [], sourceCoverage: checked.sourceCoverage };
    if (selected.length > 300 || new Set(selected.map(image => image.id)).size !== selected.length) unverified();
    for (const image of selected) {
      const exact = checked.fullImages.find(row => row.id === image.id);
      if (!exact || image.imageSetId !== set.id) return unverified();
      const keys = ["id", "imageSetId", "imageUrl", "imagePosition", "positionIndex", "aplusModuleType", "aplusModuleClass"] as const;
      // Thumbnails intentionally omit module metadata; full-set proof still
      // verifies it. Every field actually emitted must match that exact row.
      if (keys.some(key => key in image && acquisitionReviewCanonical(image[key]) !== acquisitionReviewCanonical(exact[key]))) unverified();
    }
    return { images: selected, sourceCoverage: checked.sourceCoverage };
  }
  async function selection<T extends ImageIdentity>(selected: T[]): Promise<T[]> {
    const groups = new Map<number, T[]>();
    for (const image of selected) {
      const setId=image.imageSetId;
      if (!positive(image.id) || !positive(setId)) return denied();
      const group = groups.get(setId) ?? []; group.push(image); groups.set(setId, group);
    }
    for (const [setId, group] of groups) {
      const set = await getSet(setId, owner.userId, owner.workspaceId);
      if (!set || set.id !== setId) denied();
      const checked = await forSet(set, group);
      // Export/list callers must not receive an apparently successful partial
      // package when one manual version could not be verified.
      if (checked.sourceCoverage?.status === "unavailable") unverified();
    }
    return selected;
  }
  return { forSet, selection };
}
