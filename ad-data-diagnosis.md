# 广告数据诊断结果

## 问题1: SP广告报表API调用失败，回退到mock数据

**API**: `/pb/openapi/newad/spProductAdReports`
**错误**: code=102, "参数不合法"
**详情**: `report_date => report_date不能为空`, `sid和profile_id不能同时为null`

**当前代码传参**:
```js
body: {
  start_date: chunk.startDate,  // ❌ 应该是 report_date
  end_date: chunk.endDate,      // ❌ 不存在此参数
  asin: childAsins[0] || parentAsin,
}
```

**正确传参应该是**:
- `report_date`: 必填，日期
- `sid` 或 `profile_id`: 至少一个必填
- 需要逐日查询或按领星文档格式传日期

## 问题2: MSKU利润报表的数据结构

**API**: `/bd/profit/report/open/report/msku/list`
**返回结构**: `data.records[]` (不是 `data[]`)
**当前代码**: `const items = Array.isArray(raw) ? raw : (raw.records || raw.list || [])` — 这个能正确处理

**关键字段**:
- `totalAdsCost`: -35.98 (负数表示花费)
- `adsSpCost`: -35.98
- `totalSalesQuantity`: 0 (这条记录没有销量)
- `seller_sku`: undefined (字段名可能是 `sellerSku` 或其他)
- `asin`: B0FHP8G759
- `parentAsin`: B0FRMRW839

## 问题3: ACOS计算错误

当前代码: `acos = totalAdSpend / totalRevenue * 100`
正确公式: `acos = adSpend / adSales * 100` (广告花费 / 广告销售额)

## 问题4: totalAdsCost是负数

利润报表中 `totalAdsCost` 是负数（-35.98），当前代码用 `Math.abs()` 处理了，但需要确认这是否正确。

## 修复方案

1. 修复 spProductAdReports API 调用参数
2. 从利润报表中提取广告花费（已有 totalAdsCost），不再依赖单独的广告报表
3. 修正 ACOS 计算公式
4. 添加广告销售额字段到数据库
