# A8 Amazon监控Provider候选公开能力核验

**日期：** 2026-09-13  
**性质：** 公开页面只读调研；未运行Actor、未产生Provider费用、未形成生产批准

## 候选对比

| 监控能力 | 候选 | 公开页面声明 | 当前资格状态 |
|---|---|---|---|
| `offers` / `sales_rank` | `marketplace-scrapers/amazon-bsr-scraper` | 页面声明支持按ASIN读取BSR主排名与子类排名、Buy Box卖家、价格/币种、offer数量；覆盖US、UK、DE、FR、IT、ES、NL、JP、CA、AU；提供API入口和定时运行说明。 | **qualification_pending**。公开说明可作为候选依据，但尚未用受控ASIN实样验证字段、错误、成本和空值语义。 |
| `search_rank` | `doesaiknow/amazon-rank-tracker` | 页面声明每次最多100个关键词、最多扫描3页，跟踪ASIN自然与Sponsored位置、品牌Share of Shelf及与上次运行的变化；页面提供Input/Output/API入口。 | **qualification_pending**。公开说明可作为候选依据，但尚未用受控ASIN×关键词实样验证organic/ad位置、分页、地点、成本和空值语义。 |

## 公开输入合同

| 候选 | 精确输入字段 | 公开限制与成本提示 |
|---|---|---|
| BSR / Buy Box | `marketplaces: string[]`、`asins: string[]`、`maxSnapshots: 1..1000`、`proxyConfiguration` | 单条监控按`marketplaces:["US"]`、单ASIN、`maxSnapshots:1`构造；公开页标价约每1,000条$2起，真实费用仍以受控Run返回为准。 |
| Keyword Rank | `keywords: string[]`（最多100）、`asins: string[]`（最多20）、`competitorAsins?: string[]`、`marketplace:"com"`、`postalCode?: string`、`depth:1..3`、`watchlistId?: string`、`includeVolume?: boolean`、`bypassRunCache?: boolean` | 单监控首期固定单关键词、单ASIN、US、`depth:1`、固定邮编、`includeVolume:false`。公开页说明每次启动$0.05，免费层每关键词每页约$0.025；真实费用仍受单Run预算和用户独立授权约束。 |

## 实施门禁

两个候选都只能写入Provider Profile的待资格状态。A8可以完成能力合同、持久化Monitor Run、Heartbeat和前后台管理，但在管理员录入受管Secret、完成单次预算授权和实样资格验证前，真实运行必须失败关闭。系统不得以旧`scraper.ts`、`crawlerEngine.ts`、浏览器或代理/UA轮换作为自动降级。

候选资格验证必须分别覆盖：正常返回、目标ASIN不存在或未排名、字段缺失、部分结果、限流、超时、Schema漂移、站点/地区、费用上限和幂等重试。只有通过的Capability才可从`qualification_pending`切换为`active`。
