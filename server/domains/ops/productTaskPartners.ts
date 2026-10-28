import type { DbExecutor } from "../../repositories/dbClient";
import { readNorthAmericaOwnership } from "./northAmericaBoardSources";

export function directTaskPartnerIds(userId: number, owners: Array<{ ownerIds: number[] }>) {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error("TASK_PARTNER_ID_INVALID");
  const ids = new Set([userId]);
  for (const owner of owners) {
    if (owner.ownerIds.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error("TASK_PARTNER_ID_INVALID");
    // Only a shared product with this requester grants visibility. A partner's
    // other partners do not become the requester's partners transitively.
    if (owner.ownerIds.includes(userId)) owner.ownerIds.forEach(id => ids.add(id));
  }
  return [...ids].sort((a, b) => a - b);
}

/** Current US product directory + confirmed active member IDs, never task
 * assignee names or historical snapshot ownerIds. No mutation authority. */
export async function currentTaskPartners(session: {
  tx: DbExecutor; identity: { userId: number; workspaceId: number }; all: boolean;
}) {
  if (process.env.ENABLE_NORTH_AMERICA_TASK_PARTNERS !== "true") {
    return { available: false, ids: [session.identity.userId] };
  }
  const ownership = await readNorthAmericaOwnership({ ...session, manager: session.all }, []);
  if (!ownership.members.some(member => member.id === session.identity.userId)) throw new Error("TASK_PARTNER_MEMBER_INVALID");
  return { available: true, ids: directTaskPartnerIds(session.identity.userId, ownership.owners) };
}
