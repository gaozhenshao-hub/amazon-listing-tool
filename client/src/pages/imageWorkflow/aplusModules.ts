import {
  IMAGE_WORKFLOW_APLUS_CATEGORIES,
  IMAGE_WORKFLOW_APLUS_MODULES,
  findImageWorkflowAplusModule,
  normalizeImageWorkflowAplusStyle,
} from "@shared/imageWorkflow";

export { DEFAULT_OUTLINE_APLUS_MODULE_ID, normalizeImageOutline } from "@shared/imageWorkflow";

export const OUTLINE_APLUS_MODULES = IMAGE_WORKFLOW_APLUS_MODULES;
export const OUTLINE_APLUS_CATEGORIES = IMAGE_WORKFLOW_APLUS_CATEGORIES;

export function findOutlineAplusModule(value?: string) {
  return findImageWorkflowAplusModule(value);
}

export function normalizeAplusModuleStyle(mod: any) {
  return normalizeImageWorkflowAplusStyle(mod);
}
