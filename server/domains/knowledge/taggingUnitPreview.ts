import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { parseStorageUri } from "../../storage";
import { verifiedLocalObjectPath } from "../../infrastructure/localObjectStorage";
import type { ImageTaggingUnit } from "../../../shared/imageTaggingUnits";
import type { AmazonImageModule } from "../../../shared/amazonImageLayout";

/** Temporary inference input only; no duplicate images are stored in the library. */
export async function taggingUnitPreview(unit: ImageTaggingUnit<{id:number;imageUrl:string;imagePosition:string}>) {
  if (!unit.images.length || unit.images.length > 80) throw new Error("模块图片数量不正确");
  const originals: Buffer[] = [];
  let totalBytes = 0;
  for (const image of unit.images) {
    const stored = parseStorageUri(image.imageUrl);
    if (!stored || stored.provider !== "local") throw new Error("图片原件暂时不可读取");
    const bytes = await readFile(await verifiedLocalObjectPath(stored.key));
    if (bytes.length > 20 * 1024 * 1024) throw new Error("图片超过分析大小限制");
    totalBytes += bytes.length;
    if (totalBytes > 64 * 1024 * 1024) throw new Error("模块原图过大，请人工核对");
    originals.push(bytes);
  }
  return composeTaggingPreview(originals, unit.module);
}

export async function composeTaggingPreview(originals: Buffer[], module?: AmazonImageModule) {
  if (!originals.length || originals.length > 80) throw new Error("模块图片数量不正确");
  const columns = module?.kind === "grid" || module?.kind === "comparison" ? Math.max(1,module.cards.length) : 1;
  const width = Math.floor(1600 / Math.max(1,columns)), height = Math.min(width,600);
  const buffers: Buffer[] = [];
  for (const bytes of originals) {
    const pipeline = sharp(bytes, {limitInputPixels:40_000_000}).rotate();
    buffers.push(await (originals.length === 1
      ? pipeline.resize({width:1400,height:1400,fit:"inside",withoutEnlargement:true})
      : pipeline.resize({width,height,fit:"contain",background:"white"})).jpeg({quality:88}).toBuffer());
  }
  if (buffers.length === 1) return buffers[0];
  return sharp({create:{width:columns*width,height:Math.ceil(buffers.length/columns)*height,channels:3,background:"white"}})
    .composite(buffers.map((input,index)=>({input,left:(index%columns)*width,top:Math.floor(index/columns)*height})))
    .jpeg({quality:88}).toBuffer();
}
