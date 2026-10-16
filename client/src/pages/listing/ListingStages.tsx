import { Link, useLocation } from "wouter";
import { useProject } from "@/contexts/ProjectContext";

const stages = [
  ["/listing/analysis", "1. Listing 抓取"],
  ["/listing/comparison", "2. Listing 对比及分析"],
  ["/listing/generate", "3. 智能 Listing 生成"],
] as const;

/** Stage links never select a project or start a background task. */
export default function ListingStages() {
  const [location] = useLocation();
  const { selectedProjectId } = useProject();
  const pathname = location.split(/[?#]/, 1)[0];
  const query = Number.isSafeInteger(selectedProjectId) && Number(selectedProjectId) > 0
    ? `?projectId=${selectedProjectId}` : "";

  return (
    <nav aria-label="Listing 工作步骤" className="flex min-w-0 flex-wrap gap-2 rounded-xl border bg-muted/20 p-3">
      {stages.map(([href, label]) => (
        <Link key={href} href={`${href}${query}`} aria-current={pathname === href ? "step" : undefined}
          className={`rounded-lg px-4 py-2 text-sm ${pathname === href ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
