# 亚马逊全链路智能工具独立部署审计与迁移方案

**日期：** 2026-08-18  
**目标：** 将应用从当前托管运行方式迁移为独立服务器部署，同时保持现有图片工作流页面结构、业务流程和 AI 审核逻辑不变。

## 一、审计结论

应用本体已具备独立 Node.js 运行基础：生产构建会产出 Web 服务、AI Worker 和 Scheduler 三个进程，数据库层使用 MySQL 方言的 Drizzle ORM，文件存储调用已集中在统一服务边界。当前阻止完全独立运行的关键不是 React 页面或业务代码，而是 **认证、数据库/对象存储生命周期、Forge AI 服务和平台调度** 四类平台依赖。

皇帝中台的模型层已具备独立迁移基础：只读审计发现当前有 35 条模型提供商配置，其中当前活动默认模型为自定义 OpenAI 兼容网关（`https://api.teamorouter.com/v1`），并同时保留多种活动模型配置。独立迁移时应复制这些**配置记录**与项目级密钥，不应读取、打印或写入任何明文密钥。所有仍标记为 `manus_builtin` 的模型必须在切换前改为现有自定义网关模型或其他独立供应商模型。

| 边界 | 当前实现 | 完全独立部署时的处理 | 风险级别 |
|---|---|---|---|
| 用户认证 | Manus OAuth 回调、`openId` 会话令牌 | 替换为独立邮件密码登录或第三方 OAuth；保持 `users`、角色、组织和工作区数据 | 高 |
| 数据库 | MySQL 方言，当前数据和连接由托管项目生命周期管理 | 自建 MySQL 8 或托管 MySQL；先只读备份、校验后迁移 | 高 |
| 对象存储 | `/manus-storage/*` 代理到 Forge 预签名服务 | 已适配青岛私有OSS S3兼容接口；服务端使用内网Endpoint，浏览器使用公网预签名Endpoint | 高 |
| AI 能力 | Forge LLM、图片、语音、通知、地图及数据 API | LLM可切换外部OpenAI兼容网关；其余Forge专属能力必须替换或在首期禁用 | 高 |
| 后台任务 | 托管调度接口和 AI Job Worker | 用 systemd 管理 Web、Worker、Scheduler；使用 systemd timer 或 cron | 中 |
| 前端与 API | Vite + Express + tRPC | 无需重写，使用 Nginx + HTTPS 反向代理 | 低 |

> 现有 Manus OAuth 的回调 URI 被绑定到托管域名，因此不能直接用于独立服务器域名。独立入口必须替换认证提供者或启用独立密码登录。

## 二、推荐独立架构

已创建的目标环境为阿里云华北1（青岛，`cn-qingdao`）ECS，采用本机MySQL 8、青岛私有OSS Bucket和现有自定义OpenAI兼容模型网关。应用将使用ECS本机Node 22与systemd运行，不购买ACR企业版，因此不增加仅为托管基础镜像而产生的固定月费。该方案不要求拆分现有图片工作流页面，也不改变现有 Step0–5、Skill、Agent、人审确认或锁定逻辑。

```text
Internet
   │ HTTPS
   ▼
Nginx + Let's Encrypt
   │
   ├── Web / Express + tRPC (Node.js)
   ├── AI Worker (Node.js)
   └── Scheduler (Node.js + systemd timer)
          │
          ├── MySQL 8（本机仅回环监听）
          ├── 阿里云OSS（青岛私有Bucket）
          └── 外部 AI 网关（LLM、图片、语音、通知）
```

## 三、Forge专属依赖与首期替代边界

本轮代码扫描确认：认证、存储和通用LLM均已具备独立开关；但下表能力仍直接依赖托管Forge，不能在缺少替代服务的独立环境中静默启用。

| 能力 | 直接依赖位置 | 独立部署首期策略 | 上线门槛 |
|---|---|---|---|
| 通用LLM与皇帝Skill | `server/_core/llm.ts`、Skill模型配置 | `LLM_PROVIDER=external`，迁移所有仍为`manus_builtin`的Skill模型配置 | 必须以外部网关真实调用通过 |
| 图片生成/编辑 | `server/_core/imageGeneration.ts` | 接入用户现有兼容图像服务，或在独立站首期隐藏入口并返回明确不可用提示 | 未替代前不得将图片生成任务投入生产队列 |
| 视频语音转写 | `server/_core/voiceTranscription.ts`、`kbVideos.ts` | 接入Whisper兼容服务或禁用知识库视频转写 | 必须验证一条真实音视频转写 |
| 地图与数据API | `server/_core/map.ts`、`dataApi.ts` | 配置对应供应商凭据；当前运营主流程不依赖时可延后 | 入口必须显示功能状态，不能伪装成功 |
| 所有者通知 | `server/_core/notification.ts` | 改用SMTP、企业微信或Webhook | 首期可降级为应用日志，不影响业务主流程 |
| 托管Heartbeat | `server/_core/heartbeat.ts` | 由Compose Scheduler和系统cron替代；任何Forge Heartbeat调用应停用或替换 | 定时任务需在ECS连续运行中验证 |

> 当前图片工作流的文本/结构化分析已遵循皇帝Skill调用链；独立环境只要为皇帝Skill配置外部模型网关，即不需要为这一主流程重写前台、Agent或业务路由。

### 已确认的低成本运行决策

青岛ECS将不购买ACR企业版实例。该实例仅为托管/订阅Node与MySQL基础镜像而设，并非业务运行所必需；应用改为使用ECS本机安装的Node 22、本机MySQL 8与systemd守护Web、AI Worker和Scheduler，从而不引入额外的ACR固定月费。Docker保留为可选工具，不作为首期应用运行依赖。

外部模型网关采用TeamoRouter的OpenAI兼容接口：基础地址为`https://api.teamorouter.com/v1`，通用聊天端点为`/chat/completions`，模型列表可由`GET /v1/models`读取。受管连接测试已验证默认模型`gpt-5.6-sol`可用；密钥仅保存在受管密钥与真实ECS的权限600运行配置中，绝不写入本文件或版本库。[1]

## 四、迁移前必须确认的选择

以下选择涉及账号、数据和外部服务的实际归属，不能默认替用户决定。

| 项目 | 建议方案 | 需要用户确认 |
|---|---|---|
| 认证 | 保留现有用户表和角色，启用邮箱 + 密码登录；后续可加 Google OAuth | 是否采用独立邮箱密码作为首期登录方式 |
| 数据库 | 在独立服务器部署 MySQL 8，并在切换前从现有库做完整只读备份和校验 | 是否同意迁移全部业务数据到独立 MySQL |
| 对象存储 | Cloudflare R2 或 AWS S3 私有桶，应用通过签名 URL 访问 | 选择 R2、AWS S3 或自建 MinIO |
| AI 服务 | 统一替换为用户自有的 OpenAI 兼容网关/模型供应商密钥 | 选择供应商并提供独立 API 密钥 |
| 域名 | 使用现有自有域名或新域名，DNS A 记录指向独立服务器 | 提供域名或确认后续购买/绑定 |
| 切换策略 | 先以独立测试域名灰度运行，保留当前托管站点作为回滚 | 是否接受双入口验证后再切换正式域名 |

## 五、实施顺序与保护措施

迁移将按“可回滚优先”执行：先配置独立服务器和测试域名；随后部署应用及三类进程；再以备份方式迁移数据库和对象；完成真实登录、数据库、AI 调用、上传下载和图片工作流 Smoke Test；最后才修改正式域名。当前托管部署在全部验证通过前保持可用，不能删除。

数据库迁移前将执行只读备份、行数/校验抽查和恢复演练；对象存储迁移将先清单化对象键再复制；密钥只写入独立服务器项目级 `.env` 或 systemd `EnvironmentFile`，不写入代码仓库、文档或全局系统环境。

## 六、当前可立即执行与受限事项

真实青岛ECS已核验为4核、约7.1GiB内存和99GB磁盘。Node 22、本机MySQL 8、Nginx、Certbot及pnpm均已准备完成；Manus托管TiDB已做只读一致性导出，并在隔离MySQL恢复校验后提升至独立生产库。当前仍不得切换DNS或关闭Manus站点，直至完成本机Node服务、OSS、外部模型、备份恢复与HTTPS的端到端验证。

## 参考资料

[1] [TeamoRouter API 接入文档](https://teamorouter.com/zh/docs/api-integration)
