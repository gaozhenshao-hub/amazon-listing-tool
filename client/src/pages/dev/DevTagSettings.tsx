import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tags, PlusCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const defaultDimensions = [
  { name: "产品类型", category: "基础属性", examples: ["电子产品", "家居用品", "户外运动"] },
  { name: "价格区间", category: "市场定位", examples: ["低端(<$15)", "中端($15-$50)", "高端(>$50)"] },
  { name: "目标人群", category: "用户画像", examples: ["年轻女性", "户外爱好者", "家庭主妇"] },
  { name: "差异化特征", category: "竞争优势", examples: ["便携性", "多功能", "高颜值"] },
];

export default function DevTagSettings() {
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">标签管理</h1>
          <p className="text-muted-foreground text-sm mt-1">管理产品标签维度，用于AI智能分类</p>
        </div>
        <Button className="gap-2"><PlusCircle className="h-4 w-4" />新增维度</Button>
      </div>
      <div className="grid gap-4">
        {defaultDimensions.map((dim) => (
          <Card key={dim.name}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Tags className="h-4 w-4 text-primary" />
                  <span className="font-medium">{dim.name}</span>
                  <Badge variant="secondary" className="text-xs">{dim.category}</Badge>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {dim.examples.map((e) => (
                  <span key={e} className="text-xs px-2 py-1 rounded-md bg-muted">{e}</span>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
