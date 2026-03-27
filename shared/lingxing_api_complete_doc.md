# 领星ERP开放API完整文档

> 本文档基于领星API官方文档截图自动提取生成，包含所有可用接口的详细信息。

> 共提取 **99** 个独立API接口，覆盖 **23** 个业务分类。

---

## 目录

- [授权](#授权)
- [接入指南](#接入指南)
- [接入指引](#接入指引)
- [接入准备](#接入准备)
- [基础数据](#基础数据)
- [FBA](#FBA)
- [产品](#产品)
- [库存](#库存)
- [广告](#广告)
- [促销](#促销)
- [促销管理](#促销管理)
- [客服](#客服)
- [客诉](#客诉)
- [店铺](#店铺)
- [工具](#工具)
- [新广告](#新广告)
- [物流](#物流)
- [统计](#统计)
- [订单](#订单)
- [评论](#评论)
- [财务](#财务)
- [采购](#采购)
- [销售](#销售)


---

## 授权

### 获取access-token和refresh-token

| 属性 | 值 |
|------|------|
| **API Path** | `/api/auth-server/oauth/access-token` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| appid(AppID,在ERP开放接口菜单中获取,string) |  |
| appSecret(AppSecret,在ERP开放接口菜单中获取,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| msg(消息提示,string) |  |
| data(响应数据,object) |  |
| data>>access_token(access_token,请求令牌token,string) |  |
| data>>refresh_token(refresh_token,可以使用它来给access_token延续有效期,string) |  |
| data>>expires_in(access_token过期时间,string) |  |

> **备注**: 该接口用于获取访问令牌。


### 续约接口令牌

| 属性 | 值 |
|------|------|
| **API Path** | `/api/auth-server/oauth/refresh` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| appId(AppID,在ERP开放接口中获取,string) |  |
| refreshToken(refreshToken,获取接口令牌-token 接口对应字段【refresh_token】,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| msg(消息提示,string) |  |
| data(响应数据,object) |  |
| data>>access_token(access_token,string) |  |
| data>>refresh_token(refresh_token,string) |  |
| data>>expires_in(access_token过期时间,string) |  |



---

## 接入指南

### 领星API接入指南

| 属性 | 值 |
|------|------|
| **API Path** | `N/A` |
| **请求方式** | N/A |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| access_token(接口调用凭证,string) |  |
| app_key(应用appKey,string) |  |
| timestamp(时间戳,string) |  |
| sign(签名,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(返回码,integer) |  |
| message(返回信息,string) |  |
| data(返回数据,object) |  |
| count(数据总条数,integer) |  |

> **备注**: 该截图为领星API的通用接入指南，非特定接口文档。左侧导航栏显示了多个API分类。



---

## 接入指引

### 全局错误码说明

| 属性 | 值 |
|------|------|
| **API Path** | `N/A` |
| **请求方式** | N/A |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| 错误码(错误码) |  |
| 说明(错误说明) |  |
| 处理(处理方式) |  |

> **备注**: 该截图为全局错误码说明，非特定API接口。左侧导航菜单可见，包含常见场景、授权、基础数据、销售、FBA、补货建议、补货限制、产品、采购、仓库、物流、新广告、财务、客服、工具、统计、目标管理等分类。



---

## 接入准备

### 常见问题案例

| 属性 | 值 |
|------|------|
| **API Path** | `N/A` |
| **请求方式** | N/A |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(错误码,string) |  |
| msg(错误信息,string) |  |
| data(返回数据,any) |  |
| throwable(异常信息,string) |  |
| errorTime(错误时间,string) |  |
| message(消息,string) |  |
| stackTrace(堆栈跟踪,string) |  |
| success(是否成功,boolean) |  |

> **备注**: 该截图为'常见问题案例'页面，非具体API接口文档。内容为调用API时可能遇到的各种错误场景及对应的返回数据格式。左侧导航栏显示了多个业务分类，如FBA、产品、广告、库存等。



---

## 基础数据

### 查询亚马逊市场列表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/seller/allMarketplace` |
| **请求方式** | GET |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码, 0成功,int) |  |
| message(提示信息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,array) |  |
| data>>mid(站点id,int) |  |
| data>>region(地区,string) |  |
| data>>aws_region(亚马逊地区,string) |  |
| data>>country(商城所在国家名称,string) |  |
| data>>code(亚马逊国家code,string) |  |
| data>>marketplace_id(亚马逊市场id,string) |  |

> **备注**: 唯一键: marketplace_id或mid; 调用本接口,获取到领星ERP的站点ID【字段mid】对应的亚马逊市场ID映射关系; 该接口数据变更频率较低,建议获取后本地保留数据; mid将用于部分开放接口传入参数;


### 查询亚马逊概念店铺列表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/seller/conceptLists` |
| **请求方式** | GET |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(消息提示,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| data>>id(概念店铺ID,number) |  |
| data>>mid(概念市场ID,number) |  |
| data>>name(概念店铺名称,string) |  |
| data>>seller_id(亚马逊卖家记号,string) |  |
| data>>seller_account_name(店铺账号名称,string) |  |
| data>>seller_account_id(店铺账号ID,number) |  |
| data>>region(站点简称,string) |  |
| data>>country(店铺所在国家名称,string) |  |
| data>>status(概念店铺状态,number) |  |

> **备注**: 无


### 获取国家下的州、省编码

| 属性 | 值 |
|------|------|
| **API Path** | `/basicOpen/multiplatform/profit/report/stateList` |
| **请求方式** | POST |

**请求参数：**

countryCode(国家编码,二字码,string)

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码, 0:成功,number) |  |
| message(消息提示,string) |  |
| error_details(数据校验失败时的错误详情,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,object) |  |
| data>>states(州/省列表,array) |  |
| data>>states>>countryCode(国家编码,string) |  |
| data>>states>>stateOrProvinceName(州/省名称,string) |  |
| data>>states>>code(州/省编码,string) |  |
| total(总数,number) |  |

> **备注**: 无


### 下载附件

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/routing/common/file/download` |
| **请求方式** | POST |

**请求参数：**

file_id(附件id【取对应功能接口返回结果中的附件id值】,[int])

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码, 0 成功,[int]) |  |
| message(提示消息,[string]) |  |
| error_details(错误信息,[array]) |  |
| request_id(请求链路id,[string]) |  |
| response_time(响应时间,[string]) |  |
| total(总数,[int]) |  |
| data(响应数据,[object]) |  |
| data>>file_name(文件名,[string]) |  |
| data>>mime_type(文件类型,[string]) |  |
| data>>content(base64 编码的文件内容,[string]) |  |


### 查询ERP用户信息列表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/account/lists` |
| **请求方式** | GET |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0成功,int) |  |
| message(消息提示,string) |  |
| error_details(错误信息,array) |  |
| response_time(响应时间,string) |  |
| data(响应数据,array) |  |
| data>>uid(用户id,int) |  |
| data>>realname(姓名,string) |  |
| data>>username(用户名,string) |  |
| data>>mobile(电话,string) |  |
| data>>email(邮箱,string) |  |
| data>>login_num(登陆次数,int) |  |
| data>>last_login_time(最近登录时间,string) |  |
| data>>last_login_ip(最近登录IP,string) |  |
| data>>status(状态:0禁用,1正常,int) |  |
| data>>create_time(创建时间,string) |  |
| data>>role(角色,string) |  |
| data>>seller(店铺权限,string) |  |
| data>>is_master(是否为主账号:0否,1是,int) |  |

> **备注**: 无


### 批量修改店铺名称

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/seller/batchEditSellerName` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid_name_list(批量修改店铺数组,最多可批量修改10个,array) |  |
| sid_name_list>>sid(店铺id,对应查询亚马逊店铺列表接口对应字段【sid】,int) |  |
| sid_name_list>>name(店铺名称,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0成功,int) |  |
| message(提示信息,string) |  |
| error_details(错误信息,array) |  |
| data(返回数据,object) |  |
| data>>success_num(成功个数,int) |  |
| data>>failure_num(失败个数,int) |  |
| data>>failure_detail(失败详情,array) |  |
| data>>failure_detail>>sid(店铺id,string) |  |
| data>>failure_detail>>name(店铺名,string) |  |
| data>>failure_detail>>error(失败原因,string) |  |
| request_id(请求id,string) |  |
| response_time(响应时间,string) |  |
| total(总记录数,int) |  |

> **备注**: 无


### 查询亚马逊国家下地区列表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/worldState/lists` |
| **请求方式** | POST |

**请求参数：**

country_code(国家code,查询亚马逊市场列表 接口对应字段【code】,[string])

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0 成功,[int]) |  |
| message(提示信息,[string]) |  |
| error_details(错误信息,[array]) |  |
| request_id(请求链路id,[string]) |  |
| response_time(响应时间,[string]) |  |
| data(响应数据,[array]) |  |
| data>>country_code(国家code,[string]) |  |
| data>>state_or_province_name(地区名称,[string]) |  |
| data>>code(地区code,[string]) |  |
| total(总数,[int]) |  |

> **备注**: 唯一组合键:【country_code+state_or_province_name+code】;该接口数据变更频率较低,建议获取后本地保留数据



---

## FBA

### 查询FBA发货计划

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/fba/ShipmentPlanLists` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| p(页码,int) |  |
| s(分页大小,int) |  |
| packing_type(装箱方式,string) |  |
| search_field_type(查询字段类型,string) |  |
| search_field(查询字段值,string) |  |
| status(状态,string) |  |
| offset(偏移量,int) |  |
| length(长度,int) |  |
| start_date(开始时间,string) |  |
| end_date(结束时间,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| total(数据总条数,int) |  |
| max_id(N/A,int) |  |
| records.id(主键ID,int) |  |
| records.shipment_plan_id(发货计划ID,string) |  |
| records.shipment_plan_name(发货计划名称,string) |  |
| records.seller_id(店铺ID,int) |  |
| records.seller_name(店铺名称,string) |  |
| records.marketplace_id(站点,string) |  |
| records.country_fields(目的国,string) |  |
| records.shipment_address_id(发货地址ID,int) |  |
| records.shipment_address_name(发货地址,string) |  |
| records.shipment_address_name_cn(发货地址中文,string) |  |
| records.packing_type(装箱方式,int) |  |
| records.packing_type_name(装箱方式名称,string) |  |
| records.shipment_plan_display_id(shipment_plan_display_id,string) |  |
| records.is_are_cases_required(is_are_cases_required,boolean) |  |
| records.status(状态,int) |  |
| records.status_name(状态名称,string) |  |
| records.created_time(创建时间,string) |  |
| records.shipment_plan_class(发货类型,int) |  |
| records.shipment_plan_class_name(发货类型名称,string) |  |
| records.logistics_name(物流方式,string) |  |
| records.channel_name(渠道名称,string) |  |
| records.tracking_id(跟踪号,string) |  |
| records.logistics_bill_no(物流单号,string) |  |
| records.reference_id(reference_id,string) |  |
| records.logistics_status(物流状态,int) |  |
| records.logistics_status_name(物流状态名称,string) |  |
| records.delivery_time(发货时间,string) |  |
| records.eta(预计到达时间,string) |  |
| records.items.id(主键ID,int) |  |
| records.items.shipment_plan_id(发货计划ID,int) |  |


### 创建FBA发货计划

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/routing/storage/shipment/createShipmentPlan` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| remark(批次信息备注,string) |  |
| product_list(商品信息,array) |  |
| product_list>>sid(店铺id,int) |  |
| product_list>>packing_type(包装类型:1混装,2原厂,int) |  |
| product_list>>shipment_time(发货时间,格式:Y-m-d,string) |  |
| product_list>>msku(MSKU,string) |  |
| product_list>>fnsku(FNSKU,string) |  |
| product_list>>shipment_plan_quantity(计划发货量,int) |  |
| product_list>>quantity_in_case(单箱数量【PCS】,int) |  |
| product_list>>box_num(箱数,int) |  |
| product_list>>logistics_provider_id(物流商id,int) |  |
| product_list>>logistics_channel_id(物流渠道id,int) |  |
| product_list>>wid(系统仓库id,int) |  |
| product_list>>remark(商品信息备注,string) |  |
| product_list>>purchase_plan_sn(关联采购计划单号,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0成功,int) |  |
| message(消息提示,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,object) |  |
| data>>seq(批次号,string) |  |
| data>>order_sn(计划编号,array) |  |


### 编辑FBA发货计划

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/routing/storage/shipment/updateShipmentPlan` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| order_sn(发货计划单号,string) |  |
| shipment_time(发货时间, 格式: Y-m-d,string) |  |
| packing_type(包装类型: 1混装, 2原厂,int) |  |
| logistics_provider_id(物流商id,int) |  |
| logistics_channel_id(物流渠道id,int) |  |
| shipment_plan_quantity(计划发货量,int) |  |
| quantity_in_case(单箱数量(PCS),int) |  |
| box_num(箱数,int) |  |
| sys_wid(系统仓库id【发货仓库】,int) |  |
| cg_package_length(包装规格长(cm)【保留两位小数】,number) |  |
| cg_package_width(包装规格宽(cm)【保留两位小数】,number) |  |
| cg_package_height(包装规格高(cm)【保留两位小数】,number) |  |
| cg_box_length(箱规长(cm)【保留两位小数】,number) |  |
| cg_box_width(箱规宽(cm)【保留两位小数】,number) |  |
| cg_box_height(箱规高(cm)【保留两位小数】,number) |  |
| rw(单品净重(g)【保留两位小数】,number) |  |
| gw(单品毛重(g)【保留两位小数】,number) |  |
| cg_box_weight(单箱重量(kg)【保留两位小数】,number) |  |
| remark(备注,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码, 0成功,int) |  |
| message(消息提示,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |


### 查询亚马逊进仓订单详情

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/fba/shipmentOrder/detail` |
| **请求方式** | POST |

**请求参数：**

shipment_order_id(进仓单ID,string)

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(返回信息,string) |  |
| data_list(返回数据,array) |  |
| shipment_id(货件ID,string) |  |
| reference_id(参考ID,string) |  |
| is_are_cases_required(是否需要箱子,boolean) |  |
| label_prep_type(标签类型,string) |  |
| ship_from_address_id(发货地址ID,int) |  |
| ship_from_address(发货地址,string) |  |
| destination_fulfillment_center_id(目的地运营中心ID,string) |  |
| shipment_name(货件名称,string) |  |
| seller_id(卖家ID,int) |  |
| msku(MSKU,string) |  |
| fnsku(FNSKU,string) |  |
| asin(ASIN,string) |  |
| quantity_shipped(已发货数量,int) |  |
| quantity_received(已接收数量,int) |  |
| quantity_in_case(箱内数量,int) |  |
| prep_details_list(预处理详情,array) |  |
| shipment_status(货件状态,string) |  |
| created_at(创建时间,string) |  |
| updated_at(更新时间,string) |  |
| fulfillment_network_sku(FNSKU,string) |  |
| seller_sku(SKU,string) |  |
| shipment_order_id(进仓单ID,int) |  |
| shipment_order_name(进仓单名称,string) |  |
| shipment_order_status(进仓单状态,string) |  |
| address_name(地址名称,string) |  |
| address_line1(地址行1,string) |  |
| address_line2(地址行2,string) |  |
| city(城市,string) |  |
| district_or_county(区/县,string) |  |
| state_or_province_code(州/省代码,string) |  |
| country_code(国家代码,string) |  |
| postal_code(邮政编码,string) |  |
| box_contents_source(箱内物品信息来源,string) |  |
| estimated_box_contents_fee_total_fee(预估的箱内物品信息费用,string) |  |
| estimated_box_contents_fee_fee_per_unit(每个商品的费用,string) |  |
| estimated_box_contents_fee_currency_code(货币代码,string) |  |


### 查询FBA库存列表-v2

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/fba/FbaStockLists` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| seller_id(店铺ID,string) |  |
| msku(msku,string) |  |
| fnsku(fnsku,string) |  |
| asin(asin,string) |  |
| seller_sku(seller_sku,string) |  |
| warehouse_state(仓库状态,string) |  |
| search_type(搜索类型,int) |  |
| search_content(搜索内容,string) |  |
| page_no(页码,int) |  |
| page_size(每页大小,int) |  |
| country_code(国家简码,string) |  |
| is_afn(是否fba库存,int) |  |
| is_fbm(是否fbm库存,int) |  |
| is_local(是否海外仓库存,int) |  |
| is_oversea(是否中转仓库存,int) |  |
| is_purchase(是否采购途中库存,int) |  |
| sort_field(排序字段,string) |  |
| sort_type(排序方式,string) |  |
| is_all_country(是否查询所有国家,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| total(总数,int) |  |
| current_page(当前页,int) |  |
| per_page(每页大小,int) |  |
| data(数据,array) |  |
| id(id,int) |  |
| seller_id(店铺id,int) |  |
| country_code(国家简码,string) |  |
| msku(msku,string) |  |
| fnsku(fnsku,string) |  |
| asin(asin,string) |  |
| seller_sku(seller_sku,string) |  |
| product_name(产品名称,string) |  |
| total_quantity(总库存,int) |  |
| inbound_working_quantity(inbound_working,int) |  |
| inbound_shipped_quantity(inbound_shipped,int) |  |
| inbound_receiving_quantity(inbound_receiving,int) |  |
| fulfillable_quantity(fulfillable,int) |  |
| reserved_quantity(reserved,int) |  |
| researching_quantity(researching,int) |  |
| unfulfillable_quantity(unfulfillable,int) |  |
| afn_warehouse_quantity(afn_warehouse_quantity,int) |  |
| afn_unsellable_quantity(afn_unsellable_quantity,int) |  |
| afn_reserved_quantity(afn_reserved_quantity,int) |  |
| afn_total_quantity(afn_total_quantity,int) |  |
| per_unit_volume(per_unit_volume,string) |  |
| afn_inbound_working_quantity(afn_inbound_working_quantity,int) |  |
| afn_inbound_shipped_quantity(afn_inbound_shipped_quantity,int) |  |
| afn_inbound_receiving_quantity(afn_inbound_receiving_quantity,int) |  |
| currency(币种,string) |  |
| your_price(your_price,string) |  |
| sales_price(sales_price,string) |  |
| lowest_price_new(最低价,string) |  |
| fbm_stock(fbm库存,int) |  |
| local_stock(海外仓库存,int) |  |
| oversea_stock(中转仓库存,int) |  |
| purchase_stock(采购途中库存,int) |  |
| stock_total(总库存,int) |  |
| img_url(图片地址,string) |  |
| parent_asin(父ASIN,string) |  |
| open_date(创建日期,string) |  |
| country_name(国家名称,string) |  |
| seller_name(店铺名称,string) |  |
| group_name(店铺分组,string) |  |
| group_id(店铺分组ID,int) |  |
| chargeable_fees(仓储费,string) |  |
| monthly_storage_fees(月度仓储费,string) |  |
| inventory_age_0_to_90_days(库龄0-90天,int) |  |
| inventory_age_91_to_180_days(库龄91-180天,int) |  |
| inventory_age_181_to_270_days(库龄181-270天,int) |  |
| inventory_age_271_to_365_days(库龄271-365天,int) |  |
| inventory_age_365_plus_days(库龄365+天,int) |  |
| qty_to_be_charged_ltsf_12_mo(长期仓储费,string) |  |
| projected_ltsf_12_mo(预估长期仓储费,string) |  |
| inv_age_feature_last_modified_date(库龄特征最后修改日期,string) |  |
| required_removal_qty(需移除数量,int) |  |
| removal_deadline(移除截止日期,string) |  |


### 查询FBA库存列表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/fba/ShipmentPlanLists` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺id,string) |  |
| offset(分页偏移量,int) |  |
| length(分页长度,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(返回码,int) |  |
| message(结果描述,string) |  |
| request_id(请求ID,string) |  |
| response_time(服务器时间,string) |  |
| data(返回数据,array) |  |
| data->total(总条数,int) |  |
| data->list(列表,array) |  |
| data->list->seller_name(店铺名称,string) |  |
| data->list->msku(MSKU,string) |  |
| data->list->fnsku(FNSKU,string) |  |
| data->list->asin(ASIN,string) |  |
| data->list->product_name(品名,string) |  |
| data->list->product_image(图片,string) |  |
| data->list->category_id(分类ID,int) |  |
| data->list->category_name(分类名称,string) |  |
| data->list->brand_id(品牌ID,int) |  |
| data->list->brand_name(品牌名称,string) |  |
| data->list->stock_cost_total(总货值,number) |  |
| data->list->currency(货币符号,string) |  |
| data->list->listing_status_type(listing状态,int) |  |
| data->list->fulfillable_quantity(可售,int) |  |
| data->list->reserved_fc_transfers(调拨,int) |  |
| data->list->reserved_fc_processing(预处理,int) |  |
| data->list->reserved_customerorders(客户订单,int) |  |
| data->list->total_reserved_quantity(预留库存(汇总),int) |  |
| data->list->total_inbound_quantity(总入库(汇总),int) |  |
| data->list->inbound_working(待处理,int) |  |
| data->list->inbound_shipped(已发货,int) |  |
| data->list->inbound_receiving(接收中,int) |  |
| data->list->afn_whs_prep_shipped_quantity(运营中心间调拨,int) |  |
| data->list->researching_quantity(调查中,int) |  |
| data->list->age_0_to_30_days(0-30天库龄,int) |  |
| data->list->age_31_to_60_days(31-60天库龄,int) |  |
| data->list->age_61_to_90_days(61-90天库龄,int) |  |
| data->list->age_91_to_180_days(91-180天库龄,int) |  |
| data->list->age_181_to_270_days(181-270天库龄,int) |  |
| data->list->age_271_to_365_days(271-365天库龄,int) |  |
| data->list->age_366_plus_days(366+天库龄,int) |  |
| data->list->fulfillment_channel_name(配送网络,string) |  |
| data->list->afn_fulfillable_quantity_multi(可售数量(多国),string) |  |
| data->list->afn_fulfillable_quantity_multi_country(可售数量国家(多国),string) |  |
| data->list->afn_fulfillable_quantity_multi_quantity(可售数量(多国),string) |  |


### 按ASIN查询FBA补货建议图表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/lingXing/getDailySalesAndInventorie` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺id,对应【查询亚马逊店铺列表】接口的sid字段,string) |  |
| asin(ASIN,string) |  |
| sug_type(建议类型 1:建议采购量 2:建议本地仓发货量 3:建议海外仓发货量,int) |  |
| mode(补货建议模式 1:海外仓中转模式,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(消息提示,string) |  |
| error_details(错误信息,string) |  |
| request_id(请求ID,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(明细数据,object) |  |
| data->list(每日数据信息,object) |  |
| data->list->日期(每日数据,array) |  |
| data->sug_date_line(图表时间线,array) |  |
| data->sug_date_line->date(日期,string) |  |
| data->sug_date_line->title(标题,string) |  |
| data->sug_date_line->desc(上个日期到当前区间的描述,string) |  |
| data->sug_date_line->type(数据类型,string) |  |

> **备注**: 补货建议


### 查询报表型数据明细-ASIN

| 属性 | 值 |
|------|------|
| **API Path** | `/wp/sc/routing/fba5ug/asin/getSourceList` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺id,int) |  |
| asin(ASIN,string) |  |
| type(数据类型,string) |  |
| mode(补货建议模式,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(消息提示,string) |  |
| error_details(错误信息,string) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,object) |  |
| data->mode(补货建议模式,string) |  |
| data->source_list(数据列表,array) |  |
| data->source_list->quantity(数量,object) |  |
| data->source_list->type(数据类型,object) |  |
| data->source_list->amazon_sale_date(预计FBA可售时间,string) |  |
| data->source_list->remark(备注,object) |  |
| data->source_list->remark->amz_fulfillable_quantity(FBA可售,string) |  |
| data->source_list->remark->reserved_fc_transfers(待调仓,string) |  |
| data->source_list->remark->reserved_fc_processing(调仓中,string) |  |
| data->source_list->remark->shipment_id(货件单号,string) |  |
| data->source_list->remark->warehouse_name(仓库名,string) |  |
| data->source_list->remark->sku(SKU,string) |  |
| data->source_list->remark->fnsku(FNSKU,string) |  |
| data->source_list->remark->qc_sn(质检单号,string) |  |
| data->source_list->remark->purchase_order_sn(采购单号,string) |  |
| data->source_list->remark->plan_sn(采购计划编号,object) |  |
| data->source_list->remark->overseas_order_no(海外仓备货单号,string) |  |
| data->source_list->remark->logistics_name(物流方式,string) |  |
| data->source_list->remark->deliver_time(发货时间,string) |  |
| data->source_list->expect_arrive_time(预计到达时间,string) |  |
| total(总数,int) |  |


### 批量设置规则 - ASIN

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/fba/AsinSetConfig` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| asin_list(ASIN列表,array) |  |
| days_plan(执行计划,string) |  |
| sit_fba_list(FBA站点,array) |  |
| sit_fba_list>settings(FBA设置,array) |  |
| sit_oversea_list(海外仓站点,array) |  |
| sit_oversea_list>id(仓库ID,string) |  |
| sit_oversea_list>days(天数,string) |  |
| days_oversea_list>days(海外FBA在途天数,integer) |  |
| days_frequency_purchase(采购频率,integer) |  |
| days_frequency_local_bland(本地仓调拨频率,integer) |  |
| days_frequency_oversea_send(海外仓调拨频率,integer) |  |
| safe_day(安全天数,integer) |  |
| is_ignore_pentiny_short(忽略少量缺货,integer) |  |
| is_ignore_history_out_stock(忽略历史缺货,integer) |  |
| days_tostocking(已弃用,integer) |  |
| days_tostocking_air(已弃用,integer) |  |
| days_tostocking_air(已弃用,integer) |  |
| default_type_tostocking(已弃用,integer) |  |
| days_frequency(已弃用,integer) |  |
| config_list(日销量设置,array) |  |
| config_list>title(名称,string) |  |
| config_list>autook_status(是否默认,integer) |  |
| config_list>type(类型,integer) |  |
| config_list>weight_1(权重1,integer) |  |
| config_list>weight_2(权重2,integer) |  |
| config_list>weight_3(权重3,integer) |  |
| config_list>weight_4(权重4,integer) |  |
| config_list>weight_5(权重5,integer) |  |
| config_list>volume(日销量,number) |  |
| config_list>date_start(开始日期,string) |  |
| config_list>date_end(结束日期,string) |  |
| denoise_list(排除日期,array) |  |
| denoise_list>title(标题,string) |  |
| denoise_list>date_start(开始日期,string) |  |
| denoise_list>date_end(结束日期,string) |  |
| denoise_list>type(类型,integer) |  |
| denoise_list>percent(百分比,integer) |  |
| denoise_list>volume(销量,integer) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,integer) |  |
| message(状态提示,string) |  |
| error_details(错误信息,array) |  |
| error_details>asin(ASIN,string) |  |
| error_details>reason(错误提示,string) |  |
| request_id(请求ID,string) |  |
| response_time(响应时间,string) |  |
| data(数据,object) |  |
| total(总数,integer) |  |


### 单个设置规则-ASIN

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/ling/fbaLog/saveConfig` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺ID,int) |  |
| asin(ASIN,string) |  |
| days_plan(测算天数,string) |  |
| days_zf(周转天数,int) |  |
| sx_fba_list(本地仓至FBA时效,array) |  |
| sx_fba_list->sn_id(运输方式ID,string) |  |
| sx_fba_list->days(天数,int) |  |
| sm_oversea_list(本地仓至海外仓时效,array) |  |
| sm_oversea_list->sn_id(运输方式ID,string) |  |
| sm_oversea_list->days(天数,int) |  |
| days_oversea_to_fba(海外仓至FBA天数,number) |  |
| days_frequency_purchase(采购频率,number) |  |
| days_frequency_local_send(本地仓发货频率,number) |  |
| days_frequency_oversea_send(海外仓发货频率,number) |  |
| safe_day(安全天数,number) |  |
| is_ignore_certainly_short(智能建议忽略断货场景,number) |  |
| is_ignore_history_out_stock(历史销量忽略断货场景,number) |  |
| days_toucheng(已开启（原本地仓途程天数-海运）,number) |  |
| days_oversea(已开启（原本地仓海外仓天数-海运）,number) |  |
| days_toucheng_air(已开启（原本地仓途程天数-空运）,number) |  |
| days_oversea_air(已开启（原本地仓海外仓天数-空运）,number) |  |
| default_type_toucheng(已开启（原默认头程物流类型）,number) |  |
| default_type_oversea(已开启（原默认发海外仓物流类型）,number) |  |
| days_frequency(已开启（原备货频率）,number) |  |
| config_list(日销量设置,array) |  |
| config_list->title(规则名称,string) |  |
| config_list->is_default(是否默认,int) |  |
| config_list->type(类型：0-普通，1-动态,int) |  |
| config_list->weight_3(权重：3天,number) |  |
| config_list->weight_7(权重：7天,number) |  |
| config_list->weight_14(权重：14天,number) |  |
| config_list->weight_30(权重：30天,number) |  |
| config_list->weight_60(权重：60天,number) |  |
| config_list->weight_90(权重：90天,number) |  |
| config_list->volume(日销量(若使用多人,保留两位小数),string) |  |
| config_list->date_start(开始日期,string) |  |
| config_list->date_end(结束日期,string) |  |
| denoise_list(销量去噪设置,array) |  |
| denoise_list->title(规则名称,string) |  |
| denoise_list->date_start(配置开始日期,string) |  |
| denoise_list->date_end(配置结束日期,string) |  |
| denoise_list->type(类型：1-按星期，2-按分位比去噪,int) |  |
| denoise_list->percent(去噪百分比,number) |  |
| denoise_list->volume(日销量,number) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(消息提示,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求唯一ID,string) |  |
| response_time(第五时间,string) |  |
| data(第五维度,object) |  |
| total(总数,int) |  |


### 查询建议信息-MSKU

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/fba/suggest/getMskuSuggestList` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺ID,string) |  |
| msku(MSKU,string) |  |
| mode(补货运输方式,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(结果提示,string) |  |
| error_details(错误明细,string) |  |
| request_id(请求ID,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(返回数据,object) |  |
| data->msku(MSKU,string) |  |
| data->fnsku(FNSKU,string) |  |
| data->asin(ASIN,string) |  |
| data->country(站点,string) |  |
| data->quantity_sug_replenishment(建议补货量,number) |  |
| data->quantity_fba_valid(有效FBA存仓,number) |  |
| data->quantity_fba_inbound(FBA在途,number) |  |
| data->sales_total_7(7日总销量,number) |  |
| data->sales_total_14(14日总销量,number) |  |
| data->sales_total_30(30日总销量,number) |  |
| data->sales_total_60(60日总销量,number) |  |
| data->sales_total_90(90日总销量,number) |  |

> **备注**: 请求参数mode: 0表示全部运输方式, 1表示海运, 2表示空运, 3表示海运快船


### 查询建议信息-ASIN

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/fba/web/getAdviceInfo` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺id,string) |  |
| asin(ASIN,string) |  |
| mode(补货建议模式,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(结果提示,string) |  |
| error_details(错误提示,string) |  |
| request_id(请求ID,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(数据,object) |  |
| data->sid(店铺ID,string) |  |
| data->asin(ASIN,string) |  |
| data->mode(模式,int) |  |
| data->stock(0普通 1海外仓中转,string) |  |
| data->quantity_fba_valid(可售：FBA可售,number) |  |
| data->vmsku_list(VMSKU库存列表,array) |  |
| data->vmsku_list->vmsku(MSKU,string) |  |
| data->vmsku_list->saleable_quantity(可售：FBA可售库存,number) |  |
| data->vmsku_list->reserved_fc_transfers(预留仓中,number) |  |
| data->vmsku_list->reserved_fc_processing(处理中,number) |  |
| data->quantity_sug_purchase(建议采购量,number) |  |
| data->quantity_sug_local_to_oversea(建议本地发海外仓量（海外仓中转模式）,number) |  |
| data->quantity_sug_local_to_fba(建议本地发FBA量（普通模式）,number) |  |
| data->quantity_sug_oversea_to_fba(建议海外仓发FBA量,number) |  |
| data->req_date_send_local(建议本地发货日,string) |  |
| data->req_date_send_oversea(建议海外仓发货日,string) |  |
| data->req_date_purchase(建议采购日,string) |  |
| data->sales_avg_3(日均-3天,number) |  |
| data->sales_avg_7(日均-7天,number) |  |
| data->sales_avg_14(日均-14天,number) |  |
| data->sales_avg_30(日均-30天,number) |  |
| data->sales_avg_60(日均-60天,number) |  |
| data->sales_avg_90(日均-90天,number) |  |
| data->sales_total_3(3日总销量,int) |  |
| data->sales_total_7(7日总销量,int) |  |
| data->sales_total_14(14日总销量,int) |  |
| data->sales_total_30(30日总销量,int) |  |
| data->sales_total_60(60日总销量,int) |  |
| data->sales_total_90(90日总销量,int) |  |
| data->suggest_sn_list(运输方式列表,array) |  |
| data->suggest_sn_list->sn_id(运输方式id,string) |  |
| data->suggest_sn_list->name(运输方式名称,string) |  |
| data->suggest_sn_list->quantity_sug_local_to_fba(建议本地发FBA量,number) |  |
| data->suggest_sn_list->quantity_sug_local_to_oversea(建议本地发海外仓量,number) |  |
| data->suggest_sn_list->quantity_sug_purchase(建议采购量,number) |  |
| data->quantity_sug_purchase_air(已不用（建议采购量（空运））,number) |  |
| data->quantity_sug_purchase_sea(已不用（建议采购量（海运））,number) |  |
| data->quantity_sug_local_to_oversea_air(已不用（建议本地发海外仓量（空运）（海外仓模式））,number) |  |
| data->quantity_sug_local_to_oversea_sea(已不用（建议本地发海外仓量（海运）（海外仓模式））,number) |  |
| data->quantity_sug_local_to_fba_air(已不用（建议本地发FBA量（空运））,number) |  |
| data->quantity_sug_local_to_fba_sea(已不用（建议本地发FBA量（海运））,number) |  |

> **备注**: 请求参数mode: 0普通模式 1海外仓中转模式 [不传]以店铺设置模式


### 查询规则 - MSKU

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/products/mskuRule` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺ID,string) |  |
| msku(MSKU,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(返回信息,string) |  |
| error_details(错误详情,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,object) |  |
| data->mfn_days_30_sale(自发货30天销量,number) |  |
| data->mfn_stock_num(企业总库存,number) |  |
| data->mfn_on_way_num(在途库存,number) |  |
| data->mfn_can_sale_num(可售库存,number) |  |
| data->fba_stock_num(FBA总库存,number) |  |
| data->fba_on_way_num(FBA在途,number) |  |
| data->fba_can_sale_num(FBA可售,number) |  |
| data->stock_day(存货天数,number) |  |
| data->is_prohibit_sales(禁止销售,int) |  |
| data->prohibit_sales_reason(禁止销售原因,string) |  |
| data->is_new_product(是否新品,int) |  |
| data->new_product_end_date(新品期结束日期,string) |  |
| data->lifecycle(生命周期,int) |  |
| data->product_status(产品状态,int) |  |
| data->replenishment_strategy(补货策略,int) |  |
| data->is_stop_replenishment(停止补货,int) |  |
| data->stop_replenishment_reason(停止补货原因,string) |  |
| data->delivery_type(发货方式,int) |  |
| data->warehouse_type(备货仓库,int) |  |
| data->is_multi_site(是否多站点,int) |  |
| data->main_site_id(主站点ID,string) |  |
| data->main_site_name(主站点名称,string) |  |
| data->main_site_msku(主站点MSKU,string) |  |
| data->main_site_fnsku(主站点FNSKU,string) |  |
| data->main_site_asin(主站点ASIN,string) |  |
| data->main_site_seller_sku(主站点SellerSKU,string) |  |
| data->is_main_site(是否主站点,int) |  |
| data->is_calculate(是否参与计算,int) |  |
| data->product_image(产品图片,string) |  |
| data->product_name(产品名称,string) |  |
| data->product_asin(产品ASIN,string) |  |
| data->product_msku(产品MSKU,string) |  |
| data->product_fnsku(产品FNSKU,string) |  |
| data->product_seller_sku(产品SellerSKU,string) |  |
| data->open_date(上架日期,string) |  |
| data->country(国家,string) |  |
| data->weight(重量,number) |  |
| data->length(长度,number) |  |
| data->width(宽度,number) |  |
| data->height(高度,number) |  |
| data->volume(体积,number) |  |
| data->pack_weight(包装重量,number) |  |
| data->pack_volume(包装体积,number) |  |
| data->pack_quantity(装箱量,number) |  |
| data->purchase_price(采购单价,number) |  |
| data->fba_shipping(头程运费,number) |  |
| data->additional_cost(附加费,number) |  |
| data->fba_size_tier(FBA尺寸等级,string) |  |
| data->is_auto_update_size(是否自动更新尺寸,int) |  |
| data->is_auto_update_weight(是否自动更新重量,int) |  |
| data->is_auto_update_pack_quantity(是否自动更新装箱量,int) |  |


### 查询规则 - ASIN

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/api/fba/shipment/rule/asin` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺ID,int) |  |
| ASIN(ASIN,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(错误提示,string) |  |
| error_detail(错误信息,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,object) |  |
| data.fba_rule_info(FBA发货规则,object) |  |
| data.fba_rule_info.rule_name(规则名称(新),string) |  |
| data.fba_rule_info.rule_switch(是否开启(0:否,1:是),number) |  |
| data.fba_rule_info.safe_stock_days(安全销售天数,number) |  |
| data.fba_rule_info.first_leg_days(头程天数,number) |  |
| data.fba_rule_info.stock_up_cycle(备货周期,number) |  |
| data.fba_rule_info.is_oversea(是否海外仓发货,number) |  |
| data.fba_rule_info.is_purchase(是否需要采购,number) |  |
| data.fba_rule_info.purchase_prepare_days(采购提前期,number) |  |
| data.fba_rule_info.is_default(是否默认规则,int) |  |
| data.fba_rule_info.id(主键ID,int) |  |
| data.fba_rule_info.sid(店铺ID,int) |  |
| data.fba_rule_info.created_at(创建时间,string) |  |
| data.fba_rule_info.updated_at(更新时间,string) |  |
| data.fba_rule_info.weight_1(权重1,number) |  |
| data.fba_rule_info.weight_7(权重7,number) |  |
| data.fba_rule_info.weight_14(权重14,number) |  |
| data.fba_rule_info.weight_30(权重30,number) |  |
| data.fba_rule_info.weight_60(权重60,number) |  |
| data.fba_rule_info.weight_90(权重90,number) |  |
| data.fba_rule_info.volume(体积,string) |  |
| data.fba_rule_info.dimension_type(体积单位,string) |  |
| data.fba_rule_info.dimension_unit(尺寸单位,string) |  |
| data.fba_rule_info.weight_type(重量单位,string) |  |
| data.fba_rule_info.weight_unit(重量单位,string) |  |


### 查询补货列表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/fba/ShipmentPlanLists` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| date_type(日期类型,integer) |  |
| start_date(开始日期,string) |  |
| end_date(结束日期,string) |  |
| mode(运输方式,string) |  |
| time_zone_type(时区类型,integer) |  |
| offset(偏移量,integer) |  |
| limit(记录数,integer) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| total(总记录数,integer) |  |
| data(列表,array) |  |
| id(列表ID,string) |  |
| shipment_id(货件ID,string) |  |
| shipment_name(货件名称,string) |  |
| warehouse_name(发货仓库,string) |  |
| fnsku(FNSKU,string) |  |
| msku(MSKU,string) |  |
| asin(ASIN,string) |  |
| seller_sku(SellerSKU,string) |  |
| listing_name(Listing名称,string) |  |
| country(站点,string) |  |
| status(货件状态,integer) |  |
| created_at(创建时间,string) |  |
| updated_at(更新时间,string) |  |

> **备注**: 信息提取自截图


### 查询FBA发货计划列表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/fba/ShipmentPlanLists` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sellerId(店铺ID,string) |  |
| plan_name(计划名称,string) |  |
| plan_status(计划状态,array) |  |
| created_at_start(创建时间-开始,string) |  |
| created_at_end(创建时间-结束,string) |  |
| page_size(每页大小,integer) |  |
| page_num(页码,integer) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| total(总数,integer) |  |
| list(列表,array) |  |
| id(主键ID,integer) |  |
| plan_name(计划名称,string) |  |
| plan_status(计划状态,integer) |  |
| seller_id(店铺id,integer) |  |
| msku(MSKU,string) |  |
| asin(ASIN,string) |  |
| fnsku(FNSKU,string) |  |
| warehouse_name(发货仓库,string) |  |
| destination_fulfillment_center_id(目的地,string) |  |
| label_prep_type(标签类型,string) |  |
| created_at(创建时间,string) |  |
| updated_at(更新时间,string) |  |
| items(商品列表,array) |  |


### 查询FBA货件

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/fba/shipments` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| seller_id(店铺ID,string) |  |
| start_date(查询开始时间,string) |  |
| end_date(查询结束时间,string) |  |
| page_no(页码,integer) |  |
| page_size(每页数量,integer) |  |
| shipment_id_list(货件ID列表,array) |  |
| shipment_name(货件名称,string) |  |
| shipment_status_list(货件状态列表,array) |  |
| msku(MSKU,string) |  |
| fnsku(FNSKU,string) |  |
| updated_at_start(更新时间-开始,string) |  |
| updated_at_end(更新时间-结束,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| id(货件ID,string) |  |
| shipment_name(货件名称,string) |  |
| shipment_status(货件状态,string) |  |
| destination_fulfillment_center_id(目的地运营中心ID,string) |  |
| label_prep_type(标签准备类型,string) |  |
| cases_required(是否需要箱子,boolean) |  |
| box_contents_source(箱子内容物来源,string) |  |
| packing_list_id(装箱单ID,integer) |  |
| packing_list_no(装箱单号,string) |  |
| packing_status(装箱状态,integer) |  |
| total_skus(总SKU数,integer) |  |
| total_units(总件数,integer) |  |
| total_carton(总箱数,integer) |  |
| total_weight(总重量,number) |  |
| weight_unit(重量单位,string) |  |
| total_volume(总体积,number) |  |
| volume_unit(体积单位,string) |  |
| logistics_channel_name(物流渠道,string) |  |
| logistics_status(物流状态,integer) |  |
| logistics_status_name(物流状态名称,string) |  |
| logistics_bill_no(物流单号,string) |  |
| logistics_transport_type(运输方式,integer) |  |
| logistics_transport_type_name(运输方式名称,string) |  |
| logistics_cost(物流费用,number) |  |
| currency_code(币种,string) |  |
| avg_logistics_cost(平均物流成本,number) |  |
| reference_id(参考号,string) |  |
| created_at(创建时间,string) |  |
| updated_at(更新时间,string) |  |
| items(货件商品列表,array) |  |

> **备注**: 返回字段列表过长，截图可能未完全显示所有字段。


### 查询补货计划列表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/fba/shipmentPlan/getShipmentPlanLists` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| date_type(日期类型,string) |  |
| date_from(开始日期,string) |  |
| date_to(结束日期,string) |  |
| status(补货计划状态,array) |  |
| warehouse_id(计划发货仓ID,array) |  |
| seller_id(店铺ID,array) |  |
| marketplace_id(站点ID,array) |  |
| msku(MSKU,array) |  |
| fnsku(FNSKU,array) |  |
| asin(ASIN,array) |  |
| plan_type(计划类型,array) |  |
| is_suggestion(是否建议补货,integer) |  |
| page(页码,integer) |  |
| offset(每页数量,integer) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| plan_id(补货计划ID,string) |  |
| plan_name(补货计划名称,string) |  |
| seller_name(店铺名称,string) |  |
| marketplace_name(站点名称,string) |  |
| warehouse_name(计划发货仓,string) |  |
| plan_type_name(计划类型,string) |  |
| status(状态,integer) |  |
| status_name(状态名称,string) |  |
| is_suggestion_name(是否建议补货,string) |  |
| msku(MSKU,string) |  |
| fnsku(FNSKU,string) |  |
| asin(ASIN,string) |  |
| listing_sku(SKU,string) |  |
| listing_title(产品标题,string) |  |
| listing_img(产品图片,string) |  |
| plan_quantity(计划发货量,number) |  |
| shipped_quantity(已创建货件量,number) |  |
| received_quantity(已接收数量,number) |  |
| purchase_plan_quantity(关联采购计划量,number) |  |
| purchase_shipped_quantity(采购在途量,number) |  |
| purchase_received_quantity(采购已入库量,number) |  |
| purchase_plan_list(关联采购计划,array) |  |
| logistics_name(运输方式,string) |  |
| estimated_cost(预估费用,number) |  |
| estimated_cost_currency(预估费用币种,string) |  |
| created_at(创建时间,string) |  |
| updated_at(更新时间,string) |  |
| created_by_name(创建人,string) |  |
| updated_by_name(更新人,string) |  |
| remark(备注,string) |  |
| plan_sn(补货计划编号,string) |  |
| box_num(箱数,number) |  |
| weight(预估总重量,number) |  |
| volume(预估总体积,number) |  |
| size_tier_name(尺寸分段,string) |  |
| prep_owner(标签方,string) |  |
| prep_type(标签类型,string) |  |
| packing_type(包装方式,string) |  |
| packing_type_name(包装方式名称,string) |  |
| is_suggestion(是否建议补货,integer) |  |
| plan_quantity_total(计划发货量汇总,number) |  |
| shipped_quantity_total(已创建货件量汇总,number) |  |
| received_quantity_total(已接收数量汇总,number) |  |
| purchase_plan_quantity_total(关联采购计划量汇总,number) |  |
| purchase_shipped_quantity_total(采购在途量汇总,number) |  |
| purchase_received_quantity_total(采购已入库量汇总,number) |  |
| box_num_total(箱数汇总,number) |  |
| weight_total(预估总重量汇总,number) |  |
| volume_total(预估总体积汇总,number) |  |


### 查询规则 - ASIN

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/rule/asin/queryRuleByAsin` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺ID,int) |  |
| ASIN(ASIN,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(提示信息,string) |  |
| error_detail(错误明细,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,object) |  |
| data->fbaFulfillable(FBA可售,number) |  |
| data->fbaInbound(FBA来货,number) |  |
| data->fbaReserved(FBA预留,number) |  |
| data->fbaUnfulfillable(FBA不可售,number) |  |
| data->stock_purchase(采购在途,number) |  |
| data->stock_fba_transfer(FBA调拨,number) |  |
| data->stock_local_transfer(本地调拨,number) |  |
| data->stock_local_oversea_send(本地仓直发-海外,number) |  |
| data->stock_frequency_local_send(本地仓直发频率,number) |  |
| data->stock_frequency_oversea_send(海外仓直发频率,number) |  |
| data->stock_day(可售天数,number) |  |
| data->stock_ignore_internal_stock(忽略国内仓库存,int) |  |
| data->stock_ignore_history_out_stock(忽略历史缺货,int) |  |
| data->stock_safe_day(安全销售天数,number) |  |
| data->stock_default_stocking_air(默认空运补货,number) |  |
| data->stock_default_stocking_sea(默认海运补货,number) |  |
| data->stock_default_oversea_air(默认海外仓空运补货,number) |  |
| data->stock_default_oversea_sea(默认海外仓海运补货,number) |  |
| data->stock_frequency(发货频率,number) |  |
| data->stock_suggest_qty(建议补货量,number) |  |
| data->stock_suggest_qty_air(建议空运补货量,number) |  |
| data->stock_suggest_qty_sea(建议海运补货量,number) |  |
| data->stock_suggest_qty_oversea_air(建议海外仓空运补货量,number) |  |
| data->stock_suggest_qty_oversea_sea(建议海外仓海运补货量,number) |  |
| data->stock_default_type_stocking(默认补货方式,int) |  |


### 查询评价统计-Feedback列表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/cs/feedbackReport/lists` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| offset(分页偏移量,默认0,int) |  |
| length(分页长度,默认20,int) |  |
| start_date(开始时间,时间间隔不超过1年,格式:Y-m-d,string) |  |
| end_date(结束时间,时间间隔不超过1年,格式:Y-m-d,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0成功,int) |  |
| message(响应信息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,array) |  |
| data>>count_lifetime(feedback总数,number) |  |
| data>>count_12(近1年feedback数,number) |  |
| data>>count_30(近30天feedback,number) |  |
| data>>count_90(近90天feedback,number) |  |
| data>>feedback_num(feedback获取总数,number) |  |
| data>>five_star(五星feedback获取数,number) |  |
| data>>four_star(四星feedback获取数,number) |  |
| data>>three_star(三星feedback获取数,number) |  |
| data>>two_star(二星feedback获取数,number) |  |
| data>>one_star(一星feedback获取数,number) |  |
| data>>modified_num(feedback到评数,number) |  |
| data>>seller_name(店铺名称,string) |  |
| data>>country(国家,string) |  |
| data>>score(评分,number) |  |
| data>>negative_lifetime(feedback累计差评率,number) |  |
| data>>neutral_lifetime(feedback累计中评率,number) |  |
| data>>positive_lifetime(feedback累计好评率,number) |  |
| total(总数,int) |  |


### 统计-查询退货分析

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/fba/returnAnalysis` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| dimension(统计维度,string) |  |
| origin(订单来源,string) |  |
| offset(分页条数,integer) |  |
| start_date(开始时间,string) |  |
| end_date(结束时间,string) |  |
| date_type(时间类型,string) |  |
| shop(店铺ID,array) |  |
| person_liable_id(销售负责人ID,array) |  |
| marketplace_ids(站点,array) |  |
| return_date_type(退款日期类型,string) |  |
| currency(币种,string) |  |
| sku_type(商品类型,array) |  |
| brand_id(品牌ID,array) |  |
| product_label_id(产品标签ID,array) |  |
| product_status(产品状态,array) |  |
| logistics_type(物流方式,array) |  |
| is_fnsku(是否FNSKU,integer) |  |
| is_fba(是否FBA,integer) |  |
| is_exist_order(是否存在订单,integer) |  |
| key_words_type(关键词类型,string) |  |
| key_words(关键词,string) |  |
| sort_field(排序字段,string) |  |
| sort_order(排序方式,string) |  |
| is_page(是否分页,integer) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,integer) |  |
| data(数据,object) |  |
| total(总条数,integer) |  |
| current_page(当前页,integer) |  |
| last_page(最后一页,integer) |  |
| per_page(每页数量,integer) |  |
| list(列表,array) |  |
| return_date(退货日期,string) |  |
| order_id(订单号,string) |  |
| shop_name(店铺,string) |  |
| marketplace_name(站点,string) |  |
| asin(ASIN,string) |  |
| fnsku(FNSKU,string) |  |
| msku(MSKU,string) |  |
| sku(SKU,string) |  |
| product_name(商品名称,string) |  |
| quantity(数量,integer) |  |
| disposition(FBA处理结果,string) |  |
| customer_comments(买家评论,string) |  |
| status(状态,string) |  |
| detailed_disposition(详细处理结果,string) |  |
| reason(退货原因,string) |  |
| license_plate_number(LPN,string) |  |
| person_liable_name(销售负责人,string) |  |
| parent_asin(父ASIN,string) |  |
| product_img_url(商品图片,string) |  |
| sale_price(销售额,number) |  |
| sale_price_cny(销售额(CNY),number) |  |
| refund_price(退款金额,number) |  |
| refund_price_cny(退款金额(CNY),number) |  |



---

## 产品

### 查询优惠券详情+listing+订单(批量)

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/listing/openapi/v1/listing/getListingAndCouponByMarketplace` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sellerId(店铺ID,string) |  |
| marketplaceId(站点ID,string) |  |
| idType(ID类型,string) |  |
| idList(ID列表,array) |  |
| isIncludeCouponFlag(是否包含优惠券,boolean) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| sellerId(店铺ID,string) |  |
| marketplaceId(站点ID,string) |  |
| asin(ASIN,string) |  |
| fnsku(FNSKU,string) |  |
| sku(SKU,string) |  |
| sellerSku(卖家SKU,string) |  |
| listingId(listingId,string) |  |
| openDate(创建时间,string) |  |
| price(价格,number) |  |
| warehouseQuantity(仓库数量,integer) |  |
| shippingQuantity(在途数量,integer) |  |
| title(标题,string) |  |
| imageUrl(图片链接,string) |  |
| parentAsin(父ASIN,string) |  |
| couponList(优惠券列表,array) |  |

> **备注**: 无


### 查询亚马逊Listing

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/listing/list` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| seller_id(店铺ID,string) |  |
| listing_type(查询类型,string) |  |
| listing_param_type(查询参数,string) |  |
| listing_param_value(查询内容,string) |  |
| page_no(页码,integer) |  |
| page_size(每页大小,integer) |  |
| sort_name(排序字段,string) |  |
| sort_order(排序方式,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| id(listing id,integer) |  |
| seller_id(店铺id,integer) |  |
| seller_name(店铺名称,string) |  |
| marketplace_id(站点id,string) |  |
| marketplace_name(站点名称,string) |  |
| seller_sku(seller sku,string) |  |
| fnsku(fnsku,string) |  |
| asin(asin,string) |  |
| parent_asin(父asin,string) |  |
| product_name(产品名称,string) |  |
| product_image(产品图片,string) |  |
| product_group(产品分组,string) |  |
| review_avg_star(review评分,number) |  |
| review_num(review数量,integer) |  |
| shipping_type(运输类型,string) |  |
| listing_status(listing状态,string) |  |
| open_date(创建日期,string) |  |
| local_shipping(运输模板,string) |  |
| price(价格,number) |  |
| cost(采购成本,number) |  |
| weight(重量,number) |  |
| fba_inventory_num(FBA库存,integer) |  |
| fba_transfer_num(FBA中转数量,integer) |  |
| fba_customer_return_num(FBA客户退货数,integer) |  |
| fba_inventory_total_num(FBA总库存,integer) |  |
| fba_undeliverable_num(FBA不可售数量,integer) |  |
| fba_researching_num(FBA调查中数量,integer) |  |
| fba_reserved_num(FBA预留数量,integer) |  |
| fba_inbound_num(FBA入库数量,integer) |  |
| fba_can_ship_num(FBA可售数量,integer) |  |
| fba_transfer_inventory_num(FBA在途数量,integer) |  |
| afn_fulfillable_quantity(可售数量,integer) |  |
| afn_reserved_quantity(预留数量,integer) |  |
| afn_inbound_working_quantity(正在操作中,integer) |  |
| afn_inbound_shipped_quantity(已发货,integer) |  |
| afn_inbound_receiving_quantity(正在接收,integer) |  |
| afn_researching_quantity(调查中,integer) |  |
| afn_total_quantity(总库存,integer) |  |
| afn_unsellable_quantity(不可售,integer) |  |
| per_unit_volume(单位体积,number) |  |
| is_exist_fba_fee(是否存在FBA费用,boolean) |  |
| is_exist_ad(是否存在广告,boolean) |  |
| update_time(更新时间,string) |  |
| create_time(创建时间,string) |  |


### 查询多属性产品详情

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/product/variationProductInfo` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| seller_id(店铺ID,string) |  |
| spu(SPU,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,integer) |  |
| message(返回信息,string) |  |
| data(返回数据,object) |  |
| trace_id(请求ID,string) |  |
| request_time(请求时间,string) |  |
| list(数据列表,array) |  |
| variation_id(子商品ID,integer) |  |
| variation_name(子商品名称,string) |  |
| seller_sku(子商品SKU,string) |  |
| asin(ASIN,string) |  |
| price(价格,number) |  |
| stock(库存,integer) |  |
| status(状态,integer) |  |
| images(图片,array) |  |
| length(长,number) |  |
| width(宽,number) |  |
| height(高,number) |  |
| weight(重量,number) |  |
| package_length(包装长,number) |  |
| package_width(包装宽,number) |  |
| package_height(包装高,number) |  |
| package_weight(包装重量,number) |  |

> **备注**: 无


### 查询多属性产品列表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/routing/storage/spu/spuList` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| offset(分页偏移量,int) |  |
| length(分页长度, 上限200,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码, 0成功,int) |  |
| message(提示信息,string) |  |
| request_id(请求链路ID,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(数据,array) |  |
| ps_id(SPU唯一ID,int) |  |
| spu(SPU,string) |  |
| spu_name(SPU名称,string) |  |
| model(型号,string) |  |
| cid(分类ID,int) |  |
| wid(仓库ID,int) |  |
| developer_uid(开发人员ID,int) |  |
| cg_uid(采购员ID,int) |  |
| purchase_remark(采购备注,string) |  |
| cg_price(采购成本,string) |  |
| cg_delivery(交期,int) |  |
| create_uid(创建人ID,string) |  |
| create_time(创建时间,string) |  |
| status(状态,int) |  |


### 查询产品属性列表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/tool/v2/storage/attribute/attributeList` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| offset(分页偏移量,int) |  |
| length(分页长度, 上限200,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码, 0成功,int) |  |
| message(消息提示,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求ID,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,object) |  |
| data>>total(总数,int) |  |
| data>>list(数据列表,array) |  |
| data>>list>>spa_id(类型id,int) |  |
| data>>list>>attr_name(属性名称,string) |  |
| data>>list>>create_time(属性创建时间,string) |  |
| data>>list>>item_list(属性值列表,array) |  |
| data>>list>>item_list>>pal_id(类型id,int) |  |
| data>>list>>item_list>>pa_id(属性id,int) |  |
| data>>list>>item_list>>attr_value(属性值,string) |  |
| data>>list>>item_list>>create_time(属性值创建时间,string) |  |


### 批量查询本地产品详情

| 属性 | 值 |
|------|------|
| **API Path** | `/openapi/v2/product/local/lists` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| seller_id(店铺ID,string) |  |
| msku_list(MSKU列表,array) |  |
| local_sku_list(本地SKU列表,array) |  |
| warehouse_sku_list(仓库SKU列表,array) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| local_product_id(本地产品ID,integer) |  |
| seller_id(店铺ID,integer) |  |
| msku(MSKU,string) |  |
| local_sku(本地SKU,string) |  |
| warehouse_sku(仓库SKU,string) |  |
| product_name(产品名称,string) |  |
| product_image(产品图片,string) |  |
| product_category(产品分类,string) |  |
| status(产品状态,integer) |  |
| product_weight(产品重量,number) |  |
| product_length(产品长度,number) |  |
| product_width(产品宽度,number) |  |
| product_height(产品高度,number) |  |
| purchase_price(最新采购价,number) |  |
| purchase_freight(采购运费,number) |  |
| purchase_days(采购天数,integer) |  |
| supplier_name(默认供应商,string) |  |
| supplier_link(供应商链接,string) |  |
| purchase_from(采购来源,string) |  |
| brand(品牌,string) |  |
| designer(开发员,string) |  |
| buyer(采购员,string) |  |
| responsible_person(负责人,string) |  |
| customs_name_cn(中文报关名,string) |  |
| customs_name_en(英文报关名,string) |  |
| customs_code(海关编码,string) |  |
| declaration_price(申报价格,number) |  |
| declaration_currency(申报币种,string) |  |
| declaration_weight(申报重量,number) |  |
| dangerous_goods(是否危险品,integer) |  |
| dangerous_goods_type(危险品类型,string) |  |
| fnsku(FNSKU,string) |  |
| asin(ASIN,string) |  |
| parent_asin(父ASIN,string) |  |
| upc(UPC,string) |  |
| ean(EAN,string) |  |
| package_weight(包装重量,number) |  |
| package_length(包装长度,number) |  |
| package_width(包装宽度,number) |  |
| package_height(包装高度,number) |  |
| packing_material(包装材质,string) |  |
| packing_quantity(装箱量,integer) |  |
| packing_weight(装箱重量,number) |  |
| packing_length(装箱长度,number) |  |
| packing_width(装箱宽度,number) |  |
| packing_height(装箱高度,number) |  |
| created_at(创建时间,string) |  |
| updated_at(更新时间,string) |  |
| remark(备注,string) |  |
| warehouse_list(仓库列表,array) |  |


### 查询本地产品详情

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/product/localProductInfo` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| seller_id(店铺ID,string) |  |
| msku(本地产品MSKU,string) |  |
| product_name(产品名称,string) |  |
| local_sku(本地产品SKU,string) |  |
| page_no(页码,integer) |  |
| page_size(每页大小,integer) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| id(主键ID,integer) |  |
| product_id(产品ID,integer) |  |
| seller_id(店铺ID,string) |  |
| seller_name(店铺名称,string) |  |
| product_name(产品名称,string) |  |
| product_name_cn(产品中文名称,string) |  |
| product_name_en(产品英文名称,string) |  |
| product_sku(产品SKU,string) |  |
| local_sku(本地产品SKU,string) |  |
| msku(本地产品MSKU,string) |  |
| asin(ASIN,string) |  |
| fnsku(FNSKU,string) |  |
| upc(UPC,string) |  |
| ean(EAN,string) |  |
| product_status(产品状态,integer) |  |
| product_type(产品类型,integer) |  |
| product_weight(产品重量,number) |  |
| product_length(产品长度,number) |  |
| product_width(产品宽度,number) |  |
| product_height(产品高度,number) |  |
| package_weight(包装重量,number) |  |
| package_length(包装长度,number) |  |
| package_width(包装宽度,number) |  |
| package_height(包装高度,number) |  |
| purchase_price(采购单价,number) |  |
| head_trip_fee(头程费用,number) |  |
| tariff(关税,number) |  |
| product_cost(产品成本,number) |  |
| packing_charges(打包发货费,number) |  |
| logistics_cost(物流成本,number) |  |
| other_cost(其它成本,number) |  |
| total_cost(总成本,number) |  |
| selling_price(销售价格,number) |  |
| platform_fee(平台费用,number) |  |
| fba_fee(FBA费用,number) |  |
| cpc_fee(CPC广告费,number) |  |
| vat_fee(VAT税费,number) |  |
| other_fee(其它费用,number) |  |
| total_fee(总费用,number) |  |
| profit(利润,number) |  |
| profit_rate(利润率,number) |  |
| product_img_url(产品图片URL,string) |  |
| product_url(产品URL,string) |  |
| product_brand(产品品牌,string) |  |
| product_supplier(产品供应商,string) |  |
| product_category(产品分类,string) |  |
| product_level(产品分级,string) |  |
| product_owner(开发员,string) |  |
| product_sales(销售员,string) |  |
| product_designer(美工,string) |  |
| create_time(创建时间,string) |  |
| update_time(更新时间,string) |  |
| create_by(创建人,string) |  |
| update_by(更新人,string) |  |
| remark(备注,string) |  |
| is_delete(是否删除,integer) |  |
| is_combination(是否是组合产品,integer) |  |
| combination_detail(组合产品详情,string) |  |
| is_enable_cost_calculate(是否开启成本计算,integer) |  |
| cost_calculate_type(成本计算方式,integer) |  |
| cost_calculate_value(成本计算值,number) |  |
| is_enable_purchase_suggest(是否开启采购建议,integer) |  |
| purchase_suggest_type(采购建议方式,integer) |  |
| purchase_suggest_value(采购建议值,number) |  |
| is_enable_inventory_warning(是否开启库存预警,integer) |  |
| inventory_warning_type(库存预警方式,integer) |  |
| inventory_warning_value(库存预警值,number) |  |
| is_enable_sales_warning(是否开启销量预警,integer) |  |
| sales_warning_type(销量预警方式,integer) |  |
| sales_warning_value(销量预警值,number) |  |
| is_enable_fba_return_warning(是否开启FBA退货预警,integer) |  |
| fba_return_warning_type(FBA退货预警方式,integer) |  |
| fba_return_warning_value(FBA退货预警值,number) |  |


### 查询本地产品详情

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/localProductInfo` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| seller_id(店铺ID,string) |  |
| msku(本地产品SKU,string) |  |
| product_id(产品ID,integer) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| product_id(产品ID,integer) |  |
| seller_id(店铺ID,string) |  |
| msku(本地产品SKU,string) |  |
| asin(ASIN,string) |  |
| fnsku(FNSKU,string) |  |
| product_name(产品名称,string) |  |
| product_image(产品图片,string) |  |
| product_status(产品状态,integer) |  |
| product_status_name(产品状态名称,string) |  |
| category_id(产品分类ID,integer) |  |
| category_name(产品分类名称,string) |  |
| brand_id(品牌ID,integer) |  |
| brand_name(品牌名称,string) |  |
| supplier_id(供应商ID,integer) |  |
| supplier_name(供应商名称,string) |  |
| purchase_price(采购单价,number) |  |
| purchase_price_currency(采购单价币种,string) |  |
| head_trip_fee(头程费用,number) |  |
| head_trip_fee_currency(头程费用币种,string) |  |
| pack_weight(包装重量,number) |  |
| pack_weight_unit(包装重量单位,string) |  |
| net_weight(净重,number) |  |
| net_weight_unit(净重单位,string) |  |
| product_length(长,number) |  |
| product_width(宽,number) |  |
| product_height(高,number) |  |
| product_size_unit(尺寸单位,string) |  |
| pack_length(包装后长,number) |  |
| pack_width(包装后宽,number) |  |
| pack_height(包装后高,number) |  |
| pack_size_unit(包装后尺寸单位,string) |  |
| dev_officer_id(开发负责人ID,integer) |  |
| dev_officer_name(开发负责人,string) |  |
| pur_officer_id(采购负责人ID,integer) |  |
| pur_officer_name(采购负责人,string) |  |
| sale_officer_id(销售负责人ID,integer) |  |
| sale_officer_name(销售负责人,string) |  |
| designer_id(美工ID,integer) |  |
| designer_name(美工,string) |  |
| customs_name_cn(中文报关名,string) |  |
| customs_name_en(英文报关名,string) |  |
| customs_code(海关编码,string) |  |
| tax_rebate_rate(退税率,number) |  |
| declare_price(申报价值,number) |  |
| declare_price_currency(申报价值币种,string) |  |
| declare_weight(申报重量,number) |  |
| declare_weight_unit(申报重量单位,string) |  |
| dangerous_goods(是否危险品,integer) |  |
| dangerous_goods_type(危险品类型,string) |  |
| create_time(创建时间,string) |  |
| update_time(更新时间,string) |  |
| create_by(创建人,string) |  |
| update_by(更新人,string) |  |
| is_delete(是否删除,integer) |  |
| is_multi(是否多属性,integer) |  |
| parent_id(父产品ID,integer) |  |
| parent_msku(父MSKU,string) |  |
| remark(备注,string) |  |
| label_print_status(标签打印状态,integer) |  |
| label_print_num(标签打印次数,integer) |  |
| label_last_print_time(标签最后打印时间,string) |  |
| label_last_print_by(标签最后打印人,string) |  |
| supplier_product_code(供应商产品编码,string) |  |
| supplier_product_link(供应商产品链接,string) |  |
| supplier_product_name(供应商产品名称,string) |  |
| supplier_min_buy_num(供应商起订量,integer) |  |
| supplier_delivery_day(供应商交期,integer) |  |
| supplier_remark(供应商备注,string) |  |
| supplier_price_list(供应商价格阶梯,array) |  |
| custom_clearance_material(清关材质,string) |  |
| use(用途,string) |  |


### 查询竞品监控列表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/asinMonitor/list` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| levels(竞品等级,array) |  |
| update_time_start(更新时间【开始时间】,string) |  |
| update_time_end(更新时间【结束时间】,string) |  |
| search_field(搜索字段,string) |  |
| search_value(搜索值,string) |  |
| offset(分页页码,int) |  |
| length(分页长度,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(提示信息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求ID,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(数据列表,array) |  |
| data->id(监控ID,int) |  |
| data->title(商品标题,string) |  |
| data->asin(ASIN,string) |  |
| data->asin_url(商品链接,string) |  |
| data->price(商品价格,string) |  |
| data->currency(货币,string) |  |
| data->is_self(是否本店商品,int) |  |
| data->category_list(商品类目,array) |  |
| data->category_list->category_name(分类名称,string) |  |
| data->rating(评分,string) |  |
| data->star(星级,string) |  |
| data->review_num(review数量,int) |  |
| data->big_category_rank(大类排名名次,int) |  |
| data->big_category(大类排名名称,string) |  |
| data->small_category_rank(小类排名名次,int) |  |
| data->small_ranks(小类排名,array) |  |
| data->monitor_status(监控状态,int) |  |
| data->monitor_uid(监控记录创建人uid,string) |  |
| data->monitor_uids(监控用户ID,array) |  |
| data->creator(商品记录创建人,string) |  |
| data->last_update_event(最近更新事件,string) |  |
| data->search_term(Search Term,string) |  |
| data->main_image(主图,string) |  |
| data->thumbnail(商品缩略图,array) |  |
| data->item_bullets(五点描述,array) |  |
| data->item_weight(商品重量,string) |  |
| data->product_dimensions(商品尺寸,string) |  |
| data->fbm_seller_num(fbm卖家数量,int) |  |
| data->self_fba_seller_num(当前fba卖家数量,int) |  |
| data->buybox_price(当前Buybox价格,string) |  |
| data->buybox_currency(当前Buybox价格币种,string) |  |
| data->buybox_usd_price(当前Buybox价格USD价格,string) |  |
| data->avg_price(平均价格,string) |  |
| data->avg_currency(平均价格币种,string) |  |


### 查询预警消息列表-商品

| 属性 | 值 |
|------|------|
| **API Path** | `/data/open/listings/warningMessage/getList` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| offset(分页偏移量,int) |  |
| length(分页长度,默认50,上限200,int) |  |
| model_id_list(预警模型,array) |  |
| sids(店铺id,对应店铺列表接口对应字段【sid】,array) |  |
| start_date(开始日期【精确到时】,格式:Y-m-d,时间间隔最长不超过90天,string) |  |
| end_date(结束日期【精确到时】,格式:Y-m-d,时间间隔最长不超过90天,string) |  |
| search_field(搜索类型,string) |  |
| search_value(搜索值,string) |  |
| show_status(处理状态,0 待处理 1 全部,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(返回码,0 成功,int) |  |
| message(消息提示,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链接id,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| data>>message_id(用户消息bid,string) |  |
| data>>image_url(图片地址,string) |  |
| data>>asin(ASIN,string) |  |
| data>>asin_url(ASIN链接,string) |  |
| data>>msku_list(msku列表,array) |  |
| data>>msku(MSKU,string) |  |
| data>>title(标题,string) |  |
| data>>sku_list(sku列表,array) |  |
| data>>sku_list>>local_sku(本地产品SKU,string) |  |
| data>>sku_list>>local_name(品名,string) |  |
| data>>country(国家市场,string) |  |
| data>>model_id(modelId,string) |  |
| data>>model_name(预警模型,string) |  |
| data>>rule_id(规则id,string) |  |
| data>>rule_name(规则名称,string) |  |
| data>>metric(监控指标,string) |  |
| data>>notify_way_str(通知方式说明,string) |  |
| data>>notify_time(提醒时间,string) |  |
| data>>receive_id(接收人id,string) |  |
| data>>receiver(接收人名称,string) |  |
| data>>handle_status(处理状态,string) |  |
| data>>handle_status_str(处理状态说明,string) |  |
| data>>read_status(阅读状态,string) |  |
| data>>read_status_str(阅读状态说明,string) |  |
| data>>monitor_time(预警时间,string) |  |



---

## 库存

### 领星ERP与外部系统实现库存双向同步 (接口概览)

| 属性 | 值 |
|------|------|
| **API Path** | `N/A` |
| **请求方式** | N/A |

> **备注**: 该截图为'库存双向同步'功能的接口概览，并非单个API的详细文档。图中涉及的接口包括：查询亚马逊店铺基础信息、查询本地产品列表、添加/编辑本地产品、查询本地仓库列表、添加/编辑仓库、创建待到货的采购单、添加入库单、添加出库单、生成已发货的发货单、创建调拨单、查询采购单列表、查询调拨单列表、查询发货单列表、查询海外仓备货单列表、查询库存流水、查询仓库库存明细。


### 查询批次明细

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/inv/local_inventory/getBatchDetailList` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| offset(页码,int) |  |
| length(每页条数,int) |  |
| show_zero_stock(是否显示0库存,int) |  |
| pids(仓库id,string) |  |
| stock_in_type_list(入库类型,string) |  |
| search_field(搜索字段,string) |  |
| search_value(搜索值,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(信息提示,string) |  |
| error_details(错误信息,string) |  |
| request_id(请求ID,string) |  |
| response_time(响应时间,string) |  |
| total(总记录数,int) |  |
| data(响应数据,object) |  |
| data.batch_no(批次号,string) |  |
| data.stock_batch_no(批次号,string) |  |
| data.order_sn(入库单号,string) |  |
| data.order_type(入库单类型,int) |  |
| data.order_type_name(入库单类型描述,string) |  |
| data.product_id(产品ID,int) |  |
| data.product_name(品名,string) |  |
| data.sku(SKU,string) |  |
| data.stock_id(仓库ID,int) |  |
| data.stock_name(仓库名称,string) |  |
| data.msku(MSKU,string) |  |
| data.fnsku(FNSKU,string) |  |
| data.warehouse_name(仓位名称,string) |  |
| data.unit_name(单位,string) |  |
| data.total_balance_num(库存结余,int) |  |
| data.balance_num(库存结余,int) |  |
| data.total_transit_num(在途总量,int) |  |
| data.total_travel_num(待入库总量,int) |  |
| data.travel_num(待入库量,int) |  |
| data.cost_rmb(采购成本,int) |  |
| data.plan_sn(计划单号,string) |  |
| data.purchase_order_sn(采购单号,string) |  |
| data.receive_order_sn(收货单号,string) |  |
| data.supplier_id(供应商ID,int) |  |
| data.supplier_name(供应商名称,string) |  |
| data.amount(采购单价,float) |  |
| data.head_ship_cost(头程运费,float) |  |
| data.tax(关税,float) |  |
| data.stock_cost(库存成本,float) |  |


### 查询仓位库存明细

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/report/data/local_inventory/inventoryBinDetails` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| wid(多个仓库用英文逗号分隔,默认所有仓库,string) |  |
| bin_type_list(仓位类型,多个类型用英文逗号分隔:1.待检验仓 2.可用正品仓 3.次品仓 4.待销毁仓 5.可用仓,string) |  |
| offset(分页偏移量,默认0,int) |  |
| length(分页长度,默认20,上限500,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0成功,int) |  |
| message(返回消息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求ID,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,array) |  |
| data->wid(仓库id,int) |  |
| data->wh_name(仓库名称,string) |  |
| data->whb_id(仓位id,int) |  |
| data->whb_name(仓位名称,string) |  |
| data->whb_type(仓位类型,string) |  |
| data->whb_type_name(仓位类型名称,string) |  |
| data->product_id(商品id,int) |  |
| data->sku(SKU,string) |  |
| data->seller_id(店铺id,string) |  |
| data->fnsku(FNSKU,string) |  |
| data->total(总量,int) |  |
| data->lockNum(锁定量,int) |  |
| data->pickNum(未拣货量,string) |  |
| data->third_inventory(海外仓第三方库存信息,object) |  |
| data->third_inventory->qty_sellable(可用量,int) |  |
| data->third_inventory->qty_pending(待上架库存,int) |  |
| data->third_inventory->qty_reserved(锁定库存,int) |  |
| data->third_inventory->qty_onway(备货在途,int) |  |
| total(总条数,int) |  |


### 查询AWD库存列表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/v2/warehouse/awd/stocks` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| wids(店铺ID, 对应店铺列表, 批量查询,string) |  |
| cid(分区ID,string) |  |
| sid(仓库ID,string) |  |
| asin_principals(货物信息,array) |  |
| search_field(搜索字段, 指定的搜索条件,string) |  |
| search_value(搜索值,string) |  |
| status(状态,string) |  |
| is_hide_zero_stock(隐藏0库存,number) |  |
| offset(分页偏移量,number) |  |
| length(分页条数,number) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码, 0:成功,string) |  |
| message(提示信息,string) |  |
| error_details(异常明细,array) |  |
| request_id(请求ID,string) |  |
| response_time(响应时间,string) |  |
| data(array) |  |
| data->list(array) |  |
| data->list->wid(店铺ID,string) |  |
| data->list->seller_name(店铺名称,string) |  |
| data->list->wid+seller_name(店铺,string) |  |
| data->list->msku(MSKU,string) |  |
| data->list->master_sku(主SKU,string) |  |
| data->list->fnsku(FNSKU,string) |  |
| data->list->asin(ASIN,string) |  |
| data->list->asin_url(ASIN链接,string) |  |
| data->list->seller_sku(Seller SKU,string) |  |
| data->list->sku(SKU,string) |  |
| data->list->product_name(品名,string) |  |
| data->list->product_brand_name(品牌,string) |  |
| data->list->small_image_url(存货图片,string) |  |
| data->list->product_id(产品ID,string) |  |
| data->list->category_level1(分类层级1,string) |  |
| data->list->product_brand_text(品牌,string) |  |
| data->list->category_level2(分类层级2,string) |  |
| data->list->category_level3(分类层级3,string) |  |
| data->list->category_text(类目,string) |  |
| data->list->attribute(属性,string) |  |
| data->list->attribute_with_name(属性名称,string) |  |
| data->list->attribute_with_value(属性值,string) |  |
| data->list->asin_principal_list(Listing负责人,array) |  |
| data->list->total_inbound_quantity(AWD在途数量,number) |  |
| data->list->available_quantity(AWD可用数量,number) |  |
| data->list->reserved_quantity(AWD预留数量,number) |  |
| data->list->inbound_quantity(在途数量,number) |  |
| data->list->fulfillable_quantity(可售数量,number) |  |
| data->list->reserved_actual_quantity_shipped(AWD预留-实际发货,number) |  |
| data->list->reserved_fc_transfers_quantity_price(AWD预留-FC转运,number) |  |
| data->list->reserved_customerorders_quantity_price(AWD预留-买家订单,number) |  |
| data->list->reserved_total_quantity_price(AWD预留-合计,number) |  |
| data->list->inbound_quantity_shipped_price(AWD在途-已发货,number) |  |
| data->list->inbound_quantity_receiving_price(AWD在途-接收中,number) |  |
| data->list->inbound_quantity_shipped_price(AWD在途-合计,number) |  |
| total(总数,number) |  |


### 查询仓库库存明细

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/hosting/data/local_inventory/inventoryDetails` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| wid(仓库id,多个使用英文逗号分隔,string) |  |
| offset(分页偏移量,默认0,int) |  |
| length(分页长度,默认20,上限800,int) |  |
| sku(sku,多个,模糊搜索,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0:成功,int) |  |
| message(消息提示,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求id,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| data>>wid(仓库id,int) |  |
| data>>product_id(本地产品id,int) |  |
| data>>sku(SKU,string) |  |
| data>>seller_id(店铺id,string) |  |
| data>>fnsku(FNSKU,string) |  |
| data>>product_total(实际库存总量,int) |  |
| data>>product_valid_num(可用量,int) |  |
| data>>product_bad_num(次品量,int) |  |
| data>>product_qc_num(待检待上架量,int) |  |
| data>>product_lock_num(锁定量,int) |  |
| data>>stock_cost_total(库存成本,string) |  |
| data>>quantity_receive(待收货量,int) |  |
| data>>stock_cost(单位库存成本,string) |  |
| data>>product_onway(调拨在途,int) |  |
| data>>transit_head_cost(调拨在途头程成本,string) |  |
| data>>average_age(平均库龄,int) |  |
| data>>third_inventory(海外仓第三方库存信息,object) |  |
| data>>stock_age_list(库龄信息,array) |  |
| data>>purchase_price(采购单价,string) |  |
| data>>price(单位费用,string) |  |
| data>>head_stock_price(单位头程,string) |  |
| data>>stock_price(单位库存成本,string) |  |


### 库存报表-本地仓-新报表-汇总

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/storageReport/local/aggregateList` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| start_date(开始时间,string) |  |
| end_date(结束时间,string) |  |
| sys_wid(仓库ID,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(消息提示,string) |  |
| request_id(请求链接id,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,array) |  |
| data->sys_wid(多仓库id,int) |  |
| data->ware_house_name(仓库名称,string) |  |
| data->product_count(商品数量,number) |  |
| data->allocation_in_cost(调拨入库-成本,number) |  |
| data->allocation_in_count(调拨入库-数量,number) |  |
| data->allocation_out_cost(调拨出库-成本,number) |  |
| data->allocation_out_count(调拨出库-数量,number) |  |



---

## 广告

### SB分摊

| 属性 | 值 |
|------|------|
| **API Path** | `/pb/openapi/newad/sbDivideAsinReports` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| profile_id(店铺profile_id,int) |  |
| report_date(报告日期,string) |  |
| offset(分页偏移量, 默认0,int) |  |
| length(分页长度, 默认15,int) |  |
| next_token(分页游标, 上次分页结果中的next_token,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码, 0成功,int) |  |
| message(提示消息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| next_token(分页游标, 填入下次请求中的next_token,string) |  |
| data(响应数据,array) |  |
| data>>report_date(报告日期,number) |  |
| data>>profile_id(profile_id,number) |  |
| data>>campaign_id(广告活动id,number) |  |
| data>>department_id(部门id,number) |  |
| data>>ad_group_id(广告组id,string) |  |
| data>>transaction_uuid(设置分摊的事务ID,用于追踪具体的分摊规则,string) |  |
| data>>asin(asin,number) |  |
| data>>sku(sku,number) |  |
| data>>impressions(展示量,number) |  |
| data>>clicks(点击数,string) |  |
| data>>spends(广告花费,array) |  |
| data>>orders(订单数,array) |  |
| data>>sales(广告销售额,array) |  |
| data>>units_sold(销售件数,array) |  |
| data>>same_orders(直接订单数,array) |  |
| data>>same_sales(直接广告销售额,array) |  |
| data>>same_units_sold(直接销售件数,array) |  |
| data>>divide_asin_md5(md5(ad_group_id, asin, sku),array) |  |
| data>>percent(分摊比例,array) |  |

> **备注**: 当next_token和offset同时存在时以next_token为准


### 出单时段分析 (产品)

| 属性 | 值 |
|------|------|
| **API Path** | `/adReport/productOrderAnalysis/list` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(VC广告店铺profile_id,string) |  |
| profile_id(VC广告活动profile_id,int) |  |
| sku(msku,最多10个,array) |  |
| start_date(开始日期,string) |  |
| end_date(结束日期,string) |  |
| group_type(时间维度,string) |  |
| sponsored_type(广告类型,array) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(消息提示,string) |  |
| error_details(错误明细,array) |  |
| request_id(请求ID,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,object) |  |
| data->list(数据列表,array) |  |
| data->list->sub_total(汇总行,string) |  |
| data->list->key(时间维度,string) |  |
| data->list->store_orders(店铺订单,string) |  |
| data->list->store_orders_percent(店铺订单百分比,string) |  |
| data->list->store_units(店铺销量,string) |  |
| data->list->store_units_percent(店铺销量百分比,string) |  |
| data->list->store_sales(店铺销售额,string) |  |
| data->list->store_sales_percent(店铺销售额百分比,string) |  |
| data->list->ad_orders(广告订单,string) |  |
| data->list->ad_orders_percent(广告订单百分比,string) |  |
| data->list->ad_units(广告销量,string) |  |
| data->list->ad_units_percent(广告销量百分比,string) |  |
| data->list->spend(花费,string) |  |
| data->list->impressions(曝光,string) |  |
| data->list->clicks(点击,string) |  |
| data->list->ad_sales_percent(广告销售额百分比,string) |  |
| data->list->spend_percent(花费百分比,string) |  |
| data->list->acos(acos,string) |  |
| data->list->ad_spend_store_percent(广告花费占总销售额百分比,string) |  |
| data->list->ad_store_percent(广告订单占总订单百分比,string) |  |
| data->list->ad_units_store_percent(广告销量占总销量百分比,string) |  |
| data->list->impression_store_percent(曝光量百分比,string) |  |
| data->list->clicks_percent(点击率百分比,string) |  |
| data->list->roas(roas,string) |  |
| data->list->ctr(ctr,string) |  |
| data->list->cpc(cpc,string) |  |
| data->list->cvr(cvr,string) |  |
| data->list->cpa(cpa,string) |  |
| data->list->key_chart(图表数据,string) |  |
| data->list->key_table(表格数据,string) |  |
| total(总计,int) |  |


### 查询DSP报告列表-订单

| 属性 | 值 |
|------|------|
| **API Path** | `/basicopen/dapReport/order/list` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| offset(分页偏移量,默认0,int) |  |
| length(分页长度,默认20,int) |  |
| profile_id(亚马逊店铺数字id,查询广告账号列表接口对应字段【profile_id】,string) |  |
| start_date(报告开始日期,双闭区间,格式:Y-m-d,时间间隔最长不超过90天,string) |  |
| end_date(报告结束日期,双闭区间,格式:Y-m-d,时间间隔最长不超过90天,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0成功,int) |  |
| message(消息提示,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| data>>profile_id(亚马逊店铺数字id,string) |  |
| data>>order_id(订单id,string) |  |
| data>>order_name(订单名称,string) |  |
| data>>advertiser_id(广告主id,string) |  |
| data>>advertiser_name(广告主名称,string) |  |
| data>>order_start_date(开始时间,string) |  |
| data>>order_end_date(结束时间,string) |  |
| data>>order_budget(预算,string) |  |
| data>>spends(花费,string) |  |
| data>>sales(销售额,string) |  |
| data>>orders(订单数,string) |  |
| data>>impressions(曝光,string) |  |
| data>>viewable_impressions(可见展示次数,string) |  |
| data>>clicks(点击,string) |  |
| data>>dpv(商品详情页浏览次数,string) |  |
| data>>total_add_to_cart(加购次数,string) |  |
| data>>order_currency(币种,string) |  |
| data>>ad_units(销量,string) |  |


### SD投放小时数据

| 属性 | 值 |
|------|------|
| **API Path** | `/pb/openapi/newad/sdTargetHourData` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| report_date(报告日期,格式: Y-m-d 只能查询最近60天,string) |  |
| campaign_id(广告活动id,number) |  |
| agg_dimension(聚合维度:target 投放维度, both_ad_target 广告+投放维度,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码, 0 成功,number) |  |
| message(提示消息,string) |  |
| total(总数,number) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,array) |  |
| data>>profile_id(店铺id,number) |  |
| data>>report_date(报告日期,string) |  |
| data>>hour(小时:0表示0-1点之间 1表示1-2点之间 以此类推,number) |  |
| data>>campaign_id(广告活动id,number) |  |
| data>>ad_id(广告id【聚合维度为: both_ad_target时,该字段有数据】,number) |  |
| data>>asin(asin【聚合维度为: both_ad_target时,该字段有数据】,String) |  |
| data>>msku(msku【聚合维度为: both_ad_target时,该字段有数据】,String) |  |
| data>>impressions(曝光量,number) |  |
| data>>clicks(点击量,number) |  |
| data>>cost(花费,number) |  |
| data>>same_orders(直接成交订单,number) |  |
| data>>orders(订单数,number) |  |
| data>>same_sales(直接销售额,number) |  |
| data>>sales(销售额,number) |  |
| data>>units(销量,number) |  |
| data>>ctr(点击/曝光,number) |  |
| data>>cpa(花费/订单数,number) |  |
| data>>acos(花费/销售额,number) |  |
| data>>cpc(花费/点击,number) |  |
| data>>roas(销售额/花费,number) |  |
| data>>cvr(订单数/点击,number) |  |
| data>>group_id(广告组id,number) |  |
| data>>targeting_id(投放id,number) |  |
| data>>targeting(投放表达式,string) |  |


### SD广告小时数据

| 属性 | 值 |
|------|------|
| **API Path** | `/ph/openapi/newad/sdAdvertiseHourData` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| report_date(报告日期,格式:Y-m-d只能查询最近60天,string) |  |
| campaign_id(广告活动id,number) |  |
| agg_dimension(聚合维度,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(响应数据,number) |  |
| message(提示消息,string) |  |
| total(总数,number) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,array) |  |
| data>>profile_id(店铺id,number) |  |
| data>>report_date(报告日期,string) |  |
| data>>hour(小时,number) |  |
| data>>campaign_id(店铺id,number) |  |
| data>>ad_id(广告id,number) |  |
| data>>asin(asin,string) |  |
| data>>targeting(投放表达式,string) |  |
| data>>targeting_id(投放id,number) |  |
| data>>msku(msku,string) |  |
| data>>impressions(曝光量,number) |  |
| data>>clicks(点击量,number) |  |
| data>>cost(花费,number) |  |
| data>>same_orders(直接成交订单,number) |  |
| data>>orders(订单数,number) |  |
| data>>same_sales(直接销售额,number) |  |
| data>>sales(销售额,number) |  |
| data>>units(销量,number) |  |
| data>>cpa(花费/订单数,number) |  |
| data>>cvr(订单数/点击,number) |  |
| data>>acos(花费/销售额,number) |  |
| data>>cpc(花费/点击,number) |  |
| data>>roas(销售额/花费,number) |  |
| data>>ctr(点击/曝光,number) |  |
| data>>group_id(广告组id,number) |  |


### SD广告组小时数据

| 属性 | 值 |
|------|------|
| **API Path** | `/pb/openaps/newad/sdAdGroupHourData` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| report_date(报告日期,格式:Y-m-d只能查询最近60天,string) |  |
| campaign_id(广告活动id,number) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0成功,number) |  |
| message(提示消息,string) |  |
| total(总数,number) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,array) |  |
| data>>campaign_id(广告活动id,number) |  |
| data>>profile_id(店铺id,number) |  |
| data>>report_date(报告日期,string) |  |
| data>>hour(小时,number) |  |
| data>>cost(花费,number) |  |
| data>>clicks(点击量,number) |  |
| data>>impressions(曝光量,number) |  |
| data>>same_orders(直接成交订单,number) |  |
| data>>orders(订单数,number) |  |
| data>>same_sales(直接销售额,number) |  |
| data>>sales(销售额,number) |  |
| data>>units(销量,number) |  |
| data>>ctr(点击/曝光,number) |  |
| data>>acos(花费/销售额,number) |  |
| data>>roas(销售额/花费,number) |  |
| data>>cvr(订单数/点击,number) |  |
| data>>cpc(花费/点击,number) |  |
| data>>cpa(花费/订单数,number) |  |
| data>>group_id(广告组id,number) |  |


### SB广告位小时数据

| 属性 | 值 |
|------|------|
| **API Path** | `/pb/openaps/newad/sbAdPlacementHourData` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| report_date(报告日期,格式:Y-m-d只能查询最近60天,string) |  |
| campaign_id(广告活动id,number) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0成功,number) |  |
| message(提示消息,string) |  |
| total(总数,number) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,array) |  |
| data>>campaign_id(广告活动id,number) |  |
| data>>profile_id(店铺id,number) |  |
| data>>report_date(报告日期,string) |  |
| data>>hour(小时,number) |  |
| data>>cost(花费,number) |  |
| data>>clicks(点击量,number) |  |
| data>>impressions(曝光量,number) |  |
| data>>same_orders(直接成交订单,number) |  |
| data>>orders(订单数,number) |  |
| data>>same_sales(直接销售额,number) |  |
| data>>sales(销售额,number) |  |
| data>>units(销量,number) |  |
| data>>ctr(点击/曝光,number) |  |
| data>>cvr(订单数/点击,null) |  |
| data>>roas(销售额/花费,null) |  |
| data>>cpa(花费/订单数,null) |  |
| data>>cpc(花费/点击,number) |  |
| data>>acos(花费/销售额,null) |  |
| data>>placement(广告位,string) |  |


### SP投放小时数据

| 属性 | 值 |
|------|------|
| **API Path** | `/ph/opensps/newad/spTargetHourflata` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| report_date(报告日期,格式:Y-m-d只能查询最近60天,string) |  |
| campaign_id(广告活动id,number) |  |
| agg_dimension(聚合维度:target 投放维度,both_ad_target 广告+投放维度,both_target_placement 投放+广告位placement维度,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码、0成功,number) |  |
| message(提示消息,string) |  |
| total(总数,number) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,array) |  |
| data>>profile_id(店铺id,number) |  |
| data>>report_date(报告日期,string) |  |
| data>>hour(小时,number) |  |
| data>>campaign_id(广告活动id,number) |  |
| data>>ad_id(广告id,number) |  |
| data>>asin(asin,string) |  |
| data>>msku(msku,null) |  |
| data>>match_type(匹配方式,string) |  |
| data>>targeting_id(投放id,number) |  |
| data>>targeting(投放表达式,string) |  |
| data>>placement(广告位,string) |  |
| data>>impressions(曝光量,number) |  |
| data>>clicks(点击量,number) |  |
| data>>cost(花费,number) |  |
| data>>same_orders(直接成交订单,number) |  |
| data>>orders(订单数,number) |  |
| data>>same_sales(直接销售额,number) |  |
| data>>sales(销售额,number) |  |
| data>>same_units(直接成交销量,number) |  |
| data>>units(销量,number) |  |
| data>>ctr(点击/曝光,number) |  |
| data>>cpc(花费/点击,number) |  |
| data>>cvr(订单数/点击,number) |  |
| data>>cpa(花费/订单数,number) |  |
| data>>acos(花费/销售额,number) |  |
| data>>roas(销售额/花费,number) |  |
| data>>group_id(广告组id,number) |  |


### SP广告小时数据

| 属性 | 值 |
|------|------|
| **API Path** | `/ph/openaps/newad/spAdvertisellourData` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| report_date(报告日期,格式:Y-m-d只能查询最近60天,string) |  |
| campaign_id(广告活动id,number) |  |
| agg_dimension(聚合维度:ad广告维度,both_ad_target广告+投放维度,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0成功,int) |  |
| message(提示消息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| data>>profile_id(店铺id,number) |  |
| data>>report_date(报告日期,string) |  |
| data>>hour(小时,number) |  |
| data>>campaign_id(广告活动id,number) |  |
| data>>ad_id(广告id,number) |  |
| data>>msku(msku,null) |  |
| data>>asin(asin,object) |  |
| data>>impressions(曝光量,object) |  |
| data>>clicks(点击量,number) |  |
| data>>cost(花费,object) |  |
| data>>same_orders(直接成交订单,number) |  |
| data>>orders(订单数,number) |  |
| data>>same_sales(直接销售额,number) |  |
| data>>sales(销售额,number) |  |
| data>>same_units(直接成交销量,number) |  |
| data>>units(销量,number) |  |
| data>>match_type(匹配方式,string) |  |
| data>>targeting_id(投放id,number) |  |
| data>>targeting(投放表达式,string) |  |
| data>>ctr(点击/曝光,number) |  |
| data>>cpc(花费/点击,number) |  |
| data>>cvr(订单数/点击,number) |  |
| data>>cpa(花费/订单数,number) |  |
| data>>acos(花费/销售额,number) |  |
| data>>roas(销售额/花费,number) |  |
| data>>group_id(广告组id,number) |  |


### SP广告组小时数据

| 属性 | 值 |
|------|------|
| **API Path** | `/pb/openapi/newad/spAdGroupHourData` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| report_date(报告日期,格式:Y-m-d 只能查询最近60天,string) |  |
| campaign_id(广告活动id,number) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0 成功,int) |  |
| message(提示消息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| data>>campaign_id(广告活动id,number) |  |
| data>>profile_id(店铺id,number) |  |
| data>>report_date(报告日期,string) |  |
| data>>hour(小时,number) |  |
| data>>cost(花费,number) |  |
| data>>clicks(点击量,number) |  |
| data>>impressions(曝光量,number) |  |
| data>>same_orders(直接成交订单,number) |  |
| data>>orders(订单数,number) |  |
| data>>same_sales(直接销售额,number) |  |
| data>>sales(销售额,number) |  |
| data>>same_units(直接成交销量,number) |  |
| data>>units(销量,number) |  |
| data>>ctr(点击/曝光,number) |  |
| data>>cpc(花费/点击,number) |  |
| data>>cvr(订单数/点击,number) |  |
| data>>cpa(花费/订单数,number) |  |
| data>>acos(花费/销售额,number) |  |
| data>>roas(销售额/花费,number) |  |
| data>>group_id(广告组id,number) |  |


### SP广告位小时数据

| 属性 | 值 |
|------|------|
| **API Path** | `/pb/openapi/newad/spAdPlacementHourData` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| report_date(报告日期,格式:Y-m-d只能查询最近60天,string) |  |
| campaign_id(广告活动id,number) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0成功,int) |  |
| message(提示消息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| data>>campaign_id(广告活动id,number) |  |
| data>>profile_id(店铺id,number) |  |
| data>>report_date(报告日期,string) |  |
| data>>placement(广告位,string) |  |
| data>>hour(小时,number) |  |
| data>>cost(花费,number) |  |
| data>>clicks(点击量,number) |  |
| data>>impressions(曝光量,number) |  |
| data>>same_orders(直接成交订单,number) |  |
| data>>orders(订单数,number) |  |
| data>>same_sales(直接销售额,number) |  |
| data>>sales(销售额,number) |  |
| data>>same_units(直接成交销量,number) |  |
| data>>units(销量,number) |  |
| data>>cpc(花费/点击,number) |  |
| data>>cvr(订单数/点击,number) |  |
| data>>cpa(花费/订单数,number) |  |
| data>>acos(花费/销售额,number) |  |
| data>>roas(销售额/花费,number) |  |
| data>>ctr(点击/曝光,number) |  |


### SP广告活动小时数据

| 属性 | 值 |
|------|------|
| **API Path** | `/pb/openaps/newad/spCampaignHourData` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| report_date(报告日期, 格式: Y-m-d 只能查询最近60天,string) |  |
| campaign_id(广告活动id,number) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码, 0成功,int) |  |
| message(提示消息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| data>>campaign_id(广告活动id,number) |  |
| data>>profile_id(店铺id,number) |  |
| data>>report_date(报告日期,string) |  |
| data>>hour(小时,number) |  |
| data>>cost(花费,number) |  |
| data>>clicks(点击量,number) |  |
| data>>impressions(曝光量,number) |  |
| data>>same_orders(直接成交订单,number) |  |
| data>>orders(订单数,number) |  |
| data>>same_sales(直接销售额,number) |  |
| data>>sales(销售额,number) |  |
| data>>same_units(直接成交销量,number) |  |
| data>>units(销量,number) |  |
| data>>ctr(点击/曝光,number) |  |
| data>>cvr(订单数/点击,number) |  |
| data>>cpa(花费/订单数,number) |  |
| data>>acos(花费/销售额,number) |  |
| data>>roas(销售额/花费,number) |  |
| data>>cpc(花费/点击,number) |  |


### SB广告归因于广告的购买报告

| 属性 | 值 |
|------|------|
| **API Path** | `/sb/open-api/new-ad/hsa/purchasedAsinReports` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| X-API-VERSION(【兼容旧版本】不添加该标签:offset 为分页页码。从1开始 值为2时:offset 为分页偏移量,从0开始,Int) |  |
| sid(店铺id,对应查询亚马逊店铺列表接口对应字段【sid】,int) |  |
| profile_id(VC广告店铺profile_id,对应查询广告账号列表接口对应字段【profile_id】,sid和profile_id其中一个必填,int) |  |
| report_date(报告日期,格式:Y-m-d,string) |  |
| offset(分页偏移量,默认0,int) |  |
| length(分页长度,默认15,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0成功,int) |  |
| message(提示消息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| data>>profile_id(亚马逊店铺数字id,number) |  |
| data>>report_date(报告日期,string) |  |
| data>>campaign_name(广告活动名称,string) |  |
| data>>campaign_id(广告活动Id,number) |  |
| data>>ad_group_name(广告组名称,string) |  |
| data>>ad_group_id(广告组Id,number) |  |
| data>>asin(已购买的asin,string) |  |
| data>>attribution_type(引流类型,string) |  |
| data>>sales14d(14天总销售额,number) |  |
| data>>orders14d(14天总订单数,number) |  |
| data>>units_sold14d(14天总件数,number) |  |
| data>>new_to_brand_sales14d(14天新客户订单销售额,number) |  |
| data>>new_to_brand_purchases14d(14天新客户订单,number) |  |
| data>>new_to_brand_units_sold14d(14天新客户订单件数,number) |  |
| data>>new_to_brand_sales_percentage14d(14天新客户订单销售额百分比,number) |  |
| data>>new_to_brand_purchases_percentage14d(14天新客户订单百分比,number) |  |
| data>>new_to_brand_units_sold_percentage14d(14天新客户订单件数百分比,number) |  |
| data>>units(销量,number) |  |
| data>>same_units(直接成交量,number) |  |


### SB广告活动-广告位报告

| 属性 | 值 |
|------|------|
| **API Path** | `/pb/openap/newad/heaCampaignPlacementReports` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| X-API-VERSION(【兼容旧版本】不添加标签: offset 为分页页码, 从1开始 值为2时: offset 为分页偏移量, 从0开始,int) |  |
| sid(店铺id, 对应查询店铺列表接口对应字段【sid】,int) |  |
| profile_id(VC广告店铺profile_id, 对应查询广告账号列表接口对应字段【profile_id】, sid和profile_id其中一个必填,int) |  |
| report_date(报表日期, 格式: Y-m-d,string) |  |
| offset(分页偏移量, 默认0,int) |  |
| length(分页长度, 默认15,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码, 0成功,int) |  |
| message(提示消息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| data>>clicks(点击量,number) |  |
| data>>cost(花费,number) |  |
| data>>profile_id(亚马逊店铺数字id,number) |  |
| data>>impressions(展示量,number) |  |
| data>>report_date(报表日期,string) |  |
| data>>campaign_id(广告活动id,number) |  |
| data>>placement_type(广告位类型,string) |  |
| data>>orders(订单数,number) |  |
| data>>new_to_brand_orders(品牌新买家订单数量,number) |  |
| data>>new_to_brand_units(品牌新买家销量,number) |  |
| data>>new_to_brand_sales(品牌新买家销售额,number) |  |
| data>>new_to_brand_order_percentage(品牌新买家订单百分比,number) |  |
| data>>new_to_brand_order_rate(品牌新买家转换率,number) |  |
| data>>sales(销售额,number) |  |
| data>>creative_type(广告类型,string) |  |
| data>>units(销量,number) |  |
| data>>same_units(直接成交量,number) |  |


### SB广告活动报表

| 属性 | 值 |
|------|------|
| **API Path** | `/pb/openapi/newad/hsaCampaignReports` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| X-API-VERSION(【兼容旧版本】不添加标签:offset 为分页页码,从1开始 值为2时:offset 为分页偏移量,从0开始,int) |  |
| sid(店铺id,对应查询亚马逊店铺列表接口对应字段【sid】,int) |  |
| profile_id(VC广告店铺profile_id,对应查询广告账号列表接口对应字段【profile_id】,sid跟profile_id其中一个必填,int) |  |
| report_date(报表日期,格式:Y-m-d,string) |  |
| offset(分页偏移量,默认0,int) |  |
| length(分页长度,默认15,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0成功,int) |  |
| message(提示消息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| data>>campaign_id(广告活动id,number) |  |
| data>>profile_id(亚马逊店铺数字id,number) |  |
| data>>impressions(展示量,number) |  |
| data>>clicks(点击量,number) |  |
| data>>cost(花费,number) |  |
| data>>vtr(vtr,number) |  |
| data>>vctr(vctr,number) |  |
| data>>report_date(报告日期,string) |  |
| data>>same_orders(直接成交订单数,number) |  |
| data>>orders(订单数,number) |  |
| data>>same_sales(直接成交销售额,number) |  |
| data>>sales(销售额,number) |  |
| data>>new_to_brand_orders(品牌新买家订单数量,number) |  |
| data>>new_to_brand_order_percentage(品牌新买家订单百分比,number) |  |
| data>>new_to_brand_order_rate(品牌新买家转换率,number) |  |
| data>>new_to_brand_sales(品牌新买家销售额,number) |  |
| data>>new_to_brand_units(品牌新买家销量,number) |  |
| data>>units(销量,number) |  |
| data>>same_units(直接成交量,number) |  |


### SP用户搜索词报表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sp/query/queryUserSearchTerm` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺id,int) |  |
| profile_id(VC广告请填profile_id,int) |  |
| report_date(报表日期,string) |  |
| show_detail(是否展示完整指标数据【默认0】0否，1是,int) |  |
| target_type(按报表类型【默认 keyword】,string) |  |
| offset(分页偏移量，默认0,int) |  |
| length(分页条数，默认15,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(消息提示,string) |  |
| request_id(请求跟踪id,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| data->query(搜索词,string) |  |
| data->target_id(投放id,number) |  |
| data->match_type(匹配类型,string) |  |
| data->target_text(投放的内容,string) |  |
| data->ad_group_id(广告组id,number) |  |
| data->impressions(展示量,number) |  |
| data->clicks(点击量,number) |  |
| data->cost(花费,number) |  |
| data->sales(销售额,number) |  |
| data->orders(订单数,number) |  |


### SP商品定位报表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sp/api/v2/reports/targets` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺id,int) |  |
| profile_id(VC广告店铺profile_id,int) |  |
| report_date(报表日期,string) |  |
| show_detail(是否基于地域分组明细报表,int) |  |
| offset(分页偏移量,int) |  |
| length(分页长度,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,string) |  |
| message(提示信息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| total(总条数,int) |  |
| data(响应数据,array) |  |
| data->target_id(投放id,number) |  |
| data->targeting_type(投放类型,string) |  |
| data->targeting_expression(投放表达式,string) |  |
| data->ad_group_id(广告组id,number) |  |
| data->impressions(曝光量,number) |  |
| data->clicks(点击量,number) |  |
| data->cost(花费,number) |  |
| data->report_date(报表日期,string) |  |
| data->profile_id(亚马逊店铺数字id,number) |  |
| data->campaign_id(广告活动id,number) |  |
| data->same_orders(直接成交订单数,number) |  |
| data->same_orders_7d(直接成交订单数(7d),number) |  |
| data->same_orders_14d(直接成交订单数(14d),number) |  |
| data->same_orders_30d(直接成交订单数(30d),number) |  |
| data->orders(订单数,number) |  |
| data->orders_7d(订单数(7d),number) |  |
| data->orders_14d(订单数(14d),number) |  |
| data->orders_30d(订单数(30d),number) |  |
| data->same_sales(直接成交销售额,number) |  |
| data->same_sales_7d(直接成交销售额(7d),number) |  |
| data->same_sales_14d(直接成交销售额(14d),number) |  |
| data->same_sales_30d(直接成交销售额(30d),number) |  |
| data->sales(销售额,number) |  |
| data->sales_7d(销售额(7d),number) |  |
| data->sales_14d(销售额(14d),number) |  |
| data->sales_30d(销售额(30d),number) |  |
| data->units(销量,number) |  |
| data->units_7d(销量(7d),number) |  |
| data->units_14d(销量(14d),number) |  |
| data->units_30d(销量(30d),number) |  |


### SP关键词报表

| 属性 | 值 |
|------|------|
| **API Path** | `/sc/sp/report/keywords/reportList` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺id,int) |  |
| profile_id(VC广告的profile_id,int) |  |
| report_date(报表日期,string) |  |
| show_detail(是否展示分天数据,int) |  |
| offset(分页偏移量,int) |  |
| length(分页长度,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(提示信息,string) |  |
| request_id(请求id,string) |  |
| total(总数,int) |  |
| data(明细列表,array) |  |
| keyword_id(关键词id,number) |  |
| match_type(匹配类型,string) |  |
| keyword_text(关键词,string) |  |
| ad_group_id(广告组id,number) |  |
| impressions(曝光量,number) |  |
| clicks(点击量,number) |  |
| cost(花费,number) |  |


### SP广告商品报表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sp/data/getProductsReports` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺id,int) |  |
| profile_id(VC广告的profile_id,int) |  |
| report_date(报表日期,string) |  |
| show_detail(是否展示明细,int) |  |
| offset(分页偏移量,int) |  |
| length(分页长度,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(提示信息,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| ad_id(商品广告id,number) |  |
| asin(asin,string) |  |
| sku(sku,string) |  |
| ad_group_id(广告组id,number) |  |
| profile_id(广告活动id,number) |  |
| campaign_id(广告活动id,number) |  |
| impressions(曝光量,number) |  |
| clicks(点击量,number) |  |
| cost(花费,number) |  |
| report_date(报表日期,string) |  |
| orders(订购数,number) |  |
| sales(销售额,number) |  |
| units(销量,number) |  |


### SP广告组报表

| 属性 | 值 |
|------|------|
| **API Path** | `/data/sp/report/adGroup` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺id,int) |  |
| profile_id(VC广告活动的profile_id,int) |  |
| report_data(报表日期,string) |  |
| show_detail(是否展示有数据的报表,int) |  |
| offset(分页偏移量,int) |  |
| length(分页长度,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(提示信息,string) |  |
| total(总数,int) |  |
| data(返回数据,array) |  |
| data>>ad_group_id(广告组id,string) |  |
| data>>impressions(曝光量,number) |  |
| data>>clicks(点击量,number) |  |
| data>>cost(花费,number) |  |
| data>>report_date(报表日期,string) |  |
| data>>profile_id(亚马逊店铺数字id,number) |  |
| data>>campaign_id(广告活动id,number) |  |
| data>>same_orders(直接成交订单数,number) |  |
| data>>same_orders_1d(直接成交订单数(1d),number) |  |
| data>>orders(订单数,number) |  |
| data>>sales(销售额,number) |  |
| data>>units(销量,number) |  |


### SP广告商品报表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sp/data/spProductAds/reports` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺ID,int) |  |
| profile_id(VC广告店铺profile_id,string) |  |
| report_date(报表日期,string) |  |
| show_detail(是否展示明细,int) |  |
| offset(分页偏移量,int) |  |
| length(分页长度,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(提示信息,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| cato>>ad_id(商品广告id,number) |  |
| cato>>asin(asin,string) |  |
| cato>>sku(sku,string) |  |
| cato>>ad_group_id(广告组id,number) |  |
| cato>>campaign_id(广告活动id,number) |  |
| cato>>impressions(展示量,number) |  |
| cato>>clicks(点击量,number) |  |
| cato>>cost(花费,number) |  |
| cato>>orders(订单数,number) |  |
| cato>>sales(销售额,number) |  |


### SP广告组报表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sp/data/ad_group/report_list` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺id,int) |  |
| profile_id(VC广告店铺profile_id,int) |  |
| report_date(报表日期,string) |  |
| show_detail(是否展示明细数据,int) |  |
| offset(分页偏移量,int) |  |
| length(分页长度,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(提示信息,string) |  |
| total(总数,int) |  |
| data(返回数据,array) |  |
| data>>ad_group_id(广告组id,number) |  |
| data>>impressions(曝光量,number) |  |
| data>>clicks(点击量,number) |  |
| data>>cost(花费,number) |  |
| data>>report_date(报表日期,string) |  |
| data>>profile_id(亚马逊店铺数字id,number) |  |
| data>>campaign_id(广告活动id,number) |  |
| data>>same_orders(直接成交订单数,number) |  |
| data>>orders(订单数,number) |  |
| data>>same_sales(直接成交销售额,number) |  |
| data>>sales(销售额,number) |  |
| data>>units(销量,number) |  |
| data>>same_units(直接成交销量,number) |  |

> **备注**: 返回字段中包含大量带有1d, 7d, 14d, 30d后缀的字段，表示不同时间周期的数据，此处仅列出主要字段。


### SP广告位报告

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sp/api/v2/adGroups/placementReports` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺id,为查询亚马逊店铺列表接口对应VC接口字段【sid】,int) |  |
| profile_id(VC广告店铺profile_id,对应查询广告账户列表接口对应VC接口字段【profile_id】,sid跟profile_id其中一个必填,int) |  |
| report_date(报表日期,格式: Y-m-d,string) |  |
| show_detail(是否展示详细数据【默认0】,0:否,1:是,int) |  |
| offset(分页偏移量,默认0,int) |  |
| length(分页长度,默认15,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0:成功,int) |  |
| message(状态描述,string) |  |
| error_details(错误详情,array) |  |
| request_id(请求链接id,string) |  |
| response_time(您的调用时间,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| data>>profile_id(亚马逊店铺助手id,number) |  |
| data>>impressions(展示量,number) |  |
| data>>clicks(点击量,number) |  |
| data>>cost(花费,number) |  |
| data>>report_date(报表日期,string) |  |
| data>>placement_type(广告位类型,string) |  |
| data>>campaign_id(广告活动id,number) |  |
| data>>same_orders(直接成交订单数,number) |  |
| data>>same_orders_7d(直接成交订单数[7d],number) |  |
| data>>same_orders_14d(直接成交订单数[14d],number) |  |
| data>>same_orders_30d(直接成交订单数[30d],number) |  |
| data>>orders(订单数,number) |  |
| data>>orders_7d(订单数[7d],number) |  |
| data>>orders_14d(订单数[14d],number) |  |
| data>>orders_30d(订单数[30d],number) |  |
| data>>sales(销售额,number) |  |
| data>>sales_7d(销售额[7d],number) |  |
| data>>sales_14d(销售额[14d],number) |  |
| data>>sales_30d(销售额[30d],number) |  |
| data>>same_sales(直接成交销售额,number) |  |
| data>>same_sales_7d(直接成交销售额[7d],number) |  |
| data>>same_sales_14d(直接成交销售额[14d],number) |  |
| data>>same_sales_30d(直接成交销售额[30d],number) |  |
| data>>units(销量,number) |  |
| data>>units_1d(销量[1d],number) |  |
| data>>units_7d(销量[7d],number) |  |
| data>>units_14d(销量[14d],number) |  |
| data>>units_30d(销量[30d],number) |  |
| data>>same_units(直接成交销量,number) |  |
| data>>same_units_1d(直接成交销量[1d],number) |  |
| data>>same_units_7d(直接成交销量[7d],number) |  |
| data>>same_units_14d(直接成交销量[14d],number) |  |
| data>>same_units_30d(直接成交销量[30d],number) |  |


### SP广告活动报表

| 属性 | 值 |
|------|------|
| **API Path** | `/api/connect/sp/campaign/report` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺id,int) |  |
| profile_id(广告活动id,int) |  |
| report_date(报表日期,string) |  |
| show_detail(是否显示详细结果,int) |  |
| offset(分页条数,int) |  |
| length(分页长度,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(提示信息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| data->targeting_type(投放类型,string) |  |
| data->impressions(展示量,number) |  |
| data->clicks(点击量,number) |  |
| data->cost(花费,number) |  |
| data->report_date(报表日期,string) |  |
| data->profile_id(生成报表查询id,number) |  |
| data->campaign_id(广告活动id,number) |  |
| data->same_orders(直接成交订单数,number) |  |
| data->same_orders_7d(直接成交订单数(7d),number) |  |
| data->same_orders_14d(直接成交订单数(14d),number) |  |
| data->same_orders_30d(直接成交订单数(30d),number) |  |
| data->orders(订单数,number) |  |
| data->orders_7d(订单数(7d),number) |  |
| data->orders_14d(订单数(14d),number) |  |
| data->orders_30d(订单数(30d),number) |  |
| data->same_sales(直接成交销售额,number) |  |
| data->same_sales_7d(直接成交销售额(7d),number) |  |
| data->same_sales_14d(直接成交销售额(14d),number) |  |
| data->same_sales_30d(直接成交销售额(30d),number) |  |
| data->sales(销售额,number) |  |
| data->sales_7d(销售额(7d),number) |  |
| data->sales_14d(销售额(14d),number) |  |
| data->sales_30d(销售额(30d),number) |  |
| data->units(销量,number) |  |
| data->units_7d(销量(7d),number) |  |
| data->units_14d(销量(14d),number) |  |
| data->units_30d(销量(30d),number) |  |
| data->same_units(直接成交量,number) |  |
| data->same_units_7d(直接成交量(7d),number) |  |
| data->same_units_14d(直接成交量(14d),number) |  |
| data->same_units_30d(直接成交量(30d),number) |  |



---

## 促销

### 查询促销活动列表-管理促销

| 属性 | 值 |
|------|------|
| **API Path** | `/basicopen/promotionalActivities/manage/list` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| start_date(开始日期【活动时间】, 站点时间, 闭区间, 格式: Y-m-d, 时间间隔最长不超过90天,string) |  |
| end_date(结束日期【活动时间】, 站点时间, 闭区间, 格式: Y-m-d, 时间间隔最长不超过90天,string) |  |
| sids(店铺id, 对应查询亚马逊店铺列表接口对应字段【sid】,array) |  |
| offset(分页偏移量, 默认0,int) |  |
| length(分页长度, 默认20, 上限200,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码, 0成功,int) |  |
| message(消息提示,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| data>>promotion_id(促销活动id,string) |  |
| data>>name(内部描述,string) |  |
| data>>sid(店铺id,int) |  |
| data>>promotion_type(活动类型,int) |  |
| data>>currency_icon(货币icon,string) |  |
| data>>origin_status(活动状态,string) |  |
| data>>promotion_code(优惠码,string) |  |
| data>>sales_amount(活动总销售额,string) |  |
| data>>sales_volume(活动总销量,string) |  |
| data>>participate_condition(参与条件,string) |  |
| data>>participate_condition_num(参与条件数值,string) |  |
| data>>buyer_gets(买家获得,string) |  |
| data>>buyer_gets_num(买家获得值,string) |  |
| data>>purchase_product(需购买商品,string) |  |
| data>>discount_product(优惠商品,string) |  |
| data>>exclude_product(排除商品,string) |  |
| data>>exchange_limit(是否限制兑换,int) |  |
| data>>promotion_start_time(活动开始时间【站点时间】,string) |  |
| data>>promotion_end_time(活动结束时间【站点时间】,string) |  |
| data>>first_sync_time(首次同步时间【站点时间】,string) |  |
| data>>last_sync_time(最后同步时间【站点时间】,string) |  |
| data>>remark(备注,string) |  |



---

## 促销管理

### 查询促销活动列表-秒杀

| 属性 | 值 |
|------|------|
| **API Path** | `/basicOpen/promotionalActivities/seckill/list` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| start_date(开始日期【活动时间】,string) |  |
| end_date(结束日期【活动时间】,string) |  |
| sids(店铺id,array) |  |
| offset(分页偏移量,int) |  |
| length(分页长度,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(消息提示,string) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| promotion_id(促销活动id,string) |  |
| name(秒杀标题,string) |  |
| product_quantity(商品数量,int) |  |
| sid(店铺id,int) |  |
| currency_icon(货币icon,string) |  |
| origin_status(活动状态,string) |  |
| promotion_type(秒杀类型,int) |  |
| description(描述,string) |  |
| seckill_fee(秒杀费,string) |  |
| sales_amount(活动总销售额,string) |  |
| sales_volume(活动总销量,string) |  |
| participate_inventory(参与库存数,string) |  |
| sold_rate(售出率,string) |  |
| page_view(浏览量,string) |  |
| exchange_rate(转化率,string) |  |
| promotion_start_time(活动开始时间,string) |  |
| promotion_end_time(活动结束时间,string) |  |
| first_sync_time(首次同步时间,string) |  |
| last_sync_time(最后同步时间,string) |  |
| remark(备注,string) |  |


### 查询促销活动列表-优惠券

| 属性 | 值 |
|------|------|
| **API Path** | `/basicOpen/promotionalActivities/coupon/list` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| start_date(开始日期【活动时间】, string) |  |
| end_date(结束日期【活动时间】, string) |  |
| sids(店铺id, array) |  |
| offset(分页偏移量, int) |  |
| length(分页长度, int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码, int) |  |
| message(消息提示, string) |  |
| error_details(错误信息, array) |  |
| request_id(请求链路id, string) |  |
| response_time(响应时间, string) |  |
| total(总数, int) |  |
| data(响应数据, array) |  |
| data>>promotion_id(促销活动id, string) |  |
| data>>name(优惠券名称, string) |  |
| data>>sid(店铺id, int) |  |
| data>>currency_icon(货币icon, string) |  |
| data>>origin_status(活动状态, string) |  |
| data>>discount(折扣, string) |  |
| data>>budget(预算, string) |  |
| data>>cost(支出, string) |  |
| data>>draw_quantity(领取数, string) |  |
| data>>exchange_quantity(兑换数, string) |  |
| data>>exchange_rate(兑换率, string) |  |
| data>>sales_amount(活动总销售额, string) |  |
| data>>sales_volume(活动总销量, string) |  |
| data>>promotion_start_time(活动开始时间, string) |  |
| data>>promotion_end_time(活动结束时间, string) |  |
| data>>first_sync_time(首次同步时间, string) |  |
| data>>last_sync_time(最后同步时间, string) |  |
| data>>remark(备注, string) |  |



---

## 客服

### 查询业绩通知列表

| 属性 | 值 |
|------|------|
| **API Path** | `/basicOpen/customerService/performanceNotice/list` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺id,array) |  |
| status(处理状态: 0(无), 1(待处理), 2(已处理), 3(无需处理),array) |  |
| startDate(开始时间 YYYY-MM-DD,string) |  |
| endDate(结束时间 YYYY-MM-DD,string) |  |
| searchField(搜索字段,subject 邮件主题,content 邮件内容,string) |  |
| searchValue(搜索值,string) |  |
| mailTagIds(邮件标签 id,array) |  |
| isRead(是否已读,-1全部, 0未读, 1已读,number) |  |
| offset(偏移量,number) |  |
| length(分页长度,number) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码。0成功,number) |  |
| message(提示信息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| data(object) |  |
| data>>list(array) |  |
| data>>list>>id(主键ID,number) |  |
| data>>list>>companyId(企业ID,number) |  |
| data>>list>>performanceNoticeUuid(唯一标识ID,string) |  |
| data>>list>>sid(店铺ID,number) |  |
| data>>list>>mailId(亚马逊邮件唯一标识,string) |  |
| data>>list>>subject(主题,string) |  |
| data>>list>>status(处理状态: 0(无), 1(待处理), 2(已处理), 3(无需处理),number) |  |
| data>>list>>isRead(是否已读, -1全部, 0未读, 1已读,number) |  |
| data>>list>>content(内容,string) |  |
| data>>list>>mailCreateDate(亚马逊邮件创建时间,string) |  |
| data>>list>>tagList(邮件标签信息列表,array) |  |
| data>>list>>tagList>>cid(分类ID,number) |  |
| data>>list>>tagList>>color(标签颜色,string) |  |
| data>>list>>tagList>>tagName(标签名称,string) |  |
| data>>list>>tagList>>webMailTagUuid(标签ID,string) |  |
| data>>total(总数,number) |  |
| data>>lastUpdateDate(最后更新时间,string) |  |


### 查询客户列表 (新)

| 属性 | 值 |
|------|------|
| **API Path** | `/basic/openapi/customer/service/v1/customer/index` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sort_field(排序字段,string) |  |
| sort_type(排序类型,string) |  |
| date_field(时间筛选查询类型,string) |  |
| start_date(筛选开始时间,string) |  |
| end_date(筛选结束时间,string) |  |
| currency_type(币种,number) |  |
| search_field(支持搜索的字段,string) |  |
| offset(分页查询起始位置,number) |  |
| length(分页长度,number) |  |
| search_value(搜索值,string) |  |
| sids(店铺id,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(返回状态码,number) |  |
| message(响应提示,string) |  |
| error_details(错误详情,array) |  |
| request_id(请求ID,string) |  |
| response_time(响应时间,string) |  |
| data(返回数据,object) |  |
| data>>list(客户列表,array) |  |
| data>>list>>buyer_email(买家邮箱,string) |  |
| data>>list>>buyer_name(买家姓名,string) |  |
| data>>list>>sid(店铺ID,array) |  |
| data>>list>>country(国家名称,string) |  |
| data>>list>>order_items(总订单,number) |  |
| data>>list>>volume(总销量,number) |  |
| data>>list>>amount(总销售额,number) |  |
| data>>list>>avg_customer_transaction(平均客单价,number) |  |
| data>>list>>currency_icon(币种符号,string) |  |
| data>>list>>refund_number(退款订单数,number) |  |
| data>>list>>refund_sales_number(退款销量,number) |  |
| data>>list>>refund_rate(退款率,number) |  |
| data>>list>>return_number(退货订单数,number) |  |
| data>>list>>return_sales_number(退货销量,number) |  |
| data>>list>>return_rate(退货率,number) |  |
| data>>list>>feedback_number(Feedback评论数,number) |  |
| data>>list>>seller_name(店铺名称,string) |  |
| data>>list>>feedback_bad_number(Feedback差评数,number) |  |
| data>>list>>feedback_rate(Feedback好评率,number) |  |
| data>>list>>feedback_bad_rate(Feedback差评率,number) |  |
| data>>list>>first_purchase_date(首次购买时间,string) |  |
| data>>list>>last_purchase_date(最近购买时间,string) |  |
| data>>list>>remark(备注,string) |  |
| data>>list>>group(分组,array) |  |
| data>>total(总数,number) |  |
| total(总数,number) |  |


### 查询RMA管理

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/open/customerService/rmaManage/list` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺id,array[string]) |  |
| searchTimeField(搜索的时间类型,string) |  |
| startTime(创建/完成/审核时间(开始),string) |  |
| endTime(创建/完成/审核时间(结束),string) |  |
| searchValue(搜索值,array[string]) |  |
| searchField(搜索字段,array[string]) |  |
| sortColumn(排序字段,string) |  |
| sortType(排序方式,string) |  |
| pageNum(页码,number) |  |
| pageSize(每页数量,number) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,number) |  |
| message(消息,string) |  |
| request_id(请求id,string) |  |
| response_time(响应时间,string) |  |
| data(数据,object) |  |
| data->total(总数,number) |  |
| data->records(数据列表,array) |  |
| data->records->id(id,string) |  |
| data->records->createTime(创建时间,string) |  |
| data->records->rmaId(RMA ID,string) |  |
| data->records->orderId(订单id,number) |  |
| data->records->owner(跟进人,string) |  |
| data->records->amazonOrderId(亚马逊订单号,string) |  |
| data->records->asin(asin,string) |  |
| data->records->sellerSku(seller sku,string) |  |
| data->records->itemName(商品标题,string) |  |
| data->records->sku(sku,string) |  |
| data->records->sellerName(卖家名称,string) |  |
| data->records->country(国家,string) |  |
| data->records->channelSourceName(渠道来源名称,string) |  |
| data->records->afterSaleTypeName(售后类型名称,string) |  |
| data->records->afterSaleCount(售后数量,number) |  |
| data->records->processWayName(处理方式名称,string) |  |
| data->records->buyerName(买家名,string) |  |
| data->records->buyerEmail(买家邮箱,string) |  |


### 查询店铺绩效列表

| 属性 | 值 |
|------|------|
| **API Path** | `/basicopen/customerService/storeTarget/list` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| offset(分页偏移量,默认0,int) |  |
| length(分页长度,默认20,上限200,int) |  |
| search_field_time(搜索时间类型,string) |  |
| search_time(搜索时间,格式:Y-m-d,string) |  |
| sids(店铺id,多个使用英文逗号分隔,string) |  |
| anomaly_indicator(异常指标,array) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| sid(店铺id,int) |  |
| pull_date(报表获取日期,string) |  |
| update_date(报表数据更新时间,string) |  |
| order_with_defect(fbm订单缺陷率,百分比,string) |  |
| return_dissatisfaction(退货不满意度,百分比,string) |  |
| late_shipment(迟发率,百分比,string) |  |
| pre_fulfillment_cancellation(预配送取消率,百分比,string) |  |
| valid_tracking(有效追踪率,百分比,string) |  |
| on_time_delivery(准时交货率,百分比,string) |  |
| commodity_policy_compliance(商品政策合规性,string) |  |
| fba_order_with_defect(fba订单缺陷率,百分比,string) |  |
| invoice_defect(发票缺陷率,百分比,string) |  |
| ahr_score(账户状况分数,string) |  |
| ahr_status(账户状况评级,string) |  |


### 查询评价管理 4-5星Feedback列表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/cs/feedback/list` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺id,int) |  |
| start_date(评论开始日期,string) |  |
| end_date(评论结束日期,string) |  |
| offset(分页偏移量,int) |  |
| length(分页长度,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(提示信息,string) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,array) |  |
| data>>sid(店铺id,int) |  |
| data>>seller_name(店铺名称,string) |  |
| data>>country(国家,string) |  |
| data>>star(星级,number) |  |
| data>>amazon_order_id(订单号,string) |  |
| data>>feedback_date(评论时间,string) |  |
| data>>feedback_content(评论内容,string) |  |
| data>>update_time(更新时间,string) |  |
| data>>operation_time(操作时间,string) |  |
| data>>remark(备注,string) |  |
| data>>status(feedback处理状态,int) |  |
| data>>productList(商品信息,array) |  |
| total(总数,int) |  |

> **备注**: 所属分类为客服


### 查询评价统计-Review列表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/v2/ca/reviewReport/lists` |
| **请求方式** | GET |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| start_date(开始时间【时间间隔不超过1年】,格式：Y-m-d,string) |  |
| end_date(结束时间【时间间隔不超过1年】,格式：Y-m-d,string) |  |
| sid(店铺id,刻度查询店铺列表接口对应字段【sid】,array) |  |
| offset(分页偏移量,默认0,int) |  |
| length(分页长度,默认20,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0成功,int) |  |
| message(响应信息,string) |  |
| request_id(请求ID,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| data>>ratings(平均rating总数,number) |  |
| data>>five_star(5星review新增数,number) |  |
| data>>four_star(4星review新增数,number) |  |
| data>>three_star(3星review新增数,number) |  |
| data>>two_star(2星review新增数,number) |  |
| data>>one_star(1星review新增数,number) |  |
| data>>review_num(review数,number) |  |
| data>>good_num(review好评数,number) |  |
| data>>negative_num(review中评数,number) |  |
| data>>good_rate(review好评率,number) |  |
| data>>negative_rate(review中差评率,number) |  |
| data>>modified_num(review被评数,number) |  |
| data>>remove_num(review删除数,number) |  |
| data>>asin(asin,string) |  |
| data>>asin_url(asin链接,string) |  |
| data>>image_url(图片链接,string) |  |
| data>>title(商品标题,string) |  |
| data>>country(国家,string) |  |
| data>>score(评分,number) |  |
| data>>mark(仅评分数,number) |  |
| data>>seller_name(店铺名称,array) |  |
| data>>local_info(本地信息,array) |  |
| data>>parent_asin(父asin,array) |  |
| data>>seller_list(店铺列表,array) |  |


### 查询评价管理 1-3星Feedback列表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/cs/feedback/listMws` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺id,int) |  |
| start_date(评论开始日期,string) |  |
| end_date(评论结束日期,string) |  |
| offset(分页偏移量,int) |  |
| length(分页长度,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(提示信息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,array) |  |
| data>>sid(店铺id,int) |  |
| data>>seller_name(店铺名称,string) |  |
| data>>country(国家,string) |  |
| data>>star(星级,number) |  |
| data>>amazon_order_id(订单号,string) |  |
| data>>feedback_date(评论时间,string) |  |
| data>>feedback_content(评论内容,string) |  |
| data>>update_time(更新时间,string) |  |
| data>>operation_time(操作时间,string) |  |
| data>>remark(备注,string) |  |
| data>>status(feedback处理状态,number) |  |
| data>>productList(商品信息,array) |  |
| data>>productList>>title(商品标题,string) |  |
| data>>productList>>asin(asin,string) |  |
| data>>productList>>seller_sku(msku,string) |  |
| total(总数,int) |  |

> **备注**: 唯一键: sid + amazon_order_id


### 查询邮件详情

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/mail/detail` |
| **请求方式** | POST |

**请求参数：**

webmail_uuid(邮件唯一标识,string)

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0成功,int) |  |
| message(响应信息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,object) |  |
| data>>webmail_uuid(邮件唯一标识,string) |  |
| data>>subject(邮件标题,string) |  |
| data>>from_name(发件人姓名,string) |  |
| data>>from_address(发件人地址,string) |  |
| data>>to_address_all(所有收件人地址,string) |  |
| data>>date(日期,string) |  |
| data>>cc(抄送,string) |  |
| data>>bcc(密送地址,string) |  |
| data>>text_html(邮件内容,string) |  |
| data>>text_plain(纯文本的邮件内容,string) |  |
| data>>attachments(附件,array) |  |
| data>>attachments>>name(附件名称,string) |  |
| data>>attachments>>size(附件大小(b),number) |  |
| data>>type(邮件类型,string) |  |
| total(总数,int) |  |


### 查询邮件列表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/mail/lists` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| flag(类型,string) |  |
| email(店铺绑定邮箱,string) |  |
| start_date(开始日期,string) |  |
| end_date(结束日期,string) |  |
| offset(分页偏移量,int) |  |
| length(分页长度,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(响应信息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,array) |  |
| data>>webmail_uuid(邮件唯一标识,string) |  |
| data>>date(日期,string) |  |
| data>>subject(邮件标题,string) |  |
| data>>from_name(发件人姓名,string) |  |
| data>>from_address(发件人地址,string) |  |
| data>>to_name(接收人,string) |  |
| data>>to_address(接收人地址,string) |  |
| data>>has_attachment(是否存在附件,int) |  |
| total(总数,int) |  |



---

## 客诉

### 查询买家之声列表

| 属性 | 值 |
|------|------|
| **API Path** | `/v2/open/customerService/voiceOfBuyer/list` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| offset(分页偏移量,int) |  |
| length(分页长度,int) |  |
| fulfillment_channel(配送方式,string) |  |
| skus(店铺SKU,array) |  |
| proc_health(满意度状况,array) |  |
| search_field(搜索类型,string) |  |
| search_value(搜索值,string) |  |
| return_badge(退货标识,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(消息提示,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链接ID,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(数据列表,array) |  |
| data>>sid(反馈ID,string) |  |
| data>>seller_name(店铺名称,string) |  |
| data>>country(国家名称,string) |  |
| data>>image_url(图片地址,string) |  |
| data>>asin(ASIN,string) |  |
| data>>asin_url(ASIN地址,string) |  |
| data>>title(标题,string) |  |
| data>>msku(MSKU,string) |  |
| data>>fnsku(FNSKU,string) |  |
| data>>fulfillment_channel(配送方式,string) |  |
| data>>ncx_rate(不满意率,string) |  |
| data>>ncx_count(不满意订单数量,int) |  |
| data>>order_count(订单总数,int) |  |
| data>>most_common_return_reason_bucket(主要退货原因,string) |  |
| data>>last_action_date(最近更新日期,string) |  |
| data>>event_date(上次更新日期,string) |  |
| data>>pcx_health_text(满意度状况说明,string) |  |
| data>>product_name(品名,string) |  |
| data>>sku(SKU,string) |  |
| data>>listing_exists(是否在售,boolean) |  |
| data>>star_rating(评分,string) |  |
| data>>returnbadge(退货标记,string) |  |
| data>>returnrate(退货率,string) |  |



---

## 店铺

### 查询店铺绩效详情

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/data/seller/performance/list` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| seller_id(店铺ID,string) |  |
| pids(站点ID,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| id(主键ID,integer) |  |
| seller_id(店铺ID,integer) |  |
| seller_name(店铺名称,string) |  |
| country_code(国家二字码,string) |  |
| account_status(账户状况,string) |  |
| feedback_rating(Feedback评级,string) |  |
| feedback_count(Feedback数量,integer) |  |
| feedback_positive_count(好评数,integer) |  |
| feedback_neutral_count(中评数,integer) |  |
| feedback_negative_count(差评数,integer) |  |
| feedback_positive_rate(好评率,string) |  |
| feedback_update_time(Feedback更新时间,string) |  |
| a_to_z_claims(亚马逊商城交易保障索赔,string) |  |
| a_to_z_claims_update_time(A-Z更新时间,string) |  |
| order_defect_rate(订单缺陷率,string) |  |
| order_defect_rate_update_time(订单缺陷率更新时间,string) |  |
| policy_violations(违反政策,string) |  |
| policy_violations_update_time(违反政策更新时间,string) |  |
| shipping_performance(配送绩效,string) |  |
| shipping_performance_update_time(配送绩效更新时间,string) |  |
| customer_service_performance(客户服务绩效,string) |  |
| customer_service_performance_update_time(客户服务绩效更新时间,string) |  |
| account_health_update_time(账户健康状况更新时间,string) |  |
| create_time(创建时间,string) |  |
| update_time(更新时间,string) |  |



---

## 工具

### 关键词列表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/routing/tool/toolKeywordRank/getteywordList` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| mid(国家id,int) |  |
| start_date(开始日期,格式:Y-m-d,string) |  |
| end_date(结束日期,格式:Y-m-d,string) |  |
| offset(分页偏移量,默认为0,int) |  |
| length(分页长度,默认20,最大值为2000,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0成功,int) |  |
| message(提示信息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求id,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,array) |  |
| data>>id(记录唯一id,int) |  |
| data>>key_word(关键词,string) |  |
| data>>rank(排名,number) |  |
| data>>page(页码,number) |  |
| data>>create_time(开始监控时间,string) |  |
| data>>monitor_time(更新时间,string) |  |
| data>>keyword_remark(关键词备注,string) |  |
| data>>asin(监控的asin,string) |  |
| data>>parent_asin(父asin,string) |  |
| data>>title(标题,string) |  |
| data>>keyword_num(关键词数量,number) |  |
| data>>asin_remark(监控asin的备注,string) |  |
| data>>country(国家,string) |  |
| data>>creator(创建人,string) |  |
| data>>monitors(监控人,array) |  |
| data>>asin_create_time(监控asin的创建时间,string) |  |
| data>>current_page_rank(当前页排名,number) |  |
| data>>sbv_page(sbv排名,number) |  |
| data>>rank_text(排名说明,string) |  |
| data>>sbv_text(sbv排名说明,string) |  |
| data>>is_sponsored(监控范围,number) |  |
| data>>type(监控指标,number) |  |
| total(总数,int) |  |

> **备注**: 该接口位于“工具”分类下



---

## 新广告

### SD广告活动小时数据

| 属性 | 值 |
|------|------|
| **API Path** | `/pb/openapi/newad/sdCampaignHourData` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| report_date(报告日期, 格式:Y-m-d 只能查询最近60天,string) |  |
| campaign_id(广告活动id,number) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码, 0成功,number) |  |
| message(提示消息,string) |  |
| total(总数,number) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,array) |  |
| data>>campaign_id(广告活动id,number) |  |
| data>>profile_id(店铺id,number) |  |
| data>>report_date(报告日期,string) |  |
| data>>hour(小时,number) |  |
| data>>cost(花费,number) |  |
| data>>clicks(点击量,number) |  |
| data>>impressions(曝光量,number) |  |
| data>>same_orders(直接成交订单,number) |  |
| data>>orders(订单数,number) |  |
| data>>same_sales(直接销售额,number) |  |
| data>>sales(销售额,number) |  |
| data>>units(销量,number) |  |
| data>>ctr(点击/曝光,number) |  |
| data>>cvr(订单数/点击,number) |  |
| data>>cpa(花费/订单数,number) |  |
| data>>roas(销售额/花费,number) |  |
| data>>acos(花费/销售额,number) |  |
| data>>cpc(花费/点击,number) |  |



---

## 物流

### STA货件流程说明

| 属性 | 值 |
|------|------|
| **API Path** | `N/A` |
| **请求方式** | N/A |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| access_token(调用接口凭证,string) |  |
| seller_id(卖家ID,string) |  |
| start_time(查询开始时间,string) |  |
| end_time(查询结束时间,string) |  |
| page(页码,integer) |  |
| page_size(每页数量,integer) |  |
| shipment_id(货件ID,string) |  |
| reference_id(货件追踪号,string) |  |
| warehouse_code(仓库代码,string) |  |
| country_code(国家代码,string) |  |
| shipment_status(货件状态,string) |  |
| start_update_time(更新开始时间,string) |  |
| end_update_time(更新结束时间,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| shipment_id(货件ID,string) |  |
| reference_id(货件追踪号,string) |  |
| warehouse_code(仓库代码,string) |  |
| country_code(国家代码,string) |  |
| shipment_status(货件状态,string) |  |
| label_type(标签类型,string) |  |
| create_time(创建时间,string) |  |
| update_time(更新时间,string) |  |
| items(货件商品列表,array) |  |
| seller_sku(商品SKU,string) |  |
| fnsku(FNSKU,string) |  |
| asin(ASIN,string) |  |
| quantity_shipped(发货数量,integer) |  |
| quantity_received(接收数量,integer) |  |
| quantity_in_case(每箱数量,integer) |  |

> **备注**: 该截图为STA货件的整体流程说明，包含多个相关API的参数信息，并非单一接口文档。


### 更新发货单物流信息

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/v1/logistics/updateLogistics` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| data(请求数据,object) |  |
| data.logistics_sn(运单号,string) |  |
| data.expected_arrival_date(预计到港日期,string) |  |
| data.actual_arrival_date(实际到港日期,string) |  |
| data.actual_shipment_date(实际发货日期,string) |  |
| data.box_type(装箱方式,int) |  |
| data.logistics_channel_id(物流渠道ID,int) |  |
| data.logistics_list(更新物流信息,array) |  |
| data.logistics_list.tracking_list(追踪明细,array) |  |
| data.logistics_list.tracking_list.tracking_no(运单号,string) |  |
| data.logistics_list.tracking_list.transport_type(运输方式,int) |  |
| data.logistics_list.tracking_list.transporter_type_code(承运商类型,string) |  |
| data.logistics_list.remark(备注,string) |  |
| data.logistics_list.estimate_expenses_list(预估费用,array) |  |
| data.logistics_list.estimate_expenses_list.chargeable_weight(计费重量,number) |  |
| data.logistics_list.estimate_expenses_list.price(单价,number) |  |
| data.logistics_list.estimate_expenses_list.currency(币种,string) |  |
| data.logistics_list.estimate_expenses_list.other_fee(其他费用,number) |  |
| data.logistics_list.estimate_expenses_list.other_fee_currency(其他费用币种,string) |  |
| data.logistics_list.estimate_expenses_list.total_amount(总金额,number) |  |
| data.logistics_list.estimate_expenses_list.total_amount_currency(总金额币种,string) |  |
| data.logistics_list.actual_expenses_list(实际费用,array) |  |
| data.logistics_list.actual_expenses_list.chargeable_weight(计费重量,number) |  |
| data.logistics_list.actual_expenses_list.price(单价,number) |  |
| data.logistics_list.actual_expenses_list.currency(币种,string) |  |
| data.logistics_list.actual_expenses_list.other_fee(其他费用,number) |  |
| data.logistics_list.actual_expenses_list.other_fee_currency(其他费用币种,string) |  |
| data.logistics_list.actual_expenses_list.total_amount(总金额,number) |  |
| data.logistics_list.actual_expenses_list.total_amount_currency(总金额币种,string) |  |
| data.logistics_list.tracking_number(追踪号,string) |  |
| data.logistics_list.predicted_transportation_cost(预估运输费,number) |  |
| data.logistics_list.predicted_transportation_currency(预估运输费币种,string) |  |
| data.logistics_list.predicted_other_remark(其他费用备注,string) |  |
| data.logistics_list.predicted_other_currency(其他费用币种,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| msg(返回信息,string) |  |
| request_id(请求ID,string) |  |
| response_time(响应时间,string) |  |
| data(返回数据,object) |  |



---

## 统计

### 查询asin360小时数据

| 属性 | 值 |
|------|------|
| **API Path** | `/basicOpen/salesAnalysis/productPerformance/performanceTrendByHour` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sids(店铺id,多个值使用英文逗号隔开,最大上限为200,string) |  |
| date_start(开始时间,闭区间,格式:Y-m-d,string) |  |
| date_end(结束时间,闭区间,格式:Y-m-d,string) |  |
| summary_field(查询维度,string) |  |
| summary_field_value(查询维度值,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0成功,number) |  |
| message(提示信息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,object) |  |
| data>>list(列表,array) |  |
| data>>list>>r_date(小时段,string) |  |
| data>>list>>volume(销量,int) |  |
| data>>list>>order_items(订单量,int) |  |
| data>>list>>amount(销售额,string) |  |
| data>>list>>price(价格,string) |  |
| data>>list>>sales_rank(大类排名,string) |  |
| data>>total(总计,object) |  |
| data>>total>>r_date(小时段,string) |  |
| data>>total>>volume(销量,int) |  |
| data>>total>>order_items(订单量,int) |  |
| data>>total>>amount(销售额,string) |  |
| data>>total>>price(价格,null) |  |
| data>>total>>sales_rank(大类排名,null) |  |
| data>>currency_icon(币种类型,string) |  |
| total(总数,int) |  |



---

## 订单

### 查询亚马逊订单列表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/amazon/OrderLists` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| sid(店铺id, 对指定店铺过滤时传店铺id,否则传店铺id字符串【'all'】,string) |  |
| sku_list(店铺sku列表, 最大长度20,array) |  |
| start_date(查询时间, 支持的格式: Y-m-d H:i:s, Y-m-d, Y-m-d H:i, Y-m-d H,string) |  |
| end_date(查询时间, 支持的格式: Y-m-d H:i:s, Y-m-d, Y-m-d H:i, Y-m-d H,string) |  |
| date_type(查询时间类型: 【默认】1, 1【创建时间】, 2【已审核时间】, 3【平台更新时间】, 4【发货时间】, 5【付款时间】,int) |  |
| order_status(订单状态: Pending, Unshipped, PartiallyShipped, Shipped, Canceled,array) |  |
| sort_desc_by_date_type(是否按查询日期类型降序排序: 0否, 1是, 2升序【默认】,int) |  |
| fulfillment_channel(配送方式: 1亚马逊FBA, 2自发货MFN,int) |  |
| offset(分页偏移量, 默认0,int) |  |
| length(拉取长度, 默认1000, 上限5000,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码, 0:成功,int) |  |
| message(消息提示,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求标识id,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| data->id(店铺id,int) |  |
| data->seller_name(店铺名称,string) |  |
| data->amazon_order_id(亚马逊订单号,string) |  |
| data->order_status(订单状态,string) |  |
| data->order_total_amount(订单金额,string) |  |
| data->fulfillment_channel(配送方式: 自动识别-AFN, 自发货-MFN,string) |  |
| data->postal_code(邮编,string) |  |
| data->is_return(退货状态: 0 未退款, 1部分, 2 退款完成,int) |  |
| data->is_next_order(是否为多次派送订单: 0否, 1是,int) |  |
| data->is_replaced(是否为换货订单: 0否, 1是,int) |  |
| data->is_replacement_order(是否为替代换货订单: 0否, 1是,int) |  |
| data->is_return_order(是否为退货订单: 0否, 1是,int) |  |
| data->order_total_amount_cny(订单金额(CNY),string) |  |
| data->sales_channel(销售渠道,string) |  |
| data->tracking_number(物流单号,string) |  |
| data->refund_amount(退款金额(含税),string) |  |
| data->item_list(商品信息,array) |  |
| data->item_list->asin(Asin,string) |  |
| data->item_list->quantity_ordered(数量,int) |  |
| data->item_list->msku(MSKU,string) |  |
| data->item_list->local_sku(本地SKU,string) |  |
| data->item_list->local_name(本地品名,string) |  |
| data->purchase_date(采购时间,string) |  |
| data->purchase_date_utc(采购时间【UTC】,string) |  |
| data->purchase_date_local(采购时间【本地时区】,string) |  |
| data->shipment_date(发货日期【亚马逊后台时间，不一定为北京时间】,string) |  |
| data->shipment_date_utc(发货日期【UTC】,string) |  |
| data->shipment_date_local(发货日期【本地时区】,string) |  |
| data->last_update_date(订单更新时间【亚马逊后台时间】,string) |  |
| data->last_update_date_utc(订单更新时间【UTC】,string) |  |
| data->last_update_date_local(订单更新时间【本地时区】,string) |  |
| data->posted_date(创建日期,string) |  |
| data->posted_date_utc(创建日期【UTC】,string) |  |
| data->purchase_date(订单创建时间【亚马逊后台时间，不一定为北京时间】,string) |  |
| data->purchase_date_utc(订单创建时间【UTC】,string) |  |
| data->earliest_ship_date(发货时间【亚马逊后台时间，不一定为北京时间】,string) |  |
| data->earliest_ship_date_utc(发货时间【UTC】,string) |  |
| data->last_updated_before(订单更新时间【UTC】,string) |  |
| data->grid_modified_at(订单修改时间【UTC】,string) |  |

> **备注**: order_status说明: Pending, Unshipped, PartiallyShipped, Canceled各种状态不互斥。Pending, Unshipped, Canceled没有先后顺序。date_type为5时, 传入这三个参数无效。



---

## 评论

### 查询评论管理 - Review(新)

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/comment/data/review/listNewReview` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| seller_id(店铺ID,string) |  |
| review_type(类型,string) |  |
| asin(ASIN,string) |  |
| skus(SKU,string) |  |
| search_type(查询类型,string) |  |
| search_value(查询值,string) |  |
| date_item(时间筛选类型,string) |  |
| start_date(开始时间,string) |  |
| end_date(结束时间,string) |  |
| status(状态,string) |  |
| star(星级,string) |  |
| review_modified_status(评论修改状态,string) |  |
| mark(标记,string) |  |
| is_pinned_note(是否置顶,string) |  |
| length(分页数量,int) |  |
| offset(分页,int) |  |
| global_tag_ids(全局标签,string) |  |
| match_type(匹配类型,string) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| total(总数,integer) |  |
| data(数据,array) |  |
| review_id(评论ID,string) |  |
| review_time(评论时间,string) |  |
| asin(ASIN,string) |  |
| data->local_image_url(主图,string) |  |
| data->seller_sku(SKU,string) |  |
| data->local_title(标题,string) |  |
| data->review_title(评论标题,string) |  |
| data->review_comment(评论内容,string) |  |
| data->star(星级,number) |  |
| data->review_link(评论链接,string) |  |
| data->order_id(订单ID,string) |  |
| data->customer_name(买家姓名,string) |  |
| data->is_vp(是否VP,integer) |  |
| data->images(评论图片,array) |  |
| data->videos(评论视频,array) |  |
| data->review_status(状态,string) |  |
| data->review_modified_date(评论修改时间,string) |  |
| data->feedback(Feedback,string) |  |
| data->feedback_status(Feedback状态,string) |  |
| data->feedback_time(Feedback时间,string) |  |
| data->feedback_rating(Feedback星级,integer) |  |
| data->arrived_time(留评时间,string) |  |
| data->is_delete(是否删除,integer) |  |
| data->is_replied(是否回复,integer) |  |
| data->replied_date(回复时间,string) |  |
| data->replied_content(回复内容,string) |  |
| data->is_read(是否已读,integer) |  |
| data->mark(标记,integer) |  |
| data->note(备注,string) |  |
| data->pinned_time(置顶时间,string) |  |
| data->is_pinned_note(是否置顶,integer) |  |
| data->country(站点,string) |  |
| data->seller_name(店铺名称,string) |  |
| data->last_follow_time(最后跟进时间,string) |  |
| data->last_follow_user_name(最后跟进人,string) |  |
| data->follow_user_name(跟进人,string) |  |
| data->follow_status_name(跟进状态,string) |  |
| data->global_tag_names(全局标签,string) |  |
| data->local_tag_names(本地标签,string) |  |



---

## 财务

### 查询批次流水

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/finance/data/inventory/getInventoryStatementList` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| statement_type_list(流水类型,array[int]) |  |
| search_field(搜索字段,string) |  |
| search_value(搜索值,string) |  |
| offset(分页查询,int) |  |
| length(分页条数,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(结果提示,string) |  |
| total(总数,int) |  |
| data(数据,array) |  |
| batch_id(批次ID,string) |  |
| batch_name(批次名称,string) |  |
| batch_no(批次号,string) |  |
| warehouse_name(仓库名称,string) |  |
| product_name(品名,string) |  |
| sku(SKU,string) |  |
| statement_type_name(流水类型名称,string) |  |
| initial_balance_num(期初结余数量,int) |  |
| initial_cost(期初成本,float) |  |
| inbound_num(入库数量,int) |  |
| inbound_cost(入库成本,float) |  |
| outbound_num(出库数量,int) |  |
| outbound_cost(出库成本,float) |  |
| final_balance_num(期末结余数量,int) |  |
| final_cost(期末成本,float) |  |



---

## 采购

### 查询采购单列表

| 属性 | 值 |
|------|------|
| **API Path** | `/erp/sc/data/purchase/PurchaseOrderLists` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| seller_id(店铺ID,string) |  |
| start_date(开始时间,string) |  |
| end_date(结束时间,string) |  |
| date_type(日期类型,integer) |  |
| warehouse_id(仓库ID,integer) |  |
| page(页码,integer) |  |
| pagesize(每页大小,integer) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(返回编码,integer) |  |
| message(返回信息,string) |  |
| total(总条数,integer) |  |
| list(数据列表,array) |  |
| id(采购单ID,integer) |  |
| purchase_order_sn(采购单号,string) |  |
| warehouse_name(仓库名称,string) |  |
| supplier_name(供应商名称,string) |  |
| purchase_amount(采购金额,float) |  |
| status(状态,integer) |  |
| created_at(创建时间,string) |  |
| sku(SKU,string) |  |
| product_name(产品名称,string) |  |
| product_img(产品图片,string) |  |
| qty(采购数量,integer) |  |
| price(采购单价,float) |  |
| amount(商品金额,float) |  |

> **备注**: 页面显示完整，非续页


### 创建待采购的采购计划

| 属性 | 值 |
|------|------|
| **API Path** | `/sc/routing/data/local_inventory/createPurchasePlan` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| remark(计划备注,string) |  |
| data(产品信息,array) |  |
| data>>sid(店铺id,string) |  |
| data>>supplier_id(供应商id,int) |  |
| data>>sku(sku,string) |  |
| data>>fnsku(fnsku,string) |  |
| data>>wid(仓库id,int) |  |
| data>>purchaser_id(采购方id,int) |  |
| data>>expect_arrive_time(期望到货时间,string) |  |
| data>>cg_uid(采购员id,int) |  |
| data>>quantity_plan(计划采购量,int) |  |
| data>>remark(产品备注,string) |  |
| data>>options(可选参数,object) |  |
| data>>options>>is_auto_fill_fnsku(是否自动填充FNSKU,int) |  |
| data>>options>>is_auto_fill_store(是否自动填充店铺,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,int) |  |
| message(说明消息,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求id,string) |  |
| response_time(响应时间,string) |  |
| data(响应数据,object) |  |
| data>>ppg_sn(计划编号,array) |  |
| data>>ppg_no(计划批次号,string) |  |



---

## 销售

### 查询促销活动列表-会员折扣/价格折扣

| 属性 | 值 |
|------|------|
| **API Path** | `/basicOpen/promotionalActivities/vipDiscount/list` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| start_date(开始日期【活动时间】,站点时间,闭区间,格式:Y-m-d,时间间隔最长不超过90天,string) |  |
| end_date(结束日期【活动时间】,站点时间,闭区间,格式:Y-m-d,时间间隔最长不超过90天,string) |  |
| sids(店铺id,对应查询亚马逊店铺列表接口对应字段【sid】,array) |  |
| offset(分页偏移量,默认0,int) |  |
| length(分页长度,默认20,上限200,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码,0成功,int) |  |
| message(消息提示,string) |  |
| error_details(错误信息,array) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| total(总数,int) |  |
| data(响应数据,array) |  |
| data>>promotion_id(促销活动id,string) |  |
| data>>name(折扣名称,string) |  |
| data>>product_quantity(商品数量,int) |  |
| data>>sid(店铺id,int) |  |
| data>>currency_icon(货币icon,string) |  |
| data>>customer_target(消费群体类型,string) |  |
| data>>origin_status(活动状态,string) |  |
| data>>promotion_start_time(活动开始时间【站点时间】,string) |  |
| data>>promotion_end_time(活动结束时间【站点时间】,string) |  |
| data>>first_sync_time(首次同步时间【站点时间】,string) |  |
| data>>last_sync_time(最后同步时间【站点时间】,string) |  |
| data>>update_time(更新时间【站点时间】,string) |  |
| data>>remark(备注,string) |  |


### 多渠道订单-交易明细

| 属性 | 值 |
|------|------|
| **API Path** | `/basicopen/openapi/salesOrder/multi-channel/list/transaction` |
| **请求方式** | POST |

**请求参数：**

| 参数名 | 说明 |
|--------|------|
| amazonOrderId(亚马逊订单ID,string) |  |
| sid(店铺id,int) |  |

**返回字段：**

| 字段名 | 说明 |
|--------|------|
| code(状态码, 0 成功,int) |  |
| message(消息提示,string) |  |
| request_id(请求链路id,string) |  |
| response_time(响应时间,string) |  |
| data(返回数据,object) |  |
| total(总数,int) |  |
| data>>list>>costDetails(明细,array) |  |
| data>>list>>fid(结算编号,string) |  |
| data>>list>>productName(产品名,string) |  |
| data>>list>>quantity(数量,string) |  |
| data>>list>>sellerSku(MSKU,string) |  |
| data>>list>>totalCurrencyAmount(总金额,string) |  |

> **备注**: 查询【销售】>【SC订单】>【多渠道订单】交易明细数据

