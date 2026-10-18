import { ListingCandidateFields } from "./ListingConfiguredCandidateView";
import { type ListingAuxiliaryCandidate, type ListingAuxiliaryPreviewInput, listingAuxiliaryTargets } from "@shared/listingAuxiliaryWorkflow";
export default function ListingAuxiliaryCandidateView({ candidate, request }: { candidate: ListingAuxiliaryCandidate; request: ListingAuxiliaryPreviewInput }) {
  const targets = listingAuxiliaryTargets(request);
  return <div className="min-w-0 space-y-3" aria-label="完整辅助候选与提交原文">{candidate.targets.map(target => <article className="min-w-0 rounded border p-3" key={target.targetIndex}>
    <h4 className="font-medium">{request.operation === "checkBullet" ? `卖点 ${request.payload.items[target.targetIndex].bulletIndex + 1}` : "完整结果"}</h4>
    <p className="break-all text-xs text-muted-foreground">原稿绑定 {target.targetHash}</p>
    <details><summary>本次实际提交的完整稿件／上下文</summary><ListingCandidateFields value={targets[target.targetIndex].value} /></details>
    <ListingCandidateFields value={target.result} />
  </article>)}<p className="text-xs text-muted-foreground">评分及建议不是事实确认，不会自动修改正文、锁定步骤或同步Listing；建议改写需人工核对。</p></div>;
}
