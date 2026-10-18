import { saihuReportFail } from "./saihuReportContract";

function decimal(value: number) {
  const text = String(value),
    [coefficient, exponent = "0"] = text.toLowerCase().split("e"),
    [integer, fraction = ""] = coefficient.replace(/^-/, "").split("."),
    rawScale = fraction.length - Number(exponent),
    digits = BigInt(integer + fraction) * (value < 0 ? -1n : 1n);
  if (Math.abs(rawScale) > 14)
    return saihuReportFail("METRIC_PRECISION_UNVERIFIED");
  return {
    units: rawScale < 0 ? digits * 10n ** BigInt(-rawScale) : digits,
    scale: Math.max(0, rawScale),
  };
}
function normalized(units: bigint, scale: number) {
  const digits = (units < 0n ? -units : units)
      .toString()
      .padStart(scale + 1, "0"),
    result = scale
      ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(
          /\.?0+$/u,
          ""
        )
      : digits;
  return units === 0n ? "0" : `${units < 0n ? "-" : ""}${result}`;
}
/** Addition/sign/percentage conversion uses exact decimal units. Do not round
 * a source amount, invent a remainder fee, or silently lose minor units. */
export function saihuReportDecimalSum(
  terms: Array<{ value: number; multiplier: 1 | -1; divisor: 1 | 100 }>
): number {
  const parts = terms.map(term => {
      if (
        !Number.isFinite(term.value) ||
        Math.abs(term.value) > Number.MAX_SAFE_INTEGER
      )
        return saihuReportFail("METRIC_INVALID");
      const parsed = decimal(term.value);
      return {
        units: parsed.units * BigInt(term.multiplier),
        scale: parsed.scale + (term.divisor === 100 ? 2 : 0),
      };
    }),
    scale = Math.max(0, ...parts.map(part => part.scale)),
    units = parts.reduce(
      (sum, part) => sum + part.units * 10n ** BigInt(scale - part.scale),
      0n
    ),
    text = normalized(units, scale),
    value = Number(text);
  if (
    !Number.isFinite(value) ||
    Math.abs(value) > Number.MAX_SAFE_INTEGER ||
    normalized(decimal(value).units, decimal(value).scale) !== text
  )
    return saihuReportFail("METRIC_PRECISION_UNVERIFIED");
  return value;
}
