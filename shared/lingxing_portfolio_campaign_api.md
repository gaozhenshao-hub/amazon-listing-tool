# 领星广告组合与广告活动API文档

## 1. 广告组合 /pb/openapi/newad/portfolios

### 请求参数
| 参数名 | 说明 | 必填 | 类型 | 示例 |
|--------|------|------|------|------|
| sid | 店铺ID | 是 | int | 101 |
| profile_id | VC广告店铺profile_id，sid和profile_id其中一个必填 | 是 | int | 123456 |
| offset | 分页偏移量，默认0 | 否 | int | 0 |
| length | 分页长度，默认15 | 否 | int | 15 |
| next_token | 分页游标 | 否 | string | "MTAx" |

### 返回字段
| 字段 | 说明 | 类型 |
|------|------|------|
| portfolio_id | 广告组合ID | number |
| profile_id | 亚马逊店铺数字ID | number |
| name | 名称 | string |
| budget | 预算信息（JSON字符串，null=无预算上限） | string |
| in_budget | 是否在预算范围内（0超出/1在范围内） | number |
| state | 状态（enabled/paused/archived） | string |
| creation_date | 创建时间（时间戳ms） | number |
| last_updated_date | 最后更新时间（时间戳ms） | number |
| serving_status | 投放状态 | string |

## 2. SP广告活动 /pb/openapi/newad/spCampaigns

### 请求参数
| 参数名 | 说明 | 必填 | 类型 | 示例 |
|--------|------|------|------|------|
| sid | 店铺ID | 是 | int | 12 |
| profile_id | sid和profile_id其中一个必填 | 是 | int | 123456 |
| state | 状态过滤（enabled/paused/archived），不传默认所有 | 否 | string | enabled |
| offset | 分页偏移量，默认0 | 否 | int | 0 |
| length | 分页长度，默认15 | 否 | int | 15 |
| next_token | 分页游标 | 否 | string | "MTAx" |

### 返回字段
| 字段 | 说明 | 类型 |
|------|------|------|
| campaign_id | 广告活动ID | number |
| profile_id | 亚马逊店铺数字ID | number |
| name | 广告活动名称 | string |
| campaign_type | 广告活动类型（sponsoredProducts） | string |
| targeting_type | 投放类型（auto/manual） | string |
| premium_bid_adjustment | 溢价报价调整 | number |
| daily_budget | 每日预算 | number |
| start_date | 起始日期 | string |
| end_date | 结束日期 | string |
| creation_date | 创建日期（时间戳ms） | number |
| last_updated_date | 最后更新时间（时间戳ms） | number |
| state | 状态（enabled/paused/archived） | string |
| serving_status | 服务状态（CAMPAIGN_STATUS_ENABLED等） | string |
| bidding | 竞价策略（JSON字符串） | string |
| portfolio_id | 所属广告组合ID | number |
| tags | 标签信息（parent/child） | array |

## 3. SB广告活动 /pb/openapi/newad/hsaCampaigns

### 请求参数
同SP广告活动

### 返回字段
| 字段 | 说明 | 类型 |
|------|------|------|
| campaign_id | 广告活动ID | number |
| profile_id | 亚马逊店铺数字ID | number |
| name | 广告活动名称 | string |
| budget | 预算 | number |
| budget_type | 预算类型（daily） | string |
| start_date | 开始日期 | datetime |
| state | 状态 | string |
| serving_status | 服务状态（running等） | string |
| bid_optimization | 自动竞价 | number |
| creative | 广告创意结构（已废弃） | string |
| landing_page | 广告着陆页（url + pageType） | string |
| bid_multiplier | 自定义竞价调整 | number |
| end_date | 结束日期 | string |
| portfolio_id | 广告组合ID | number |
| creative_type | 创意类型（COLLECTION等） | string |
| tags | 标签信息 | array |

## 4. SD广告活动 /pb/openapi/newad/sdCampaigns

### 请求头
| 标签 | 必填 | 说明 | 类型 | 示例 |
|------|------|------|------|------|
| X-API-VERSION | 是 | 兼容旧版本，值为2时offset为分页偏移量 | int | 2 |

### 请求参数
同SP广告活动

### 返回字段
| 字段 | 说明 | 类型 |
|------|------|------|
| campaign_id | 广告活动ID | number |
| profile_id | 亚马逊店铺数字ID | number |
| name | 广告活动名称 | string |
| tactic | 投放类型（T00020等） | string |
| cost_type | 竞价类型（cpc） | string |
| budget_type | 预算类型（daily） | string |
| budget | 预算 | number |
| start_date | 开始日期 | string |
| end_date | 结束日期 | string |
| creation_date | 创建时间（时间戳ms） | number |
| last_updated_date | 最后更新日期（时间戳ms） | number |
| state | 状态 | string |
| serving_status | 服务状态 | string |
| portfolio_id | 广告组合ID | number |
| tags | 标签信息 | array |
