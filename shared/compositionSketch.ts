import type { DocumentEntry } from "./imageDocument";
// Version prevents a previous realistic sketch from being reused as a wireframe.
export const compositionSketchInput = (entry: DocumentEntry) =>
  JSON.stringify({
    version: "abstract-wireframe-v3",
    width: entry.width,
    height: entry.height,
    layout: entry.layout,
    layoutNote: entry.layoutNote,
    content: entry.content,
    scenes: entry.scenes,
    copy: entry.copy,
  });
function geometry(value: string) {
  // Pass placement only. Product names and literal scene/copy descriptions must
  // never invite the image model to draw a real child, motor or landscape.
  return (
    value.match(
      /(?:左上|右上|左下|右下|中上|中下|上方|下方|上部|下部|顶部|底部|左侧|右侧|左区|右区|居中|中央|横排|竖排|横向|纵向|并列|长条|主[1-9]|辅[1-9]|[1-9]区|\d+(?:\.\d+)?%|top|bottom|left|right|center)/gi
    ) || []
  )
    .join("、")
    .slice(0, 300);
}
export const compositionSketchPrompt = (entry: DocumentEntry) => `Draw a minimal flat wireframe diagram for a graphic layout. White canvas, thin straight black borders and plenty of whitespace. Use only these primitive placeholders: empty rectangles for regions, one small empty square for a product slot, circles for icon slots, and the literal letters XXX for text slots. 所有产品主体只用空心方块。The output is a schematic of placement and proportions, like a blank presentation layout template.
Canvas ratio ${entry.width}:${entry.height}. Layout type: ${entry.layout}. Placement hints: ${geometry(entry.layoutNote)}.
Regions: ${entry.scenes.map((s, n) => `Region ${n + 1}: ${geometry(s.region + s.name + s.product + s.interaction)}; ${s.productPresent ? "one small square placeholder" : "empty rectangular region"}`).join("; ")}.
${entry.copy.headline || entry.copy.subtitle || entry.copy.body ? `Text placeholders: large XXX at ${geometry(entry.copy.headlinePosition || "") || "top left"}; small XXX at ${geometry(entry.copy.subtitlePosition || "") || "below the large XXX"}; short XXX lines at ${geometry(entry.copy.bodyPosition || "") || "the designated text region"}.` : "Use empty regions only, without text placeholders."}
Icon slots: ${entry.copy.icons.length ? entry.copy.icons.map((i, n) => `circle ${n + 1} at ${geometry(i.position) || "the blank margin"}`).join("; ") : "zero circles"}.
Maintain the indicated main/auxiliary panels, margins and alignment. Keep every element a simple outline shape or XXX placeholder. This is only a two dimensional layout grid.`;
