# 领星 SP用户搜索词报表 API

## 请求

| 属性 | 值 |
|------|------|
| **API Path** | `/pb/openapi/newad/queryWordReports` |
| **请求方式** | POST |

### 请求参数

| 参数名 | 说明 | 必填 |
|--------|------|------|
| sid | 店铺id | 是 |
| report_date | 报表日期 (YYYY-MM-DD) | 是 |
| show_detail | 是否展示完整指标数据，0否 1是 | 否（默认0） |
| target_type | 报表类型，默认 keyword | 否 |
| offset | 分页偏移量，默认0 | 否 |
| length | 分页条数，默认15 | 否 |

### 请求示例

```json
{
    "sid": 109,
    "report_date": "2022-06-01",
    "show_detail": 1,
    "target_type": "keyword",
    "offset": 0,
    "length": 15
}
```

## 返回

### 基础字段（必返回）

| 字段名 | 说明 | 类型 | 示例 |
|--------|------|------|------|
| code | 状态码，0 成功 | int | 0 |
| message | 响应提示 | string | 操作成功 |
| error_details | 错误信息 | array | |
| request_id | 请求链路id | string | 52688b81-2398-4e60-9617-6ty71fcf5b1e |
| response_time | 响应时间 | string | 2023-03-20 10:07:22 |
| total | 总数 | int | 20 |
| data | 响应数据 | array | |
| data>>query | 搜索词 | string | iphone13 pro ケース |
| data>>target_id | 投放id（关键词/商品投放，根据target_type） | number | 257012918513585 |
| data>>match_type | 匹配类型 | string | BROAD |
| data>>target_text | 投放的内容 | string | iphone 13 pro |
| data>>ad_group_id | 广告组id | number | 876493198967 |
| data>>impressions | 展示量 | number | 327 |
| data>>clicks | 点击量 | number | 3 |
| data>>cost | 花费 | number | 150.94 |
| data>>profile_id | 亚马逊店铺数字id | number | 121923590660074 |
| data>>campaign_id | 广告活动id | number | 223897112753433 |
| data>>same_orders | 直接成交订单数 | number | 0 |
| data>>orders | 订单数 | number | 0 |
| data>>same_sales | 直接成交销售额 | number | 0.00 |
| data>>sales | 销售额 | number | 0.00 |
| data>>units | 销量 | number | 0 |
| data>>same_units | 直接成交销量 | number | 0 |
| data>>report_date | 报表日期 | string | 2021-07-15 |

### show_detail=1 额外字段（1d/7d/14d/30d 四个归因窗口）

| 字段名 | 说明 | 类型 |
|--------|------|------|
| data>>same_orders_1d | 直接成交订单数(1d) | number |
| data>>orders_1d | 订单数(1d) | number |
| data>>same_sales_1d | 直接成交销售额(1d) | number |
| data>>sales_1d | 销售额(1d) | number |
| data>>same_orders_7d | 直接成交订单数(7d) | number |
| data>>orders_7d | 订单数(7d) | number |
| data>>same_sales_7d | 直接成交销售额(7d) | number |
| data>>sales_7d | 销售额(7d) | number |
| data>>same_orders_14d | 直接成交订单数(14d) | number |
| data>>orders_14d | 订单数(14d) | number |
| data>>same_sales_14d | 直接成交销售额(14d) | number |
| data>>sales_14d | 销售额(14d) | number |
| data>>same_orders_30d | 直接成交订单数(30d) | number |
| data>>orders_30d | 订单数(30d) | number |
| data>>same_sales_30d | 直接成交销售额(30d) | number |
| data>>sales_30d | 销售额(30d) | number |
| data>>units_1d | 销量(1d) | number |
| data>>units_7d | 销量(7d) | number |
| data>>units_14d | 销量(14d) | number |
| data>>units_30d | 销量(30d) | number |
| data>>same_units_1d | 直接成交销量(1d) | number |
| data>>same_units_7d | 直接成交销量(7d) | number |
| data>>same_units_14d | 直接成交销量(14d) | number |
| data>>same_units_30d | 直接成交销量(30d) | number |

### 返回示例

```json
{
    "code": 0,
    "message": "操作成功",
    "error_details": [],
    "request_id": "52688b81-2398-4e60-9617-6ty71fcf5b1e",
    "response_time": "2023-03-20 10:07:22",
    "total": 20,
    "data": [
        {
            "query": "iphone13 pro ケース",
            "target_id": 257012918513585,
            "match_type": "BROAD",
            "target_text": "iphone 13 pro",
            "ad_group_id": 876493198967,
            "impressions": 327,
            "clicks": 3,
            "cost": 150.94,
            "profile_id": 121923590660074,
            "campaign_id": 223897112753433,
            "same_orders": 0,
            "orders": 0,
            "same_sales": 0.00,
            "sales": 0.00,
            "units": 0,
            "same_units": 0,
            "report_date": "2021-07-15",
            "same_orders_1d": 0,
            "orders_1d": 0,
            "same_sales_1d": 0.00,
            "sales_1d": 0.00,
            "same_orders_7d": 0,
            "orders_7d": 0,
            "same_sales_7d": 0.00,
            "sales_7d": 0.00,
            "same_orders_30d": 0,
            "orders_30d": 0,
            "same_sales_30d": 0.00,
            "sales_30d": 0.00,
            "same_orders_14d": 0,
            "orders_14d": 0,
            "same_sales_14d": 0.00,
            "sales_14d": 0.00,
            "units_1d": 0,
            "units_7d": 0,
            "units_14d": 0,
            "units_30d": 0,
            "same_units_1d": 0,
            "same_units_7d": 0,
            "same_units_14d": 0,
            "same_units_30d": 0
        }
    ]
}
```
