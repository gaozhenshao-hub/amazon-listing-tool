# 领星ERP 广告小时数据API字段映射

> 所有API返回的 `acos` 是小数形式（如 0.0721 = 7.21%），需要 *100 转换为百分比显示。
> `cvr/acos/cpa/roas` 在无订单时可能为 **null**，前后端必须处理。
> `asin/msku` 在SD广告中可能为 **null**。

## 共有字段（所有13个API都包含）

| 字段 | 类型 | 说明 |
|------|------|------|
| profile_id | number | 广告配置ID |
| campaign_id | number | 广告活动ID |
| report_date | string | 报告日期 "YYYY-MM-DD" |
| hour | number | 小时 0-23 |
| cost | number | 花费 |
| clicks | number | 点击 |
| impressions | number | 曝光 |
| same_orders | number | 同期订单 |
| orders | number | 归因窗口订单 |
| same_sales | number | 同期销售额 |
| sales | number | 归因窗口销售额 |
| units | number | 销售数量 |
| ctr | number/null | 点击率（小数，如 0.375 = 37.5%） |
| cpc | number/null | 每次点击成本 |
| cvr | number/null | 转化率（小数，可能为null） |
| acos | number/null | ACoS（小数，如 0.0721 = 7.21%，可能为null） |
| cpa | number/null | 每次获客成本（可能为null） |
| roas | number/null | ROAS（可能为null） |

## SP广告（5个API）

### 1. SP广告活动小时数据
- **路径**: `/pb/openapi/newad/spCampaignHourData`
- **独有字段**: 无（仅共有字段）

### 2. SP广告小时数据
- **路径**: `/pb/openapi/newad/spAdvertiseHourData`
- **独有字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| ad_id | number | 广告ID |
| asin | string | ASIN |
| group_id | number | 广告组ID |
| targeting_id | number | 投放对象ID |
| targeting | string | 投放关键词/目标 |
| match_type | string | 匹配类型 (EXACT/BROAD/TARGETING_EXPRESSION_PREDEFINED等) |
| msku | string/null | MSKU |

### 3. SP广告位小时数据
- **路径**: `/pb/openapi/newad/spAdPlacementHourData`
- **独有字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| placement | string | 广告位 ("Top of Search on-Amazon", "Detail Page on-Amazon", "Other on-Amazon") |

### 4. SP投放小时数据
- **路径**: `/pb/openapi/newad/spTargetHourData`
- **独有字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| ad_id | number | 广告ID |
| asin | string | ASIN |
| group_id | number | 广告组ID |
| targeting_id | number | 投放对象ID |
| targeting | string | 投放关键词/目标 |
| match_type | string | 匹配类型 |
| msku | string/null | MSKU |

### 5. SP广告组小时数据
- **路径**: `/pb/openapi/newad/spAdGroupHourData`
- **独有字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| group_id | number | 广告组ID |

## SB品牌广告（4个API）

### 6. SB广告活动小时数据
- **路径**: `/pb/openapi/newad/sbCampaignHourData`
- **独有字段**: 无（仅共有字段）

### 7. SB广告组小时数据
- **路径**: `/pb/openapi/newad/sbAdGroupHourData`
- **独有字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| group_id | number | 广告组ID |

### 8. SB投放小时数据
- **路径**: `/pb/openapi/newad/sbTargetHourData`
- **独有字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| group_id | number | 广告组ID |
| targeting_id | number | 投放对象ID |
| targeting | string | 投放关键词/目标 |

### 9. SB广告位小时数据
- **路径**: `/pb/openapi/newad/sbAdPlacementHourData`
- **独有字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| placement | string | 广告位 |

## SD展示广告（4个API）

### 10. SD广告活动小时数据
- **路径**: `/pb/openapi/newad/sdCampaignHourData`
- **独有字段**: 无（仅共有字段）

### 11. SD广告组小时数据
- **路径**: `/pb/openapi/newad/sdAdGroupHourData`
- **独有字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| group_id | number | 广告组ID |

### 12. SD广告小时数据
- **路径**: `/pb/openapi/newad/sdAdvertiseHourData`
- **独有字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| ad_id | number | 广告ID |
| asin | string/null | ASIN（可能为null） |
| group_id | number | 广告组ID |
| targeting_id | number | 投放对象ID |
| targeting | string | 投放目标（可能为空字符串） |
| msku | string/null | MSKU（可能为null） |

### 13. SD投放小时数据
- **路径**: `/pb/openapi/newad/sdTargetHourData`
- **独有字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| ad_id | number | 广告ID |
| asin | string/null | ASIN（可能为null） |
| group_id | number | 广告组ID |
| targeting_id | number | 投放对象ID |
| targeting | string | 投放目标 |
| msku | string/null | MSKU（可能为null） |

## API请求参数（通用）

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| report_date | string | 是 | 报告日期 "YYYY-MM-DD" |
| campaign_id | number | 是 | 广告活动ID |
| offset | number | 否 | 分页偏移 |
| length | number | 否 | 每页数量 |
