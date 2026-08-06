export const MARKETPLACE_MID_MAP: Record<string, number[]> = {
  US: [1],
  UK: [4],
  DE: [5],
  FR: [6],
  IT: [7],
  ES: [8],
  JP: [9],
  AU: [10],
  CA: [2],
  MX: [3],
};

type ProductSellerIdentity = {
  storeName: string | null;
  marketplace: string | null;
};

export function matchSellerAccount(
  sellers: any[],
  product: ProductSellerIdentity,
): { matchedSid: number | string; matchedMid: number } {
  let matchedSid: number | string = 1;
  let matchedMid = 1;
  const matched = sellers.find((seller: any) =>
    (product.storeName && (
      seller.name === product.storeName
      || seller.wname === product.storeName
      || seller.account_name === product.storeName
    ))
    || (product.marketplace && (
      seller.marketplace === product.marketplace
      || (MARKETPLACE_MID_MAP[product.marketplace] || []).includes(seller.mid)
    )),
  );

  if (matched) {
    matchedSid = matched.sid;
    matchedMid = matched.mid
      || (product.marketplace ? (MARKETPLACE_MID_MAP[product.marketplace]?.[0] || 1) : 1);
  } else if (product.marketplace) {
    matchedMid = MARKETPLACE_MID_MAP[product.marketplace]?.[0] || 1;
  }

  return { matchedSid, matchedMid };
}
