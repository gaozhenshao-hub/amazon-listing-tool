export type RufusProductIdentity = {
  brand?: string | null;
  productName?: string | null;
  asin?: string | null;
  category?: string | null;
};

export function getRufusIdentityEntries(identity: RufusProductIdentity | null | undefined) {
  const fields: Array<[keyof RufusProductIdentity, string]> = [
    ["brand", "品牌"],
    ["productName", "产品名称"],
    ["asin", "ASIN"],
    ["category", "产品类目"],
  ];

  return fields
    .map(([key, label]) => ({ key, label, value: identity?.[key]?.trim() || "" }))
    .filter((entry) => entry.value);
}
