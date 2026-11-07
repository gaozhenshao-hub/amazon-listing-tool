/** Older captures included Amazon's inline comparison-table CSS in cell text. */
export function amazonContentText(value: string) {
  return value.replace(/(?:^|\s)\.aplus[^{}]{0,250}\{[^}]*\}\s*/g, " ").trim();
}

/** Carousel controls are UI, not product copy or translation evidence. */
export function isAmazonPageNavigation(value: string) {
  return /^(?:(?:(?:previous|next)\s+page|上一页|下一页)(?:\s+|$))+$/iu.test(
    value
      .replace(/[\u200b-\u200d\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Also cleans legacy captures whose navigation labels were saved on separate lines. */
export function amazonModuleCopy(value: string) {
  return amazonContentText(value)
    .split(/\r?\n/)
    .filter(line => !isAmazonPageNavigation(line))
    .join("\n")
    .trim();
}
