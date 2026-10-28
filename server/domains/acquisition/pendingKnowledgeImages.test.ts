import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({job:vi.fn(),snapshot:vi.fn(),assets:vi.fn(),confirm:vi.fn(),tag:vi.fn(),store:vi.fn()}));
vi.mock("../../repositories/dbClient",()=>({requireDb:async()=>({execute:async()=>[[]]}),withDbTransaction:vi.fn()}));
vi.mock("../../storage",()=>({storagePut:mocks.store}));
vi.mock("./repository",()=>({getAcquisitionJob:mocks.job,getSourceSnapshotByJob:mocks.snapshot,listAssetCandidates:mocks.assets}));
vi.mock("./snapshotReview",()=>({confirmSnapshotForDirectIngestion:mocks.confirm}));
vi.mock("./postConfirmation",()=>({triggerConsumerPostConfirmation:mocks.tag}));
import {confirmPendingKnowledgeImages,supplementPendingKnowledgeImage} from "./pendingKnowledgeImages";
const scope={workspaceId:1,userId:7,jobId:9};
beforeEach(()=>{vi.clearAllMocks();mocks.job.mockResolvedValue({id:9,requestedBy:7,consumerType:"kb_images",status:"review_required"});mocks.snapshot.mockResolvedValue({id:4,status:"pending_review"});mocks.assets.mockResolvedValue([{id:1,storageKey:null}]);});
it.each([{requestedBy:8},{consumerType:"project_competitor"},{deletedAt:new Date()}])("rejects unauthorized supplementation before reading/storing bytes: %j",async override=>{
  mocks.job.mockResolvedValue({id:9,requestedBy:7,consumerType:"kb_images",status:"review_required",...override});
  await expect(supplementPendingKnowledgeImage(scope,1,"invalid")).rejects.toMatchObject({code:"NOT_FOUND"});
  expect(mocks.store).not.toHaveBeenCalled();expect(mocks.assets).not.toHaveBeenCalled();
});
it("rejects corrupt image input without writing storage",async()=>{
  await expect(supplementPendingKnowledgeImage(scope,1,Buffer.from("not an image").toString("base64"))).rejects.toMatchObject({code:"BAD_REQUEST"});expect(mocks.store).not.toHaveBeenCalled();
});
it("confirms with a pending-job ownership guard and dispatches automatic tags",async()=>{
  const projection={consumerType:"kb_images",imageSetId:5,workspaceId:1,userId:7};mocks.confirm.mockResolvedValue({projection});
  await confirmPendingKnowledgeImages(scope);
  expect(mocks.confirm).toHaveBeenCalledWith({workspaceId:1,snapshotId:4,requestedBy:7,expectedPendingJobId:9});expect(mocks.tag).toHaveBeenCalledWith(projection);
});
