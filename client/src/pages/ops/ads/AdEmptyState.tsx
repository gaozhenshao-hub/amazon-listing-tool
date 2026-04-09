import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, ShieldAlert, Info } from "lucide-react";

interface AdEmptyStateProps {
  adType: string;
  featureName: string;
}

export default function AdEmptyState({ adType, featureName }: AdEmptyStateProps) {
  const isSBSD = adType === "SB" || adType === "SD";
  const typeLabel = adType === "SB" ? "品牌推广 (Sponsored Brands)" 
    : adType === "SD" ? "展示型推广 (Sponsored Display)" 
    : "商品推广 (Sponsored Products)";

  if (isSBSD) {
    return (
      <Card className="border-amber-200 bg-amber-50/50">
        <CardContent className="py-8">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
              <ShieldAlert className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="text-lg font-semibold text-amber-900">
              {typeLabel} 暂无{featureName}数据
            </h3>
            <div className="text-sm text-amber-700 max-w-md space-y-2">
              <p>可能的原因：</p>
              <ul className="text-left list-disc list-inside space-y-1">
                <li>当前店铺尚未开通 {adType} 广告权限</li>
                <li>所选日期范围内没有 {adType} 广告投放记录</li>
                <li>领星ERP中 {adType} 数据授权尚未完成</li>
                <li>{adType} 广告活动处于暂停或归档状态</li>
              </ul>
              <div className="mt-3 p-2 bg-amber-100 rounded text-xs">
                <Info className="w-3 h-3 inline mr-1" />
                建议：请在领星ERP后台确认 {adType} 广告数据授权状态，或切换到 SP 类型查看数据
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-gray-200">
      <CardContent className="py-8">
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-600">
            暂无{featureName}数据
          </h3>
          <p className="text-sm text-gray-500 max-w-md">
            当前筛选条件下没有找到{featureName}数据。请尝试更换日期范围或选择其他广告活动。
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
