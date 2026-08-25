export function asFiniteMetric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function formatMetricFixed(value: unknown, digits: number): string {
  const numeric = asFiniteMetric(value);
  return numeric == null ? "—" : numeric.toFixed(digits);
}
