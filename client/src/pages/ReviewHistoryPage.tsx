import { useProject } from "@/contexts/ProjectContext";
import ProjectSelector from "@/components/ProjectSelector";
import ListingUploadedFiles from "./listing/ListingUploadedFiles";
export default function ReviewHistoryPage() {
  const {selectedProjectId}=useProject();
  return <div className="space-y-5"><header className="flex items-center justify-between"><h1 className="text-2xl font-bold">资料上传记录</h1><ProjectSelector /></header>{selectedProjectId ? <ListingUploadedFiles projectId={selectedProjectId} /> : <p>请先选择项目。</p>}</div>;
}
