/** Labels use the report's period, never the computer's current month. */
export function reportMonthLabel(month: string, includeYear = false): string {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  return match ? `${includeYear ? `${match[1]}年` : ""}${Number(match[2])}月` : month;
}

export function reportPeriodLabel(start: string, end: string): string {
  if (start === end) return reportMonthLabel(end);
  if (start.slice(0, 4) !== end.slice(0, 4)) return `${reportMonthLabel(start, true)}—${reportMonthLabel(end, true)}`;
  return `${reportMonthLabel(start).replace(/月$/, "")}—${reportMonthLabel(end)}`;
}
