import { createHash } from "node:crypto";
import { load, type CheerioAPI } from "cheerio";
type AnyNode = ReturnType<CheerioAPI>[number];
import { AmazonImageLayoutSchema, type AmazonImageModule } from "../../../shared/amazonImageLayout";
import { mainAmazonVideo, aplusAmazonVideos } from "./amazonVideos";

export function amazonImageUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw, "https://www.amazon.com");
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    if (!["media-amazon.com", "ssl-images-amazon.com"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    if (!/\.(jpe?g|png|webp|gif)(?:$)/i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}
const digest = (url: string) => createHash("sha256").update(url).digest("hex");
function text($: CheerioAPI, node: AnyNode, selector: string, max = 500) {
  return $(node).find(selector).first().text().replace(/\s+/g, " ").trim().slice(0, max);
}

/** Capture layout as data, never executable Amazon HTML. Images remain in private storage. */
export function parseAmazonImageLayout(html: string) {
  const $ = load(html), urls = { aplus: [] as string[], brand_story: [] as string[] };
  // Scripts and embedded styles are source implementation, not product copy.
  const videos = mainAmazonVideo($);
  $("style,noscript,template").remove();
  const modules: AmazonImageModule[] = [];
  function images(node: AnyNode, section: "aplus" | "brand_story") {
    const result: Array<{ hash: string; alt: string }> = [];
    $(node).find("img").addBack("img").each((_, element) => {
      const img = $(element);
      if (section === "aplus" && img.closest("#aplusBrandStory_feature_div, #aplusBrandStory").length) return;
      if (img.closest(".a-hidden,.apm-brand-story-mobile,[class*=mobile-only]").length) return;
      if (img.attr("width") && img.attr("height") && Number(img.attr("width")) <= 40 && Number(img.attr("height")) <= 40) return;
      const url = [img.attr("data-src"), img.attr("data-a-hires"), img.attr("src")].map(amazonImageUrl).find(Boolean);
      if (!url) return;
      const hash = digest(url);
      if (result.some(item => item.hash === hash)) return;
      if (!urls[section].includes(url)) urls[section].push(url);
      result.push({ hash, alt: (img.attr("alt") || "").slice(0, 600) });
    });
    return result.slice(0, 24);
  }
  function card(node: AnyNode, section: "aplus" | "brand_story") {
    return { images: images(node, section), title: text($, node, "h1,h2,h3,h4,.apm-brand-story-card-title"), text: text($, node, "p,.apm-brand-story-card-text", 2000) };
  }
  const roots = $("#aplus_feature_div, #aplus").filter((_, e) => !$(e).parents("#aplus_feature_div, #aplus").length);
  roots.each((_, root) => {
    let blocks = $(root).find(".aplus-module").filter((_, e) => !$(e).parentsUntil(root, ".aplus-module").length && !$(e).closest("#aplusBrandStory_feature_div, #aplusBrandStory").length);
    if (!blocks.length) blocks = $(root);
    blocks.each((index, node) => {
      const moduleVideos = aplusAmazonVideos($, node, `aplus-${index}`, index).slice(0, 21-videos.length);
      if (moduleVideos.length) {
        videos.push(...moduleVideos);
        modules.push({id:`aplus-${index}`,section:"aplus",kind:"video",subtype:"视频模块",title:text($,node,"h1,h2"),background:null,cards:[],rows:[],videoHashes:moduleVideos.map(v=>v.hash)});
        return;
      }
      $(node).find("script").remove();
      const cls = $(node).attr("class") || "";
      const comparison = /compar/i.test(cls) || $(node).find(".apm-comparison-table, .aplus-comparison-table, [class*=comparison]").length > 0;
      const slides = $(node).find(".a-carousel-card, .aplus-carousel-card, [class*=carousel-slide]").filter((_, e) => !$(e).parentsUntil(node, ".a-carousel-card,.aplus-carousel-card,[class*=carousel-slide]").length);
      let cards: AmazonImageModule["cards"] = [], rows: AmazonImageModule["rows"] = [];
      let kind: AmazonImageModule["kind"] = "image";
      if (comparison) {
        kind = "comparison";
        const table = $(node).find("table").filter((_, e) => $(e).find("img").length > 0).first();
        const imageRow = table.find("tr").filter((_, e) => $(e).find("img").length > 0).first();
        imageRow.children("td,th").each((_, e) => { const c = card(e, "aplus"); if (c.images.length) cards.push(c); });
        table.find("tr").each((_, e) => {
          if ($(e).find("img").length) return;
          const cells = $(e).children("td,th").map((_, c) => $(c).text().replace(/\s+/g," ").trim().slice(0,1000)).get();
          if (cells.length > 1 && cells.some(Boolean)) rows.push({label: cells[0].slice(0,300), cells: cells.slice(1,41)});
        });
        if (!cards.length) cards = images(node,"aplus").map(image => ({images:[image],title:image.alt,text:""}));
      } else if (slides.length) {
        kind = "carousel";
        cards = slides.map((_, e) => card(e,"aplus")).get().filter(c => c.images.length);
      } else {
        // Standard and Premium A+ use different column wrappers. Keep the outer
        // card so its heading and body remain attached to the correct image.
        const columnSelector = ".apm-fourthcol, .apm-thirdcol, .premium-aplus-column, .apm-lefttwothirdswrap, .apm-rightthirdcol, .apm-leftimage, .apm-rightimage";
        const columns = $(node).find(columnSelector).filter((_, e) => !$(e).parentsUntil(node,columnSelector).length);
        cards = columns.map((_, e) => card(e,"aplus")).get().filter(c=>c.images.length);
        if (cards.length > 1) kind = "grid";
        else cards = [card(node,"aplus")];
      }
      const structure = cls + " " + $(node).find("[class]").map((_, e) => $(e).attr("class")).get().join(" ");
      // Classify the source module, not the photographic composition inside it.
      const subtype = /hotspot/i.test(structure) ? "热点交互"
        : /navigation.carousel|nav.carousel/i.test(structure) ? "导航轮播"
        : kind === "comparison" ? "对比表格"
        : /technical|specification/i.test(structure) ? "技术参数表"
        : /video/i.test(cls) ? "视频模块"
        : kind === "carousel" ? "图片轮播"
        : /brand.story/i.test(cls) ? "品牌故事卡"
        : /overlay/i.test(structure) ? "图文叠加"
        : kind === "grid" && cards.length === 4 ? "四图文"
        : kind === "grid" && cards.length === 3 ? "三图文"
        : /leftimage|rightimage|lefttwothirds|rightthird/i.test(structure) ? "单图侧文"
        : /full.width|fullwidth|hero.image/i.test(structure) || (kind === "image" && cards.length === 1 && cards[0].images.length === 1 && !cards[0].text) ? "全宽图"
        : undefined;
      const heading = $(node).find("h1,h2").filter((_, e) => !$(e).closest(".premium-aplus-column,.apm-fourthcol,.apm-thirdcol").length).first().text().replace(/\s+/g," ").trim().slice(0,500);
      if (cards.some(c=>c.images.length)) modules.push({id:`aplus-${index}`,section:"aplus",kind,subtype,title:heading,background:null,cards:cards.slice(0,40),rows:rows.slice(0,60)});
    });
  });
  $("#aplusBrandStory_feature_div, #aplusBrandStory").filter((_,e)=>!$(e).parents("#aplusBrandStory_feature_div, #aplusBrandStory").length).each((index,node)=>{
    $(node).find("script").remove();
    const bgNode=$(node).find(".apm-brand-story-background, [class*=brand-story-background], [class*=brand-story-hero]").first();
    let background = bgNode.length ? images(bgNode[0],"brand_story")[0] || null : null;
    if (!background) {
      const styled=$(node).find("[style*=background]").addBack("[style*=background]").first();
      const raw=styled.attr("style")?.match(/url\(['"]?([^)'"\s]+)['"]?\)/i)?.[1];
      const url=amazonImageUrl(raw);
      if(url){ urls.brand_story.push(url);background={hash:digest(url),alt:""}; }
    }
    let nodes=$(node).find(".a-carousel-card");
    if(!nodes.length) nodes=$(node).find(".apm-brand-story-card").filter((_,e)=>!$(e).parentsUntil(node,".apm-brand-story-card").length);
    const cards=nodes.map((_,e)=>card(e,"brand_story")).get().map(c=>({...c,images:c.images.filter(i=>i.hash!==background?.hash)})).filter(c=>c.images.length||c.text);
    if(!cards.length) { const fallback=card(node,"brand_story");fallback.images=fallback.images.filter(i=>i.hash!==background?.hash);if(fallback.images.length) cards.push(fallback); }
    if(cards.length||background) modules.push({id:`brand-${index}`,section:"brand_story",kind:"brand_story",title:text($,node,"h1,h2"),background,cards:cards.slice(0,40),rows:[]});
  });
  return { layout: AmazonImageLayoutSchema.parse({version:1, modules:modules.slice(0,100)}), urls, videos };
}
