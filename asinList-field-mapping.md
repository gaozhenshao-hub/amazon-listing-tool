# /bd/productPerformance/openApi/asinList 字段映射

## 请求参数
```json
{
  "offset": 0,
  "length": 20,
  "sort_field": "volume",
  "sort_type": "desc",
  "search_field": "asin",
  "search_value": ["B085M7NH7K"],
  "mid": 1,
  "sid": [1,109],
  "start_date": "2024-08-01",
  "end_date": "2024-08-07",
  "summary_field": "asin",
  "currency_code": "CNY",
  "is_recently_enum": true,
  "purchase_status": 0
}
```

## 返回字段映射 → productWeeklyOps

| API字段 | 含义 | DB字段 |
|---------|------|--------|
| volume | 销量 | salesQty |
| order_items | 订单量 | orderQty |
| amount | 销售额 | salesAmount |
| gross_profit | 毛利润 | orderProfit |
| gross_margin | 毛利率 | orderProfitMargin |
| sessions_total | Session总数 | sessionTotal |
| cvr | 总转化率 | totalCvr |
| ad_cvr | 广告转化率 | adCvr |
| ad_order_quantity | 广告订单数 | adOrders |
| ad_direct_order_quantity | 广告直接订单数 | (参考) |
| clicks | 广告点击数 | adClicks |
| impressions | 广告展示数 | adImpressions |
| ctr | 点击率 | ctr |
| cpc | 单次点击成本 | cpc |
| spend | 广告花费 | adSpend |
| ad_sales_amount | 广告销售额 | adSales (新增) |
| acos | ACOS | acos |
| roas | ROAS | (可选) |
| acoas | ACOaS | (可选) |
| return_rate | 退货率 | returnRate |
| avg_star | 平均评分 | rating |
| reviews_count | 评论数 | reviewCount |
| buy_box_percentage | BuyBox占比 | (可选) |
| volume_chain_ratio | 销量环比 | (用于趋势) |

## 广告费用明细
| API字段 | 含义 |
|---------|------|
| ads_sp_cost | SP广告花费 |
| shared_ads_sb_cost | SB广告花费 |
| shared_ads_sbv_cost | SBV广告花费 |
| ads_sd_cost | SD广告花费 |
| shared_cost_of_advertising | 共享广告费 |

## 库存数据
| API字段 | 含义 |
|---------|------|
| afn_fulfillable_quantity | FBA可售库存 |
| afn_inbound_receiving_quantity | 入库中 |
| afn_inbound_shipped_quantity | 已发货 |
| fbm_quantity | FBM库存 |
| available_days | FBA可售天数 |

## 关键优势
1. **一个接口包含所有数据**：销量、利润、广告、Session、CVR、库存、评论
2. **ACOS已由领星计算**：不需要自己算，直接用 `acos` 字段
3. **支持日期范围查询**：可以按周查询
4. **支持ASIN搜索**：`search_field: "asin"`, `search_value: [...]`
5. **包含环比数据**：`volume_chain_ratio`, `amount_chain_ratio`
