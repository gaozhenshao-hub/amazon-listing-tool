import { buildOperatorParentKey, normalizeMarketplaceForOperatorMapping } from "./operatorMappingKeys";

export type InventoryOwnerAssignmentScope = {
  parentAsin: string;
  storeName: string;
  country: string;
};

export function normalizeInventoryOwnerAssignmentScope(scope: InventoryOwnerAssignmentScope): InventoryOwnerAssignmentScope {
  return {
    parentAsin: scope.parentAsin.trim().toUpperCase(),
    storeName: scope.storeName.trim(),
    country: normalizeMarketplaceForOperatorMapping(scope.country),
  };
}

export function inventoryOwnerAssignmentKey(scope: InventoryOwnerAssignmentScope): string {
  const normalized = normalizeInventoryOwnerAssignmentScope(scope);
  return buildOperatorParentKey(normalized.parentAsin, normalized.storeName, normalized.country);
}

export function uniqueInventoryOwnerAssignmentScopes(scopes: InventoryOwnerAssignmentScope[]): InventoryOwnerAssignmentScope[] {
  const unique = new Map<string, InventoryOwnerAssignmentScope>();
  for (const scope of scopes) {
    const normalized = normalizeInventoryOwnerAssignmentScope(scope);
    unique.set(inventoryOwnerAssignmentKey(normalized), normalized);
  }
  return [...unique.values()];
}
