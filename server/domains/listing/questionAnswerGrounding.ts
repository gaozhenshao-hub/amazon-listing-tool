/** A question can come from a competitor; its answer must describe our saved
 * product, not inherit that competitor's measurements or manufacturing claims. */
const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(
      /[一二两三四五六七八九]/g,
      c =>
        ({
          一: "1",
          二: "2",
          两: "2",
          三: "3",
          四: "4",
          五: "5",
          六: "6",
          七: "7",
          八: "8",
          九: "9",
        })[c]!
    )
    .replace(/\s+/g, "")
    .replace(/[–—~～至]/g, "-")
    .replace(/inches?|英吋/g, "英寸")
    .replace(/centimeters?|cm/g, "厘米")
    .replace(/millimeters?|mm/g, "毫米")
    .replace(/years?/g, "年")
    .replace(/℃/g, "°c");
export function questionAnswerIssues(answer: string, confirmedFacts: string) {
  const text = normalize(answer),
    facts = normalize(confirmedFacts),
    issues: string[] = [];
  const values =
    text.match(
      /\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?(?:英寸|厘米|毫米|年|天|个月|°c|%|％)/g
    ) || [];
  for (const value of new Set(values))
    if (!facts.includes(value)) issues.push("本品未确认的精确数值：" + value);
  for (const claim of ["预缩", "防缩水处理", "数年", "黄铜", "阻燃", "医用级"])
    if (
      text.includes(claim) &&
      !facts.includes(claim) &&
      !(claim === "阻燃" && facts.includes("防火"))
    )
      issues.push("本品未确认的工艺、材料或寿命：" + claim);
  if (
    /未(?:附带|配备|配置|提供)|不(?:包含|附带|提供)/.test(answer) &&
    /手提袋|收纳袋|手提箱|收纳箱/.test(answer) &&
    !/(未|无|不|没有).{0,10}(手提|收纳)/.test(confirmedFacts)
  )
    issues.push(
      "未确认收纳配件是否附带，不要自行断言没有；可说明已确认配件并给出收纳建议"
    );
  if (
    /极高的?性价比|价格更加亲民|价格更低|比竞品便宜/.test(answer) &&
    !facts.includes("性价比") &&
    !facts.includes("价格")
  )
    issues.push("缺少本品定价依据，不要新增价格优势");
  if (
    /100%[^。]*(防蜇|防蛰|防刺)|绝不会[^。]*(蜇|蛰)|不会被[^。]*(蜇|蛰)/.test(
      answer
    )
  )
    issues.push("不能保证绝对防蜇，请用已确认的防护结构和正确穿戴说明回答");
  if (/本品资料待|未提供本品资料|资料待补充/.test(answer))
    issues.push("不要重复要求本品属性表；依据已确认功能给出有用建议");
  return issues;
}
