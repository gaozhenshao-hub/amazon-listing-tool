# 领星API调用全面审计

## 涉及的API端点（共47个唯一路径）

### 一、产品运营数据（productOps.ts - 4661行）
| API路径 | 数据类型 | 领星导出对应 |
|---------|---------|-------------|
| /bd/profit/report/open/report/msku/list | MSKU利润报表 | 利润报表导出 |
| /bd/profit/report/open/report/asin/list | ASIN利润报表 | 利润报表导出 |
| /bd/profit/report/open/report/parent/asin/list | 父ASIN利润报表 | 利润报表导出 |
| /bd/productPerformance/openApi/asinList | ASIN产品列表 | 产品列表导出 |
| /basicOpen/salesAnalysis/productPerformance/performanceTrendByHour | ASIN360小时数据 | ASIN360导出 |
| /erp/sc/data/fba/FbaStockLists | FBA库存 | FBA库存导出 |
| /erp/sc/data/mws/listing | Listing信息 | Listing导出 |
| /ph/openaps/newad/spAdvertiseHourData | SP广告小时数据 | 广告报表导出 |
| /pb/openapi/newad/spProductAdReports | SP产品广告报表 | 广告报表导出 |

### 二、广告分析（adAnalysis.ts - 2927行）
| API路径 | 数据类型 | 领星导出对应 |
|---------|---------|-------------|
| /erp/sc/data/seller/lists | 店铺列表 | 系统设置 |
| /erp/sc/data/mws/listing | Listing信息 | Listing导出 |
| /erp/sp/query/queryUserSearchTerm | 搜索词报告 | 搜索词报告导出 |
| /erp/sp/data/getKeywordsReports | 关键词报告 | 关键词报告导出 |
| /pb/openapi/newad/spCampaigns | SP广告活动 | 广告活动导出 |
| /pb/openapi/newad/spKeywords | SP关键词 | 关键词导出 |
| /pb/openapi/newad/spProductAds | SP产品广告 | 产品广告导出 |
| /pb/openapi/newad/spAdvertiseHourData | SP广告小时数据 | 广告报表导出 |
| /pb/openapi/newad/spCampaignHourData | SP活动小时数据 | 广告报表导出 |
| /pb/openapi/newad/sdCampaigns | SD广告活动 | SD广告导出 |
| /pb/openapi/newad/sdProductAds | SD产品广告 | SD广告导出 |
| /pb/openaps/newad/sbCampaignHourData | SB活动小时数据 | SB广告导出 |
| /pb/openaps/newad/sdCampaignHourData | SD活动小时数据 | SD广告导出 |
| /pb/openaps/newad/spCampaignHourData | SP活动小时数据 | 广告报表导出 |
| /pb/openapi/newad/portfolios | 广告组合 | 广告组合导出 |
| /pb/openapi/newad/queryWordReports | 搜索词报告 | 搜索词报告导出 |

### 三、库存运营（operations.ts - 2435行）
| API路径 | 数据类型 | 领星导出对应 |
|---------|---------|-------------|
| /erp/sc/data/seller/lists | 店铺列表 | 系统设置 |
| /erp/sc/data/fba/FbaStockLists | FBA库存 | FBA库存导出 |
| /erp/sc/data/fba/awdStockLists | AWD库存 | AWD库存导出 |
| /erp/sc/data/inventory/getWarehouseStockDetail | 本地仓库存 | 本地仓导出 |
| /erp/sc/routing/restocking/analysis/getSummaryList | 补货建议 | 补货分析导出 |
| /erp/sc/data/fba/replenish/chart | 补货图表 | 补货分析导出 |

### 四、售后服务（afterSales.ts - 732行）
| API路径 | 数据类型 | 领星导出对应 |
|---------|---------|-------------|
| /erp/comment/data/review/listNewReview | 评论列表 | 评论导出 |
| /erp/sc/v2/ca/reviewReport/lists | 评论报告 | 评论报告导出 |
| /erp/sc/data/fba/returnAnalysis | 退货分析 | 退货分析导出 |
| /erp/sc/open/customerService/rmaManage/list | RMA管理 | RMA导出 |
| /erp/sc/data/mail/lists | 邮件列表 | 邮件导出 |
| /erp/sc/data/mail/info | 邮件详情 | - |
| /erp/sc/cs/feedback/listMws | Feedback列表 | Feedback导出 |

### 五、物流发货（shippingBatch.ts - 1263行）
| API路径 | 数据类型 | 领星导出对应 |
|---------|---------|-------------|
| /erp/sc/routing/storage/shipment/getInboundShipmentList | 入库计划 | 入库计划导出 |
| /erp/sc/data/local_inventory/channelList | 渠道列表 | - |
| /erp/sc/routing/data/local_inventory/purchaseOrderList | 采购订单 | 采购订单导出 |
| /erp/sc/data/fba_report/shipmentList | 发货报告 | 发货报告导出 |

### 六、其他模块
| 文件 | API路径 | 数据类型 |
|------|---------|---------|
| competitorMonitor.ts | /erp/sc/data/mws/competitorMonitor | 竞品监控 |
| dashboardUpgrade.ts | /erp/sc/data/mws/lightningDeal | 秒杀 |
| dashboardUpgrade.ts | /erp/sc/data/mws/coupon/list | 优惠券 |
| dashboardUpgrade.ts | /erp/sc/cs/performance/list | 客服绩效 |
| profitDeep.ts | /erp/finance/data/inventory/getInventoryStatementList | 库存报表 |
| replenishmentEngine.ts | /erp/sc/routing/storage/fbaInventoryV2 | FBA库存V2 |
| replenishmentEngine.ts | /erp/sc/data/replenish/salesForecast | 销量预测 |
| customerProfile.ts | /erp/sc/data/mws/orders | 订单数据 |
| customDashboard.ts | /erp/sc/data/fba/FbaStockLists | FBA库存 |
| customDashboard.ts | /erp/sc/data/mws/reviewList | 评论列表 |

## 按数据类别归类（用于设计上传模板）

### 核心数据（高频使用）
1. **利润报表** - MSKU/ASIN/父ASIN维度（productOps, profitDeep）
2. **FBA库存** - 库存数量、可售、在途（productOps, operations, customDashboard）
3. **广告报表** - SP/SD/SB广告数据（adAnalysis, productOps）
4. **ASIN360/产品表现** - 流量、转化、销量（productOps, conversionDataCollector）
5. **产品列表** - ASIN基础信息（productOps）

### 辅助数据（中频使用）
6. **搜索词报告** - 用户搜索词（adAnalysis）
7. **关键词报告** - 广告关键词表现（adAnalysis）
8. **评论数据** - Review/Rating（afterSales, customDashboard）
9. **退货分析** - 退货原因、退货率（afterSales, dashboardUpgrade）
10. **补货分析** - 补货建议、销量预测（operations, replenishmentEngine）

### 配置数据（低频使用）
11. **店铺列表** - SID/店铺名（operations, adAnalysis）
12. **Listing信息** - 标题、图片、价格（productOps, adAnalysis）
13. **竞品监控** - 竞品价格变动（competitorMonitor）
14. **邮件/客服** - 买家邮件（afterSales）
15. **物流发货** - 入库计划、采购订单（shippingBatch）
