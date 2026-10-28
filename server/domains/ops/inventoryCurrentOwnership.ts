import type { InventoryReadRow } from "../../../shared/inventorySnapshotRead";
import type { readNorthAmericaOwnership } from "./northAmericaBoardSources";
import { directTaskPartnerIds } from "./productTaskPartners";

/** This is a live product/permission projection, not a replacement for the
 * saved warehouse-source provenance, stock values, allocation or currency. */
export function projectCurrentInventoryOwnership(
  source: Awaited<ReturnType<typeof readNorthAmericaOwnership>>,
  rows: InventoryReadRow[],
  actor: { userId: number; manager: boolean },
  operatorId?: number
) {
  if (!source.members.some(member => member.id === actor.userId)) throw new Error("INVENTORY_CURRENT_MEMBER_INVALID");
  const partners = new Set(directTaskPartnerIds(actor.userId, source.owners));
  const operators = source.members.filter(member => actor.manager || partners.has(member.id));
  if (operatorId !== undefined && !operators.some(member => member.id === operatorId)) throw new Error("INVENTORY_CURRENT_OPERATOR_DENIED");
  const byAsin = new Map(source.bindings.map(binding => [binding.asin, binding]));
  if (byAsin.size !== source.bindings.length) throw new Error("INVENTORY_CURRENT_ASIN_CONFLICT");
  const owners = new Map(source.owners.map(owner => [JSON.stringify([owner.storeName, owner.parentAsin]), owner]));
  if (owners.size !== source.owners.length) throw new Error("INVENTORY_CURRENT_PARENT_CONFLICT");
  const projections: Array<{ rowId: string; product: NonNullable<InventoryReadRow["currentProduct"]> }> = [], rowIds: string[] = [];
  for (const row of rows) {
    const binding = byAsin.get(row.asin), owner = binding && owners.get(JSON.stringify([binding.storeName, binding.parentAsin]));
    if (binding && owner && binding.source.table === "saihu_product_weekly") {
      const visible = (actor.manager || owner.ownerIds.some(id => partners.has(id))) && (operatorId === undefined || owner.ownerIds.includes(operatorId));
      if (visible) {
        rowIds.push(row.id);
        projections.push({ rowId: row.id, product: { storeName: binding.storeName, parentAsin: binding.parentAsin, title: owner.title, ownerIds: owner.ownerIds, operator: owner.ownerIds.map(id => source.members.find(member => member.id === id)?.name ?? `成员 #${id}`).join(" / "), sourceRowId: binding.source.rowId } });
      }
    } else if (actor.manager && operatorId === undefined) {
      // Keep unpaired stock visible to administrators without inventing owners.
      rowIds.push(row.id);
    }
  }
  return { projections, rowIds, operators };
}
