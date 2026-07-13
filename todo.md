# Amazon Listing Tool - TODO

## 部署任务

- [x] 初始化 Manus webdev 项目（web-db-user 架构）
- [x] 从 GitHub 仓库同步业务代码到 Manus 项目目录
- [x] 安装依赖（pnpm install）
- [x] 配置环境变量（COMPANY_NAME、ERP_TYPE、INSTANCE_ID 等）
- [x] 执行数据库迁移（73 个 SQL 文件，174 张表）
- [x] 修复 offsite 相关表字段命名（驼峰 → 下划线）
- [x] 修复 ad_report_uploads、ad_campaign_reports 等广告报告表
- [x] 创建 kb_intel_sources、kb_intel_items 等知识库情报表
- [x] 创建 product_todos 表，补充 product_profiles.chinese_name 字段
- [x] 修复测试数据时效性问题（devAnalysisOptimization.test.ts）
- [x] 全量测试通过（157 文件 / 3495 用例全部通过）
- [x] 生产构建成功（pnpm run build）
- [x] 保存 Checkpoint 并发布上线

## 待优化项

- [x] 前端 bundle 体积过大（index.js 9.8MB），建议拆分动态导入（已知问题，后续版本优化）
- [x] 部分 offsite 表仍有冗余旧字段，可在后续版本清理（已知问题，后续版本优化）

## 独立账号密码登录（2026-07-08）

- [x] users 表新增 password_hash、must_change_password 字段
- [x] 后端：账号密码登录接口（bcrypt 验证）
- [x] 后端：修改密码接口
- [x] 前端：密码登录页面（与 Manus OAuth 并存）
- [x] 前端：首次登录强制修改密码弹窗
- [x] 预设管理员账号 kangboning（首次登录需改密码）
- [x] 测试通过，保存 Checkpoint 并发布

## 风格结构化参数新增「风格特点」字段（2026-07-09）

- [x] imageTagConstants.ts：StyleParams 接口新增 styleFeature 字段，13 个预设风格补充默认值
- [x] KBTagManagement.tsx：预览卡片、新增表单、编辑表单三处同步添加「风格特点」输入项
- [x] 测试通过（kbTags + kbImageOptimization，57 个用例）

## 图片集详情页新布局（2026-07-09）

- [x] 副图缩略图条只保留主图和套图（过滤掉 A+ 和品牌故事图片）
- [x] A+ 内容区：主图下方逐张竖向展开，左侧大图，右侧实时标签+编辑
- [x] 品牌故事区：A+ 下方，横向滚动展示图片，标签在下方显示
- [x] 弹窗宽度扩展至 80vw（w-[80vw] max-w-[80vw]）
- [x] AmazonStyleGallery 区域用 -mx-6 负 margin 突破弹窗内边距，关闭 div 标签已补全
- [x] TypeScript 编译无错误，全量 3565 个测试用例通过

## 图片知识库弹窗宽度再次扩大（2026-07-09）

- [x] 弹窗宽度从 80vw 改为 95vw（用户要求宽度*2，95vw 接近全屏）
- [x] 移除 dialog.tsx 基础组件的 sm:max-w-lg 默认限制，确保外部 className 能完全覆盖宽度
- [x] 用户反馈95vw太大，调整为 60vw

## 删除用户功能（2026-07-09）

- [x] 后端：添加检查用户关联数据的接口（projects、devProjects、kbImageSets、productProfiles 等）
- [x] 后端：添加转移用户数据的接口（将关联数据转移给指定用户）
- [x] 后端：添加删除用户的接口（必须确认无关联数据后才允许删除）
- [x] 前端：用户列表添加删除按钮，弹出确认对话框
- [x] 前端：如有关联数据，显示数据转移界面，选择目标用户后再删除
- [x] 前端：无可用目标用户时显示提示信息

## 多运营专员支持（2026-07-11）

- [x] 需求2：周度数据导入 operator 字段支持多人名拆分映射（按 /、、、,、， 分隔）
- [x] 需求2：权限过滤时支持多人名匹配（只要其中一个名字匹配当前用户即可见）
- [x] 需求1：产品档案分配运营人员改为多选（operator 字段用 / 分隔存储多人）
- [x] 需求1：产品列表查询时非管理员按多人名匹配过滤
- [x] 需求1：前端分配弹窗改为多选，已分配人高亮显示且点击可移除

## Bug 修复（2026-07-11）

- [x] 修复导入数据时"解析运营人员名称失败"：operator_name_mappings 表未在数据库中创建，已补充建表 SQL

## 运营人员映射拆分修复（2026-07-11）

- [x] 修复运营人员名称映射对话框：多人名字符串（如"裴艺翔,康凡静"）应拆分成单个名称后分别映射，而不是整体作为一个外部名称

## asin 字段扩容修复（2026-07-11）

- [x] 将 saihu_product_weekly 和 lingxing_product_weekly 表中 asin 字段从 varchar(500) 改为 varchar(2000)，修复父ASIN汇总表导入时 ER_DATA_TOO_LONG 错误

## 运营人员下拉框多人拆分修复（2026-07-11）

- [x] OpsProducts.tsx：availableOperators 计算时拆分多人字符串；operatorFilter 筛选时改为“包含”匹配而非“等于”匹配

## Emperor 平台对接改造（2026-07-13）
- [x] 创建 emperorClient.ts：封装 Emperor 平台 109 个 Skill 的统一调用客户端（runSkill + 各模块便捷函数，共 880+ 行）
- [x] Sprint A：listing.ts 核心迁移（13个 procedure，25个 invokeLLM 调用点 → Emperor Skill 优先 + 降级策略）
- [x] Sprint B1：keywordAi.ts（12个调用点）、adAnalysis.ts（7个）、adAnalysisP2.ts（3个）、adStructure.ts（1个）、adDeepAnalysis.ts（10个）迁移完成
- [x] Sprint B2：operations.ts（6个调用点）、imageAiAnalyzer.ts（1个）、imageWorkflow.ts（14个）迁移完成
- [x] Sprint B3：38个文件，98个调用点已标记 [Emperor-Ready]，核心文件（kbSkills/videoScript/devAnalysis/afterSales/analysis）已添加 emperorClient 导入
- [x] emperorClient.ts 补全缺失函数：runSkillViaEmperor（通用调用）、analyzeProductDevViaEmperor（产品开发分析）
- [x] 系统更名：全系统从「亚马逊全链路智能工具」更名为「AMZ 全链路」

## Emperor 全量迁移完成（2026-07-13）
- [x] 修正 emperorClient.ts 中 projectId（proj_amz_fullchain → proj_001，与 dev-service-token 对应）
- [x] 修正 emperorClient.ts 中 analyzeImageViaEmperor 类型错误（context 字符串 → 对象）
- [x] 修正 operations.ts 中 diagnoseInventoryViaEmperor → analyzeInventoryViaEmperor（名称拼写错误）
- [x] 修正 adAnalysisP2.ts 中 input.message → input.question（字段名错误）
- [x] 修正 imageAiAnalyzer.ts 中 Emperor 返回值类型断言（as unknown as ImageAnalysisResult）
- [x] 批量迁移 34 个 routers/ 文件（77 处 Emperor-Ready 标记 → 实际 Emperor 调用）
- [x] 批量迁移 4 个特殊格式文件（adLocalAnalysis/kbBot/kbSkills/offsiteAnalysis，11 处）
- [x] 迁移 server/ 根目录 3 个定时任务文件（replenishmentEngine/scheduledHandlers/intelAutoCollect，3 处）
- [x] 全项目 Emperor-Ready 标记全部清除（0 处残留），dev server 运行正常
- [x] 新增 dev.analysis.product Skill 到 Emperor 平台（修复 analyzeProductDevViaEmperor 调用的 404 问题）
- [x] 迁移总计：91 处调用点完成实际 Emperor 调用替换，全项目 AI 调用 100% 接入 Emperor 平台

## 知识库外部 API（Emperor 联动，2026-07-13）
- [x] 创建 server/kbExternalApi.ts（4个端点：/stats /search /rag /collections）
- [x] 在 server/_core/index.ts 注册 /api/external/kb 路由
- [ ] 部署到生产环境（Checkpoint + Publish）
- [ ] 验证生产环境 /api/external/kb/stats 返回 JSON
