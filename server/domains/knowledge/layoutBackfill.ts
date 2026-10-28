import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import sharp from "sharp";
import { BasicAmazonImagesProvider } from "../acquisition/basicAmazonProvider";
import { amazonImageUrl } from "../acquisition/amazonImageLayout";
import { AmazonImageLayoutSchema } from "../../../shared/amazonImageLayout";
import { safeHttpRequest } from "../../infrastructure/http/safeHttpClient";
import type { DbExecutor } from "../../repositories/dbClient";

const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
async function signature(bytes: Buffer) {
  const meta = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
  const pixels = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().flatten({ background: "white" }).resize(48, 48, { fit: "fill" }).removeAlpha().raw().toBuffer();
  return { hash: digest(bytes), ratio: (meta.width || 1) / (meta.height || 1), pixels };
}
type Signature = Awaited<ReturnType<typeof signature>>;
export function imageDistance(a: Signature, b: Signature) {
  if (a.hash === b.hash) return 0;
  if (Math.abs(a.ratio / b.ratio - 1) > 0.02 || a.pixels.length !== b.pixels.length) return Infinity;
  return a.pixels.reduce((sum, value, i) => sum + Math.abs(value - b.pixels[i]), 0) / a.pixels.length;
}

/** Supplement source layout only. Never replaces/deletes historical images or their tags. */
export async function backfillKnowledgeLayouts(input: {
  db: DbExecutor; workspace: number; limit: number; setId?: number;
  readImage: (reference: string) => Promise<Buffer>;
  readSaved: (name: string) => Promise<any>;
  save: (name: string, value: unknown) => Promise<void>;
}) {
  const { db, workspace } = input;
  const rows = async (query: ReturnType<typeof sql>) => (await db.execute(query))[0] as unknown as Array<Record<string, any>>;
  if (input.setId !== undefined && (!Number.isSafeInteger(input.setId) || input.setId < 1)) throw new Error("Invalid set scope");
  const setScope = input.setId === undefined ? sql`1=1` : sql`id=${input.setId}`;
  const sets = await rows(sql`SELECT id,asin FROM kb_image_sets WHERE workspaceId=${workspace} AND ${setScope} AND status='confirmed' AND visibility<>'private' AND sourceLayout IS NULL AND (origin_instance_id IS NULL OR origin_instance_id='unified_amazon_acquisition') ORDER BY id DESC LIMIT ${input.limit}`);
  const report: unknown[] = [];
  async function processSet(set: typeof sets[number]) {
    try {
      let product;
      try { product = await input.readSaved(`layout-source-${set.id}.json`); } catch { /* First collection. */ }
      if (!product?.sourceLayout?.modules?.length) {
        const result = await new BasicAmazonImagesProvider().fetch({ workspaceId: workspace, idempotencyKey: `layout-backfill-${set.id}-${Date.now()}`, asin: set.asin, marketplace: "US", capabilities: ["catalog_basic", "aplus", "brand_story"] });
        if (!result.rawArtifact) throw new Error(`source-unavailable:${result.failureCategory || 'unknown'}`);
        product = JSON.parse(Buffer.from(result.rawArtifact.bytes).toString())[0];
      }
      if (product.asin !== set.asin) throw new Error("identity-mismatch");
      const layout = AmazonImageLayoutSchema.parse(product.sourceLayout);
      await input.save(`layout-source-${set.id}.json`, product);
      const old = await rows(sql`SELECT * FROM kb_images WHERE imageSetId=${set.id} AND imagePosition IN ('aplus','brand_story') ORDER BY id`);
      await input.save(`layout-before-${set.id}.json`, old);
      const signatures: Array<{ image: typeof old[number]; signature: Signature }> = [];
      for (const image of old) try { signatures.push({ image, signature: await signature(await input.readImage(image.imageUrl)) }); } catch { /* Keep inaccessible historical records intact. */ }
      const mapping = new Map<string, string>(), assigned = new Map<number, string>();
      let missing = 0;
      const sources = [["aplus", product.aPlusContent], ["brand_story", product.brandStory]].flatMap(([role, urls]) => (Array.isArray(urls) ? urls : []).map(raw => ({role,raw})));
      let cursor = 0;
      async function matchSources() {
        while (cursor < sources.length) {
          const {role,raw} = sources[cursor++];
          const url = amazonImageUrl(typeof raw === "string" ? raw : raw.url);
          if (!url) continue;
          const hash = digest(url), same = old.find(i => i.imagePosition === role && i.sourceUrlHash === hash);
          if (same) { mapping.set(hash, hash); continue; }
          try {
            let candidate: Signature;
            try {
              const cached = await input.readSaved(`layout-image-${hash}.json`);
              candidate = {hash:cached.hash,ratio:cached.ratio,pixels:Buffer.from(cached.pixels,'base64')};
              if (!/^[a-f0-9]{64}$/.test(candidate.hash) || !Number.isFinite(candidate.ratio) || candidate.pixels.length !== 6912) throw new Error("invalid-cache");
            } catch {
              const response = await safeHttpRequest(url, { allowedHostSuffixes: ["media-amazon.com", "ssl-images-amazon.com"], timeoutMs: 12_000, maxResponseBytes: 20 * 1024 * 1024 });
              if (!response.ok) throw new Error("image-unavailable");
              candidate = await signature(response.body);
              await input.save(`layout-image-${hash}.json`, {...candidate,pixels:candidate.pixels.toString('base64')});
            }
            const ranked = signatures.filter(i => i.image.imagePosition === role).map(i => ({ ...i, distance: imageDistance(candidate, i.signature) })).sort((a, b) => a.distance - b.distance);
            const match = ranked[0];
            if (!match || match.distance > 3 || (match.distance > 0 && ranked[1] && ranked[1].distance - match.distance < 1.5)) { missing++; continue; }
            const canonical = match.image.sourceUrlHash || assigned.get(match.image.id) || hash;
            mapping.set(hash, canonical); assigned.set(match.image.id, canonical);
          } catch { missing++; }
        }
      }
      await Promise.all([matchSources(), matchSources(), matchSources()]);
      if (!mapping.size || !layout.modules.length) throw new Error("layout-unmatched");
      for (const module of layout.modules) {
        if (module.background) module.background.hash = mapping.get(module.background.hash) || module.background.hash;
        for (const card of module.cards) for (const ref of card.images) ref.hash = mapping.get(ref.hash) || ref.hash;
      }
      await db.transaction(async (tx: DbExecutor) => {
        const receipt = await tx.execute(sql`UPDATE kb_image_sets SET sourceLayout=${JSON.stringify(layout)} WHERE id=${set.id} AND workspaceId=${workspace} AND sourceLayout IS NULL AND status='confirmed' AND visibility<>'private'`);
        if (!(receipt[0] as unknown as { affectedRows: number }).affectedRows) throw new Error("layout-changed");
        for (const [id, hash] of assigned) {
          const before = old.find(image => image.id === id)!;
          await tx.execute(sql`UPDATE kb_images SET sourceUrlHash=${hash} WHERE id=${id} AND imageSetId=${set.id} AND imageUrl=${before.imageUrl} AND sourceUrlHash <=> ${before.sourceUrlHash}`);
        }
      });
      const entry = { asin: set.asin, status: "updated", matched: mapping.size, missing, modules: layout.modules.map(m => m.kind) };
      report.push(entry); console.log(JSON.stringify(entry));
    } catch (error) {
      const entry = { asin: set.asin, status: "unresolved", reason: error instanceof Error ? error.message.slice(0, 100) : "unavailable" };
      report.push(entry); console.log(JSON.stringify(entry));
    }
  }
  let next = 0;
  async function worker() { while (next < sets.length) await processSet(sets[next++]); }
  await worker();
  await input.save("layout-report.json", report);
  console.log(JSON.stringify({ status: "layouts-complete", sets: sets.length }));
}
