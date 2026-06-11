# 领星ERP开放API参考索引

> 本文件为精简版索引，从489个API文档中提取。完整文档备份在 `/home/ubuntu/lingxing-api-docs-backup/`

- **API基础URL**: `https://openapi.lingxing.com`
- **文档地址**: `https://apidoc.lingxing.com`（访问密钥: hTpAZDmc6D）
- **总API数**: 480 个接口，32 个模块

---

## 一、本项目使用的核心API

### 利润分析

#### `POST` /bd/profit/statistics/open/asin/list

**查询利润统计-ASIN** — 利润统计-ASIN

频率限制: 10 次/秒

**请求参数:**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| offset | int | 否 | 分页偏移量 |
| length | int | 否 | 分页长度，上限10000 |
| mids | array | 否 | 站点id |
| sids | array | 否 | 店铺id ，对应[查询亚马逊店铺列表](docs/BasicData/SellerLists)接口对应字段【sid】 |
| startDate | string | 是 | 开始时间，双闭区间【开始结束时间间隔最长不能跨度7天】 |
| endDate | string | 是 | 结束时间，双闭区间【开始结束时间间隔最长不能跨度7天】 |
| searchField | string | 否 | 搜索值类型：asin |
| searchValue | array | 否 | 搜索值 |
| currencyCode | string | 否 | 币种code |

---

#### `POST` /bd/profit/statistics/open/msku/list

**查询利润统计-MSKU** — 利润统计-MSKU

频率限制: 10 次/秒

**请求参数:**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| offset | int | 否 | 分页偏移量 |
| length | int | 否 | 分页长度，上限10000 |
| mids | array | 否 | 站点id |
| sids | array | 否 | 店铺id ，对应[查询亚马逊店铺列表](docs/BasicData/SellerLists)接口对应字段【sid】 |
| startDate | string | 是 | 开始时间，双闭区间【开始结束时间间隔最长不能跨度7天】 |
| endDate | string | 是 | 结束时间，双闭区间【开始结束时间间隔最长不能跨度7天】 |
| searchField | string | 否 | 搜索值类型：msku |
| searchValue | array | 否 | 搜索值 |
| currencyCode | string | 否 | 币种code |

---

#### `POST` /bd/profit/report/open/report/asin/list

**查询利润报表-ASIN** — 利润报表-ASIN

频率限制: 10 次/秒

**请求参数:**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| offset | int | 否 | 分页偏移量 |
| length | int | 否 | 分页长度，上限10000 |
| mids | array | 否 | 站点id |
| sids | array | 否 | 店铺id ，对应[查询亚马逊店铺列表](docs/BasicData/SellerLists)接口对应字段【sid】 |
| monthlyQuery | boolean | 否 | 是否按月查询： false 按天【默认值】 true 按月 |
| startDate | string | 是 | 开始时间【结算时间，双闭区间】 按天：开始结束时间间隔最长不能跨度 31 天，格式：Y-m-d 按月：开始结束时间年月相同，格式：Y-m |
| endDate | string | 是 | 结束时间【结算时间，双闭区间】 按天：开始结束时间间隔最长不能跨度 31 天，格式：Y-m-d 按月：开始结束时间年月相同，格式：Y-m |
| searchField | string | 否 | 搜索值类型，ASIN |
| searchValue | array | 否 | 搜索的值 |
| currencyCode | string | 否 | 币种code |
| summaryEnabled | boolean | 否 | 是否按asin汇总返回： false 默认值  true |
| orderStatus | string | 否 | 交易状态 Deferred 已推迟 Disbursed 已发放【默认】 DisbursedAndPreSettled 已发放（含预结算） All 全部 |

---

#### `POST` /bd/profit/report/open/report/msku/list

**查询利润报表-MSKU** — 利润报表-MSKU（SKU级利润分析核心接口）

频率限制: 10 次/秒

**请求参数:**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| offset | int | 否 | 分页偏移量 |
| length | int | 否 | 分页长度，上限10000 |
| mids | array | 否 | 站点id |
| sids | array | 否 | 店铺id ，对应[查询亚马逊店铺列表](docs/BasicData/SellerLists)接口对应字段【sid】 |
| monthlyQuery | boolean | 否 | 是否按月查询： false 按天【默认值】 true 按月 |
| startDate | string | 是 | 开始时间【结算时间，双闭区间】 按天：开始结束时间间隔最长不能跨度 31 天，格式：Y-m-d 按月：开始结束时间年月相同，格式：Y-m |
| endDate | string | 是 | 结束时间【结算时间，双闭区间】 按天：开始结束时间间隔最长不能跨度 31 天，格式：Y-m-d 按月：开始结束时间年月相同，格式：Y-m |
| searchField | string | 否 | 搜索值类型，seller_sku |
| searchValue | array | 否 | 搜索的值 |
| currencyCode | string | 否 | 币种code【默认原币种】 |
| summaryEnabled | boolean | 否 | 是否按msku汇总返回： false 默认值  true |
| orderStatus | string | 否 | 交易状态 Deferred 已推迟 Disbursed 已发放【默认】 DisbursedAndPreSettled 已发放（含预结算） All 全部（不包含已发放预结算数据） |

---

#### `POST` /bd/profit/report/open/report/parent/asin/list

**查询利润报表-父ASIN** — 利润报表-父ASIN

频率限制: 10 次/秒

**请求参数:**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| offset | int | 否 | 分页偏移量 |
| length | int | 否 | 分页长度，上限10000 |
| mids | array | 否 | 站点id |
| sids | array | 否 | 店铺id ，对应[查询亚马逊店铺列表](docs/BasicData/SellerLists)接口对应字段【sid】 |
| monthlyQuery | boolean | 否 | 是否按月查询： false 按天【默认值】 true 按月 |
| startDate | string | 是 | 开始时间【结算时间，双闭区间】 按天：开始结束时间间隔最长不能跨度 31 天，格式：Y-m-d 按月：开始结束时间年月相同，格式：Y-m |
| endDate | string | 是 | 结束时间【结算时间，双闭区间】 按天：开始结束时间间隔最长不能跨度 31 天，格式：Y-m-d 按月：开始结束时间年月相同，格式：Y-m |
| searchField | string | 否 | 搜索值类型，parent_asin |
| searchValue | array | 否 | 搜索的值 |
| currencyCode | string | 否 | 币种code |
| summaryEnabled | boolean | 否 | 是否按父asin汇总返回： false 默认值  true |
| orderStatus | string | 否 | 交易状态 Deferred 已推迟 Disbursed 已发放【默认】 DisbursedAndPreSettled 已发放（含预结算） All 全部 |

---

### 库存管理

#### `POST` /erp/sc/routing/fba/fbaStock/fbaList

**查询FBA库存列表** — FBA库存列表

频率限制: 3 次/秒

**请求参数:**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| sid | string | 是 | 店铺id，多个使用英文逗号分隔 ，对应[查询亚马逊店铺列表](docs/BasicData/SellerLists)接口对应字段【sid】 |
| offset | int | 否 | 分页偏移量，默认0 |
| length | int | 否 | 分页长度，默认15 |

---

### 广告数据

#### `POST` /pb/openapi/newad/sdCampaigns

**SD广告活动** — SD广告活动

频率限制: 10 次/秒

**请求参数:**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| sid | int | 是 | 店铺id ，对应[查询亚马逊店铺列表](docs/BasicData/SellerLists)接口对应字段【sid】 |
| profile_id | int | 是 | VC广告店铺profile_id，对应[查询广告账号列表](docs/newAd/baseData/dspAccountList)接口对应字段【profile_id】，sid跟profile_id其中 |
| state | string | 否 | 状态：【不传默认为所有】 enabled paused archived |
| offset | int | 否 | 分页偏移量，默认0 |
| length | int | 否 | 分页长度，默认15 |
| next_token | string | 否 | 分页游标，上次分页结果中的next_token (第一次分页无需填写，当next_token 和 offset同时存在时以next_token为主 |

---

#### `POST` /pb/openapi/newad/spKeywords

**SP关键词** — SP关键词

频率限制: 10 次/秒

**请求参数:**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| sid | int | 是 | 店铺id ，对应[查询亚马逊店铺列表](docs/BasicData/SellerLists)接口对应字段【sid】 |
| profile_id | int | 是 | VC广告店铺profile_id，对应[查询广告账号列表](docs/newAd/baseData/dspAccountList)接口对应字段【profile_id】，sid跟profile_id其中 |
| state | string | 否 | 状态：【不传默认为所有】 enabled paused archived |
| offset | int | 否 | 分页偏移量，默认0 |
| length | int | 否 | 分页长度，默认15 |
| next_token | string | 否 | 分页游标，上次分页结果中的next_token (第一次分页无需填写，当next_token 和 offset同时存在时以next_token为主 |

---

#### `POST` /pb/openapi/newad/spTargets

**SP商品定位** — SP投放目标

频率限制: 10 次/秒

**请求参数:**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| sid | int | 是 | 店铺id ，对应[查询亚马逊店铺列表](docs/BasicData/SellerLists)接口对应字段【sid】 |
| profile_id | int | 是 | VC广告店铺profile_id，对应[查询广告账号列表](docs/newAd/baseData/dspAccountList)接口对应字段【profile_id】，sid跟profile_id其中 |
| state | string | 否 | 状态：【不传默认为所有】 enabled paused archived |
| offset | int | 否 | 分页偏移量，默认0 |
| length | int | 否 | 分页长度，默认15 |
| next_token | string | 否 | 分页游标，上次分页结果中的next_token (第一次分页无需填写，当next_token 和 offset同时存在时以next_token为主 |

---

#### `POST` /pb/openapi/newad/spCampaigns

**SP广告活动** — SP广告活动

频率限制: 10 次/秒

**请求参数:**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| sid | int | 是 | 店铺id ，对应[查询亚马逊店铺列表](docs/BasicData/SellerLists)接口对应字段【sid】 |
| profile_id | int | 是 | VC广告店铺profile_id，对应[查询广告账号列表](docs/newAd/baseData/dspAccountList)接口对应字段【profile_id】，sid跟profile_id其中 |
| state | string | 否 | 状态：【不传默认为所有】 enabled paused archived |
| offset | int | 否 | 分页偏移量，默认0 |
| length | int | 否 | 分页长度，默认15 |
| next_token | string | 否 | 分页游标，上次分页结果中的next_token (第一次分页无需填写，当next_token 和 offset同时存在时以next_token为主 |

---

#### `POST` /pb/openapi/newad/spAdGroups

**SP广告组** — SP广告组

频率限制: 10 次/秒

**请求参数:**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| sid | int | 是 | 店铺id ，对应[查询亚马逊店铺列表](docs/BasicData/SellerLists)接口对应字段【sid】 |
| profile_id | int | 是 | VC广告店铺profile_id，对应[查询广告账号列表](docs/newAd/baseData/dspAccountList)接口对应字段【profile_id】，sid跟profile_id其中 |
| state | string | 否 | 状态：【不传默认为所有】 enabled paused archived |
| offset | int | 否 | 分页偏移量，默认0 |
| length | int | 否 | 分页长度，默认15 |
| next_token | string | 否 | 分页游标，上次分页结果中的next_token (第一次分页无需填写，当next_token 和 offset同时存在时以next_token为主 |

---

### 基础数据

#### `GET` /erp/sc/data/seller/lists

**查询亚马逊店铺列表** — 亚马逊店铺列表

频率限制: 1 次/秒

---

## 二、利润报表-MSKU 响应字段详解（实测确认）

以下字段来自 `/bd/profit/report/open/report/msku/list` 接口的实际返回数据，每条记录包含212个字段。

### 标识字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `msku` | string | MSKU编码（亚马逊商家SKU） |
| `localSku` | string | 本地SKU编码 |
| `localName` | string | 本地产品名称（中文） |
| `itemName` | string | 产品标题（英文，Amazon上的标题） |
| `asin` | string | ASIN编码 |
| `parentAsin` | string | 父ASIN编码 |
| `smallImageUrl` | string | 产品小图URL |
| `storeName` | string | 店铺名称 |
| `sid` | number | 店铺ID |
| `brandName` | string | 品牌名 |
| `categoryName` | string | 类目名 |
| `country` | string | 国家 |
| `countryCode` | string | 国家代码 |
| `currencyCode` | string | 币种代码 |
| `currencyIcon` | string | 币种符号 |

### 销售数据

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `totalFbaAndFbmAmount` | number | FBA+FBM总销售额（核心收入字段） |
| `totalFbaAndFbmQuantity` | number | FBA+FBM总销量 |
| `totalSalesAmount` | number | 总销售额 |
| `totalSalesQuantity` | number | 总销量 |
| `fbaSaleAmount` | number | FBA销售额 |
| `fbaSalesQuantity` | number | FBA销量 |
| `fbmSaleAmount` | number | FBM销售额 |
| `fbmSalesQuantity` | number | FBM销量 |

### 利润数据

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `grossProfit` | number | 毛利润 |
| `grossRate` | number | 毛利率 |
| `grossProfitIncome` | number | 毛利收入 |
| `grossProfitTax` | number | 毛利税 |
| `platformIncome` | number | 平台收入 |
| `platformExpense` | number | 平台支出 |
| `platformFee` | number | 平台费（佣金） |
| `totalCost` | number | 总成本 |
| `roi` | number | 投资回报率 |

### FBA费用

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `totalFbaDeliveryFee` | number | FBA发货费合计 |
| `fbaDeliveryFee` | number | FBA发货费 |
| `mcFbaDeliveryFee` | number | FBA多渠道发货费 |
| `totalStorageFee` | number | FBA仓储费合计 |
| `fbaStorageFee` | number | 月度仓储费 |
| `longTermStorageFee` | number | 长期仓储费 |

### 广告数据

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `totalAdsCost` | number | 广告费合计 |
| `adsSpCost` | number | SP广告费 |
| `adsSbCost` | number | SB广告费 |
| `adsSbvCost` | number | SBV广告费 |
| `adsSdCost` | number | SD广告费 |
| `totalAdsSales` | number | 广告销售额 |
| `totalAdsSalesQuantity` | number | 广告销量 |

### 采购成本

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `cgPriceTotal` | number | 采购成本（含税） |
| `cgPriceAbsTotal` | number | 采购成本（绝对值） |
| `cgUnitPrice` | number | 采购单价 |
| `cgTransportCostsTotal` | number | 头程运费 |
| `cgOtherCostsTotal` | number | 其他采购成本 |

### 退款退货

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `totalSalesRefunds` | number | 收入退款额 |
| `refundsQuantity` | number | 退款量 |
| `refundsRate` | number | 退款率 |
| `fbaReturnsQuantity` | number | 退货量 |
| `fbaReturnsQuantityRate` | number | 退货率 |

### 推广费用

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `promotionFee` | number | 推广费 |
| `sharedLdFee` | number | 秒杀费 |
| `sharedCouponFee` | number | 优惠券费 |
| `sharedVineFee` | number | Vine费 |
| `sharedSubscriptionFee` | number | 订阅费 |

## 三、全部API概览（按模块分类）

### FBA货件（STA）（45个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 上传货件跟踪号 | `/amzStaServer/openapi/inbound-shipment/updateShipmentTrack` | POST |
| 保存装箱信息 | `N/A` | POST |
| 修改货件实际状态 | `/erp/sc/routing/storage/shipment/updateShipmentActualStatus` | POST |
| 修改货件装箱信息 | `/amzStaServer/openapi/inbound-packing/updateShipmentPacking` | POST |
| 创建AWD入库任务 | `/amzStaServer/openapi/awd/inbound-plan/createInboundPlan` | POST |
| 创建STA任务 | `/amzStaServer/openapi/inbound-plan/createInboundPlan` | POST |
| 取消AWD入库任务 | `/amzStaServer/openapi/awd/inbound-plan/cancel` | POST |
| 取消STA任务 | `/amzStaServer/openapi/inbound-plan/cancelInboundPlan` | POST |
| 同步STA任务到ERP | `/amzStaServer/openapi/inbound-plan/gatherInboundPlan` | POST |
| 同步亚马逊货件到ERP | `/erp/sc/routing/fba/shipment/syncShipment` | POST |
| 地址簿-发货地址修改 | `/erp/sc/routing/fba/shipment/updateShipFromAddress` | POST |
| 地址簿-发货地址列表 | `/erp/sc/routing/fba/shipment/shipFromAddressList` | POST |
| 地址簿-发货地址创建 | `/erp/sc/routing/fba/shipment/createShipFromAddress` | POST |
| 地址簿-配送地址详情 | `/basicOpen/openapi/fbaShipment/shoppingAddress` | POST |
| 打印AWD入库货件箱子标签 | `/amzStaServer/openapi/awd/inbound-shipment/uploadPacking` | POST |
| 提交装箱信息 | `/amzStaServer/openapi/inbound-packing/setPackingInformation` | POST |
| 提交货件配送服务 | `/amzStaServer/openapi/inbound-shipment/setDeliveryService` | POST |
| 提交送达时间 | `/amzStaServer/openapi/inbound-shipment/commitStaDeliverTime` | POST |
| 更新AWD入库任务 | `/amzStaServer/openapi/awd/inbound-plan/updateInboundPlan` | POST |
| 更新AWD货件跟踪编号 | `/amzStaServer/openapi/awd/inbound-shipment/updateShipmentInfo` | POST |
| 查询AWD入库任务列表 | `/amzStaServer/openapi/awd/inbound-plan/page` | POST |
| 查询AWD入库任务详情 | `/amzStaServer/openapi/awd/inbound-plan/detail` | POST |
| 查询AWD入库货件详情 | `/amzStaServer/openapi/awd/inbound-shipment/detail` | POST |
| 查询FBA到货接收明细 | `/erp/sc/data/fba_report/receivedInventory` | POST |
| 查询FBA商品信息列表（旧） | `/erp/sc/routing/fba/shipment/getFbaProductList` | POST |
| 查询FBA货件商品FNSKU标签 | `/erp/sc/storage/shipment/printFnskuLabels` | POST |
| 查询FBA货件箱子、卡板标签 | `/erp/sc/storage/shipment/printFbaLabels` | POST |
| 查询STA任务列表 | `/amzStaServer/openapi/inbound-plan/page` | POST |
| 查询STA任务包装组装箱信息 | `/amzStaServer/openapi/inbound-plan/listInboundPlanGroupPacking` | POST |
| 查询STA任务详情 | `/amzStaServer/openapi/inbound-plan/detail` | POST |
| 查询包装组 | `/amzStaServer/openapi/inbound-packing/listPackingGroupItems` | POST |
| 查询可选送达时间 | `/amzStaServer/openapi/inbound-shipment/getDeliveryDateList` | POST |
| 查询异步任务状态 | `/amzStaServer/openapi/task-plan/operate` | POST |
| 查询承运方式 | `/amzStaServer/openapi/inbound-shipment/getTransportList` | POST |
| 查询货件列表 | `/erp/sc/data/fba_report/shipmentList` | POST |
| 查询货件方案 | `/amzStaServer/openapi/inbound-shipment/shipmentPreView` | POST |
| 查询货件方案的装箱信息 | `/amzStaServer/openapi/inbound-packing/getInboundPackingBoxInfo` | POST |
| 查询货件装箱信息 | `/amzStaServer/openapi/inbound-shipment/listShipmentBoxes` | POST |
| 查询货件装箱信息（旧） | `/erp/sc/routing/fba/shipment/boxInfo` | POST |
| 查询货件详情 | `/amzStaServer/openapi/inbound-shipment/shipmentDetailList` | POST |
| 生成可选送达时间 | `/amzStaServer/openapi/inbound-shipment/generateDeliveryDateList` | POST |
| 生成承运方式 | `/amzStaServer/openapi/inbound-shipment/generateTransportList` | POST |
| 生成货件方案 | `/amzStaServer/openapi/inbound-shipment/generatePlacementOptions` | POST |
| 确认AWD入库任务 | `/amzStaServer/openapi/awd/inbound-plan/confirmInboundPlan` | POST |
| 确认货件方案 | `/amzStaServer/openapi/inbound-shipment/confirmPlacementOption` | POST |

### Listing（13个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| FBA费差异-异常订单-MSKU | `/basicOpen/openapi/sale/fbaFeeDifference/msku/list` | POST |
| FBA费差异-异常订单-订单 | `/basicOpen/openapi/sale/fbaFeeDifference/order/list` | POST |
| 修改B2B价格 | `/basicOpen/b2bPrice/modifyPrice` | POST |
| 删除Listing标签 | `/basicOpen/globalTag/listing/removeTag` | POST |
| 批量修改Listing价格 | `/erp/sc/listing/ProductPricing/pricingSubmit` | POST |
| 批量分配Listing负责人 | `/listing/listing/open/api/asin/updatePrincipal` | POST |
| 批量添加/编辑Listing配对 | `/erp/sc/storage/product/link` | POST |
| 批量获取Listing费用 | `/listing/listing/open/api/listing/getPrices` | POST |
| 查询Listing操作日志列表 | `/basicOpen/listingManage/listingOperateLog/pageList` | POST |
| 查询Listing标签列表 | `/basicOpen/globalTag/listing/page/list` | POST |
| 查询Listing标记标签列表 | `/basicOpen/listingManage/queryListingRelationTagList` | POST |
| 查询亚马逊Listing | `/erp/sc/data/mws/listing` | POST |
| 添加Listing标签 | `/basicOpen/globalTag/listing/addTag` | POST |

### VC（9个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| VC发货单-确认发货 | `/basicOpen/openapi/getInvoice/invoice/batchSendGoods` | POST |
| VC订单-打印标签【DF】 | `/basicOpen/platformOrder/vcOrderDf/getShippingLabel` | POST |
| VC订单-确认发货【DF】 | `/basicOpen/platformOrder/vcOrderDf/confirmShipment` | POST |
| VC订单-请求标签【DF】 | `/basicOpen/platformOrder/vcOrderDf/submitShippingLabel` | POST |
| 查询VC-Listing列表 | `/basicOpen/listingManage/vcListing/pageList` | POST |
| 查询VC店铺列表 | `/basicOpen/platformAuth/vcSeller/pageList` | POST |
| 查询VC订单列表 | `/basicOpen/platformOrder/vcOrder/pageList` | POST |
| 查询VC订单详情【DF】 | `/basicOpen/platformOrder/vcOrderDf/detail` | POST |
| 查询VC订单详情【PO】 | `/basicOpen/platformOrder/vcOrderPo/detail` | POST |

### 亚马逊源表数据（20个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 报告导出-创建导出任务 | `/basicOpen/report/create/reportExportTask` | POST |
| 报告导出-查询导出任务结果 | `/basicOpen/report/query/reportExportTask` | POST |
| 查询亚马逊源报表- 盘存记录 | `/basicOpen/openapi/mwsReport/adjustmentList` | POST |
| 查询亚马逊源报表-Amazon Fulfilled Shipments | `/erp/sc/data/mws_report/getAmazonFulfilledShipmentsList` | POST |
| 查询亚马逊源报表-Amazon Fulfilled Shipments V1 | `/erp/sc/data/mws_report_v1/getAmazonFulfilledShipmentsList` | POST |
| 查询亚马逊源报表-FBA可售库存 | `/erp/sc/data/mws_report/getAfnFulfillableQuantity` | POST |
| 查询亚马逊源报表-FBA库存 | `/erp/sc/data/mws_report/manageInventory` | POST |
| 查询亚马逊源报表-FBA换货订单 | `/erp/sc/routing/data/order/fbaExchangeOrderList` | POST |
| 查询亚马逊源报表-FBA订单 | `/erp/sc/data/mws_report/fbaOrders` | POST |
| 查询亚马逊源报表-Inventory Event Detail | `/erp/sc/data/mws_report/getFbaInventoryEventDetailList` | POST |
| 查询亚马逊源报表-Inventory Event Detail V1 | `/erp/sc/data/mws_report_v1/getFbaInventoryEventDetailList` | POST |
| 查询亚马逊源报表-交易明细 | `/erp/sc/data/mws_report/transaction` | POST |
| 查询亚马逊源报表-库龄表 | `/erp/sc/routing/fba/fbaStock/getFbaAgeList` | POST |
| 查询亚马逊源报表-所有订单 | `/erp/sc/data/mws_report/allOrders` | POST |
| 查询亚马逊源报表-每日库存 | `/erp/sc/data/mws_report/dailyInventory` | POST |
| 查询亚马逊源报表-移除订单（新） | `/erp/sc/routing/data/order/removalOrderListNew` | POST |
| 查询亚马逊源报表-移除订单（旧） | `/erp/sc/data/mws_report/removalOrders` | POST |
| 查询亚马逊源报表-移除货件（新） | `/erp/sc/statistic/removalShipment/list` | POST |
| 查询亚马逊源报表-移除货件（旧） | `/erp/sc/data/fba_report/removalLists` | POST |
| 查询亚马逊源报表-预留库存 | `/erp/sc/data/mws_report/reservedInventory` | POST |

### 产品（25个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 上传本地产品图片 | `/erp/sc/routing/storage/product/uploadPictures` | POST |
| 产品启用、禁用 | `/basicOpen/product/productManager/product/operate/batch` | POST |
| 创建UPC编码 | `/listing/publish/api/upc/addCommodityCode` | POST |
| 创建产品标签 | `/label/operation/v1/label/product/create` | POST |
| 删除产品标签 | `/label/operation/v1/label/product/unmarkLabel` | POST |
| 批量查询本地产品详情 | `/erp/sc/routing/data/local_inventory/batchGetProductInfo` | POST |
| 查询UPC编码列表 | `/listing/publish/api/upc/upcList` | POST |
| 查询产品分类列表 | `/erp/sc/routing/data/local_inventory/category` | POST |
| 查询产品品牌列表 | `/erp/sc/data/local_inventory/brand` | POST |
| 查询产品属性列表 | `/erp/sc/routing/storage/attribute/attributeList` | POST |
| 查询产品标签 | `/label/operation/v1/label/product/list` | GET |
| 查询产品辅料列表 | `/erp/sc/routing/data/local_inventory/productAuxList` | POST |
| 查询多属性产品列表 | `/erp/sc/routing/storage/spu/spuList` | POST |
| 查询多属性产品详情 | `/erp/sc/routing/storage/spu/info` | POST |
| 查询捆绑产品关系列表 | `/erp/sc/routing/data/local_inventory/bundledProductList` | POST |
| 查询本地产品列表 | `/erp/sc/routing/data/local_inventory/productList` | POST |
| 查询本地产品详情 | `/erp/sc/routing/data/local_inventory/productInfo` | POST |
| 标记产品标签 | `/label/operation/v1/label/product/mark` | POST |
| 添加/编辑产品分类 | `/erp/sc/routing/storage/category/set` | POST |
| 添加/编辑产品品牌 | `/erp/sc/storage/brand/set` | POST |
| 添加/编辑产品属性 | `/erp/sc/routing/storage/attribute/set` | POST |
| 添加/编辑多属性产品 | `/erp/sc/routing/storage/spu/set` | POST |
| 添加/编辑捆绑产品 | `/erp/sc/routing/storage/product/setBundled` | POST |
| 添加/编辑本地产品 | `/erp/sc/routing/storage/product/set` | POST |
| 添加/编辑辅料 | `/erp/sc/routing/storage/product/setAux` | POST |

### 仓库设置（6个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 启用、禁用仓位 | `/erp/sc/routing/storage/wareHouseBin/switchStatus` | POST |
| 查询仓库列表 | `/erp/sc/data/local_inventory/warehouse` | POST |
| 查询本地仓位列表 | `/erp/sc/routing/data/local_inventory/warehouseBin` | POST |
| 海外仓sku配对 | `/basicOpen/overseaWarehouseSetting/productMatch` | POST |
| 添加/修改仓库 | `/erp/sc/storage/wareHouse/edit` | POST |
| 添加仓位 | `/erp/sc/routing/storage/wareHouseBin/create` | POST |

### 促销管理（13个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 查询优惠券详情+listing+订单(批量) | `/promotionApi/open/promotion/couponAllDetailBatch` | POST |
| 查询会员折扣or价格折扣详情+listing+订单(批量) | `/promotionApi/open/promotion/primeDiscountAllDetailBatch` | POST |
| 查询促销活动列表-优惠券 | `/basicOpen/promotionalActivities/coupon/list` | POST |
| 查询促销活动列表-会员折扣 | `/basicOpen/promotionalActivities/vipDiscount/list` | POST |
| 查询促销活动列表-秒杀 | `/basicOpen/promotionalActivities/secKill/list` | POST |
| 查询促销活动列表-管理促销 | `/basicOpen/promotionalActivities/manage/list` | POST |
| 查询商品折扣列表 | `/basicOpen/promotion/listingList` | POST |
| 查询商品折扣详情-列表-优惠卷 | `/basicOpen/promotion/listingDetailCoupon` | POST |
| 查询商品折扣详情-列表-会员折扣 | `/basicOpen/promotion/listingDetailPrimeDiscount` | POST |
| 查询商品折扣详情-列表-秒杀 | `/basicOpen/promotion/listingDetailSecKill` | POST |
| 查询商品折扣详情-列表-管理促销 | `/basicOpen/promotion/listingDetailManage` | POST |
| 查询秒杀详情+listing+订单(批量) | `/promotionApi/open/promotion/secKillAllDetailBatch` | POST |
| 查询管理促销详情+listing+订单(批量) | `/promotionApi/open/promotion/managementAllDetailBatch` | POST |

### 出入库（25个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 创建加工单 / 拆分单 | `/erp/sc/routing/inventoryReceipt/StorageProcess/addStorageProcessOrder` | POST |
| 创建已完成的SKU调整单 | `/erp/sc/routing/inventoryReceipt/StorageAdjustment/addSkuAdjustmentOrder` | POST |
| 创建已完成的换标调整单 | `/erp/sc/routing/inventoryReceipt/StorageAdjustment/addRebrandAdjustmentOrder` | POST |
| 创建已完成的数量调整单 | `/erp/sc/routing/inventoryReceipt/StorageAdjustment/addAdjustmentOrder` | POST |
| 创建已完成的盘点单 | `/erp/sc/routing/inventoryReceipt/InventoryCheck/addOrder` | POST |
| 创建待收货/已完成的调拨单 | `/erp/sc/routing/inventoryReceipt/StorageAllocation/addAllocationOrder` | POST |
| 删除调拨单 | `/basicOpen/storageAllocationList/delete` | POST |
| 加工单列表 | `/erp/sc/routing/inventoryReceipt/StorageProcess/getOrderLists` | POST |
| 撤销入库单 | `/basicOpen/inboundOrder/inbound/setOrderRevoke` | POST |
| 撤销出库单 | `/basicOpen/outboundOrder/outbound/setOrderRevoke` | POST |
| 撤销调拨单 | `/basicOpen/storageAllocationList/cancel` | POST |
| 查询入库单列表 | `/erp/sc/routing/storage/inbound/getOrders` | POST |
| 查询出库单列表 | `/erp/sc/routing/storage/outbound/getOrders` | POST |
| 查询盘点单列表 | `/erp/sc/routing/inventoryReceipt/InventoryCheck/getOrderList` | POST |
| 查询盘点单详情 | `/erp/sc/routing/inventoryReceipt/InventoryCheck/getOrderDetail` | POST |
| 查询调拨单列表 | `/erp/sc/routing/inventoryReceipt/StorageAllocation/getStorageAllocationList` | POST |
| 查询调整单列表 | `/erp/sc/routing/inventoryReceipt/StorageAdjustment/getStorageAdjustOrderList` | POST |
| 查询销售出库单详情 | `/basicOpen/wmsOrder/getWmsOrdersByOrderNumbers` | POST |
| 添加入库单 | `/erp/sc/routing/storage/storage/orderAdd` | POST |
| 添加出库单 | `/erp/sc/routing/storage/storage/orderAddOut` | POST |
| 获取自定义入库类型 | `/erp/sc/routing/storage/inbound/getCustomTypes` | POST |
| 获取自定义出库类型 | `/erp/sc/routing/storage/outbound/getCustomTypes` | POST |
| 调拨单全部收货 | `/erp/sc/routing/inventoryReceipt/StorageAllocation/receiveAllocationOrder` | POST |
| 调拨单分批收货 | `/erp/sc/routing/inventoryReceipt/StorageAllocation/partlyReceiveAllocationOrder` | POST |
| 调拨单结束到货 | `/erp/sc/routing/inventoryReceipt/StorageAllocation/finishReceiveAllocationOrder` | POST |

### 刊登管理（1个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 查询已有商品信息 | `/listing/publish/openapi/amazon/product/search` | POST |

### 发货（1个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 查询销售出库单列表 | `/erp/sc/routing/wms/order/wmsOrderList` | POST |

### 发货单（15个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| FBA发货单发货 | `/erp/sc/storage/shipment/sendGoods` | POST |
| 作废发货单 | `/basicOpen/openapi/fbaShipment/shipmentSn/invalid` | POST |
| 发货单分配库存 | `/erp/sc/routing/storage/shipment/lockStock` | POST |
| 发货单创建接口结果查询 | `/erp/sc/routing/storage/shipment/searchProcessResult` | POST |
| 发货单释放库存 | `/erp/sc/routing/storage/shipment/releaseStock` | POST |
| 批量查询FBA发货单详情 | `/erp/sc/routing/storage/shipment/getInboundShipmentListMwsDetailList` | POST |
| 更新发货单物流信息 | `/erp/sc/routing/storage/shipment/updateListLogistics` | POST |
| 更新发货单自定义成本 | `/erp/sc/routing/storage/shipment/updateCustomCost` | POST |
| 查询FBA发货单列表 | `/erp/sc/routing/storage/shipment/getInboundShipmentList` | POST |
| 查询FBA发货单详情 | `/erp/sc/routing/storage/shipment/getInboundShipmentListMwsDetail` | POST |
| 生成已发货的发货单 | `/erp/sc/storage/shipment/createSendedOrder` | POST |
| 生成待发货的发货单 | `/erp/sc/routing/storage/shipment/createReadySendOrder` | POST |
| 编辑发货单 | `/erp/sc/routing/storage/shipment/updateInboundShipmentListMws` | POST |
| 获取发货单头程物流-其他费类型 | `/erp/sc/routing/fba/shipment/getHeadLogisticsFeeTypes` | POST |
| 获取发货单头程物流-承运商信息 | `/erp/sc/routing/fba/shipment/getSeaTrackSupplierCarriers` | POST |

### 发货计划（3个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 创建FBA发货计划 | `/erp/sc/routing/storage/shipment/createShipmentPlan` | POST |
| 查询FBA发货计划 | `/erp/sc/data/fba_report/shipmentPlanLists` | POST |
| 编辑FBA发货计划 | `/erp/sc/routing/storage/shipment/updateShipmentPlan` | POST |

### 基础数据（28个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| SB否定关键词 | `/pb/openapi/newad/hsaNegativeKeywords` | POST |
| SB否定商品投放 | `/pb/openapi/newad/hsaNegativeTargets` | POST |
| SB广告创意 | `/pb/openapi/newad/hsaProductAds` | POST |
| SB广告活动 | `/pb/openapi/newad/hsaCampaigns` | POST |
| SB广告的投放 | `/pb/openapi/newad/sbTargeting` | POST |
| SB广告组 | `/pb/openapi/newad/hsaAdGroups` | POST |
| SD否定商品定位 | `/pb/openapi/newad/sdNegativeTargets` | POST |
| SD商品定位 | `/pb/openapi/newad/sdTargets` | POST |
| SD广告商品 | `/pb/openapi/newad/sdProductAds` | POST |
| SD广告活动 | `/pb/openapi/newad/sdCampaigns` | POST |
| SD广告组 | `/pb/openapi/newad/sdAdGroups` | POST |
| SP关键词 | `/pb/openapi/newad/spKeywords` | POST |
| SP否定投放 | `/pb/openapi/newad/spNegativeTargetsOrKeywords` | POST |
| SP商品定位 | `/pb/openapi/newad/spTargets` | POST |
| SP广告商品 | `/pb/openapi/newad/spProductAds` | POST |
| SP广告活动 | `/pb/openapi/newad/spCampaigns` | POST |
| SP广告组 | `/pb/openapi/newad/spAdGroups` | POST |
| 下载附件 | `/erp/sc/routing/common/file/download` | POST |
| 修改我的汇率 | `/basicOpen/settings/exchangeRate/update` | POST |
| 广告组合 | `/pb/openapi/newad/portfolios` | POST |
| 批量修改店铺名称 | `/erp/sc/data/seller/batchEditSellerName` | POST |
| 查询ERP用户信息列表 | `/erp/sc/data/account/lists` | GET |
| 查询亚马逊国家下地区列表 | `/erp/sc/data/worldState/lists` | POST |
| 查询亚马逊市场列表 | `/erp/sc/data/seller/allMarketplace` | GET |
| 查询亚马逊店铺列表 | `/erp/sc/data/seller/lists` | GET |
| 查询亚马逊概念店铺列表 | `/erp/sc/data/seller/conceptLists` | GET |
| 查询广告账号列表 | `/basicOpen/baseData/account/list` | POST |
| 查询汇率 | `/erp/sc/routing/finance/currency/currencyMonth` | POST |

### 客服（17个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 查询RMA管理 | `/basicOpen/customerService/rmaManage/list` | POST |
| 查询买家之声列表 | `/basicOpen/customerService/voiceOfBuyer/list` | POST |
| 查询售后工单列表 | `/pb/mp/returns/workOrder/list` | POST |
| 查询客户列表（新） | `/basicOpen/customerService/crm/customer/index` | POST |
| 查询客户列表（旧） | `/bd/crm/open/api/customer/list` | POST |
| 查询店铺绩效列表 | `/basicOpen/customerService/storeTarget/list` | POST |
| 查询店铺绩效详情 | `/basicOpen/customerService/storeTarget/detail` | POST |
| 查询评价管理-1-3星Feedback列表 | `/erp/sc/cs/feedback/listMws` | POST |
| 查询评价管理-4-5星Feedback列表 | `/erp/sc/cs/feedback/list` | POST |
| 查询评价管理-Review | `/erp/sc/v2/data/mws/reviews` | POST |
| 查询评价管理-Review(新) | `/basicOpen/openapi/service/v3/data/mws/reviews` | POST |
| 查询评价统计-Feedback列表 | `/erp/sc/cs/feedbackReport/lists` | POST |
| 查询评价统计-Feedback每日新增数 | `/erp/sc/cs/feedbackReport/detail` | POST |
| 查询评价统计-Review列表 | `/erp/sc/v2/cs/reviewReport/lists` | GET |
| 查询评价统计-Review每日新增数 | `/erp/sc/cs/reviewReport/detail` | POST |
| 查询邮件列表 | `/erp/sc/data/mail/lists` | POST |
| 查询邮件详情 | `/erp/sc/data/mail/detail` | POST |

### 工具（4个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 关键词列表 | `/erp/sc/routing/tool/toolKeywordRank/getKeywordList` | POST |
| 查询竞品监控列表 | `/basicOpen/tool/competitiveMonitor/list` | POST |
| 查询预警消息列表-商品 | `/basicOpen/settings/warningMessage/goodsList` | POST |
| 查询预警消息列表-库存 | `/basicOpen/settings/warningMessage/inventoryList` | POST |

### 平台订单（10个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 创建亚马逊多渠道订单 | `/order/amzod/api/createOrder` | POST |
| 更新订单备注 | `/basicOpen/platformOrder/scOrder/setRemark` | POST |
| 查询亚马逊多渠道订单列表v2 | `/order/amzod/api/orderList` | POST |
| 查询亚马逊多渠道订单详情-商品信息 | `/order/amzod/api/orderDetails/productInformation` | POST |
| 查询亚马逊多渠道订单详情-物流信息 | `/order/amzod/api/orderDetails/logisticsInformation` | POST |
| 查询亚马逊多渠道订单详情-退货换货信息 | `/order/amzod/api/orderDetails/returnInformation` | POST |
| 查询亚马逊订单列表 | `/erp/sc/data/mws/orders` | POST |
| 查询亚马逊订单详情 | `/erp/sc/data/mws/orderDetail` | POST |
| 查询售后订单列表 | `/erp/sc/routing/amzod/order/afterSaleList` | POST |
| 查询多渠道订单-交易明细 | `/basicOpen/openapi/salesOrder/multi-channel/list/transaction` | POST |

### 广告（52个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| WFS货件暂存 | `/basicOpen/multiplatform/cargo/storage` | POST |
| 创建订单 | `/pb/mp/order/v2/create` | POST |
| 删除暂存货件 | `/basicOpen/multiplatform/deleteCargoStorage` | POST |
| 合并订单 | `/pb/mp/order/v2/mergeOrder` | POST |
| 审核发货 | `/basicOpen/openapi/multiplatform/order/review` | POST |
| 快速出库 | `/pb/mp/order/v2/fastOutbound` | POST |
| 批量添加/编辑多平台配对关系 | `/pb/mp/listing/v2/pairMultiPlatform` | POST |
| 拆分订单 | `/pb/mp/order/v2/splitOrder` | POST |
| 更新订单客服备注 | `/pb/mp/order/setRemark` | POST |
| 查询AliExpress在线商品列表 - 托管模式 | `/basicOpen/multiplatform/aliexpress/list/v2` | POST |
| 查询AliExpress在线商品列表 - 自运营 | `/basicOpen/multiplatform/aliExpress/list` | POST |
| 查询Coupang库存 | `/basicOpen/multiplatform/coupang/stockSearch` | POST |
| 查询FBS库存 | `/basicOpen/multiplatform/fbs/stockSearch` | POST |
| 查询FBT库存 | `/basicOpen/multiplatform/fbt/stockSearch/v2` | POST |
| 查询FULL库存 | `/basicOpen/multiplatform/full/stockSearch` | POST |
| 查询Line在线商品 | `/basicOpen/multiplatform/line/list` | POST |
| 查询Shein在线商品 | `/basicOpen/multiplatform/shein/list` | POST |
| 查询Shopify在线商品-子体数据 | `/basicOpen/multiplatform/shopify/variantList` | POST |
| 查询Temu在线商品 | `/basicOpen/multiplatform/temu/list` | POST |
| 查询Temu库存 | `/basicOpen/multiplatform/fbt/stockSearch` | POST |
| 查询Temu货件 | `/basicOpen/multiplatform/temu/cargo` | POST |
| 查询TikTok在线商品 | `/basicOpen/multiplatform/tiktok/list` | POST |
| 查询WFS库存列表 | `/cepf/warehouse/api/openApi/queryWFSInventionPage` | POST |
| 查询WFS货件列表 | `/cepf/warehouse/api/openApi/queryWFSCargoPage` | POST |
| 查询WFS货件可添加商品列表 | `/basicOpen/multiplatform/cargo/addCargoGoods/list` | POST |
| 查询Walmart在线商品列表 | `/basicOpen/multiplatform/walmart/list` | POST |
| 查询Wayfair库存 | `/basicOpen/multiplatform/wayfair/stockSearch` | POST |
| 查询eBay在线商品列表 | `/basicOpen/multiplatform/ebay/list` | POST |
| 查询利润报表-MSKU(旧版，将于04.30下线) | `/basicOpen/multiplatformFinance/profitReportPageList/msku` | POST |
| 查询利润报表-SKU(旧版，将于04.30下线) | `/basicOpen/multiplatformFinance/profitReportPageList/sku` | POST |
| 查询利润报表-店铺(旧版，将于04.30下线) | `/basicOpen/multiplatformFinance/profitReportPageList/store` | POST |
| 查询利润报表-订单(旧版，将于04.30下线) | `/basicOpen/multiplatformFinance/profitReportPageList/order` | POST |
| 查询可用报告列表 - Walmart Payment | `/cepf/fms/openapi/walmartPayment/queryReport` | POST |
| 查询多平台店铺信息 | `/pb/mp/shop/v2/getSellerList` | POST |
| 查询多平台配对列表 | `/pb/mp/listing/v2/getPairList` | POST |
| 查询多平台销量统计v2 | `/basicOpen/platformStatisticsV2/saleStat/pageList` | POST |
| 查询平台仓发货单列表 | `/cepf/warehouse/api/openApi/queryShippingListPage` | POST |
| 查询平台订单列表 | `/cepfPlatformOrder/open-api/newPlatformOrder/list` | POST |
| 查询报告详情 - Walmart Payment | `/cepf/fms/openapi/walmartPayment/queryPage` | POST |
| 查询结算利润（利润报表）-msku | `/basicOpen/multiplatform/profit/report/msku` | POST |
| 查询结算利润（利润报表）-sku | `/basicOpen/multiplatform/profit/report/sku` | POST |
| 查询结算利润（利润报表）-店铺 | `/basicOpen/multiplatform/profit/report/seller` | POST |
| 查询结算利润（利润报表）-订单 | `/basicOpen/multiplatform/profit/report/order` | POST |
| 查询订单管理订单列表 | `/pb/mp/order/v2/list` | POST |
| 查询退件地址列表 | `/basicOpen/multiplatform/address/returnAddressList` | POST |
| 查询销量统计列表(将于04.30下线) | `/basicOpen/platformStatistics/saleStat/pageList` | POST |
| 标记订单不发货 | `/pb/mp/order/v2/cancelOrder` | POST |
| 编辑/更新自发货订单 | `/pb/mp/order/v2/updateOrder` | POST |
| 编辑订单（新版） | `/pb/mp/order/editOrder` | POST |
| 获取快速出库结果 | `/pb/mp/order/v2/getFastOutboundResult` | POST |
| 订单发货 | `/basicOpen/selfShipmentOrder/deliveryGoods` | POST |
| 预发货 | `/basicOpen/openapi/multiplatform/order/preShipment` | POST |

### 库存&流水（10个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 查询AWD库存列表 | `/basicOpen/openapi/storage/awdWarehouseDetail` | POST |
| 查询FBA库存列表 | `/erp/sc/routing/fba/fbaStock/fbaList` | POST |
| 查询FBA库存列表v2 | `/basicOpen/openapi/storage/fbaWarehouseDetail` | POST |
| 查询仓位库存明细 | `/erp/sc/routing/data/local_inventory/inventoryBinDetails` | POST |
| 查询仓位流水 | `/erp/sc/routing/data/local_inventory/wareHouseBinStatement` | POST |
| 查询仓库库存明细 | `/erp/sc/routing/data/local_inventory/inventoryDetails` | POST |
| 查询库存流水（新） | `/erp/sc/routing/inventoryLog/WareHouseInventory/wareHouseCenterStatement` | POST |
| 查询库存流水（旧） | `/erp/sc/routing/data/local_inventory/wareHouseStatement` | POST |
| 查询批次明细 | `/erp/sc/routing/data/local_inventory/getBatchDetailList` | POST |
| 查询批次流水 | `/erp/sc/routing/data/local_inventory/getBatchStatementList` | POST |

### 报告（35个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| SB关键词-广告位报告 | `/pb/openapi/newad/listHsaKeywordPlacementReport` | POST |
| SB分摊 | `/pb/openapi/newad/sbDivideAsinReports` | POST |
| SB广告位小时数据 | `/pb/openapi/newad/sbAdPlacementHourData` | POST |
| SB广告创意报告 | `/pb/openapi/newad/listHsaProductAdReport` | POST |
| SB广告活动-广告位报告 | `/pb/openapi/newad/hsaCampaignPlacementReports` | POST |
| SB广告活动小时数据 | `/pb/openapi/newad/sbCampaignHourData` | POST |
| SB广告活动报表 | `/pb/openapi/newad/hsaCampaignReports` | POST |
| SB广告的投放报告 | `/pb/openapi/newad/listHsaTargetingReport` | POST |
| SB广告组小时数据 | `/pb/openapi/newad/sbAdGroupHourData` | POST |
| SB广告组报表 | `/pb/openapi/newad/hsaAdGroupReports` | POST |
| SB投放小时数据 | `/pb/openapi/newad/sbTargetHourData` | POST |
| SD匹配的目标报表 | `/pb/openapi/newad/sdMatchTargetReports` | POST |
| SD商品定位报表 | `/pb/openapi/newad/sdTargetReports` | POST |
| SD广告商品报表 | `/pb/openapi/newad/sdProductAdReports` | POST |
| SD广告小时数据 | `/pb/openapi/newad/sdAdvertiseHourData` | POST |
| SD广告活动小时数据 | `/pb/openapi/newad/sdCampaignHourData` | POST |
| SD广告活动报表 | `/pb/openapi/newad/sdCampaignReports` | POST |
| SD广告组小时数据 | `/pb/openapi/newad/sdAdGroupHourData` | POST |
| SD广告组报表 | `/pb/openapi/newad/sdAdGroupReports` | POST |
| SD投放小时数据 | `/pb/openapi/newad/sdTargetHourData` | POST |
| SP关键词报表 | `/pb/openapi/newad/spKeywordReports` | POST |
| SP商品定位报表 | `/pb/openapi/newad/spTargetReports` | POST |
| SP已购买商品报表 | `/pb/openapi/newad/asinReports` | POST |
| SP广告位小时数据 | `/pb/openapi/newad/spAdPlacementHourData` | POST |
| SP广告位报告 | `/pb/openapi/newad/campaignPlacementReports` | POST |
| SP广告商品报表 | `/pb/openapi/newad/spProductAdReports` | POST |
| SP广告小时数据 | `/pb/openapi/newad/spAdvertiseHourData` | POST |
| SP广告活动小时数据 | `/pb/openapi/newad/spCampaignHourData` | POST |
| SP广告活动报表 | `/pb/openapi/newad/spCampaignReports` | POST |
| SP广告组小时数据 | `/pb/openapi/newad/spAdGroupHourData` | POST |
| SP广告组报表 | `/pb/openapi/newad/spAdGroupReports` | POST |
| SP投放小时数据 | `/pb/openapi/newad/spTargetHourData` | POST |
| SP用户搜索词报表 | `/pb/openapi/newad/queryWordReports` | POST |
| 出单时段分析-产品 | `/basicOpen/adReport/productOrderAnalysis/list` | POST |
| 查询DSP报告列表-订单 | `/basicOpen/dspReport/order/list` | POST |

### 报表下载（2个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| ABA搜索词报告-按周维度 | `/pb/openapi/newad/abaReport` | POST |
| 操作日志（新） | `/pb/openapi/newad/apiLogStandard` | POST |

### 授权（2个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 续约接口令牌 | `/api/auth-server/oauth/refresh` | POST |
| 获取接口令牌-access_token | `/api/auth-server/oauth/access-token` | POST |

### 接入指引（1个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 常见问题案例 | `N/A` | POST |

### 收货质检（8个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 创建待收货的收货单 | `/erp/sc/routing/deliveryReceipt/PurchaseReceiptOrder/createReceiptOrder` | POST |
| 待收货退货单快捷入库 | `N/A` | POST |
| 收货单到货 | `/erp/sc/routing/deliveryReceipt/PurchaseReceiptOrder/receive` | POST |
| 收货单快捷入库 | `/erp/sc/routing/deliveryReceipt/PurchaseReceiptOrder/fastReceive` | POST |
| 查询收货单列表 | `/erp/sc/routing/deliveryReceipt/PurchaseReceiptOrder/getOrderList` | POST |
| 查询质检单列表 | `/erp/sc/routing/deliveryReceipt/ReceiptOrderQc/getOrderList` | POST |
| 查询质检单详情 | `/basicOpen/qualityInspectionOrder/detail` | POST |
| 查询销售退货单列表 | `/pb/mp/returns/v2/list` | POST |

### 海外仓（17个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 上传备货单装箱信息 | `/erp/sc/routing/owms/inbound/packing` | POST |
| 创建待发货/待收货/已完成的备货单 | `/erp/sc/routing/owms/inbound/createInbound` | POST |
| 删除备货单 | `/basicOpen/overSeaWarehouse/stockOrder/delete` | POST |
| 备货单分批收货 | `/erp/sc/routing/owms/inbound/batchesReceipt` | POST |
| 备货单结束到货 | `/erp/sc/routing/owms/inbound/completeReceipt` | POST |
| 更新备货单 | `/erp/sc/routing/owms/inbound/updateInbound` | POST |
| 更新备货单物流信息 | `/erp/sc/routing/owms/inbound/updateLogistics` | POST |
| 查询备货单收货记录 | `/erp/sc/routing/owms/inbound/getReceiveGoodRecords` | POST |
| 查询备货单装箱信息 | `/erp/sc/routing/owms/inbound/getPackingData` | GET |
| 查询海外仓备货单列表 | `/erp/sc/routing/owms/inbound/listInbound` | POST |
| 查询海外仓备货单详情 | `/basicOpen/overSeaWarehouse/stockOrder/detail` | POST |
| 查询移除入库单列表 | `/erp/sc/routing/owms/removalInbound/list` | POST |
| 查询系统产品与第三方海外仓产品映射列表 | `/erp/sc/routing/owms/inbound/matchSkuList` | POST |
| 海外仓备货单发货 | `/erp/sc/routing/owms/inbound/sendInbound` | POST |
| 获取备货单号 | `/erp/sc/routing/owms/inbound/listOrderNos` | POST |
| 获取第三方SKU标签PDF文件 | `/erp/sc/routing/owms/inbound/productLabel` | POST |
| 获取第三方箱唛 | `/erp/sc/routing/owms/inbound/packageLabel` | POST |

### 物流（6个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 批量添加头程物流商 | `/erp/sc/routing/tms/FirstVessel/addProviders` | POST |
| 批量添加头程物流方式 | `/erp/sc/routing/tms/FirstVessel/addChannels` | POST |
| 查询头程物流商列表 | `/basicOpen/logistics/headLogisticsProvider/query/list` | POST |
| 查询头程物流渠道列表 | `/erp/sc/data/local_inventory/channelList` | POST |
| 查询已启用的自发货物流方式 | `/erp/sc/routing/wms/WmsLogistics/listUsedLogisticsType` | POST |
| 查询运输方式列表 | `/basicOpen/businessConfig/transportMethod/list` | POST |

### 目标管理（6个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 店铺维度-批量删除目标 | `/bd/goal/management/open/store/batchDelete` | POST |
| 店铺维度-批量新增/更新目标 | `/bd/goal/management/open/store/batchOperate` | POST |
| 店铺维度-批量查询目标 | `/bd/goal/management/open/store/batchSelect` | POST |
| 组织维度-批量删除目标 | `/bd/goal/management/open/user/batchDelete` | POST |
| 组织维度-批量新增/更新目标 | `/bd/goal/management/open/user/batchOperate` | POST |
| 组织维度-批量查询目标 | `/bd/goal/management/open/user/batchSelect` | POST |

### 统计（34个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 创建移除订单 | `/erp/sc/statistic/removalOrder/createAndCommit` | POST |
| 库存报表-FBA-历史报表-汇总-明细 | `/erp/sc/routing/fba/fbaStockReport/getList` | POST |
| 库存报表-FBA-新版-明细 | `/cost/center/openApi/fba/detail/query` | POST |
| 库存报表-FBA-新版-汇总 | `/cost/center/openApi/fba/gather/query` | POST |
| 库存报表-本地仓-历史报表-明细 | `/erp/sc/routing/inventoryLog/WareHouseReport/getLocalWareHouseDetailList` | POST |
| 库存报表-本地仓-历史报表-汇总 | `/erp/sc/routing/inventoryLog/WareHouseReport/getLocalWareHouseSummaryList` | POST |
| 库存报表-本地仓-新报表-明细 | `/inventory/center/openapi/storageReport/local/detail/page` | POST |
| 库存报表-本地仓-新报表-汇总 | `/inventory/center/openapi/storageReport/local/aggregate/list` | POST |
| 库存报表-海外仓-历史报表-明细 | `/erp/sc/routing/inventoryLog/WareHouseReport/getOverSeaDetailList` | POST |
| 库存报表-海外仓-历史报表-汇总 | `/erp/sc/routing/inventoryLog/WareHouseReport/getOverSeaSummaryList` | POST |
| 库存报表-海外仓-新报表-汇总 | `/inventory/center/openapi/storageReport/overseas/aggregate/list` | POST |
| 查询FBA月仓储费 | `/erp/sc/data/fba_report/storageFeeMonth` | POST |
| 查询FBA长期仓储费 | `/erp/sc/data/fba_report/storageFeeLongTerm` | POST |
| 查询asin360小时数据 | `/basicOpen/salesAnalysis/productPerformance/performanceTrendByHour` | POST |
| 查询亚马逊源报表-FBA退货订单 | `/erp/sc/data/mws_report/refundOrders` | POST |
| 查询亚马逊源报表-FBM退货订单 | `/erp/sc/routing/data/order/fbmReturnOrderList` | POST |
| 查询亚马逊赔偿报告列表 | `/basicOpen/openapi/mwsReport/reimbursementList` | POST |
| 查询亚马逊销量统计 | `/erp/sc/data/sales_report/asinDailyLists` | POST |
| 查询产品表现 | `/bd/productPerformance/openApi/asinList` | POST |
| 查询产品表现（旧） | `/erp/sc/data/sales_report/asinList` | POST |
| 查询利润统计-ASIN | `/bd/profit/statistics/open/asin/list` | POST |
| 查询利润统计-MSKU | `/bd/profit/statistics/open/msku/list` | POST |
| 查询利润统计-店铺 | `/bd/profit/statistics/open/seller/list` | POST |
| 查询利润统计-父ASIN | `/bd/profit/statistics/open/parent/asin/list` | POST |
| 查询利润统计（旧）-MSKU | `/erp/sc/routing/finance/ProfitStatis/profitMsku` | POST |
| 查询店铺汇总销量 | `/erp/sc/data/sales_report/sales` | POST |
| 查询订单利润-MSKU | `/basicOpen/finance/mreport/OrderProfit` | POST |
| 查询运营日志 | `/basicOpen/operateManage/operateLog/list` | POST |
| 查询运营日志(新) | `/basicOpen/operateManage/operateLog/list/v2` | POST |
| 查询退款量（旧） | `/erp/sc/routing/finance/Refund/profitMonthRefund` | POST |
| 查询退货分析 | `/basicOpen/salesAnalysis/returnOrder/analysisLists` | POST |
| 查询采购报表列表-产品 | `/basicOpen/report/purchase/product/list` | POST |
| 查询采购报表列表-供应商 | `/basicOpen/report/purchase/supplier/list` | POST |
| 查询采购报表列表-采购员 | `/basicOpen/report/purchase/buyer/list` | POST |

### 自发货管理（4个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 亚马逊订单提交标发 | `/pb/mp/order/submitFulfillment` | POST |
| 查询亚马逊标发结果 | `/pb/mp/order/getFulfillmentResult` | POST |
| 查询亚马逊自发货订单列表 | `/erp/sc/routing/order/Order/getOrderList` | POST |
| 查询亚马逊自发货订单详情 | `/erp/sc/routing/order/Order/getOrderDetail` | POST |

### 补货建议（13个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 单个设置规则-ASIN | `/erp/sc/routing/fbaSug/asin/setConfig` | POST |
| 单个设置规则-MSKU | `/erp/sc/routing/fbaSug/msku/setConfig` | POST |
| 批量设置规则-ASIN | `/erp/sc/routing/fbaSug/asin/setConfigs` | POST |
| 批量设置规则-MSKU | `/erp/sc/routing/fbaSug/msku/setConfigs` | POST |
| 查询建议信息-ASIN | `/erp/sc/routing/fbaSug/asin/getInfo` | POST |
| 查询建议信息-MSKU | `/erp/sc/routing/fbaSug/msku/getInfo` | POST |
| 查询报表型数据明细-ASIN | `/erp/sc/routing/fbaSug/asin/getSourceList` | POST |
| 查询报表型数据明细-MSKU | `/erp/sc/routing/fbaSug/msku/getSourceList` | POST |
| 查询未来销量预测和库存预测-ASIN | `/erp/sc/routing/fbaSug/asin/getDailySalesInfoFeature` | POST |
| 查询未来销量预测和库存预测-MSKU | `/erp/sc/routing/fbaSug/msku/getDailySalesInfoFeature` | POST |
| 查询补货列表 | `/erp/sc/routing/restocking/analysis/getSummaryList` | POST |
| 查询规则-ASIN | `/erp/sc/routing/fbaSug/asin/getConfig` | POST |
| 查询规则-MSKU | `/erp/sc/routing/fbaSug/msku/getConfig` | POST |

### 补货限制（2个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 查询IPI信息 | `/erp/sc/routing/fbaLimit/restock/getIpiInfo` | POST |
| 查询补货限制列表 | `/basicOpen/openapi/replenishmentRestriction/page/list` | POST |

### 财务（36个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 作废费用单 | `/bd/fee/management/open/feeManagement/otherFee/discard` | POST |
| 创建费用单 | `/bd/fee/management/open/feeManagement/otherFee/create` | POST |
| 删除费用单 | `/bd/fee/management/open/feeManagement/otherFee/delete` | POST |
| 应收报告-列表查询 | `/bd/sp/api/open/monthly/receivable/report/list` | POST |
| 应收报告-详情-列表 | `/bd/sp/api/open/monthly/receivable/report/list/detail` | POST |
| 应收报告-详情-基础信息 | `/bd/sp/api/open/monthly/receivable/report/list/detail/info` | POST |
| 查询FBA成本计价流水 | `/cost/center/api/cost/stream` | POST |
| 查询settlement下载URL | `/bd/sp/api/open/settlement/export/url/get` | POST |
| 查询利润报表 - 订单维度transaction视图 | `/basicOpen/finance/profitReport/order/transcation/list` | POST |
| 查询利润报表-ASIN | `/bd/profit/report/open/report/asin/list` | POST |
| 查询利润报表-MSKU | `/bd/profit/report/open/report/msku/list` | POST |
| 查询利润报表-SKU | `/bd/profit/report/open/report/sku/list` | POST |
| 查询利润报表-店铺 | `/bd/profit/report/open/report/seller/list` | POST |
| 查询利润报表-店铺月度汇总 | `/bd/profit/report/open/report/seller/summary/list` | POST |
| 查询利润报表-父ASIN | `/bd/profit/report/open/report/parent/asin/list` | POST |
| 查询利润报表-订单 | `/bd/profit/report/open/report/order/list` | POST |
| 查询利润报表（旧）-ASIN（父级） | `/erp/sc/routing/finance/ProfitState/profitAsin` | POST |
| 查询利润报表（旧）-MSKU | `/erp/sc/routing/finance/ProfitState/profitMsku` | POST |
| 查询发货结算报告 | `/cost/center/api/settlement/report` | POST |
| 查询广告发票列表 | `/bd/profit/report/open/report/ads/invoice/list` | POST |
| 查询广告发票基本信息 | `/bd/profit/report/open/report/ads/invoice/detail` | POST |
| 查询广告发票活动列表 | `/bd/profit/report/open/report/ads/invoice/campaign/list` | POST |
| 查询库存分类账detail数据 | `/cost/center/ods/detail/query` | POST |
| 查询库存分类账summary数据 | `/cost/center/ods/summary/query` | POST |
| 查询结算中心-交易明细 | `/bd/sp/api/open/settlement/transaction/detail/list` | POST |
| 查询结算中心-结算汇总 | `/bd/sp/api/open/settlement/summary/list` | POST |
| 查询请款单列表 | `/basicOpen/finance/requestFunds/order/list` | POST |
| 查询请款池-其他应付款 | `/basicOpen/finance/requestFundsPool/customFee/list` | POST |
| 查询请款池-其他费用 | `/basicOpen/finance/requestFundsPool/otherFee/list` | POST |
| 查询请款池-物流请款 | `/basicOpen/finance/requestFundsPool/logistics/list` | POST |
| 查询请款池-货款月结 | `/basicOpen/finance/requestFundsPool/inbound/list` | POST |
| 查询请款池-货款现结 | `/basicOpen/finance/requestFundsPool/purchase/list` | POST |
| 查询请款池-货款预付款 | `/basicOpen/finance/requestFundsPool/prepay/list` | POST |
| 查询费用类型列表 | `/bd/fee/management/open/feeManagement/otherFee/type` | POST |
| 立即重算-利润报表数据 | `/bd/profit/report/open/report/settle/compute/manual` | POST |
| 编辑费用单 | `/bd/fee/management/open/feeManagement/otherFee/edit` | POST |

### 采购（17个接口）

| 接口名称 | 路径 | 方法 |
|----------|------|------|
| 作废采购/委外退货单 | `/basicOpen/purchase/cancelPurchaseReturnOrder` | POST |
| 作废采购单 | `/erp/sc/routing/purchase/purchase/cancel` | POST |
| 作废采购计划 | `/basicOpen/purchase/planCancel` | POST |
| 创建已完成的采购变更单 | `/erp/sc/routing/purchase/purchaseChangeOrder/createPurchaseChangeOrder` | POST |
| 创建已完成的采购退货单 | `/erp/sc/routing/purchase/purchase_return_order/createPurchaseReturnOrder` | POST |
| 创建待到货的采购单 | `/erp/sc/routing/purchase/purchase/createPurchaseOrder` | POST |
| 创建待采购的采购计划 | `/erp/sc/routing/data/local_inventory/createPurchasePlan` | POST |
| 查询供应商列表 | `/erp/sc/data/local_inventory/supplier` | POST |
| 查询委外订单列表 | `/erp/sc/routing/purchase/purchaseOutsourceOrder/getOrders` | POST |
| 查询采购单列表 | `/erp/sc/routing/data/local_inventory/purchaseOrderList` | POST |
| 查询采购变更单列表 | `/erp/sc/routing/purchase/purchaseChangeOrder/changeOrderList` | POST |
| 查询采购方列表 | `/erp/sc/routing/data/purchaser/lists` | POST |
| 查询采购退货单列表 | `/erp/sc/routing/purchase/purchase_return_order/getPurchaseReturnOrderList` | POST |
| 添加/修改供应商 | `/erp/sc/routing/storage/supplier/edit` | POST |
| 添加采购单物流信息 | `/erp/sc/routing/purchase/purchase/addLogistics` | POST |
| 编辑采购单备注 | `/basicOpen/purchase/orderModifyRemark` | POST |
| 采购单下单 | `/erp/sc/routing/purchase/purchase/setOrders` | POST |

## 四、鉴权机制说明

### Token获取

1. 使用 `appId` + `appSecret` 调用授权接口获取 `access_token`
2. Token有效期通常为2小时，需要定期刷新
3. 本项目通过 `lingxingAdapter.ts` 中的 `TokenManager` 自动管理

### 请求签名

1. 所有API请求需要携带签名参数
2. 签名算法：使用 `crypto-js` 的 AES 加密（领星使用非标准密钥处理）
3. 签名参数：`app_token` + `timestamp` + 请求参数
4. 本项目通过 `lingxingAdapter.ts` 中的 `generateSign()` 自动处理

### 代理配置

- 领星API需要IP白名单，本项目使用代理 `154.40.32.64:14727`
- 代理通过HTTP CONNECT隧道实现，确保出口IP固定
- 配置存储在数据库 `system_settings` 表（category=lingxing_proxy）

