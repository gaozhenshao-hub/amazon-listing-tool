import { trpc } from "@/lib/trpc";
import { useProject } from "@/contexts/ProjectContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FolderOpen } from "lucide-react";

export default function ProjectSelector() {
  const { data: projects, isLoading } = trpc.project.list.useQuery();
  const { selectedProjectId, setSelectedProjectId } = useProject();

  if (isLoading) {
    return <Skeleton className="h-10 w-64" />;
  }

  if (!projects || projects.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground px-3 py-2 border rounded-lg bg-muted/50">
        <FolderOpen className="h-4 w-4" />
        <span>请先创建一个项目</span>
      </div>
    );
  }

  return (
    <Select
      value={selectedProjectId?.toString() || ""}
      onValueChange={(val) => setSelectedProjectId(parseInt(val, 10))}
    >
      <SelectTrigger className="w-64">
        <SelectValue placeholder="选择项目..." />
      </SelectTrigger>
      <SelectContent>
        {projects.map((p) => (
          <SelectItem key={p.id} value={p.id.toString()}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
