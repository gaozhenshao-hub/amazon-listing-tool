import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Search, Package, ShoppingBag, AlertCircle, CheckCircle2, Trash2,
} from "lucide-react";

export default function OpsProducts() {
  const [, navigate] = useLocation();
  const { data: products, isLoading, refetch } = trpc.productOps.listProducts.useQuery();
  const createMut = trpc.productOps.createProduct.useMutation({
    onSuccess: () => { refetch(); setShowCreate(false); resetForm(); toast.success("产品创建成功"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.productOps.deleteProduct.useMutation({
    onSuccess: () => { refetch(); toast.success("产品已删除"); },
    onError: (e) => toast.error(e.message),
  });

  const [showCreate, setShowCreate] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [form, setForm] = useState({
    parentAsin: "", title: "", brand: "", category: "", marketplace: "US",
    budgetRevenue: "", budgetProfit: "", budgetAcos: "", notes: "",
  });

  function resetForm() {
    setForm({ parentAsin: "", title: "", brand: "", category: "", marketplace: "US", budgetRevenue: "", budgetProfit: "", budgetAcos: "", notes: "" });
  }

  const filtered = (products || []).filter(p =>
    p.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.parentAsin.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.brand || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const statusColors: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700",
    inactive: "bg-gray-100 text-gray-600",
    discontinued: "bg-red-100 text-red-700",
  };
  const statusLabels: Record<string, string> = {
    active: "在售", inactive: "暂停", discontinued: "停售",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">产品运营总览</h1>
          <p className="text-muted-foreground mt-1">以父ASIN为维度管理产品，查看库存、利润、广告和竞品数据</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="h-4 w-4" /> 添加产品
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜索ASIN、标题或品牌..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50"><ShoppingBag className="h-5 w-5 text-blue-600" /></div>
              <div>
                <p className="text-2xl font-bold">{products?.length || 0}</p>
                <p className="text-sm text-muted-foreground">总产品数</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-50"><CheckCircle2 className="h-5 w-5 text-emerald-600" /></div>
              <div>
                <p className="text-2xl font-bold">{products?.filter(p => p.status === "active").length || 0}</p>
                <p className="text-sm text-muted-foreground">在售产品</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-50"><AlertCircle className="h-5 w-5 text-orange-600" /></div>
              <div>
                <p className="text-2xl font-bold">{products?.reduce((s, p) => s + p.pendingTodoCount, 0) || 0}</p>
                <p className="text-sm text-muted-foreground">待办任务</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Product List */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardContent className="pt-6 h-40" />
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">
              {searchTerm ? "没有找到匹配的产品" : "还没有添加产品，点击右上角\"添加产品\"开始"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(product => (
            <Card
              key={product.id}
              className="cursor-pointer hover:shadow-md transition-shadow group"
              onClick={() => navigate(`/ops/products/${product.id}`)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate">{product.title}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1 font-mono">{product.parentAsin}</p>
                  </div>
                  <Badge variant="secondary" className={statusColors[product.status] || ""}>
                    {statusLabels[product.status] || product.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  {product.brand && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">品牌</span>
                      <span>{product.brand}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">站点</span>
                    <span>{product.marketplace}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">变体数</span>
                    <span>{product.variantCount}</span>
                  </div>
                  {product.pendingTodoCount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">待办任务</span>
                      <Badge variant="destructive" className="text-xs">{product.pendingTodoCount}</Badge>
                    </div>
                  )}
                </div>
                <div className="mt-4 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("确定删除该产品及其所有关联数据？")) {
                        deleteMut.mutate({ id: product.id });
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Product Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>添加新产品</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>父ASIN *</Label>
                <Input
                  placeholder="B0XXXXXXXX"
                  value={form.parentAsin}
                  onChange={e => setForm(f => ({ ...f, parentAsin: e.target.value }))}
                />
              </div>
              <div>
                <Label>站点</Label>
                <Select value={form.marketplace} onValueChange={v => setForm(f => ({ ...f, marketplace: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="US">US</SelectItem>
                    <SelectItem value="UK">UK</SelectItem>
                    <SelectItem value="DE">DE</SelectItem>
                    <SelectItem value="JP">JP</SelectItem>
                    <SelectItem value="CA">CA</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>产品标题 *</Label>
              <Input
                placeholder="输入产品标题"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>品牌</Label>
                <Input
                  placeholder="品牌名称"
                  value={form.brand}
                  onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
                />
              </div>
              <div>
                <Label>类目</Label>
                <Input
                  placeholder="产品类目"
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>预算收入</Label>
                <Input
                  type="number"
                  placeholder="$"
                  value={form.budgetRevenue}
                  onChange={e => setForm(f => ({ ...f, budgetRevenue: e.target.value }))}
                />
              </div>
              <div>
                <Label>预算利润</Label>
                <Input
                  type="number"
                  placeholder="$"
                  value={form.budgetProfit}
                  onChange={e => setForm(f => ({ ...f, budgetProfit: e.target.value }))}
                />
              </div>
              <div>
                <Label>目标ACoS%</Label>
                <Input
                  type="number"
                  placeholder="%"
                  value={form.budgetAcos}
                  onChange={e => setForm(f => ({ ...f, budgetAcos: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>备注</Label>
              <Textarea
                placeholder="产品备注..."
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>取消</Button>
            <Button
              onClick={() => createMut.mutate(form)}
              disabled={!form.parentAsin || !form.title || createMut.isPending}
            >
              {createMut.isPending ? "创建中..." : "创建"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
