import { BasicAmazonImagesProvider } from "../server/domains/acquisition/basicAmazonProvider";
import { writeFileSync } from "node:fs";

// Operator-run diagnostic; only public Amazon product data is requested.
const asin = process.argv[2] || "B0FKN88MFL";
if (!/^[A-Z0-9]{10}$/.test(asin)) throw new Error("Invalid ASIN");
const result = await new BasicAmazonImagesProvider().fetch({
  workspaceId: 1, idempotencyKey: `native-diagnostic-${asin}-${Date.now()}`,
  marketplace: "US", asin,
  capabilities: ["catalog_basic", "image_gallery", "aplus", "brand_story"],
});
if (!result.rawArtifact) {
  console.log(JSON.stringify({status: result.status, failure: result.failureCategory}));
  process.exitCode = 1;
} else {
  const product = JSON.parse(Buffer.from(result.rawArtifact.bytes).toString())[0];
  writeFileSync(`/tmp/native-amazon-${asin}.json`, result.rawArtifact.bytes, {mode: 0o600});
  console.log(JSON.stringify({status: result.status, asin: product.asin, title: product.title,
    gallery: product.highResolutionImages.length, aplus: product.aPlusContent.length,
    brandStory: product.brandStory.length, modules: product.sourceLayout.modules.map((m: {kind: string})=>m.kind),
    method: product.research.collectionMethod}));
}
