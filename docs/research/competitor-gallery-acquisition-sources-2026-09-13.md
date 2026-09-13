# 竞品全图采集方案外部资料摘录（2026-09-13）

## 1. Apify 候选 Actor

来源：[Amazon ASINs Scraper · Apify](https://apify.com/junglee/amazon-asins-scraper)

- Actor：`junglee/amazon-asins-scraper`，页面显示由 Apify 维护，2026-09-13访问时显示近期有更新。
- 公开说明支持输入一个或多个 ASIN，并选择 Amazon store；输出示例包含标题、品牌、价格、评分、评论数、描述、类目路径、URL和`thumbnailImage`。
- 页面营销说明列出标题、品牌、价格、星级、描述、Features、Offers、Seller data，但**没有明确声明完整主图数组、A+模块或A+图片**。
- Output Schema 页面在公开访问中未呈现可核验字段结构，因此不能仅凭Actor名称假设“所有主图+A+图片”可获得。
- 页面展示的价格信息存在两种表述：顶部为`from $3.00 / 1,000 results`，FAQ另述月租模型；正式选型必须以启用连接器后的账户定价页和一次真实字段验收为准。
- 页面说明错误输入会返回带`error`字段的数据项，而非静默跳过；这适合映射为逐ASIN子Run的失败状态。
- 同厂商另一个Amazon Product Scraper的公开Issue显示，A+内容曾因Amazon静默阻断而返回`null`；维护者后来通过改善绕过方式并增加`ensureLoadedProductDescriptionFields`重试选项缓解，但这仍说明`null`不能直接解释为“商品没有A+”。来源：[A+ Content Issue · Apify](https://apify.com/junglee/amazon-crawler/issues/a-content-remElFJa1Oa0MLzx0)。因此产品状态必须区分`confirmed_absent`、`not_returned`和`provider_blocked_suspected`，不能把空值当成已确认无A+。

## 2. Bright Data 备选

来源：[Amazon Scraper API · Bright Data](https://brightdata.com/products/web-scraper/amazon)

- 公开页面列出的Amazon产品字段包括ASIN、标题、品牌、商品URL、类目、描述、变体、价格、评分、评论以及`images`。
- 页面另列“Amazon Image”采集项，公开描述包含`image url`、`primary image`、`additional images`、`thumbnail`、`image count`、alt text、title、url、category tree、brand。
- 页面没有明确声明A+模块或A+图片字段。因此可作为“基础信息+主图/附加图”的受控Provider备选，但A+仍必须通过字段验收后才开放。
- 页面说明支持代码触发、参数化运行、结果投递到存储或webhook，也支持控制台运行；适合作为可替换Provider，但本项目首期不应依赖webhook才能完成闭环。

## 3. Amazon官方接口

来源：[Catalog Items API v2022-04-01 Reference](https://developer-docs.amazon.com/sp-api/docs/catalog-items-api-v2022-04-01-reference)

- `getCatalogItem`/`searchCatalogItems`可读取Amazon catalog中的商品信息；`includedData`可请求`images`、`summaries`、`attributes`、`relationships`、`salesRanks`等数据。
- 官方文档将图片定义为catalog item images，但没有将公开竞品页面的完整A+视觉结构列为Catalog Items返回范围。
- 需要Selling Partner API授权，并受调用配额与权限约束。

来源：[A+ Content API](https://developer-docs.amazon.com/sp-api/docs/a-plus-content-api-use-case-guide) 与 [Create, edit, and publish A+ content](https://developer-docs.amazon.com/sp-api/docs/create-edit-publish-aplus-content)

- A+ Content API用于卖家/供应商创建、编辑和管理内容文档，需要卖家授权及Brand Analytics或Product Listing角色。
- `searchContentDocuments`描述为获取该selling partner创建的内容文档；因此它不能被当作任意竞争对手公开A+内容的通用读取接口。
- 本项目可将SP-API Catalog Items作为经授权的基础信息/目录图片补充来源，但竞争对手完整A+采集仍需受控第三方Provider或人工补充，且必须人工确认。

## 4. 当前连接器状态

通过当前任务的只读配置检查发现有两个名为Apify的连接器条目，均处于`enabled: false`。本轮只评审方案，未启用、修改或调用连接器。

## 5. 方案含义

1. “输入ASIN后自动拿到所有图片”技术上可实现为受控异步采集，但**不能承诺任一候选Provider必然返回完整A+**。
2. 产品契约应拆分为`basic_info`、`main_gallery`、`a_plus`三个独立覆盖状态；`a_plus`必须允许`unavailable/not_returned/needs_manual_supplement`。
3. 在正式开发前必须用少量经用户批准的试点ASIN做Provider字段验收，验证原始顺序、完整主图数组、A+模块、图片清晰度、变体一致性与错误语义；未通过的范围不得在生产UI中承诺。
4. 旧项目中的自建Amazon页面抓取器使用直连页面、代理、UA轮换和反自动化重试，不符合当前“仅管理员启用受控Provider”的数据源约束；新功能只能复用图片知识库的展示、标签和审核交互，不能复用旧采集实现。
