import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Calculator, DollarSign, TrendingUp, Percent } from "lucide-react";
import { useState } from "react";

export default function DevProfitCalculator() {
  const [sellingPrice, setSellingPrice] = useState("29.99");
  const [productCost, setProductCost] = useState("8.00");
  const [fbaFee, setFbaFee] = useState("5.50");
  const [referralRate, setReferralRate] = useState("15");
  const [adSpend, setAdSpend] = useState("3.00");
  const [otherCost, setOtherCost] = useState("1.00");

  const price = parseFloat(sellingPrice) || 0;
  const cost = parseFloat(productCost) || 0;
  const fba = parseFloat(fbaFee) || 0;
  const referral = price * (parseFloat(referralRate) || 0) / 100;
  const ads = parseFloat(adSpend) || 0;
  const other = parseFloat(otherCost) || 0;
  const profit = price - cost - fba - referral - ads - other;
  const margin = price > 0 ? (profit / price * 100) : 0;
  const roi = cost > 0 ? (profit / cost * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">利润计算器</h1>
        <p className="text-muted-foreground text-sm mt-1">快速计算亚马逊产品利润、利润率和ROI</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <Card className="md:col-span-2">
          <CardHeader><CardTitle className="text-base">成本参数</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>售价 ($)</Label>
              <Input type="number" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>产品成本 ($)</Label>
              <Input type="number" value={productCost} onChange={(e) => setProductCost(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>FBA费用 ($)</Label>
              <Input type="number" value={fbaFee} onChange={(e) => setFbaFee(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>佣金比例 (%)</Label>
              <Input type="number" value={referralRate} onChange={(e) => setReferralRate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>广告费 ($)</Label>
              <Input type="number" value={adSpend} onChange={(e) => setAdSpend(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>其他费用 ($)</Label>
              <Input type="number" value={otherCost} onChange={(e) => setOtherCost(e.target.value)} />
            </div>
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card className={profit >= 0 ? "border-emerald-200 bg-emerald-50/50" : "border-red-200 bg-red-50/50"}>
            <CardContent className="p-5 text-center">
              <DollarSign className={`h-6 w-6 mx-auto mb-2 ${profit >= 0 ? "text-emerald-500" : "text-red-500"}`} />
              <p className="text-sm text-muted-foreground">单件利润</p>
              <p className={`text-2xl font-bold ${profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>${profit.toFixed(2)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5 text-center">
              <Percent className="h-6 w-6 mx-auto mb-2 text-blue-500" />
              <p className="text-sm text-muted-foreground">利润率</p>
              <p className="text-2xl font-bold text-blue-600">{margin.toFixed(1)}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5 text-center">
              <TrendingUp className="h-6 w-6 mx-auto mb-2 text-purple-500" />
              <p className="text-sm text-muted-foreground">ROI</p>
              <p className="text-2xl font-bold text-purple-600">{roi.toFixed(1)}%</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
