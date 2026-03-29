# 领星API - SP关键词报表 & SP广告位报告

## 1. SP关键词报表 (投放对象分析)

**路径**: `/pb/openapi/newad/spKeywordReports`

**请求参数**:
```json
{
    "sid": 109,
    "report_date": "2022-06-01",
    "show_detail": 1,
    "offset": 0,
    "length": 15
}
```

**返回字段**:

| 字段 | 说明 | 类型 |
|------|------|------|
| keyword_id | 关键词ID | number |
| keyword_text | 关键词文本 | string |
| match_type | 匹配类型(BROAD/EXACT/PHRASE) | string |
| ad_group_id | 广告组ID | number |
| campaign_id | 广告活动ID | number |
| profile_id | 亚马逊店铺数字ID | number |
| report_date | 报表日期 | string |
| impressions | 展示量 | number |
| clicks | 点击量 | number |
| cost | 花费 | number |
| orders | 订单数 | number |
| sales | 销售额 | number |
| units | 销量 | number |
| same_orders | 直接成交订单数 | number |
| same_sales | 直接成交销售额 | number |
| same_units | 直接成交销量 | number |
| *_1d/7d/14d/30d | show_detail=1时返回多归因窗口数据 | number |

## 2. SP广告位报告

**路径**: `/pb/openapi/newad/campaignPlacementReports`

**请求参数**:
```json
{
    "sid": 109,
    "report_date": "2022-06-01",
    "show_detail": 1,
    "offset": 0,
    "length": 15
}
```

**返回字段**:

| 字段 | 说明 | 类型 |
|------|------|------|
| placement_type | 广告位类型 | string |
| campaign_id | 广告活动ID | number |
| profile_id | 亚马逊店铺数字ID | number |
| report_date | 报表日期 | string |
| impressions | 展示量 | number |
| clicks | 点击量 | number |
| cost | 花费 | number |
| orders | 订单数 | number |
| sales | 销售额 | number |
| units | 销量 | number |
| same_orders | 直接成交订单数 | number |
| same_sales | 直接成交销售额 | number |
| same_units | 直接成交销量 | number |
| *_1d/7d/14d/30d | show_detail=1时返回多归因窗口数据 | number |

**placement_type 可能的值**:
- `TOP OF SEARCH ON-AMAZON` - 搜索结果顶部
- `REST OF SEARCH` - 搜索结果其余位置
- `PRODUCT PAGES` - 商品详情页
