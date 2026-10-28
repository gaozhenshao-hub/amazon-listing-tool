import { inventoryOwnerAssignmentKey } from "./inventoryOwnerAssignmentKeys";
import { resolveConfirmedExternalOperator } from "./operatorNameResolution";

export function resolveImportedProductOwner(product: { parentAsin: string; storeName?: string | null; marketplace?: string | null; operator?: string | null }, mappings: Map<string, string>, rules: any[]) {
  const key = product.storeName && product.marketplace ? inventoryOwnerAssignmentKey({ parentAsin: product.parentAsin, storeName: product.storeName, country: product.marketplace }) : null;
  const rule = key ? rules.find(r => r.isActive === 1 && inventoryOwnerAssignmentKey(r) === key) : null;
  if (rule) return { operator: rule.assigneeName, operatorSource: "manual_assignment" as const };
  const operator = resolveConfirmedExternalOperator(product.operator, mappings);
  return { operator, operatorSource: operator ? "weekly_source" as const : null };
}
