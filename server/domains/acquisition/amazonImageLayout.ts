import { createHash } from "node:crypto";
import { load, type CheerioAPI } from "cheerio";
import {
  AmazonImageLayoutSchema,
  type AmazonImageModule,
  type AmazonTextBlock,
} from "../../../shared/amazonImageLayout";
import {
  AMAZON_MODULE_CATALOG,
  knownAmazonModuleType,
  type AmazonModuleType,
} from "../../../shared/amazonModuleCatalog";
import { mainAmazonVideo, aplusAmazonVideos } from "./amazonVideos";
import { isAmazonPageNavigation } from "../../../shared/amazonContentText";
type Node = ReturnType<CheerioAPI>[number];
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
export function amazonImageUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const u = new URL(raw, "https://www.amazon.com");
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      (u.port && u.port !== "443") ||
      !["media-amazon.com", "ssl-images-amazon.com"].some(
        h => u.hostname === h || u.hostname.endsWith("." + h)
      ) ||
      !/^.*\.(jpe?g|png|webp|gif)$/i.test(u.pathname)
    )
      return null;
    return u.href;
  } catch {
    return null;
  }
}
const blockTags = new Set([
  "div",
  "section",
  "article",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ul",
  "ol",
  "dl",
  "dt",
  "dd",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "details",
  "summary",
  "figure",
  "figcaption",
  "button",
]);
/** Read all paragraphs, including collapsed answers. Source scripts are never evaluated. */
function textBlocks(
  $: CheerioAPI,
  node: Node,
  owner: string,
  exclude: Node[] = []
): AmazonTextBlock[] {
  const omitted = new Set(exclude),
    result: AmazonTextBlock[] = [],
    occurrences = new Map<string, number>();
  const add = (raw: string, tag: string) => {
    const value = clean(raw);
    if (!value || isAmazonPageNavigation(value)) return;
    // Split unusually long paragraphs rather than silently truncating them.
    for (let start = 0; start < value.length; start += 16000) {
      const text = value.slice(start, start + 16000),
        key = digest(text).slice(0, 20),
        n = occurrences.get(key) || 0;
      occurrences.set(key, n + 1);
      const kind = /^h[1-6]$/.test(tag)
        ? "heading"
        : tag === "li"
          ? "list_item"
          : tag === "figcaption"
            ? "caption"
            : tag === "dt"
              ? "question"
              : tag === "dd"
                ? "answer"
                : tag === "button"
                  ? "navigation"
                  : "paragraph";
      result.push({
        id: `${owner}-${key}-${n}`,
        text,
        kind,
        ...(/^h[1-6]$/.test(tag) ? { level: Number(tag[1]) } : {}),
      });
    }
  };
  const walk = (element: Node, inherited = "div") => {
    if (omitted.has(element)) return;
    if (element.type === "text") {
      add(element.data, inherited);
      return;
    }
    if (!("children" in element)) return;
    const tag = "name" in element ? element.name : inherited;
    const classes = ($(element).attr("class") || "").split(/\s+/);
    const semantic = classes.some(c =>
      /(?:faq|aplus|brand).*question(?:-text|-title)?$/i.test(c)
    )
      ? "dt"
      : classes.some(c => /(?:faq|aplus|brand).*answer(?:-text)?$/i.test(c))
        ? "dd"
        : ["dt", "dd"].includes(inherited)
          ? inherited
          : tag;
    if (
      [
        "script",
        "style",
        "noscript",
        "template",
        "svg",
        "video",
        "img",
      ].includes(tag)
    )
      return;
    if (
      owner.startsWith("aplus-") &&
      $(element).closest("#aplusBrandStory_feature_div,#aplusBrandStory").length
    )
      return;
    if (
      $(element).is(
        "[class*=mobile-only],.apm-brand-story-mobile,.a-carousel-goto-nextpage,.a-carousel-goto-prevpage"
      )
    )
      return;
    let buffer = "";
    const flush = () => {
      add(buffer, semantic);
      buffer = "";
    };
    for (const child of element.children) {
      if (omitted.has(child)) continue;
      if (child.type === "text") {
        buffer += child.data;
        continue;
      }
      if (!("name" in child)) continue;
      if ($(child).is(".a-carousel-goto-nextpage,.a-carousel-goto-prevpage") || isAmazonPageNavigation($(child).text())) continue;
      if (child.name === "br") {
        buffer += "\n";
        continue;
      }
      if (
        [
          "script",
          "style",
          "noscript",
          "template",
          "svg",
          "video",
          "img",
        ].includes(child.name)
      )
        continue;
      if (blockTags.has(child.name)) {
        flush();
        walk(child, semantic);
      } else if ($(child).find("div,p,li,h1,h2,h3,h4,table").length) {
        flush();
        walk(child, semantic);
      } else buffer += $(child).text();
    }
    flush();
  };
  walk(node);
  return result;
}
function sourceType($: CheerioAPI, node: Node): AmazonModuleType | undefined {
  const e = $(node),
    all = [
      e.attr("data-module-type"),
      e.attr("data-module-name"),
      e.attr("data-content-module-type"),
      e.attr("class"),
      ...e
        .find("[data-module-type],[data-module-name]")
        .toArray()
        .map(
          n => $(n).attr("data-module-type") || $(n).attr("data-module-name")
        ),
    ]
      .filter(Boolean)
      .join(" ");
  const normalized = all
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toUpperCase();
  for (const key of Object.keys(AMAZON_MODULE_CATALOG).sort(
    (a, b) => b.length - a.length
  ))
    if (normalized.includes(key)) return key as AmazonModuleType;
  for (const token of all.split(/\s+/)) {
    const known = knownAmazonModuleType(token);
    if (known) return known;
  }
  const root = all.toLowerCase(),
    premium = /premium/.test(root),
    direct = classModuleType(root, premium);
  const descendants = e
    .find("[class]")
    .toArray()
    .map(n => $(n).attr("class") || "")
    .join(" ")
    .toLowerCase();
  if (
    direct === "PREMIUM_IMAGE_CAROUSEL" ||
    direct === "STANDARD_MULTIPLE_IMAGE_TEXT"
  ) {
    const specific = classModuleType(descendants, premium);
    if (
      specific &&
      [
        "PREMIUM_NAVIGATION_CAROUSEL",
        "PREMIUM_REGIMEN_CAROUSEL",
        "PREMIUM_COMPARISON_CAROUSEL",
        "PREMIUM_COMPARISON_SCROLLER",
        "PREMIUM_VIDEO_IMAGE_CAROUSEL",
      ].includes(specific)
    )
      return specific;
  }
  return direct || classModuleType(descendants, premium);
}
function classModuleType(
  cls: string,
  premium: boolean
): AmazonModuleType | undefined {
  if (/brand.story.(?:background|hero|image.with.logo)/.test(cls))
    return "BRAND_STORY_IMAGE_WITH_LOGO";
  if (/brand.story.(?:questions|qna)/.test(cls)) return "BRAND_STORY_QUESTIONS";
  if (/brand.story.four.asin/.test(cls)) return "BRAND_STORY_FOUR_ASIN";
  if (/brand.story.about/.test(cls)) return "BRAND_STORY_ABOUT";
  if (/brand.story.media.asset/.test(cls)) return "BRAND_STORY_MEDIA_ASSET";
  if (/video.*(?:image.*)?carousel|carousel.*video/.test(cls))
    return "PREMIUM_VIDEO_IMAGE_CAROUSEL";
  if (/video.text|text.video/.test(cls)) return "PREMIUM_VIDEO_TEXT";
  if (/hero.video/.test(cls)) return "PREMIUM_HERO_VIDEO";
  if (/faq|question.answer|q.and.a/.test(cls))
    return premium ? "PREMIUM_FAQ" : undefined;
  if (/hotspot/.test(cls))
    return /hotspot.*text|text.*hotspot/.test(cls)
      ? "PREMIUM_HOTSPOT_IMAGE_TEXT"
      : "PREMIUM_HOTSPOT_IMAGE";
  if (/navigation.*carousel|nav.*carousel/.test(cls))
    return "PREMIUM_NAVIGATION_CAROUSEL";
  if (/regimen|steps?.*carousel/.test(cls)) return "PREMIUM_REGIMEN_CAROUSEL";
  if (/comparison.*scroller/.test(cls)) return "PREMIUM_COMPARISON_SCROLLER";
  if (/comparison.*carousel/.test(cls)) return "PREMIUM_COMPARISON_CAROUSEL";
  if (/compar/.test(cls))
    return premium
      ? "PREMIUM_THREE_COLUMN_COMPARISON"
      : "STANDARD_COMPARISON_TABLE";
  if (/(?:single|sic).*highlights/.test(cls))
    return "STANDARD_SINGLE_IMAGE_HIGHLIGHTS";
  if (/(?:single|sic).*(?:specs|specification)/.test(cls))
    return "STANDARD_SINGLE_IMAGE_SPECS_DETAIL";
  if (/image.*sidebar|apm-lefttwothirdswrap|apm-rightthirdcol/.test(cls))
    return "STANDARD_IMAGE_SIDEBAR";
  if (/technical|tech.spec|specification/.test(cls))
    return premium ? "PREMIUM_TECH_SPECS" : "STANDARD_TECH_SPECS";
  if (/four.*quadrant/.test(cls)) return "STANDARD_FOUR_IMAGE_TEXT_QUADRANT";
  if (/four.*(?:column|image)|apm-fourthcol/.test(cls))
    return premium ? "PREMIUM_FOUR_COLUMN_IMAGES" : "STANDARD_FOUR_IMAGE_TEXT";
  if (/three.*(?:column|image)|(?:^|\s)apm-thirdcol(?:\s|$)/.test(cls))
    return "STANDARD_THREE_IMAGE_TEXT";
  if (/dual.*image|two.*column/.test(cls)) return "PREMIUM_DUAL_IMAGE_TEXT";
  if (/image.*sidebar/.test(cls)) return "STANDARD_IMAGE_SIDEBAR";
  if (/single.*highlights/.test(cls)) return "STANDARD_SINGLE_IMAGE_HIGHLIGHTS";
  if (/single.*specs/.test(cls)) return "STANDARD_SINGLE_IMAGE_SPECS_DETAIL";
  if (/company.logo/.test(cls)) return "STANDARD_COMPANY_LOGO";
  if (/product.description/.test(cls)) return "STANDARD_PRODUCT_DESCRIPTION";
  if (/header.*image|(?:^|\s)3p-module-b(?:\s|$)/.test(cls))
    return "STANDARD_HEADER_IMAGE_TEXT";
  if (/overlay|background.*text/.test(cls))
    return premium
      ? "PREMIUM_FULL_BACKGROUND_TEXT"
      : "STANDARD_IMAGE_TEXT_OVERLAY";
  if (/multiple.image|multi.image/.test(cls))
    return "STANDARD_MULTIPLE_IMAGE_TEXT";
  if (/carousel/.test(cls))
    return premium ? "PREMIUM_IMAGE_CAROUSEL" : "STANDARD_MULTIPLE_IMAGE_TEXT";
  if (/image.text|text.image/.test(cls))
    return premium ? "PREMIUM_IMAGE_TEXT" : "STANDARD_SINGLE_SIDE_IMAGE";
  if (/all.text|text.only|(?:^|[\s_-])text(?:$|[\s_-])/.test(cls))
    return premium ? "PREMIUM_TEXT" : "STANDARD_TEXT";
  if (/leftimage|rightimage|single.side/.test(cls))
    return premium ? "PREMIUM_IMAGE_TEXT" : "STANDARD_SINGLE_SIDE_IMAGE";
  if (/full.*background|full.*width.*image/.test(cls))
    return "PREMIUM_FULL_BACKGROUND_IMAGE";
  return undefined;
}
export function parseAmazonImageLayout(html: string) {
  const $ = load(html),
    urls = { aplus: [] as string[], brand_story: [] as string[] },
    videos = mainAmazonVideo($),
    modules: AmazonImageModule[] = [];
  $("style,noscript,template").remove();
  const images = (node: Node, section: "aplus" | "brand_story") => {
    const result: Array<{ hash: string; alt: string }> = [];
    $(node)
      .find("img")
      .addBack("img")
      .each((_, n) => {
        const e = $(n);
        if (
          section === "aplus" &&
          e.closest("#aplusBrandStory_feature_div,#aplusBrandStory").length
        )
          return;
        if (e.closest(".apm-brand-story-mobile,[class*=mobile-only]").length)
          return;
        // Inactive slides/answers may be a-hidden; unrelated hidden copies remain excluded.
        if (
          e.closest(".a-hidden").length &&
          !e.closest(
            ".a-carousel-card,.aplus-carousel-card,[class*=carousel-slide]"
          ).length
        )
          return;
        if (
          e.attr("width") &&
          e.attr("height") &&
          Number(e.attr("width")) <= 40 &&
          Number(e.attr("height")) <= 40
        )
          return;
        const url = [e.attr("data-src"), e.attr("data-a-hires"), e.attr("src")]
          .map(amazonImageUrl)
          .find(Boolean);
        if (!url) return;
        if (section === "aplus" && videos.some(v => v.poster === url)) return;
        const hash = digest(url);
        if (result.some(i => i.hash === hash)) return;
        if (!urls[section].includes(url)) urls[section].push(url);
        result.push({ hash, alt: (e.attr("alt") || "").slice(0, 600) });
      });
    return result.slice(0, 24);
  };
  const card = (node: Node, section: "aplus" | "brand_story", id: string) => {
    const blocks = textBlocks($, node, id),
      headings = blocks.filter(b => b.kind === "heading");
    return {
      id,
      images: images(node, section),
      title: (headings[0]?.text || "").slice(0, 500),
      text: blocks
        .filter(b => b.kind !== "heading")
        .map(b => b.text)
        .join("\n\n"),
      blocks,
    };
  };
  const rows = (node: Node, id: string, comparison: boolean) => {
    const result: AmazonImageModule["rows"] = [];
    $(node)
      .find("tr")
      .each((n, row) => {
        if (comparison && $(row).find("img").length) return;
        const cells = $(row)
          .children("td,th")
          .map((_, c) => clean($(c).text()))
          .get();
        if (cells.length < 2 || !cells.some(Boolean)) return;
        result.push({
          label: cells[0],
          cells: cells.slice(1),
          labelId: `${id}-row-${n}-label`,
          cellIds: cells.slice(1).map((_, i) => `${id}-row-${n}-${i}`),
        });
      });
    if (!result.length)
      $(node)
        .find("dt")
        .each((n, dt) => {
          const value = clean($(dt).next("dd").text());
          if (value)
            result.push({
              label: clean($(dt).text()),
              cells: [value],
              labelId: `${id}-row-${n}-label`,
              cellIds: [`${id}-row-${n}-0`],
            });
        });
    return result;
  };
  const roots = $("#aplus_feature_div,#aplus").filter(
    (_, e) => !$(e).parents("#aplus_feature_div,#aplus").length
  );
  roots.each((_, root) => {
    let blocks = $(root)
      .find(".aplus-module,[data-module-type],[data-content-module-type]")
      .filter(
        (_, e) =>
          !$(e).parentsUntil(
            root,
            ".aplus-module,[data-module-type],[data-content-module-type]"
          ).length &&
          !$(e).closest("#aplusBrandStory_feature_div,#aplusBrandStory").length
      );
    if (!blocks.length) blocks = $(root);
    blocks.each((index, node) => {
      if ($(node).is("#aplusBrandStory_feature_div,#aplusBrandStory")) return;
      const id = `aplus-${index}`,
        type = sourceType($, node),
        cls = $(node).attr("class") || "",
        structure =
          cls +
          " " +
          $(node)
            .find("[class]")
            .map((_, e) => $(e).attr("class"))
            .get()
            .join(" ");
      const moduleVideos = aplusAmazonVideos($, node, id, index).slice(
        0,
        21 - videos.length
      );
      videos.push(...moduleVideos);
      const slides = $(node)
        .find(".a-carousel-card,.aplus-carousel-card,[class*=carousel-slide]")
        .filter(
          (_, e) =>
            !$(e).parentsUntil(
              node,
              ".a-carousel-card,.aplus-carousel-card,[class*=carousel-slide]"
            ).length
        );
      const columnsSelector =
        ".apm-fourthcol,.apm-thirdcol,.premium-aplus-column,.apm-lefttwothirdswrap,.apm-rightthirdcol,.apm-leftimage,.apm-rightimage,[data-aplus-column]";
      const columns = $(node)
        .find(columnsSelector)
        .filter((_, e) => !$(e).parentsUntil(node, columnsSelector).length);
      let kind: AmazonImageModule["kind"] = type
          ? AMAZON_MODULE_CATALOG[type][1]
          : "image",
        cards: AmazonImageModule["cards"] = [],
        tableRows: AmazonImageModule["rows"] = [],
        topBlocks: AmazonTextBlock[] = [];
      const excluded: Node[] = [];
      if (
        kind === "comparison" ||
        /compar/i.test(cls) ||
        $(node).find(".apm-comparison-table,.aplus-comparison-table").length
      ) {
        kind = "comparison";
        const table = $(node).find("table").first();
        const imageRow = table
          .find("tr")
          .filter((_, e) => $(e).find("img").length > 0)
          .first();
        imageRow.children("td,th").each((n, e) => {
          const c = card(e, "aplus", `${id}-card-${n}`);
          if (c.images.length) cards.push(c);
        });
        if (!cards.length)
          cards = images(node, "aplus").map((i, n) => ({
            id: `${id}-card-${n}`,
            images: [i],
            title: i.alt,
            text: "",
            blocks: [],
          }));
        tableRows = rows(node, id, true);
        excluded.push(...table.toArray());
      } else if (kind === "specifications") {
        tableRows = rows(node, id, false);
        excluded.push(...$(node).find("table,dl").toArray());
        cards = images(node, "aplus").map((i, n) => ({
          id: `${id}-card-${n}`,
          images: [i],
          title: "",
          text: "",
          blocks: [],
        }));
      } else if (slides.length) {
        kind = "carousel";
        cards = slides
          .toArray()
          .map((n, i) => {
            const c = card(n, "aplus", `${id}-card-${i}`),
              found = aplusAmazonVideos($, n, id, index);
            return {
              ...c,
              navText: clean(
                $(n).attr("data-nav-text") || $(n).attr("aria-label") || ""
              ),
              videoHashes: found.map(v => v.hash),
            };
          })
          .filter(
            c => c.images.length || c.blocks.length || c.videoHashes.length
          );
        excluded.push(...slides.toArray());
      } else if (
        columns.length > 1 &&
        (!type || ["grid", "unknown"].includes(kind))
      ) {
        cards = columns
          .toArray()
          .map((n, i) => card(n, "aplus", `${id}-card-${i}`))
          .filter(c => c.images.length || c.blocks.length);
        kind = "grid";
        excluded.push(...columns.toArray());
      } else if (kind === "faq" || kind === "hotspots") {
        cards = images(node, "aplus").map((i, n) => ({
          id: `${id}-card-${n}`,
          images: [i],
          title: "",
          text: "",
          blocks: [],
        }));
      } else {
        const c = card(node, "aplus", `${id}-card-0`);
        if (c.images.length || c.blocks.length) cards = [c];
        if (moduleVideos.length) kind = "video";
        else if (!c.images.length && c.blocks.length)
          kind = type ? kind : "text";
        excluded.push(node);
      }
      topBlocks = textBlocks($, node, id, excluded);
      const questions: NonNullable<AmazonImageModule["questions"]> = [];
      if (kind === "faq") {
        const all = topBlocks,
          consumed = new Set<string>();
        let q: AmazonTextBlock | undefined,
          answers: AmazonTextBlock[] = [];
        const flush = () => {
          if (q && answers.length) {
            questions.push({
              question: { ...q, kind: "question" },
              answer: {
                id: answers.length === 1 ? answers[0].id : `${q.id}-answer`,
                text: answers.map(b => b.text).join("\n\n"),
                kind: "answer",
              },
            });
            consumed.add(q.id);
            answers.forEach(a => consumed.add(a.id));
          }
          q = undefined;
          answers = [];
        };
        for (const b of all) {
          if (
            b.kind === "question" ||
            b.kind === "heading" ||
            /[?？]$/.test(b.text)
          ) {
            flush();
            q = b;
          } else if (q) answers.push(b);
        }
        flush();
        topBlocks = all.filter(b => !consumed.has(b.id));
      }
      const hotspots: NonNullable<AmazonImageModule["hotspots"]> = [];
      if (kind === "hotspots") {
        const candidates = $(node)
          .find(
            "[data-hotspot],[class*=hotspot-content],[class*=hotspot-popup],[class*=hotspot-position]"
          )
          .filter(
            (_, e) =>
              !$(e).parentsUntil(
                node,
                "[data-hotspot],[class*=hotspot-content],[class*=hotspot-popup],[class*=hotspot-position]"
              ).length
          );
        candidates.each((n, e) => {
          const style = $(e).attr("style") || "",
            rawX =
              $(e).attr("data-x") || style.match(/left\s*:\s*([\d.]+)%/i)?.[1],
            rawY =
              $(e).attr("data-y") || style.match(/top\s*:\s*([\d.]+)%/i)?.[1];
          const position = (v: string | undefined, percent: boolean) => {
            if (v === undefined) return undefined;
            const n = Number(v.replace("%", ""));
            return Number.isFinite(n) && n >= 0 && n <= 100
              ? percent || v.includes("%") || n > 1
                ? n / 100
                : n
              : undefined;
          };
          hotspots.push({
            id: `${id}-hotspot-${n}`,
            x: position(rawX, !$(e).attr("data-x")),
            y: position(rawY, !$(e).attr("data-y")),
            blocks: textBlocks($, e, `${id}-hotspot-${n}`),
          });
        });
        if (hotspots.length)
          topBlocks = textBlocks($, node, id, [
            ...excluded,
            ...candidates.toArray(),
          ]);
      }
      const heading = topBlocks.find(b => b.kind === "heading")?.text || "";
      const subtype =
        kind === "grid" && cards.length === 3
          ? "三图文"
          : kind === "grid" && cards.length === 4
            ? "四图文"
            : type
              ? AMAZON_MODULE_CATALOG[type][0]
              : kind === "carousel"
                ? "图片轮播"
                : kind === "comparison"
                  ? "对比表格"
                  : cards.length === 1 &&
                      cards[0].images.length === 1 &&
                      !cards[0].text
                    ? "全宽图"
                    : undefined;
      const explicit =
        $(node).attr("data-module-type") ||
        $(node).attr("data-content-module-type");
      if (!type && explicit) kind = "unknown";
      if (
        cards.length ||
        topBlocks.length ||
        tableRows.length ||
        moduleVideos.length
      )
        modules.push({
          id,
          section: "aplus",
          kind,
          sourceType: type || explicit,
          sourceClass: cls.slice(0, 500),
          subtype,
          title: heading.slice(0, 500),
          background: null,
          cards,
          blocks: topBlocks,
          rows: tableRows,
          questions: questions.length ? questions : undefined,
          hotspots: hotspots.length ? hotspots : undefined,
          videoHashes: moduleVideos.map(v => v.hash),
          variant: {
            imagePosition: /rightimage|image.right/i.test(structure)
              ? "right"
              : /leftimage|image.left/i.test(structure)
                ? "left"
                : undefined,
            theme: /dark/i.test(structure)
              ? "dark"
              : /light/i.test(structure)
                ? "light"
                : undefined,
            columns:
              kind === "grid"
                ? Math.min(4, Math.max(1, cards.length))
                : undefined,
            quadrant: type === "STANDARD_FOUR_IMAGE_TEXT_QUADRANT",
          },
          warnings:
            !type && explicit ? ["模块类型待核对，已保留现有内容"] : undefined,
        });
    });
  });
  $("#aplusBrandStory_feature_div,#aplusBrandStory")
    .filter(
      (_, e) =>
        !$(e).parents("#aplusBrandStory_feature_div,#aplusBrandStory").length
    )
    .each((index, node) => {
      const bg = $(node)
        .find(
          ".apm-brand-story-background,[class*=brand-story-background],[class*=brand-story-hero]"
        )
        .first();
      let background = bg.length
        ? images(bg[0], "brand_story")[0] || null
        : null;
      if (!background) {
        const styled = $(node)
            .find("[style*=background]")
            .addBack("[style*=background]")
            .first(),
          raw = styled
            .attr("style")
            ?.match(/url\(['"]?([^)'"\s]+)['"]?\)/i)?.[1],
          url = amazonImageUrl(raw);
        if (url) {
          urls.brand_story.push(url);
          background = { hash: digest(url), alt: "" };
        }
      }
      let nodes = $(node)
        .find(".a-carousel-card")
        .filter((_, e) => !$(e).parentsUntil(node, ".a-carousel-card").length);
      if (!nodes.length)
        nodes = $(node)
          .find(".apm-brand-story-card")
          .filter(
            (_, e) => !$(e).parentsUntil(node, ".apm-brand-story-card").length
          );
      const cards = nodes
        .toArray()
        .filter(
          e =>
            sourceType($, e) !== "BRAND_STORY_IMAGE_WITH_LOGO" &&
            (!bg.length ||
              !$(bg[0])
                .parentsUntil(node, ".a-carousel-card,.apm-brand-story-card")
                .toArray()
                .includes(e))
        )
        .map((e, i) => {
          const c = card(e, "brand_story", `brand-${index}-card-${i}`);
          return {
            ...c,
            images: c.images.filter(im => im.hash !== background?.hash),
            subtype:
              sourceType($, e) ||
              (/question|faq/i.test($(e).attr("class") || "")
                ? "BRAND_STORY_QUESTIONS"
                : c.images.length === 4
                  ? "BRAND_STORY_FOUR_ASIN"
                  : c.images.length
                    ? "BRAND_STORY_MEDIA_ASSET"
                    : "BRAND_STORY_ABOUT"),
          };
        })
        .filter(c => c.images.length || c.blocks.length);
      if (!cards.length) {
        const c = card(node, "brand_story", `brand-${index}-card-0`);
        c.images = c.images.filter(im => im.hash !== background?.hash);
        c.blocks = textBlocks($, node, c.id, bg.toArray());
        c.text = c.blocks
          .filter(b => b.kind !== "heading")
          .map(b => b.text)
          .join("\n\n");
        if (c.images.length || (!background && c.blocks.length))
          cards.push({
            ...c,
            subtype: c.images.length
              ? "BRAND_STORY_MEDIA_ASSET"
              : "BRAND_STORY_ABOUT",
          });
      }
      const title = clean(
        $(node)
          .find("h1,h2")
          .filter(
            (_, e) =>
              !$(e).closest(".a-carousel-card,.apm-brand-story-card").length
          )
          .first()
          .text()
      ).slice(0, 500);
      if (cards.length || background)
        modules.push({
          id: `brand-${index}`,
          section: "brand_story",
          kind: "brand_story",
          sourceType: "BRAND_STORY_IMAGE_WITH_LOGO",
          title,
          background,
          cards,
          rows: [],
        });
    });
  return {
    layout: AmazonImageLayoutSchema.parse({ version: 2, modules }),
    urls,
    videos,
  };
}
