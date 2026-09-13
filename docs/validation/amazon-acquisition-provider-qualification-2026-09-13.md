# Amazon统一采集Provider资格验证记录

**日期：** 2026-09-13  
**阶段：** A0，只读发现与合同建立  
**真实采集状态：** 未运行；等待测试ASIN和最高费用授权

## 当前连接边界

Apify连接器已在当前开发任务启用，仅用于Actor发现、Schema和资格验证。该连接不等于青岛独立站生产接入；生产站未来必须通过服务端Provider Adapter和受管Secret调用。

## 候选结论

| 候选 | 维护与使用 | 免费层公开价格 | Schema证据 | 当前结论 |
|---|---|---:|---|---|
| `junglee/Amazon-crawler` | Apify维护；约22,926累计用户、1,967月用户；2026-09-12更新；评分4.16 | 结果约$0.005/条；设置配送国家会额外计费 | 输出Schema明确含`galleryThumbnails`、`highResolutionImages`、`variantDetails.images`、`aPlusContent`和`brandStory` | **首选实样候选**。字段声明最完整，但A+和品牌故事必须通过真实ASIN确认，不能仅凭Schema批准。 |
| `curious_coder/amazon-scraper` | 社区维护；约1,092累计用户、74月用户；2026-08-12更新；评分4.67 | 启动约$0.00005，结果约$0.001/条 | README明确图片和变体；当前推断Schema未证明A+与品牌故事 | **成本对照候选**。可测试基础信息和图片组，但未观察到A+合同证据。 |

## 只读发现结论

`junglee/Amazon-crawler`是当前最适合P0实样验证的候选，因为它由Apify维护、使用量高、近期更新，并在成功Run推断Schema中明确给出高分辨率图片、缩略图、变体图片、A+和品牌故事字段。公开问题记录同时表明A+字段可能因页面阻断而为空，因此正式状态必须区分`confirmed_absent`、`not_returned`和`provider_blocked_suspected`。

第二候选只作为成本和基础图片覆盖对照，不作为A+能力的替代承诺。两者均不得在未经用户确认测试ASIN和最高预算时运行。

## 已建立合同门禁

`server/domains/acquisition/providerContracts.ts`已定义能力枚举、字段状态、固定失败类别、资格记录Schema和批准门禁。至少实样观察到`catalog_basic`和`image_gallery`且不存在待审核、无效或疑似阻断字段时，Provider才可进入批准状态。A+未返回不阻塞主图首期，但必须保留字段状态和限制说明。

定向验证结果：`providerContracts.test.ts`共4项通过；新增合同与测试文件的ESLint检查通过；本地生产构建与Bundle预算检查通过。该结果只证明系统合同、门禁和项目构建正确，不代表Actor真实采集能力已通过。

## 下一步授权要求

真实资格验证需要用户提供或明确批准一个美国站公开竞品ASIN，并确认每次测试最高费用。首选Actor测试将限制为1个输入URL、最多1条结果、不抓Offers/Sellers、不设置收费配送地址，并设置Actor总费用上限。真实Run结果只写本地资格验证记录，不写任何产品、知识库或生产数据库。
