import { useState, useRef, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Loader2, PlusCircle, Link2, Upload, BookOpen, CheckCircle, Edit3, Trash2, Sparkles, Search, FileText, FileSpreadsheet, Presentation, Image as ImageIcon, File, AlertCircle, FolderOpen, Tag, Send } from "lucide-react";
import { toast } from "sonner";
import { TagEditor } from "@/components/TagEditor";
import { usePermissions } from "@/hooks/usePermissions";
import { KBScopeToggle, type KBScope } from "@/components/KBScopeToggle";

const SOP_TAG_SUGGESTIONS = [
  "广告投放", "库存管理", "Listing优化", "财务分析", "选品方法",
  "物流仓储", "评论管理", "品牌运营", "新品上架", "促销活动",
  "PPC策略", "SP广告", "SB广告", "SD广告", "DSP广告",
  "关键词研究", "竞品分析", "价格策略", "A+内容", "品牌旗舰店",
  "FBA补货", "FBM运营", "客服模板", "差评处理", "账号安全",
];

const FILE_TYPE_ICONS: Record<string, any> = {
  pdf: FileText, doc: FileText, docx: FileText,
  xls: FileSpreadsheet, xlsx: FileSpreadsheet, csv: FileSpreadsheet,
  ppt: Presentation, pptx: Presentation,
  md: FileText, txt: FileText, xmind: FolderOpen, mm: FolderOpen, opml: FolderOpen,
  png: ImageIcon, jpg: ImageIcon, jpeg: ImageIcon, gif: ImageIcon, webp: ImageIcon,
};

const FORMAT_GROUPS = [
  { label: "文档", formats: ["PDF", "Word", "Markdown", "TXT"], color: "text-blue-600" },
  { label: "表格", formats: ["Excel", "CSV"], color: "text-emerald-600" },
  { label: "演示", formats: ["PPT", "PPTX"], color: "text-orange-600" },
  { label: "思维导图", formats: ["XMind", "FreeMind"], color: "text-purple-600" },
  { label: "图片", formats: ["PNG", "JPG", "WebP"], color: "text-rose-600" },
];

const SUPPORTED_FORMATS = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.md,.txt,.png,.jpg,.jpeg,.gif,.webp,.xmind,.mm,.opml";

const CATEGORY_OPTIONS = [
  { value: "all", label: "全部分类" },
  { value: "advertising", label: "广告投放" },
  { value: "inventory", label: "库存管理" },
  { value: "listing", label: "Listing优化" },
  { value: "finance", label: "财务分析" },
  { value: "selection", label: "选品方法" },
  { value: "logistics", label: "物流仓储" },
  { value: "review", label: "评论管理" },
  { value: "brand", label: "品牌运营" },
  { value: "other", label: "其他" },
];

export default function KBSkills() {
  const { canEdit, canDelete } = usePermissions();
  const allowEdit = canEdit('knowledge', 'kb_skills');
  const allowDelete = canDelete('knowledge', 'kb_skills');
  const utils = trpc.useUtils();
  const [scope, setScope] = useState<KBScope>("mine");
  const { data: items, isLoading } = trpc.kbSkills.list.useQuery({ scope });
  const [showImport, setShowImport] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [manualContent, setManualContent] = useState("");
  const [manualTags, setManualTags] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [detailId, setDetailId] = useState<number | null>(null);
  const [editingAnalysis, setEditingAnalysis] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadingFileName, setUploadingFileName] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<globalThis.File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: detail } = trpc.kbSkills.getById.useQuery({ id: detailId! }, { enabled: !!detailId });

  const importUrl = trpc.kbSkills.importByUrl.useMutation({
    onSuccess: () => { toast.success("已导入链接，AI正在分析..."); utils.kbSkills.list.invalidate(); setShowImport(false); setUrlInput(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const uploadFile = trpc.kbSkills.uploadFile.useMutation({
    onSuccess: () => { toast.success("文件上传成功，AI正在分析..."); utils.kbSkills.list.invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const batchUpload = trpc.kbSkills.batchUploadFiles.useMutation({
    onSuccess: (r: any) => { toast.success(`已上传 ${r.uploaded} 个文件`); utils.kbSkills.list.invalidate(); setShowImport(false); },
    onError: (e: any) => toast.error(e.message),
  });
  const createManual = trpc.kbSkills.createManual.useMutation({
    onSuccess: () => { toast.success("已创建SOP文档"); utils.kbSkills.list.invalidate(); setShowImport(false); setManualTitle(""); setManualContent(""); setManualTags(""); },
    onError: (e: any) => toast.error(e.message),
  });
  const submitReviewMutation = trpc.kbReview.submitForReview.useMutation({
    onSuccess: () => { toast.success("已提交审核，等待管理员审批"); utils.kbSkills.getById.invalidate({ id: detailId! }); utils.kbSkills.list.invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const confirmMutation = trpc.kbSkills.confirmSummary.useMutation({
    onSuccess: () => { toast.success("已确认入库"); utils.kbSkills.list.invalidate(); utils.kbSkills.getById.invalidate({ id: detailId! }); },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteMutation = trpc.kbSkills.delete.useMutation({
    onSuccess: () => { toast.success("已删除"); utils.kbSkills.list.invalidate(); setDetailId(null); },
    onError: (e: any) => toast.error(e.message),
  });
  const updateTagsMutation = trpc.kbSkills.updateTags?.useMutation?.({
    onSuccess: () => { toast.success("标签已更新"); utils.kbSkills.getById.invalidate({ id: detailId! }); utils.kbSkills.list.invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });

  const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    uploading: { label: "上传中", variant: "secondary" },
    parsing: { label: "解析中", variant: "secondary" },
    analyzing: { label: "AI分析中", variant: "secondary" },
    pending_review: { label: "待确认", variant: "default" },
    confirmed: { label: "已入库", variant: "outline" },
  };

  const getFileIcon = (filename: string) => {
    const ext = (filename || "").split(".").pop()?.toLowerCase() || "";
    const Icon = FILE_TYPE_ICONS[ext] || File;
    return <Icon className="h-4 w-4" />;
  };

  const getFileSize = (size: number) => {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    // Validate file sizes
    const oversized = files.filter(f => f.size > 10 * 1024 * 1024);
    if (oversized.length > 0) {
      toast.error(`${oversized.length} 个文件超过10MB限制: ${oversized.map(f => f.name).join(", ")}`);
      const valid = files.filter(f => f.size <= 10 * 1024 * 1024);
      setSelectedFiles(prev => [...prev, ...valid]);
    } else {
      setSelectedFiles(prev => [...prev, ...files]);
    }
    toast.success(`已选择 ${files.length} 个文件`);
  };

  const handleFileUpload = async () => {
    if (selectedFiles.length === 0) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      const fileDataArray: { filename: string; base64: string; mimeType: string }[] = [];
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        setUploadingFileName(file.name);
        setUploadProgress(Math.round(((i) / selectedFiles.length) * 50));
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
        const base64 = btoa(binary);
        fileDataArray.push({ filename: file.name, base64, mimeType: file.type || "application/octet-stream" });
      }
      setUploadProgress(60);
      setUploadingFileName("正在上传到服务器...");
      if (fileDataArray.length === 1) {
        uploadFile.mutate({ title: fileDataArray[0].filename, fileName: fileDataArray[0].filename, fileBase64: fileDataArray[0].base64, mimeType: fileDataArray[0].mimeType });
      } else {
        batchUpload.mutate({ files: fileDataArray.map(f => ({ title: f.filename, fileName: f.filename, mimeType: f.mimeType, fileBase64: f.base64 })) });
      }
      setUploadProgress(100);
      setSelectedFiles([]);
      setShowImport(false);
    } catch (err: any) {
      toast.error("文件读取失败: " + err.message);
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setUploadingFileName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const filtered = useMemo(() => {
    return (items as any[] || []).filter((item: any) => {
      if (filterCategory !== "all") {
        const tags = (item.tags || "").toLowerCase();
        const category = (item.category || "").toLowerCase();
        if (!tags.includes(filterCategory) && category !== filterCategory) return true; // show all if no match
      }
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (item.title || "").toLowerCase().includes(q) || (item.tags || "").toLowerCase().includes(q) || (item.sourceType || "").toLowerCase().includes(q) || (item.aiSummary || "").toLowerCase().includes(q);
    });
  }, [items, searchQuery, filterCategory]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-green-500" />
            智能运营SOP知识库
          </h1>
          <p className="text-muted-foreground text-sm mt-1">支持文档/表格/PPT/PDF/思维导图/图片批量导入，AI自动提取摘要和关键步骤</p>
        </div>
        <Button onClick={() => setShowImport(true)} className="gap-2"><PlusCircle className="h-4 w-4" /> 添加SOP</Button>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <KBScopeToggle value={scope} onChange={setScope} />
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="搜索标题、标签、内容..." className="pl-9" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CATEGORY_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="h-9 px-3 flex items-center">{filtered.length} 条</Badge>
      </div>

      {/* Supported formats info - enhanced */}
      <div className="flex flex-wrap gap-4 items-center text-xs">
        {FORMAT_GROUPS.map(group => (
          <div key={group.label} className="flex items-center gap-1">
            <span className={`font-medium ${group.color}`}>{group.label}:</span>
            {group.formats.map(f => (
              <Badge key={f} variant="outline" className="text-[10px] h-5">{f}</Badge>
            ))}
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <BookOpen className="h-12 w-12 mx-auto text-muted-foreground/30 mb-4" />
            <p className="text-sm font-medium text-muted-foreground">暂无SOP文档</p>
            <p className="text-xs text-muted-foreground mt-1">上传文件或手动创建SOP，AI将自动提取摘要</p>
            <Button variant="outline" className="mt-4 gap-2" onClick={() => setShowImport(true)}><PlusCircle className="h-4 w-4" /> 添加第一个SOP</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((item: any) => {
            const status = statusMap[item.status] || { label: item.status, variant: "secondary" as const };
            return (
              <Card key={item.id} className="cursor-pointer hover:shadow-md transition-all" onClick={() => { setDetailId(item.id); setEditingAnalysis(""); }}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 text-muted-foreground">{getFileIcon(item.originalFilename || item.title || "")}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-sm truncate">{item.title}</h3>
                        <Badge variant={status.variant} className="text-xs shrink-0">{status.label}</Badge>
                      </div>
                      {item.aiSummary && <p className="text-xs text-muted-foreground line-clamp-2">{item.aiSummary}</p>}
                      <div className="flex flex-wrap gap-1 mt-2">
                        {item.sourceType && <Badge variant="outline" className="text-[10px]">{item.sourceType}</Badge>}
                        {item.tags && (item.tags as string).split(",").filter(Boolean).map((tag: string) => (
                          <Badge key={tag} variant="secondary" className="text-[10px]">{tag.trim()}</Badge>
                        ))}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ""}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Import Dialog - Enhanced */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>添加SOP文档</DialogTitle></DialogHeader>
          <Tabs defaultValue="upload">
            <TabsList className="w-full">
              <TabsTrigger value="upload" className="flex-1 gap-1.5"><Upload className="h-3.5 w-3.5" /> 文件上传</TabsTrigger>
              <TabsTrigger value="url" className="flex-1 gap-1.5"><Link2 className="h-3.5 w-3.5" /> 链接导入</TabsTrigger>
              <TabsTrigger value="manual" className="flex-1 gap-1.5"><Edit3 className="h-3.5 w-3.5" /> 手动创建</TabsTrigger>
            </TabsList>
            <TabsContent value="upload" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>选择文件（支持批量上传，拖拽或点击）</Label>
                <div
                  className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all ${isDragOver ? "border-primary bg-primary/5 scale-[1.01]" : "hover:border-primary/50"}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }}
                  onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); const files = Array.from(e.dataTransfer.files); setSelectedFiles(prev => [...prev, ...files]); toast.success(`已添加 ${files.length} 个文件`); }}
                >
                  <Upload className={`h-8 w-8 mx-auto mb-2 ${isDragOver ? "text-primary" : "text-muted-foreground/50"}`} />
                  <p className="text-sm font-medium">{isDragOver ? "释放文件到此处" : "点击或拖拽文件到此处"}</p>
                  <p className="text-xs text-muted-foreground mt-1.5">支持 PDF、Word、Excel、PPT、Markdown、TXT、思维导图、图片</p>
                  <p className="text-[10px] text-muted-foreground mt-1 flex items-center justify-center gap-1">
                    <AlertCircle className="h-3 w-3" /> 单文件最大10MB
                  </p>
                </div>
                <input ref={fileInputRef} type="file" accept={SUPPORTED_FORMATS} multiple className="hidden" onChange={handleFileSelect} />
                {selectedFiles.length > 0 && (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto border rounded-lg p-2">
                    {selectedFiles.map((file, i) => (
                      <div key={i} className="flex items-center gap-2 px-2 py-1.5 bg-muted/50 rounded-md text-sm">
                        <span className="text-muted-foreground">{getFileIcon(file.name)}</span>
                        <span className="truncate flex-1 text-xs">{file.name}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{getFileSize(file.size)}</span>
                        {file.size > 10 * 1024 * 1024 && <AlertCircle className="h-3 w-3 text-destructive shrink-0" />}
                        <button onClick={(e) => { e.stopPropagation(); removeFile(i); }} className="text-destructive hover:text-destructive/80 text-xs shrink-0">删除</button>
                      </div>
                    ))}
                    <div className="text-xs text-muted-foreground text-right pt-1">
                      共 {selectedFiles.length} 个文件，{getFileSize(selectedFiles.reduce((s, f) => s + f.size, 0))}
                    </div>
                  </div>
                )}
                {/* Upload progress */}
                {uploading && (
                  <div className="space-y-2">
                    <Progress value={uploadProgress} className="h-2" />
                    <p className="text-xs text-muted-foreground text-center">{uploadingFileName} ({uploadProgress}%)</p>
                  </div>
                )}
              </div>
              <Button onClick={handleFileUpload} disabled={uploading || uploadFile.isPending || batchUpload.isPending || selectedFiles.length === 0} className="w-full gap-2">
                {(uploading || uploadFile.isPending || batchUpload.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
                <Sparkles className="h-4 w-4" /> 上传并AI分析 ({selectedFiles.length} 个文件)
              </Button>
            </TabsContent>
            <TabsContent value="url" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>输入文档链接（每行一个）</Label>
                <Textarea placeholder={"https://example.com/sop-document.pdf\nhttps://docs.google.com/...\nhttps://www.notion.so/..."} value={urlInput} onChange={(e) => setUrlInput(e.target.value)} rows={4} />
                <p className="text-xs text-muted-foreground">支持直链PDF、Google Docs、Notion页面等在线文档链接</p>
              </div>
              <Button onClick={() => importUrl.mutate({ url: urlInput })} disabled={importUrl.isPending || !urlInput} className="w-full gap-2">
                {importUrl.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Sparkles className="h-4 w-4" /> 导入并AI分析
              </Button>
            </TabsContent>
            <TabsContent value="manual" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>SOP标题</Label>
                <Input placeholder="例：亚马逊新品上架SOP" value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>SOP内容</Label>
                <Textarea placeholder="输入SOP详细内容..." value={manualContent} onChange={(e) => setManualContent(e.target.value)} rows={8} />
              </div>
              <div className="space-y-2">
                <Label>标签（逗号分隔）</Label>
                <Input placeholder="新品,上架,运营" value={manualTags} onChange={(e) => setManualTags(e.target.value)} />
              </div>
              <Button onClick={() => createManual.mutate({ title: manualTitle, content: manualContent })} disabled={createManual.isPending || !manualTitle || !manualContent} className="w-full gap-2">
                {createManual.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                <Sparkles className="h-4 w-4" /> 创建并AI分析
              </Button>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detailId} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          {detail ? (() => {
            const d = detail as any;
            const status = statusMap[d.status] || { label: d.status, variant: "secondary" as const };
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 flex-wrap">
                    {getFileIcon(d.originalFilename || d.title || "")}
                    <span>{d.title}</span>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {d.sourceType && <Badge variant="outline">{d.sourceType}</Badge>}
                    {d.originalFilename && <span>文件: {d.originalFilename}</span>}
                    {d.createdAt && <span>创建: {new Date(d.createdAt).toLocaleString()}</span>}
                  </div>
                  {/* Tag Editor */}
                  <Card>
                    <CardHeader className="pb-2 pt-3 px-4">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Tag className="h-4 w-4 text-green-500" />
                        标签管理
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      <TagEditor
                        tags={(d.tags || "").split(",").filter(Boolean).map((t: string) => t.trim())}
                        onChange={(newTags) => {
                          if (updateTagsMutation) {
                            updateTagsMutation.mutate({ id: d.id, tags: newTags.join(",") });
                          } else {
                            toast.info("标签更新功能即将上线");
                          }
                        }}
                        suggestions={SOP_TAG_SUGGESTIONS}
                        placeholder="添加标签（回车确认）..."
                      />
                    </CardContent>
                  </Card>
                  {/* AI Summary */}
                  {d.aiSummary && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-green-500" /> AI摘要分析
                          {d.status === "pending_review" && <Badge className="ml-auto text-xs">待确认</Badge>}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {editingAnalysis ? (
                          <Textarea rows={10} value={editingAnalysis} onChange={(e) => setEditingAnalysis(e.target.value)} className="text-xs" />
                        ) : (
                          <div className="text-sm whitespace-pre-wrap">{d.aiSummary}</div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                  {/* Key Steps */}
                  {d.aiKeySteps && (
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">关键步骤</CardTitle></CardHeader>
                      <CardContent>
                        <div className="text-sm whitespace-pre-wrap">{d.aiKeySteps}</div>
                      </CardContent>
                    </Card>
                  )}
                  {/* Content preview */}
                  {d.extractedText && (
                    <Card>
                      <CardHeader className="pb-2"><CardTitle className="text-sm">原文内容</CardTitle></CardHeader>
                      <CardContent>
                        <div className="text-xs text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto">{d.extractedText}</div>
                      </CardContent>
                    </Card>
                  )}
                  <Separator />

                  <div className="flex gap-2 justify-end">
                    {d.status === "pending_review" && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setEditingAnalysis(editingAnalysis ? "" : (d.aiSummary || ""))} className="gap-1.5">
                          <Edit3 className="h-3.5 w-3.5" /> {editingAnalysis ? "取消编辑" : "编辑摘要"}
                        </Button>
                        <Button size="sm" onClick={() => confirmMutation.mutate({ id: detailId!, editedSummary: editingAnalysis || undefined })} disabled={confirmMutation.isPending} className="gap-1.5">
                          {confirmMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                          确认入库
                        </Button>
                      </>
                    )}
                    {allowEdit && (d.status === "confirmed" || d.reviewStatus === "draft" || d.reviewStatus === "rejected") && (
                      <Button variant="outline" size="sm" onClick={() => submitReviewMutation.mutate({ type: "skill", id: detailId!, visibility: "team" })} disabled={submitReviewMutation.isPending} className="gap-1.5 border-blue-200 text-blue-600 hover:bg-blue-50">
                        {submitReviewMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                        提交审核
                      </Button>
                    )}
                    {allowDelete && (
                      <Button variant="destructive" size="sm" onClick={() => { if (confirm("确定删除？")) deleteMutation.mutate({ id: detailId! }); }} className="gap-1.5">
                        <Trash2 className="h-3.5 w-3.5" /> 删除
                      </Button>
                    )}
                  </div>
                </div>
              </>
            );
          })() : (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
