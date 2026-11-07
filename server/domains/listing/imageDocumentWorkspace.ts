import type { ImageDocument } from "../../../shared/imageDocument";
import type { ImageOutline } from "../../../shared/imagePlanning";
import { requireDb } from "../../repositories/dbClient";
import { assertResearchEditable } from "./researchLocks";
import {
  readImagePlan,
  saveImagePlan,
  lockPlanningProject,
  type PlanningScope,
} from "./imagePlanningStore";
import {
  readImageDocument,
  saveImageDocument,
  synchronizeDocument,
  assertDocumentEditable,
  documentConflict,
} from "./imageDocumentStore";
import {
  validateOutlineLinks,
  imagePlanningSources,
} from "./imagePlanningSources";
import { validatePlanningReferences } from "./imagePlanningSave";
import {
  documentReferences,
  resolveDocumentMaterials,
} from "./imageDocumentMaterials";
import { planningReferenceKey } from "../../../shared/planningImageReference";
import { moduleOutline } from "../../../shared/modulePlanning";
export async function saveDocumentWorkspace(
  scope: PlanningScope,
  input: {
    outlineRevision: number;
    revision: number;
    outline: ImageOutline;
    data: ImageDocument;
  }
) {
  const sources = await imagePlanningSources(scope),
    before = await readImageDocument(scope),
    previous = documentReferences(before.data),
    old = new Set(previous.map(planningReferenceKey));
  await resolveDocumentMaterials(
    scope,
    documentReferences(input.data).filter(
      r => !old.has(planningReferenceKey(r))
    ),
    { strict: true, referenceSetIds: input.outline.referenceSets, previous }
  );
  return (await requireDb("save module document workspace")).transaction(
    async tx => {
      await lockPlanningProject(tx, scope);
      const current = await readImageDocument(scope, tx),
        plan = await readImagePlan(scope, tx);
      assertDocumentEditable(current);
      await assertResearchEditable(scope, "outline", tx);
      if (
        current.revision !== input.revision ||
        plan.revision !== input.outlineRevision
      )
        throw documentConflict();
      await validatePlanningReferences(scope, input.outline, plan.data);
      const outline =
        JSON.stringify(plan.data) === JSON.stringify(input.outline)
          ? plan
          : await saveImagePlan(
              scope,
              input.outlineRevision,
              input.outline,
              tx,
              {
                validateOutline: data =>
                  validateOutlineLinks(data, sources.upstream, plan.data),
                baseline: moduleOutline(plan.data),
              }
            );
      const baseline = synchronizeDocument(current.data, outline.data),
        data = synchronizeDocument(input.data, outline.data);
      if (
        current.revision &&
        JSON.stringify(current.data) === JSON.stringify(data)
      )
        return {
          ...current,
          outline: outline.data,
          outlineRevision: outline.revision,
        };
      const document = await saveImageDocument(
        scope,
        input.revision,
        data,
        tx,
        { baseline }
      );
      return {
        ...document,
        outline: outline.data,
        outlineRevision: outline.revision,
      };
    }
  );
}
