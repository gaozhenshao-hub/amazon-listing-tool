# 领星利润报表API字段映射参考

## 查询利润报表-ASIN
- **API Path**: `/bd/profit/report/open/report/asin/list`
- **请求参数**: searchField="asin", searchValue=["B0F21JYKNT"]

## 查询利润报表-父ASIN
- **API Path**: `/bd/profit/report/open/report/parent/asin/list`
- **请求参数**: searchField="parent_asin", searchValue=["B09MT9BKGH"]

## 返回数据结构
```
{
  code: 0,
  msg: null,
  data: {
    records: [...],
    total: 29
  }
}
```

## 关键字段映射（data>>records 下）

### 销量相关
| 字段名 | 类型 | 说明 |
|--------|------|------|
| totalSalesQuantity | int | **销量** |
| fbaSalesQuantity | int | FBA销量 |
| fbmSalesQuantity | int | FBM销量 |
| totalFbaAndFbmQuantity | int | fba和fbm销量加总（用于计算占比） |
| totalReshipQuantity | int | 补换货量 |

### 销售额相关
| 字段名 | 类型 | 说明 |
|--------|------|------|
| totalSalesAmount | number | **销售额** |
| totalFbaAndFbmAmount | number | fba和fbm销售额加总 |
| fbaSaleAmount | number | FBA销售额 |
| fbmSaleAmount | number | FBM销售额 |

### 广告相关
| 字段名 | 类型 | 说明 |
|--------|------|------|
| totalAdsCost | number | **广告费** |
| adsSpCost | number | SP广告费 |
| adsSbCost | number | SB广告费 |
| adsSbvCost | number | SBV广告费 |
| adsSdCost | number | SD广告费 |
| totalAdsSales | number | **广告销售额** |
| totalAdsSalesQuantity | int | **广告销量** |

### 利润相关
| 字段名 | 类型 | 说明 |
|--------|------|------|
| grossProfit | number | **毛利润** |
| grossRate | number | **毛利率** |
| grossProfitIncome | number | 毛利润收入 |

### 成本相关
| 字段名 | 类型 | 说明 |
|--------|------|------|
| totalCost | number | **合计成本** |
| cgPriceTotal | number | **采购成本** |
| cgTransportCostsTotal | number | **头程成本** |
| totalFbaDeliveryFee | number | **FBA发货费合计** |
| totalStorageFee | number | **FBA仓储费** |
| platformFee | number | 平台费 |

### 退款/退货相关
| 字段名 | 类型 | 说明 |
|--------|------|------|
| refundsQuantity | int | **退款量** |
| refundsRate | number | **退款率** |
| fbaReturnsQuantity | int | **退货量** |
| fbaReturnsQuantityRate | number | **退货率** |
| totalSalesRefunds | number | **收入退款额** |

### 其他标识字段
| 字段名 | 类型 | 说明 |
|--------|------|------|
| parentAsin | string | 父ASIN |
| asin | string | ASIN |
| postedDateLocale | string | 按天汇总日期 |
| sid | string | 店铺ID |
| sids | string | 店铺ID（多个逗号分隔） |
| countryCode | string | 国家 |
| currencyCode | string | 币种 |
| currencyIcon | string | 币种符号 |

## 请求示例（父ASIN）
```json
{
    "offset": 0,
    "length": 1000,
    "mids": [2],
    "sids": [110],
    "monthlyQuery": false,
    "startDate": "2023-09-21",
    "endDate": "2023-10-20",
    "searchField": "parent_asin",
    "searchValue": ["B09MT9BKGH","B09MT3989Q"],
    "currencyCode": "CNY",
    "summaryEnabled": false,
    "orderStatus": "Disbursed"
}
```

## 注意事项
- startDate/endDate 按天查询最长跨度31天
- orderStatus 默认 "Disbursed"（已发放），可选 "All"（全部）
- data结构是 data.records（数组），不是直接 data（数组）
