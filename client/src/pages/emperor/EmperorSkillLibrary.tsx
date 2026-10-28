import { useSearch } from "wouter";
import SkillReadOnlyTarget, { skillReadOnlyRoute } from "./SkillReadOnlyTarget";
import SkillWorkbench from "./SkillWorkbench";

export default function EmperorSkillLibrary() {
  const search = useSearch();
  // Preserve permission-scoped, read-only links from existing workflow records.
  const target = skillReadOnlyRoute(search);
  return target.kind === "management" ? (
    <SkillWorkbench />
  ) : (
    <SkillReadOnlyTarget slug={target.kind === "detail" ? target.slug : null} />
  );
}
