// ERP report dates are calendar dates in the source report, not timestamps.
// Friday 24:00 is Saturday 00:00: include Saturday through the next Friday.
export function addReportDays(reportDate: string, days: number): string {
  const date = new Date(`${reportDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function productReportingWeek(reportDate: string) {
  const date = new Date(`${reportDate}T00:00:00Z`);
  const weekStartDate = addReportDays(reportDate, -((date.getUTCDay() + 1) % 7));
  return { weekStartDate, weekEndDate: addReportDays(weekStartDate, 6) };
}

export function previousReportingWeekStart(weekStartDate: string) {
  return addReportDays(weekStartDate, -7);
}

// Display the actual included dates, e.g. 9.19-9.25, with no exclusive end date.
export function formatProductReportingRange(start: string, end: string) {
  const shortDate = (date: string) => `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}`;
  return `${shortDate(start)}-${shortDate(end)}`;
}
