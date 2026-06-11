import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, Mail, Bot, Send, Plus, Edit, Trash2, Copy, Check, FileText, Inbox, Clock, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function ServiceEmails() {
  const [selectedSid, setSelectedSid] = useState<number | undefined>();
  const [activeTab, setActiveTab] = useState("inbox");
  const [selectedEmail, setSelectedEmail] = useState<any>(null);
  const [showReplyDialog, setShowReplyDialog] = useState(false);
  const [editedReply, setEditedReply] = useState("");
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templateForm, setTemplateForm] = useState({ name: "", category: "return_request", subject: "", body: "", variables: "" });
  const [editingTemplate, setEditingTemplate] = useState<any>(null);

  const marketplacesQuery = trpc.operations.getMarketplaces.useQuery();
  const emailsQuery = trpc.afterSales.getEmails.useQuery({ sid: selectedSid, page: 1, pageSize: 30 });
  const templatesQuery = trpc.afterSales.listTemplates.useQuery({});
  const aiReplyMut = trpc.afterSales.aiEmailReply.useMutation();
  const saveTemplateMut = trpc.afterSales.createTemplate.useMutation();
  const deleteTemplateMut = trpc.afterSales.deleteTemplate.useMutation();
  const aiGenerateTemplateMut = trpc.afterSales.aiGenerateTemplate.useMutation();
  const updateTemplateMut = trpc.afterSales.updateTemplate.useMutation();

  const emails = emailsQuery.data?.list || [];
  const templates = templatesQuery.data || [];

  // Handle AI reply
  const handleAiReply = async (email: any) => {
    setSelectedEmail(email);
    setShowReplyDialog(true);
    setEditedReply("");
    try {
      const result = await aiReplyMut.mutateAsync({
        emailId: email.email_id || String(Date.now()),
        subject: email.subject || "",
        content: email.content || email.subject || "",
        buyerEmail: email.buyer_email || "",
        orderId: email.order_id || "",
        asin: email.asin || "",
      });
      setEditedReply((result as any)?.reply || "");
    } catch {
      toast.error("AI回复生成失败");
    }
  };

  // Handle save template
  const handleSaveTemplate = async () => {
    try {
      if (editingTemplate) {
        await updateTemplateMut.mutateAsync({
          id: editingTemplate.id,
          templateName: templateForm.name,
          category: templateForm.category as any,
          subject: templateForm.subject,
          bodyContent: templateForm.body,
          variables: templateForm.variables.split(",").map(v => v.trim()).filter(Boolean),
        });
      } else {
        await saveTemplateMut.mutateAsync({
          templateName: templateForm.name,
          category: templateForm.category as any,
          subject: templateForm.subject,
          bodyContent: templateForm.body,
          variables: templateForm.variables.split(",").map(v => v.trim()).filter(Boolean),
        });
      }
      setShowTemplateDialog(false);
      templatesQuery.refetch();
      toast.success(editingTemplate ? "模板已更新" : "模板已创建");
    } catch {
      toast.error("保存失败");
    }
  };

  // Handle delete template
  const handleDeleteTemplate = async (id: number) => {
    try {
      await deleteTemplateMut.mutateAsync({ id });
      templatesQuery.refetch();
      toast.success("模板已删除");
    } catch {
      toast.error("删除失败");
    }
  };

  // Handle AI generate template
  const handleAiGenerateTemplate = async () => {
    try {
      const result = await aiGenerateTemplateMut.mutateAsync({
        category: templateForm.category as any,
        scenario: templateForm.name || "通用场景",
      });
      if (result) {
        setTemplateForm(prev => ({
          ...prev,
          name: (result as any).name || prev.name,
          subject: (result as any).subject || "",
          body: (result as any).body || "",
          variables: ((result as any).variables || []).join(", "),
        }));
      }
    } catch {
      toast.error("AI生成失败");
    }
  };

  // Open edit template dialog
  const openEditTemplate = (tpl: any) => {
    setEditingTemplate(tpl);
    setTemplateForm({
      name: tpl.name,
      category: tpl.category,
      subject: tpl.subject,
      body: tpl.body,
      variables: (tpl.variables || []).join(", "),
    });
    setShowTemplateDialog(true);
  };

  // Open new template dialog
  const openNewTemplate = () => {
    setEditingTemplate(null);
    setTemplateForm({ name: "", category: "return_request", subject: "", body: "", variables: "" });
    setShowTemplateDialog(true);
  };

  const categoryLabels: Record<string, string> = {
    return_request: "退货请求",
    complaint: "投诉处理",
    product_inquiry: "产品咨询",
    shipping_issue: "物流问题",
    refund: "退款",
    review_follow_up: "评论跟进",
    other: "其他",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">邮件管理 & AI客服</h1>
          <p className="text-muted-foreground text-sm mt-1">智能邮件分类、AI自动回复和模板管理</p>
        </div>
        <Select value={selectedSid?.toString() || "all"} onValueChange={v => setSelectedSid(v === "all" ? undefined : Number(v))}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="全部店铺" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部店铺</SelectItem>
            {(marketplacesQuery.data || []).flatMap((mp: any) => mp.sids.map((sid: string, i: number) => (
              <SelectItem key={sid} value={sid}>{mp.storeNames?.[i] || `${mp.name}-${sid}`}</SelectItem>
            )))}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="inbox" className="gap-1"><Inbox className="h-4 w-4" /> 收件箱</TabsTrigger>
          <TabsTrigger value="templates" className="gap-1"><FileText className="h-4 w-4" /> 邮件模板</TabsTrigger>
        </TabsList>

        {/* Inbox Tab */}
        <TabsContent value="inbox" className="mt-4">
          {emailsQuery.isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <div className="space-y-3">
              {emails.map((email: any, i: number) => (
                <Card key={i} className={`hover:shadow-md transition-shadow cursor-pointer ${!email.is_read ? 'border-l-4 border-l-blue-500' : ''}`}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {!email.is_read && <div className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />}
                          <span className="font-medium text-sm truncate">{email.subject || "无主题"}</span>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {categoryLabels[email.category] || email.category}
                          </Badge>
                          {email.is_urgent && <Badge variant="destructive" className="text-[10px]">紧急</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-1">{email.content?.slice(0, 100)}</p>
                        <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                          <span>买家: {email.buyer_email || "N/A"}</span>
                          {email.order_id && <span>订单: {email.order_id}</span>}
                          {email.asin && <span>ASIN: {email.asin}</span>}
                          <span><Clock className="h-3 w-3 inline mr-0.5" />{email.received_date}</span>
                        </div>
                      </div>
                      <div className="shrink-0 flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => handleAiReply(email)}>
                          <Bot className="h-3.5 w-3.5 mr-1" /> AI回复
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {emails.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <Mail className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">暂无邮件数据</p>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* Templates Tab */}
        <TabsContent value="templates" className="mt-4">
          <div className="flex justify-end mb-4">
            <Button onClick={openNewTemplate}>
              <Plus className="h-4 w-4 mr-1" /> 新建模板
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(templates as any[]).map((tpl: any) => (
              <Card key={tpl.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{tpl.name}</CardTitle>
                    <Badge variant="outline" className="text-[10px]">{categoryLabels[tpl.category] || tpl.category}</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-xs text-muted-foreground mb-2">主题: {tpl.subject}</div>
                  <p className="text-xs text-muted-foreground line-clamp-3">{tpl.body}</p>
                  {tpl.variables?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {tpl.variables.map((v: string, i: number) => (
                        <Badge key={i} variant="secondary" className="text-[10px]">{`{{${v}}}`}</Badge>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" variant="outline" onClick={() => openEditTemplate(tpl)}>
                      <Edit className="h-3 w-3 mr-1" /> 编辑
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => {
                      navigator.clipboard.writeText(tpl.body);
                      toast.success("已复制到剪贴板");
                    }}>
                      <Copy className="h-3 w-3 mr-1" /> 复制
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600" onClick={() => handleDeleteTemplate(tpl.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {(templates as any[]).length === 0 && (
              <div className="col-span-full text-center py-12 text-muted-foreground">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">暂无邮件模板，点击"新建模板"创建</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* AI Reply Dialog */}
      <Dialog open={showReplyDialog} onOpenChange={setShowReplyDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-5 w-5 text-blue-500" /> AI智能回复
            </DialogTitle>
          </DialogHeader>
          {selectedEmail && (
            <div className="space-y-4">
              {/* Original Email */}
              <div className="p-3 rounded-lg bg-muted/30 border">
                <div className="text-xs text-muted-foreground mb-1">原始邮件</div>
                <div className="font-medium text-sm mb-1">{selectedEmail.subject}</div>
                <p className="text-sm text-muted-foreground">{selectedEmail.content}</p>
              </div>

              {/* AI Classification */}
              {aiReplyMut.data && (
                <div className="flex gap-2">
                  <Badge>{(aiReplyMut.data as any).classification || "未分类"}</Badge>
                  <Badge variant="outline">{(aiReplyMut.data as any).sentiment || "中性"}</Badge>
                  {(aiReplyMut.data as any).urgencyLevel === "high" && <Badge variant="destructive">紧急</Badge>}
                </div>
              )}

              {/* Editable Reply */}
              {aiReplyMut.isPending ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  <span className="text-sm text-muted-foreground">AI正在生成回复...</span>
                </div>
              ) : (
                <div>
                  <Label className="text-sm">回复内容（可编辑后发送）</Label>
                  <Textarea value={editedReply} onChange={e => setEditedReply(e.target.value)} rows={8} className="mt-1" />
                </div>
              )}

              {/* Quick Templates */}
              {(templates as any[]).length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">快速套用模板</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {(templates as any[]).slice(0, 5).map((tpl: any) => (
                      <Button key={tpl.id} size="sm" variant="outline" className="text-xs" onClick={() => setEditedReply(tpl.body)}>
                        {tpl.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReplyDialog(false)}>取消</Button>
            <Button disabled={!editedReply} onClick={() => {
              toast.success("回复已确认，请在亚马逊卖家后台发送");
              setShowReplyDialog(false);
            }}>
              <Check className="h-4 w-4 mr-1" /> 确认回复
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Template Edit Dialog */}
      <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? "编辑模板" : "新建邮件模板"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>模板名称</Label>
              <Input value={templateForm.name} onChange={e => setTemplateForm(p => ({ ...p, name: e.target.value }))} placeholder="如: 退货确认回复" />
            </div>
            <div>
              <Label>分类</Label>
              <Select value={templateForm.category} onValueChange={v => setTemplateForm(p => ({ ...p, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(categoryLabels).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>邮件主题</Label>
              <Input value={templateForm.subject} onChange={e => setTemplateForm(p => ({ ...p, subject: e.target.value }))} placeholder="Re: Your order..." />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>邮件正文</Label>
                <Button size="sm" variant="ghost" onClick={handleAiGenerateTemplate} disabled={aiGenerateTemplateMut.isPending}>
                  {aiGenerateTemplateMut.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Bot className="h-3 w-3 mr-1" />}
                  AI生成
                </Button>
              </div>
              <Textarea value={templateForm.body} onChange={e => setTemplateForm(p => ({ ...p, body: e.target.value }))} rows={8} placeholder="Dear {{buyer_name}},..." />
            </div>
            <div>
              <Label>变量（逗号分隔）</Label>
              <Input value={templateForm.variables} onChange={e => setTemplateForm(p => ({ ...p, variables: e.target.value }))} placeholder="buyer_name, order_id, product_name" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTemplateDialog(false)}>取消</Button>
            <Button onClick={handleSaveTemplate} disabled={saveTemplateMut.isPending || !templateForm.name || !templateForm.body}>
              {saveTemplateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
              保存模板
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
