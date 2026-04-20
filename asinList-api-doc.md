# 领星 查询产品表现 API 文档

## 接口路径
`/bd/productPerformance/openApi/asinList`

## 请求方式
POST

## 请求参数

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| offset | int | 是 | 偏移量 |
| length | int | 是 | 每页条数 |
| sort_field | string | 否 | 排序字段，如 volume |
| sort_type | string | 否 | 排序方式 desc/asc |
| search_field | string | 否 | 搜索字段，如 asin |
| search_value | array | 否 | 搜索值数组 |
| mid | int | 是 | 站点ID (1=US, 2=CA, 4=UK, 5=DE, 6=FR, 7=IT, 8=ES, 9=JP, 10=AU) |
| sid | array | 是 | 店铺ID数组 |
| start_date | string | 是 | 开始日期 YYYY-MM-DD |
| end_date | string | 是 | 结束日期 YYYY-MM-DD |
| summary_field | string | 否 | 汇总维度 asin |
| currency_code | string | 否 | 货币代码 CNY/USD |
| is_recently_enum | boolean | 否 | 是否最近枚举 |
| purchase_status | int | 否 | 采购状态 0=全部 |
| extend_search | array | 否 | 扩展搜索条件 |

## 返回字段（从示例数据提取）

### 基础信息
- parent_asins: 父ASIN列表
- asins: ASIN列表
- price_list: 价格列表（含seller_sku, price, sid等）
- item_name: 产品名称
- small_image_url: 产品图片
- sids: 关联店铺ID数组

### 销售数据
- volume: 销量
- b2b_volume: B2B销量
- order_items: 订单量
- b2b_order_items: B2B订单量
- amount: 销售额
- b2b_amount: B2B销售额
- net_amount: 净销售额
- volume_chain_ratio: 销量环比
- amount_chain_ratio: 销售额环比
- order_chain_ratio: 订单环比
- volume_chain: 销量环比差值
- amount_chain: 销售额环比差值
- order_items_chain: 订单环比差值

### 利润数据
- gross_profit: 毛利润
- predict_gross_profit: 预测毛利润
- gross_margin: 毛利率
- predict_gross_margin: 预测毛利率
- roi: ROI

### 广告数据
- spend: 广告花费总额
- ads_sp_cost: SP广告花费
- shared_ads_sb_cost: SB广告花费
- shared_ads_sbv_cost: SBV广告花费
- ads_sd_cost: SD广告花费
- shared_cost_of_advertising: 共享广告费
- ad_sales_amount: 广告销售额
- ad_order_quantity: 广告订单数
- ad_direct_order_quantity: 广告直接订单数
- ad_direct_sales_amount: 广告直接销售额
- impressions: 广告展示数
- clicks: 广告点击数
- acos: ACOS
- roas: ROAS
- acoas: ACOaS (广告花费占总销售额比)
- asoas: ASOaS
- ad_cvr: 广告转化率
- ctr: 点击率
- cpc: 单次点击成本
- cpo: 单次订单成本
- cpm: 千次展示成本
- adv_rate: 广告占比

### 流量数据
- sessions: PC端Session
- sessions_mobile: 移动端Session
- sessions_total: Session总数
- page_views: PC端页面浏览
- page_views_mobile: 移动端页面浏览
- page_views_total: 页面浏览总数
- buy_box_percentage: BuyBox占比
- volume_cvr: 销量转化率
- cvr: 转化率

### 评论数据
- avg_star: 平均评分
- prev_star: 上期评分
- reviews_count: 评论数
- comment_rate: 评论率

### 退货数据
- return_count: 退货数量
- return_rate: 退货率
- return_goods_count: 退货商品数
- return_goods_rate: 退货商品率
- return_amount: 退货金额

### 库存数据
- afn_fulfillable_quantity: FBA可售库存
- afn_inbound_receiving_quantity: 入库中
- afn_inbound_shipped_quantity: 已发货
- afn_inbound_working_quantity: 处理中
- afn_unsellable_quantity: 不可售
- reserved_fc_processing: 预留处理中
- reserved_fc_transfers: 预留调仓中
- reserved_customerorders: 预留客户订单
- fbm_quantity: FBM库存
- stock_up_num: 备货数量
- available_days: FBA可售天数
- fbm_available_days: FBM可售天数
- month_stock_sales_ratio: 月库销比
- inventory_sales_ratio: 库销比
- available_inventory: 可用库存对象

### 促销数据
- promotion_volume: 促销销量
- promotion_amount: 促销金额
- promotion_order_items: 促销订单数
- promotion_discount: 促销折扣

### 排名数据
- cate_rank: 大类排名
- small_cate_rank: 小类排名
- prev_cate_rank: 上期大类排名
- rank_category: 排名类目

### 其他
- principal_names: 负责人
- developer_names: 开发人员
- categories: 类目
- brands: 品牌
- tag_set: 标签
- avg_landed_price: 平均到岸价
- avg_custom_price: 平均自定义价格
- avg_volume: 平均销量
