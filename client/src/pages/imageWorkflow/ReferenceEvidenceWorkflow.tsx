import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, ExternalLink, FileText, Loader2, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export type Step4ReceiptChoice = {
  receiptReference: string;
  label: string;
  sourcePosition: number;
};

type EvidenceStatus = "pending_review" | "verified" | "rejected" | "revoked";
type MyEvidence = {
  evidenceRecordId: string;
  version: number;
  status: EvidenceStatus;
  reviewedAt?: Date | null;
  expiresAt?: Date | null;
  proofType: string;
  grantSummary: string;
};
type ReviewEvidence = MyEvidence & {
  proofType: string;
  assetOriginKind: "own_product" | "designer_upload";
  createdAt?: Date | null;
};
type Policy = {
  assetId: string;
  revision: number;
  reviewState: "pending_review" | "approved" | "rejected" | "revoked";
  allowedUses: string[];
};

const PROOF_TYPES = [
  ["signed_license", "签署授权书"],
  ["copyright_registration", "版权登记"],
  ["photographer_release", "摄影师授权"],
  ["employment_assignment", "职务作品/权利转让"],
  ["purchase_invoice", "采购凭证"],
] as const;

export function isControlledLedgerUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /账本.*(?:不可用|未就绪)|数据表.*(?:不可用|未就绪)|0207/i.test(message);
}

function statusLabel(status: EvidenceStatus) {
  return ({
    pending_review: "待管理员核验",
    verified: "已核验",
    rejected: "已拒绝",
    revoked: "已撤销",
  } as const)[status];
}

function policyLabel(status: Policy["reviewState"]) {
  return ({
    pending_review: "待管理员用途审核",
    approved: "用途已批准",
    rejected: "用途已拒绝",
    revoked: "用途已撤销",
  } as const)[status];
}

function statusVariant(status: EvidenceStatus | Policy["reviewState"]) {
  if (status === "verified" || status === "approved") return "default" as const;
  if (status === "pending_review") return "secondary" as const;
  return "destructive" as const;
}

function safeDate(value?: Date | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

async function uploadEvidencePdf(input: {
  projectId: number;
  receiptReference: string;
  proofType: string;
  grantSummary: string;
  expiresAt: string;
  file: File;
}) {
  const form = new FormData();
  form.set("projectId", String(input.projectId));
  form.set("originKind", "own_product");
  form.set("receiptReference", input.receiptReference);
  form.set("proofType", input.proofType);
  form.set("authorizationStatement", input.grantSummary);
  if (input.expiresAt) form.set("expiresAt", input.expiresAt);
  form.set("file", input.file);
  const response = await fetch("/api/upload/license-evidence", {
    method: "POST",
    body: form,
    credentials: "same-origin",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "许可证明上传失败");
  return body as Pick<MyEvidence, "evidenceRecordId" | "version" | "status" | "expiresAt">;
}

/**
 * Owner flow: a server-signed Step 4 upload receipt is selected, then a PDF is
 * submitted and remains pending until a separate administrator verifies both
 * proof and later asset policy. It never converts a successful upload into an
 * approved production asset by itself.
 */
export function ReferenceEvidenceWorkflow({
  projectId,
  receipts,
  disabled = false,
}: {
  projectId: number;
  receipts: Step4ReceiptChoice[];
  disabled?: boolean;
}) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const [receiptReference, setReceiptReference] = useState("");
  const [proofType, setProofType] = useState<(typeof PROOF_TYPES)[number][0]>("signed_license");
  const [grantSummary, setGrantSummary] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const myEvidenceQuery = trpc.imageWorkflow.listMyLicenseEvidence.useQuery({ projectId });
  const reviewEvidenceQuery = trpc.imageWorkflow.listLicenseEvidenceForReview.useQuery(
    { projectId },
    { enabled: isAdmin },
  );
  const policiesQuery = trpc.imageWorkflow.listAssetPolicies.useQuery(
    { projectId },
    { enabled: isAdmin },
  );
  const registerMutation = trpc.imageWorkflow.registerReceiptAsset.useMutation();
  const reviewEvidenceMutation = trpc.imageWorkflow.reviewLicenseEvidence.useMutation();
  const reviewPolicyMutation = trpc.imageWorkflow.reviewAssetPolicy.useMutation();

  const myEvidence = useMemo(() => (myEvidenceQuery.data ?? []) as MyEvidence[], [myEvidenceQuery.data]);
  const reviewEvidence = useMemo(() => (reviewEvidenceQuery.data ?? []) as ReviewEvidence[], [reviewEvidenceQuery.data]);
  const policies = useMemo(() => (policiesQuery.data ?? []) as Policy[], [policiesQuery.data]);
  const selectedReceipt = useMemo(
    () => receipts.find((item) => item.receiptReference === receiptReference) ?? null,
    [receiptReference, receipts],
  );
  const selectedEvidence = myEvidence.find((item) => item.evidenceRecordId === selectedEvidenceId) ?? null;
  const ledgerUnavailable = isControlledLedgerUnavailable(myEvidenceQuery.error)
    || isControlledLedgerUnavailable(reviewEvidenceQuery.error)
    || isControlledLedgerUnavailable(policiesQuery.error);

  useEffect(() => {
    if (!receiptReference && receipts[0]) setReceiptReference(receipts[0].receiptReference);
    if (receiptReference && !receipts.some((item) => item.receiptReference === receiptReference)) {
      setReceiptReference(receipts[0]?.receiptReference ?? "");
    }
  }, [receiptReference, receipts]);

  useEffect(() => {
    if (!selectedEvidenceId && myEvidence[0]) setSelectedEvidenceId(myEvidence[0].evidenceRecordId);
  }, [myEvidence, selectedEvidenceId]);

  useEffect(() => {
    if (!selectedEvidence) return;
    if (PROOF_TYPES.some(([value]) => value === selectedEvidence.proofType)) {
      setProofType(selectedEvidence.proofType as typeof proofType);
    }
    setGrantSummary(selectedEvidence.grantSummary);
  }, [selectedEvidence]);

  const submitEvidence = async () => {
    if (!selectedReceipt || !proofFile) {
      toast.error("请选择本项目已上传的参考图和 PDF 证明材料");
      return;
    }
    try {
      const created = await uploadEvidencePdf({
        projectId,
        receiptReference: selectedReceipt.receiptReference,
        proofType,
        grantSummary,
        expiresAt,
        file: proofFile,
      });
      setSelectedEvidenceId(created.evidenceRecordId);
      setProofFile(null);
      await myEvidenceQuery.refetch();
      toast.success("证明材料已登记，正在等待管理员核验");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "证明材料上传失败");
    }
  };

  const registerAsset = async () => {
    if (!selectedReceipt || !selectedEvidence || selectedEvidence.status !== "verified") {
      toast.error("仅已核验的证明材料可以登记为待审核素材");
      return;
    }
    try {
      await registerMutation.mutateAsync({
        projectId,
        expectedRevision: 0,
        originKind: "own_product",
        receiptReference: selectedReceipt.receiptReference,
        requestedUses: ["step4_reference"],
        licenseEvidence: {
          proofRecordId: selectedEvidence.evidenceRecordId,
          proofType,
          grantSummary,
        },
        source: {
          sourceRole: "unknown",
          sourceModule: "step4_reference",
          sourcePosition: selectedReceipt.sourcePosition,
        },
      });
      toast.success("素材已登记为待管理员用途审核；尚不可自动用于制作");
      await policiesQuery.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "素材登记失败，请确认授权摘要与已核验材料完全一致");
    }
  };

  const decideEvidence = async (evidence: ReviewEvidence, decision: "verify" | "reject") => {
    try {
      await reviewEvidenceMutation.mutateAsync({
        projectId,
        evidenceRecordId: evidence.evidenceRecordId,
        expectedVersion: evidence.version,
        decision,
      });
      await Promise.all([reviewEvidenceQuery.refetch(), myEvidenceQuery.refetch()]);
      toast.success(decision === "verify" ? "证明已核验" : "证明已拒绝");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "证明审核失败");
    }
  };

  const previewEvidence = async (evidence: ReviewEvidence) => {
    try {
      const result = await utils.imageWorkflow.createLicenseEvidencePreview.fetch({
        projectId,
        evidenceRecordId: evidence.evidenceRecordId,
        expectedVersion: evidence.version,
      });
      setPreviewUrl(result.previewUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "私有证明预览不可用");
    }
  };

  const decidePolicy = async (policy: Policy, decision: "approve" | "reject") => {
    try {
      await reviewPolicyMutation.mutateAsync({
        projectId,
        assetId: policy.assetId,
        expectedRevision: policy.revision,
        decision,
        allowedUses: policy.allowedUses as Array<"step4_reference">,
      });
      await policiesQuery.refetch();
      toast.success(decision === "approve" ? "素材用途已批准" : "素材用途已拒绝");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "用途审核失败");
    }
  };

  if (ledgerUnavailable) {
    return (
      <Card className="border-amber-300 bg-amber-50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm text-amber-900"><ShieldAlert className="size-4" />受控素材流程暂不可用</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-amber-900">
          0207 可信账本仍为 DRAFT 或所需数据表不可用；系统已拒绝绕过证明、登记或审核。请勿把竞品图或知识库图片作为本品素材。
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-3" aria-label="本品参考图许可证明">
      <Card className="border-sky-200 bg-sky-50/40">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm"><FileText className="size-4 text-sky-700" />本项目参考图：许可证明与人工审核</CardTitle>
          <CardDescription>仅本项目本人受控上传的参考图可提交 PDF 证明。证明核验和素材用途审核均由管理员单独决定，普通用户不能自动确认。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {receipts.length === 0 ? (
            <p className="text-xs text-muted-foreground">请先在本页上传构图或效果参考图；竞品图和知识库图片不能进入本品素材流程。</p>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>本项目已上传的参考图回执</Label>
                  <Select value={receiptReference} onValueChange={setReceiptReference} disabled={disabled}>
                    <SelectTrigger><SelectValue placeholder="选择已上传参考图" /></SelectTrigger>
                    <SelectContent>{receipts.map((item) => <SelectItem key={item.receiptReference} value={item.receiptReference}>{item.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>证明类型</Label>
                  <Select value={proofType} onValueChange={(value) => setProofType(value as typeof proofType)} disabled={disabled}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PROOF_TYPES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="license-grant-summary">授权摘要（须与 PDF 及后续登记保持一致）</Label>
                <Textarea id="license-grant-summary" value={grantSummary} onChange={(event) => setGrantSummary(event.target.value)} maxLength={2000} disabled={disabled} placeholder="例如：权利人授权本项目将此本品实拍图用于 Amazon Listing 参考图。" />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5"><Label htmlFor="license-proof-pdf">许可证明 PDF（32 B–5 MB，1–12 页）</Label><Input id="license-proof-pdf" type="file" accept="application/pdf,.pdf" disabled={disabled} onChange={(event) => setProofFile(event.target.files?.[0] ?? null)} /></div>
                <div className="space-y-1.5"><Label htmlFor="license-expiry">到期日（可选）</Label><Input id="license-expiry" type="date" value={expiresAt} disabled={disabled} onChange={(event) => setExpiresAt(event.target.value)} /></div>
              </div>
              <Button type="button" onClick={submitEvidence} disabled={disabled || !proofFile || !grantSummary.trim()}>
                {myEvidenceQuery.isFetching ? <Loader2 className="mr-1 size-4 animate-spin" /> : <FileText className="mr-1 size-4" />}提交 PDF 证明
              </Button>
            </>
          )}
          {myEvidence.length > 0 && <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-medium">我的真实审核状态（不含证明文件、对象键或哈希）</p>
            <div className="flex flex-wrap gap-2">{myEvidence.map((evidence) => <Button type="button" key={evidence.evidenceRecordId} variant={selectedEvidenceId === evidence.evidenceRecordId ? "default" : "outline"} size="sm" className="h-auto text-xs" onClick={() => setSelectedEvidenceId(evidence.evidenceRecordId)}>{evidence.evidenceRecordId.slice(0, 18)}… <Badge className="ml-1" variant={statusVariant(evidence.status)}>{statusLabel(evidence.status)}</Badge></Button>)}</div>
            {selectedEvidence && <p className="text-xs text-muted-foreground">当前材料：{statusLabel(selectedEvidence.status)}；版本 {selectedEvidence.version}；最近审核：{safeDate(selectedEvidence.reviewedAt)}</p>}
            <Button type="button" variant="outline" onClick={registerAsset} disabled={disabled || !selectedEvidence || selectedEvidence.status !== "verified" || registerMutation.isPending}>
              {registerMutation.isPending ? <Loader2 className="mr-1 size-4 animate-spin" /> : <CheckCircle2 className="mr-1 size-4" />}已核验后登记为待用途审核素材
            </Button>
          </div>}
        </CardContent>
      </Card>

      {isAdmin && <Card className="border-violet-200 bg-violet-50/30">
        <CardHeader className="pb-3"><CardTitle className="text-sm">管理员审核队列</CardTitle><CardDescription>只能在当前工作空间与项目内查看；预览使用受控短效 URL，若私有存储前置条件未满足会拒绝。</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2"><p className="text-xs font-medium">许可证明</p>{reviewEvidence.length === 0 ? <p className="text-xs text-muted-foreground">当前项目没有待查看的证明。</p> : reviewEvidence.map((evidence) => <div key={evidence.evidenceRecordId} className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2 text-xs"><span>{evidence.evidenceRecordId.slice(0, 18)}…</span><Badge variant={statusVariant(evidence.status)}>{statusLabel(evidence.status)}</Badge><span className="text-muted-foreground">{evidence.proofType} · v{evidence.version}</span><Button type="button" size="sm" variant="outline" onClick={() => previewEvidence(evidence)}><ExternalLink className="mr-1 size-3" />安全查看 PDF</Button>{evidence.status === "pending_review" && <><Button type="button" size="sm" onClick={() => decideEvidence(evidence, "verify")} disabled={reviewEvidenceMutation.isPending}>核验</Button><Button type="button" size="sm" variant="destructive" onClick={() => decideEvidence(evidence, "reject")} disabled={reviewEvidenceMutation.isPending}>拒绝</Button></>}</div>)}</div>
          <div className="space-y-2"><p className="text-xs font-medium">已登记素材用途</p>{policies.length === 0 ? <p className="text-xs text-muted-foreground">尚无待审核素材用途。</p> : policies.map((policy) => <div key={policy.assetId} className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-2 text-xs"><span>{policy.assetId.slice(0, 18)}…</span><Badge variant={statusVariant(policy.reviewState)}>{policyLabel(policy.reviewState)}</Badge><span className="text-muted-foreground">{policy.allowedUses.join(", ")} · r{policy.revision}</span>{policy.reviewState === "pending_review" && <><Button type="button" size="sm" onClick={() => decidePolicy(policy, "approve")} disabled={reviewPolicyMutation.isPending}>批准用途</Button><Button type="button" size="sm" variant="destructive" onClick={() => decidePolicy(policy, "reject")} disabled={reviewPolicyMutation.isPending}>拒绝用途</Button></>}</div>)}</div>
          {previewUrl && <div className="rounded-md border border-violet-200 bg-background p-2"><p className="mb-2 text-xs text-muted-foreground">私有 PDF 预览将在短效签名到期后失效。</p><iframe title="许可证明 PDF 预览" src={previewUrl} className="h-96 w-full rounded border" /></div>}
        </CardContent>
      </Card>}
    </section>
  );
}
