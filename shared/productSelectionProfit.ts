import type { PickProfit } from "./productSelection";

export const PICK_FEE_SOURCE =
  "https://sellercentral.amazon.com/help/hub/reference/external/GABBX6GZPA8MSZGW?itemid=211&locale=en-us";
export const PICK_COMMISSION_SOURCE = "https://sell.amazon.com/pricing";
export const PICK_STORAGE_SOURCE =
  "https://sellercentral.amazon.com/gp/help/external/G3EDYEF6KUCFQTNM";
export const PICK_REFUND_SOURCE =
  "https://sellercentral.amazon.com/help/hub/reference/external/G21531?locale=en";
export const PICK_CATEGORIES = {
  general: "通用类目（默认 15%）",
  garden: "庭院、草坪和园艺",
  apparel: "服装和配饰",
  electronics: "消费电子",
  accessories: "电子配件",
  grocery: "食品杂货",
  beauty: "美容、健康和个人护理",
  furniture: "家具",
  industrial: "工商业用品",
  tools: "工具和家装",
  pet: "宠物用品",
  automotive: "汽车和动力运动用品",
} as const;
const TIER = [
  "小号标准",
  "大号标准",
  "小号大件",
  "大号大件",
  "超大件 ≤50 lb",
  "超大件 50–70 lb",
  "超大件 70–150 lb",
  "超大件 >150 lb",
];

const RATE_CARD = {
  ordinary: {
    small: [
      [2.43, 3.32, 3.58],
      [2.49, 3.42, 3.68],
      [2.56, 3.45, 3.71],
      [2.66, 3.54, 3.8],
      [2.77, 3.68, 3.94],
      [2.82, 3.78, 4.04],
      [2.92, 3.91, 4.17],
      [2.95, 3.96, 4.22],
    ],
    large: [
      2.91, 3.13, 3.38, 3.78, 4.22, 4.6, 4.75, 5.0, 5.1, 5.28, 5.44, 5.85, 6.15,
    ],
    oversized: [6.78, 8.58, 25.56, 36.55, 50.55, 194.18],
    interval: 0.25,
    increment: 0.08,
  },
  peak: {
    small: [
      [2.62, 3.51, 3.77],
      [2.68, 3.61, 3.87],
      [2.76, 3.65, 3.91],
      [2.86, 3.74, 4.0],
      [2.98, 3.89, 4.15],
      [3.03, 3.99, 4.25],
      [3.14, 4.13, 4.39],
      [3.17, 4.18, 4.44],
    ],
    large: [
      3.15, 3.39, 3.66, 4.07, 4.52, 4.91, 5.07, 5.33, 5.47, 5.67, 5.84, 6.26,
      6.69,
    ],
    oversized: [7.82, 9.62, 28.29, 39.36, 54.97, 202.69],
    interval: 0.25,
    increment: 0.08,
  },
  apparel: {
    small: [
      [2.62, 3.51, 3.77],
      [2.64, 3.54, 3.8],
      [2.68, 3.59, 3.85],
      [2.81, 3.69, 3.95],
      [3.0, 3.91, 4.17],
      [3.1, 4.09, 4.35],
      [3.2, 4.2, 4.46],
      [3.3, 4.25, 4.51],
    ],
    large: [
      3.48, 3.68, 3.9, 4.35, 5.05, 5.22, 5.32, 5.43, 5.78, 5.9, 5.95, 6.08,
      6.15,
    ],
    oversized: [6.78, 8.58, 25.56, 36.55, 50.55, 194.18],
    interval: 0.5,
    increment: 0.16,
  },
  apparelPeak: {
    small: [
      [2.85, 3.74, 4.0],
      [2.87, 3.77, 4.03],
      [2.93, 3.84, 4.1],
      [3.06, 3.94, 4.2],
      [3.27, 4.18, 4.44],
      [3.37, 4.36, 4.62],
      [3.49, 4.49, 4.75],
      [3.59, 4.54, 4.8],
    ],
    large: [
      3.79, 4.0, 4.23, 4.69, 5.42, 5.59, 5.71, 5.82, 6.22, 6.34, 6.41, 6.54,
      6.82,
    ],
    oversized: [7.82, 9.62, 28.29, 39.36, 54.97, 202.69],
    interval: 0.5,
    increment: 0.16,
  },
};
const roundMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
const bands = (weight: number, interval: number) =>
  Math.max(0, Math.ceil(weight / interval - 1e-8));

function sizeFor(input: PickProfit) {
  const {
    packageLength: l,
    packageWidth: w,
    packageHeight: h,
    packageKg: kg,
  } = input;
  if (!l || !w || !h || !kg) return null;
  const [long, middle, short] = [l, w, h]
    .map(side => side / 2.54)
    .sort((a, b) => b - a);
  const unit = kg / 0.45359237;
  const volume = long * middle * short;
  const standard = Math.max(unit, volume / 139);
  const bulky = Math.max(
    unit,
    (long * Math.max(middle, 2) * Math.max(short, 2)) / 139
  );
  const girth = long + 2 * (middle + short);
  if (unit <= 1 && long <= 15 && middle <= 12 && short <= 0.75)
    return { tier: 0, weight: unit, volume };
  if (standard <= 20 && long <= 18 && middle <= 14 && short <= 8)
    return { tier: 1, weight: standard, volume };
  if (bulky <= 50 && girth <= 130 && long <= 37 && middle <= 28 && short <= 20)
    return { tier: 2, weight: bulky, volume };
  if (bulky <= 50 && girth <= 130 && long <= 59 && middle <= 33 && short <= 33)
    return { tier: 3, weight: bulky, volume };
  if (bulky <= 50) return { tier: 4, weight: bulky, volume };
  if (bulky <= 70) return { tier: 5, weight: bulky, volume };
  if (bulky <= 150) return { tier: 6, weight: bulky, volume };
  return { tier: 7, weight: unit, volume };
}

function delivery(
  size: NonNullable<ReturnType<typeof sizeFor>>,
  price: number,
  apparel: boolean,
  peak: boolean
) {
  const { tier, weight } = size;
  const rate = apparel
    ? peak
      ? RATE_CARD.apparelPeak
      : RATE_CARD.apparel
    : peak
      ? RATE_CARD.peak
      : RATE_CARD.ordinary;
  const priceBand = price < 10 ? 0 : price > 50 ? 2 : 1;
  let base: number;
  if (tier === 0) {
    base = rate.small[Math.max(0, bands(weight, 0.125) - 1)][priceBand];
  } else if (tier === 1) {
    const index = Math.min(12, Math.max(0, bands(weight, 0.25) - 1));
    base =
      rate.large[index] +
      [0, 0.82, 1.08][priceBand] +
      rate.increment * bands(weight - 3, rate.interval);
  } else {
    const threshold = [1, 1, 1, 51, 71, 151][tier - 2];
    const additional = [0.38, 0.38, 0.38, 0.75, 0.75, 0.19][tier - 2];
    base =
      rate.oversized[tier - 2] +
      (priceBand > 0 ? 0.77 : 0) +
      additional * bands(weight - threshold, 1);
  }
  return {
    base: roundMoney(base),
    fuel: roundMoney(base * 0.035),
    total: roundMoney(roundMoney(base) + roundMoney(base * 0.035)),
  };
}

function referral(input: PickProfit, price: number) {
  if (input.commissionOverride !== null)
    return roundMoney((price * input.commissionOverride) / 100);
  let fee = price * 0.15;
  switch (input.category) {
    case "apparel":
      fee = price * (price <= 15 ? 0.05 : price <= 20 ? 0.1 : 0.17);
      break;
    case "electronics":
      fee = price * 0.08;
      break;
    case "accessories":
      fee = Math.min(100, price) * 0.15 + Math.max(0, price - 100) * 0.08;
      break;
    case "grocery":
      return roundMoney(price * (price <= 15 ? 0.08 : 0.15));
    case "beauty":
      fee = price * (price <= 10 ? 0.08 : 0.15);
      break;
    case "furniture":
      fee = Math.min(200, price) * 0.15 + Math.max(0, price - 200) * 0.1;
      break;
    case "industrial":
    case "automotive":
      fee = price * 0.12;
      break;
  }
  return roundMoney(Math.max(0.3, fee));
}

export function calculatePickProfit(
  input: PickProfit,
  fetchedRate: number | null
) {
  const fx = input.exchangeOverride ?? fetchedRate;
  const size = sizeFor(input);
  const price = input.price;
  if (!size || price === null || price <= 0) return null;
  const volumeWeight =
    (input.packageLength! * input.packageWidth! * input.packageHeight!) / 5000;
  const inboundWeight =
    input.inboundMode === "chargeable"
      ? Math.max(input.packageKg!, volumeWeight)
      : input.packageKg!;
  const inbound = roundMoney(inboundWeight * input.inboundRate);
  const commission = referral(input, price);
  const refundFee = roundMoney(Math.min(5, commission * 0.2));
  const returnRate = input.returnRate / 100;
  const expectedRevenue = price * (1 - returnRate);
  const expectedCommission =
    commission * (1 - returnRate) + refundFee * returnRate;
  const returnedCosts = input.extraPerReturnUsd * returnRate;
  const invested =
    input.purchaseCny === null
      ? null
      : input.purchaseCny + inbound + input.otherCny;
  const season = (peakDelivery: boolean, peakStorage: boolean) => {
    const computed = delivery(
      size,
      price,
      input.apparel || input.category === "apparel",
      peakDelivery
    );
    const fulfillment = input.fulfillmentOverrideUsd ?? computed.total;
    const rate =
      size.tier <= 1 ? (peakStorage ? 2.4 : 0.78) : peakStorage ? 1.4 : 0.56;
    const storage = roundMoney(
      (size.volume / 1728) * rate * input.storageMonths
    );
    const usd =
      invested === null || !fx
        ? null
        : expectedRevenue -
          expectedCommission -
          returnedCosts -
          fulfillment -
          storage -
          invested / fx;
    const cny = usd === null || !fx ? null : usd * fx;
    return {
      fulfillment,
      base: computed.base,
      fuel: computed.fuel,
      storage,
      usd,
      cny,
      margin:
        usd === null || expectedRevenue <= 0 ? null : usd / expectedRevenue,
      roi: cny === null || !invested ? null : cny / invested,
    };
  };
  return {
    fx,
    tier: TIER[size.tier],
    shippingLb: size.weight,
    volumeWeight,
    inboundWeight,
    inbound,
    commission,
    refundFee,
    expectedRevenue,
    expectedCommission,
    returnedCosts,
    ordinary: season(false, false),
    peak: season(true, true),
    januaryPeak: season(true, false),
    octoberOrdinary: season(false, true),
  };
}
