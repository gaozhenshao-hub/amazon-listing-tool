import { currentOpsWorkspaceId } from "../workspaceContext";
import { opsWorkspaceCondition } from "../../../repositories/ops";
import * as shared from "../routerContext";
import type { CheckItemScore, ConversionCrawlData, ImportResult, ScoringProgress, SellerSpriteProductData } from "../routerContext";

const {
  MARKETPLACE_MID_MAP,
  SELLER_CACHE_TTL,
  TRPCError,
  _productOpsSellerCache,
  and,
  asc,
  buildCrawlDataFromSellerSprite,
  checkItemOverrides,
  collectConversionData,
  collectMultipleAsins,
  competitorMonitors,
  competitorSnapshots,
  conversionCheckItems,
  conversionComparisons,
  conversionScores,
  conversionSuggestions,
  desc,
  eq,
  executionReviews,
  findMatchedSid,
  generateMockCrawlData,
  getCachedSellers,
  getDateNDaysAgo,
  getDefault129CheckItems,
  getToday,
  getYesterday,
  inArray,
  invokeLLM,
  isNull,
  keywordMonitors,
  keywordSnapshots,
  lingxingProductWeekly,
  mergeSellerSpriteWithCrawlData,
  operatorNameMappings,
  opsImportHistory,
  opsPlanActions,
  opsPlanSummaries,
  opsPlans,
  or,
  parseSellerSpriteData,
  parseSellerSpriteXlsx,
  productBasicInfo,
  productLogs,
  productMonthlySummary,
  productProfiles,
  productTodos,
  productVariants,
  productWeeklyOps,
  protectedProcedure,
  resolveDataUserId,
  round2,
  router,
  scoreAllCheckItems,
  scoringProgressMap,
  sql,
  teamTasks,
  users,
  z,
} = shared;
const getDb = (...args: Parameters<typeof shared.getDb>) => shared.getDb(...args);

export const opsSyncProcedures = {


  // ─── Sync Products from Lingxing ERP ───
  syncFromLingxing: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();

    // Get all seller stores first
    let sellers: any[] = [];
    try {
      const sellerRes = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
      const sellerRaw = sellerRes.data || [];
      sellers = Array.isArray(sellerRaw) ? sellerRaw : (sellerRaw as any)?.records || (sellerRaw as any)?.list || [];
    } catch (err: any) {
      console.error(`[SyncProducts] Failed to get sellers: ${err.message}`);
    }

    // Get existing products for this user to avoid duplicates
    const existing = await db!.select({ parentAsin: productProfiles.parentAsin, marketplace: productProfiles.marketplace })
      .from(productProfiles)
      .where(opsWorkspaceCondition(productProfiles, currentOpsWorkspaceId(), eq(productProfiles.userId, ctx.user.id)));
    const existingSet = new Set(existing.map(e => `${e.parentAsin}_${e.marketplace}`));

    let synced = 0;
    let skipped = 0;
    const marketplaceMap: Record<number, string> = {
      1: 'US', 2: 'CA', 3: 'MX', 4: 'UK', 5: 'DE', 6: 'FR', 7: 'IT', 8: 'ES', 9: 'JP', 10: 'AU', 11: 'IN', 12: 'AE', 13: 'SA', 14: 'SG', 15: 'NL', 16: 'SE', 17: 'PL', 18: 'BE', 19: 'BR',
    };

    // Query listing data from each store
    for (const seller of sellers.slice(0, 10)) {
      const sid = seller.sid;
      const marketplace = marketplaceMap[seller.mid] || 'US';
      try {
        const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
        const listingsRaw = res.data || [];
        const listings = Array.isArray(listingsRaw) ? listingsRaw : (listingsRaw as any)?.records || (listingsRaw as any)?.list || [];

        // Group by parent ASIN (asin1 or asin)
        const parentMap = new Map<string, any>();
        for (const item of listings) {
          const asin = item.asin1 || item.asin || item.parent_asin;
          if (!asin) continue;
          if (!parentMap.has(asin)) {
            // Enhanced status mapping: support number/string/various field names
            const rawStatus = item.status ?? item.listing_status ?? item.item_status ?? item.product_status ?? '';
            const statusStr = String(rawStatus).toLowerCase().trim();
            const isActive = statusStr === 'active' || statusStr === '1' || statusStr === 'true' || statusStr === 'enabled' || statusStr === 'in stock' || statusStr === 'buyable';
            parentMap.set(asin, {
              parentAsin: asin,
              title: item.item_name || item.product_name || item.title || asin,
              brand: item.brand || '',
              category: item.item_type || item.product_type || '',
              marketplace,
              imageUrl: item.main_image || item.smallImageUrl || '',
              status: isActive ? 'active' : 'inactive',
              storeName: seller.name || seller.wname || seller.account_name || '',
              variants: [],
            });
          }
          // Add as variant (including self for single-variant products)
          const childAsin = item.asin || item.child_asin;
          const sku = item.msku || item.seller_sku || '';
          if (childAsin && sku) {
            // Avoid duplicate variants
            const existingVariant = parentMap.get(asin)!.variants.find(
              (v: any) => v.childAsin === childAsin && v.sku === sku
            );
            if (!existingVariant) {
              parentMap.get(asin)!.variants.push({
                childAsin,
                sku,
                title: item.item_name || item.title || '',
                price: item.price ? String(item.price) : undefined,
              });
            }
          } else if (childAsin) {
            // Even without SKU, add variant with ASIN only
            const existingVariant = parentMap.get(asin)!.variants.find(
              (v: any) => v.childAsin === childAsin
            );
            if (!existingVariant) {
              parentMap.get(asin)!.variants.push({
                childAsin,
                sku: sku || '',
                title: item.item_name || item.title || '',
                price: item.price ? String(item.price) : undefined,
              });
            }
          }
        }

        // Insert new products or update existing ones
        let updated = 0;
        for (const [asin, product] of Array.from(parentMap.entries())) {
          const key = `${asin}_${marketplace}`;
          if (existingSet.has(key)) {
            // Update existing product status, title, image, storeName
            const [existingProduct] = await db!.select({ id: productProfiles.id })
              .from(productProfiles)
              .where(opsWorkspaceCondition(productProfiles, currentOpsWorkspaceId(), and(
                eq(productProfiles.userId, ctx.user.id),
                eq(productProfiles.parentAsin, asin),
                eq(productProfiles.marketplace, marketplace)
              )));
            if (existingProduct) {
              await db!.update(productProfiles)
                .set({
                  status: product.status as any,
                  title: product.title.substring(0, 500),
                  imageUrl: product.imageUrl || undefined,
                  storeName: product.storeName || undefined,
                  brand: product.brand || undefined,
                })
                .where(opsWorkspaceCondition(productProfiles, currentOpsWorkspaceId(), eq(productProfiles.id, existingProduct.id)));

              // Sync variants for existing products too
              if (product.variants.length > 0) {
                // Get existing variants
                const existingVariants = await db!.select({ childAsin: productVariants.childAsin, sku: productVariants.sku })
                  .from(productVariants)
                  .where(opsWorkspaceCondition(productVariants, currentOpsWorkspaceId(), eq(productVariants.productId, existingProduct.id)));
                const existingVariantSet = new Set(existingVariants.map(v => `${v.childAsin}_${v.sku}`));

                // Insert only new variants
                const newVariants = product.variants.filter((v: any) => !existingVariantSet.has(`${v.childAsin}_${v.sku}`));
                if (newVariants.length > 0) {
                  await db!.insert(productVariants).values(
                    newVariants.map((v: any) => ({
                      productId: existingProduct.id,
                      childAsin: v.childAsin,
                      sku: v.sku,
                      title: v.title,
                      price: v.price,
                    }))
                  );
                  console.log(`[SyncProducts] Added ${newVariants.length} new variants for ${asin}`);
                }
              }
            }
            updated++;
            skipped++;
            continue;
          }
          existingSet.add(key);

          const [result] = await db!.insert(productProfiles).values({
            userId: ctx.user.id,
            parentAsin: product.parentAsin,
            title: product.title.substring(0, 500),
            brand: product.brand || undefined,
            category: product.category || undefined,
            marketplace: product.marketplace,
            imageUrl: product.imageUrl || undefined,
            status: product.status as any,
            storeName: product.storeName || undefined,
          });

          // Insert variants
          if (product.variants.length > 0) {
            await db!.insert(productVariants).values(
              product.variants.map((v: any) => ({
                productId: result.insertId,
                childAsin: v.childAsin,
                sku: v.sku,
                title: v.title,
                price: v.price,
              }))
            );
          }
          synced++;
        }
      } catch (err: any) {
        console.warn(`[SyncProducts] sid=${sid}: ${err.message}`);
      }
    }

    return { synced, skipped, updated: skipped, total: synced + skipped };
  }),
};