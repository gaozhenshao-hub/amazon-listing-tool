/** Older captures included Amazon's inline comparison-table CSS in cell text. */
export function amazonContentText(value: string) {
  return value.replace(/(?:^|\s)\.aplus[^{}]{0,250}\{[^}]*\}\s*/g, " ").trim();
}
