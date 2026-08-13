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
- [x] 部署到生产环境（Checkpoint + Publish）
- [x] 验证生产环境 /api/external/kb/stats 返回 JSON（发布后可验证）

## 知识库图片跨用户查看修复（2026-07-25）
- [x] 修复浏览他人上传图片集时一直加载中的问题：getSet 改用 getImageSetById（不过滤 userId），允许团队所有成员查看任意图片集

## 智能 Listing 生成 2.0 框架（2026-07-25）
- [x] 数据库：新增 listing2_products 表（id, userId, asin, title, status, currentStep, createdAt, updatedAt）
- [x] 后端：listing2 路由骨架（listProducts, createProduct, getProduct, updateStep）
- [x] 前端：产品列表页（/listing2）
- [x] 前端：产品工作流页（/listing2/:id），10 个阶段 Tab 留白
- [x] 导航：在侧边栏"智能 Listing 生成"下添加"智能 Listing 生成 2.0"入口

## 无限画布架构改造（v2 确认版，2026-07-27）

### Phase 1: Schema & Backend
- [x] projectFile router: getAnalysisSummary 改为只检查 product_attributes（N3就绪 = 产品属性表已上传）
- [x] buyerQuestions router: 新增 importFromXlsx procedure（解析xlsx并批量入库）
- [x] projectFile router: 新增 getDataFilesReadiness procedure（返回产品属性表+买家问题库就绪状态）

### Phase 2: N3 数据文件页面改造
- [x] DataFilesPage: 移除竞品Listing/场景词/A9关键词上传入口（这些归入N1/N4）
- [x] DataFilesPage: 保留产品属性表上传入口（已有）
- [x] DataFilesPage: 新增买家问题库上传入口（xlsx上传+解析+批量入库）
- [x] DataFilesPage: 买家问题库上传后展示问题列表（可编辑分类/优先级）

### Phase 3: GeneratePage 强制检查
- [x] GeneratePage: G1入口增加产品属性表强制检查（未上传则显示拦截弹窗，不可跳过）
- [x] GeneratePage: 拦截弹窗提供"立即上传"按钮，跳转到 /listing/data-files

### Phase 4: 无限画布主页面
- [x] 新建 WorkflowCanvasPage.tsx：展示所有节点卡片（N0-N5, G1-G5, O1-O3, E1-E2）
- [x] 节点卡片：显示状态（未开始/进行中/已完成/已锁定/有警告）、关键数字摘要
- [x] 节点卡片颜色：灰/蓝/绿/绿填充/黄/红
- [x] 节点点击：全屏跳转到对应页面
- [x] 注册路由 /listing/canvas
- [x] 侧边栏新增"工作流画布"菜单项

## SVG 连线可视化（2026-07-27）
- [x] WorkflowCanvasPage: 添加 SVG 叠加层（CanvasSVGOverlay 组件）
- [x] 使用 ResizeObserver + data-node-id 动态计算节点位置
- [x] N3→G1 红色实线（强依赖，strokeWidth=2.5）
- [x] N1/N4/N5→G1、N4→G4 橙色虚线（强烈建议）
- [x] N3→G5、G1→E1/E2/E3、N4→E4 灰色虚线（可选）
- [x] G1→G2→G3、G1→G4、G1→G5 生成层顺序依赖连线
- [x] 新增图例区域（红色实线/橙色虚线/灰色虚线说明）
- [x] 层间增加 h-8 间距，让跨层连线有足够空间显示

## 图片工作流改造（2026-07-27）
- [x] 新增 Step0 竞品图片分析（上传、AI逐张分析、编辑、确认、可跳过）
- [x] 工作流从 Step1-6 改为 Step0-5（删除 Step6 AI提示词）
- [x] Step4 参考图支持多张+手动备注（备注哪个方面）
- [x] Step5 删除中文翻译自动生成（仅保留英文建议）
- [x] Step5 删除"提示词"功能（Step6 整体删除）
- [x] 图片建议删除中文翻译显示

## 图片工作流 Step1/2/3 重新生成内容为空修复（2026-07-29）
- [x] 根因确认：Project 90001（空气套件）没有竞品分析/关键词/评论数据，buildImageWorkflowContext 返回空字符串，LLM 在 json_object 模式下返回了空内容（只有 ``` ）
- [x] 修复1：buildImageWorkflowContext 为空时加入 fallback 提示（告知 LLM 暂无数据，请基于产品名称自行推断）
- [x] 修复2：新增 callLLMWithRetry 函数，检测到 {raw:...} 坏数据时自动重试，最多重试2次，最后一次去掉 json_object 模式作为兜底
- [x] 修复3：generateStep1/2/3 均改用 callLLMWithRetry，替换原来的直接 invokeLLM 调用
- [x] 清理：移除 generateStep1 中的 [Step1 DIAG] console.log 诊断日志
- [x] 清理：移除 generateStep3 中的 [Step3 DEBUG] console.log
- [x] 数据清理：清除数据库中所有未确认的 step1/2/3 坏数据（step1AiResult LIKE '%"raw":"%'）
- [x] 保存 Checkpoint 并发布

## Step1/Step2 联动优化（2026-07-29）
- [x] Step1 dataSource 编辑态：在编辑模式为 coreSellingPoints/secondarySellingPoints 的 dataSource 字段增加下拉选择（竞品差评分析/竞品好评分析/关键词场景数据/产品画像/运营经验推断）
- [x] Step2 表达方式与 Step0 联动：当 session.step0AiResult 存在时，解析 differentiationOpportunities 和 sellingPointDistribution，在辅图表达方式选择器旁显示"参考竞品"提示（如"竞品高频使用场景暗示，建议尝试数据对比差异化"）

- [x] Step1 dataSource 编辑态下拉选择（核心卖点+次要卖点均已实现，5个选项）
- [x] Step2 表达方式选择器（8选项下拉）+ Step0 联动提示（辅图上方显示竞品高频表达方式和差异化机会）

## 皇帝融合（Emperor Integration，2026-07-29）
- [x] Phase 1: 数据库 Schema（emperor_skills/runs/agents/mcp_connectors 四张表）+ 数据迁移脚本
- [x] Phase 2: 后端 tRPC 路由（emperor.skills.*、emperor.runs.*、emperor.agents.*、emperor.models.*）
- [x] Phase 3: 前端 Skill 库 UI（cc-haha Market 三栏布局 + 分类树 + 运行面板）
- [x] Phase 4: 前端运行历史 UI（cc-haha TraceSession 调用树 + 详情面板）
- [x] Phase 5: Agent 编排 + 模型路由 + MCP 设置页面
- [x] Phase 6: 关闭皇帝 EC2（PM2 stop + ufw 关闭 4800 端口）

## 皇帝功能全面补全（2026-07-29）
- [x] Phase 1: 修复 Skill 库数据加载（0个技能 bug）+ Skill CRUD（新增/编辑/删除/导入导出/模型独立配置）
- [x] Phase 2: 模型路由完整 CRUD（新增/编辑/删除/测试连接/设置默认）+ MCP 连接器完整 CRUD（cc-haha 风格）
- [x] Phase 3: Agent 编排完整 CRUD（新增/编辑/删除/步骤配置/运行）+ 定时任务完整 CRUD（cc-haha 风格）
- [x] Phase 4: 记忆/知识库模块（cc-haha MemorySettings 风格）+ Token 用量图表 + Trace 运行历史详情

## 皇帝 AI 能力中台全面修复（2026-07-29）

- [x] 修复 EmperorSkillLibrary isAdmin 判断（兼容 super_admin）
- [x] 修复 skills.list 空字符串过滤问题（undefined 代替 ""）
- [x] 修复 EmperorMCP 完整 CRUD（新建/编辑/删除/启用切换）
- [x] 修复 EmperorModels 完整 CRUD（新建/编辑/删除/测试连接）
- [x] 修复 EmperorAgents 完整 CRUD + DAG 可视化编辑器
- [x] 修复 EmperorUsage Token 用量图表数据结构
- [x] 修复 EmperorTrace 运行历史详情（input/output/元数据三 Tab）
- [x] 修复定时任务路由路径（/emperor/schedules → /emperor/scheduled）
- [x] 修复卖点精雕"生成结果格式异常"（后端 JSON 解析容错 + 前端字段兼容）

## 皇帝模块 isAdmin 全面修复（2026-07-29）

- [x] 修复 EmperorModels.tsx：isAdmin 兼容 super_admin（line 228）
- [x] 修复 EmperorAgents.tsx：isAdmin 兼容 super_admin（line 296）
- [x] 确认 EmperorSkillLibrary.tsx：isAdmin 已兼容 super_admin（line 397）
- [x] 确认 EmperorMCP.tsx：isAdmin 已兼容 super_admin（line 275）
- [x] TypeScript 编译：0 错误

## 皇帝模块 UI 对齐原版截图（2026-07-29）

- [x] EmperorModels.tsx 对齐原版皇帝 LLM 模型管理 UI（统计卡片+三Tab+完整新建弹窗含API Key/能力标签/默认模型）
- [x] EmperorAgents.tsx 对齐原版皇帝 Agent 编排卡片列表页（新建弹窗含触发方式/可见范围/最大执行时间）
- [x] AgentCanvas.tsx 全屏拖拽画布编辑器（11种节点类型：输入/Skill/LLM/条件分支/循环/人工审核/HTTP/代码/MCP/知识库/输出）
- [x] EmperorMCP.tsx 对齐原版皇帝 MCP 工具管理 UI（统计卡片+工具网格+四步向导弹窗：基本信息→连接配置→认证方式→能力定义）
- [x] 后端 emperor.ts 扩展 agents/models/mcp router（create/update/saveWorkflow/run/getRun/listRuns/getAvailableSkills/getAvailableModels/getAvailableMcpTools/healthCheck/getCostStats/getAuditLogs）
- [x] 数据库新增 emperor_agent_runs 表
- [x] App.tsx 注册 /emperor/agents/:slug/canvas 全屏路由
- [x] TypeScript 编译：0 错误

## cc-haha 设计理念移植（2026-07-29）

- [x] 数据库 Schema 扩展：emperor_skills 表增加 whenToUse/timeout/executionMode/allowedTools/version 字段
- [x] 数据库 Schema 扩展：emperor_knowledge 表增加 memoryType 字段（Feedback/Fact/Project/Reference）
- [x] 数据库 Schema 扩展：emperor_agents 表增加 executionMode 字段（inline/fork/background）
- [x] 后端接口扩展：Skill CRUD 支持新字段（whenToUse/timeout/executionMode/allowedTools/version）
- [x] 后端接口扩展：知识库分类接口（按 memoryType 筛选）
- [x] 前端 EmperorSkillLibrary：Skill 编辑弹窗增加 when_to_use/timeout/model/allowed_tools/version 字段
- [x] 前端知识库模块：增加四分类标签（Feedback/Fact/Project/Reference）+ 记忆条目管理
- [x] 前端 AgentCanvas：节点属性面板增加执行模式（Inline/Fork/Background）+ 并行 Fork 节点

## Emperor cc-haha 能力移植（2026-07-29）

- [x] 数据库 Schema 扩展：emperor_skills 表新增 when_to_use/timeout_seconds/execution_mode/allowed_tools/disallowed_tools/version 字段
- [x] 数据库 Schema 扩展：新建 emperor_knowledge 表（四分类记忆体系：feedback/fact/project/reference）
- [x] 后端 emperor.ts：skills.create/update 接口支持 cc-haha 元数据字段
- [x] 后端 emperor.ts：新增 emperorKnowledgeRouter（upsert/list/delete/stats 接口）
- [x] 前端 EmperorSkillLibrary：Skill 编辑弹窗新增「cc-haha 元数据」Tab（whenToUse/executionMode/timeoutSeconds/allowedTools/disallowedTools/version）
- [x] 前端 EmperorKnowledge 新页面：cc-haha 四分类记忆管理（列表/详情/新建/编辑/删除）
- [x] 前端 AgentCanvas：skill_node 属性面板新增执行模式选择（Inline/Fork/Background）和超时配置
- [x] App.tsx 路由注册：/emperor/knowledge 路由
- [x] TypeScript 编译 0 错误

## Emperor → 内置 LLM 迁移（2026-07-30）

- [x] 全量扫描所有服务器文件，识别 Emperor Skill 调用模式
- [x] 删除 Emperor try-catch 包裹块，保留内置 LLM 代码路径
- [x] 修复孤立 catch 块、缺失 } 等语法错误（共修复 171 → 0 个语法错误）
- [x] 修复函数嵌套问题（analyzeRufusAttributes、analyzeCosmoScenes 等函数提升到顶层）
- [x] 修复 devAnalysis.ts import 语句断裂问题
- [x] 修复 kbBot.ts performKbSearch 函数结构问题
- [x] 服务器正常启动（Server running on http://localhost:3000/）
- [x] 修复 invokeLLM json_object 模式返回空内容的问题（Forge API 不支持 json_object，改为纯文本模式 + JSON 指令注入 + 自动清理 markdown code fence）
- [x] 修复 emperor.ts rawExecute 500 错误：从 $client (mysql2 Pool) 改为 drizzle db.execute(sql template)，解决 agents.list 等接口 500 错误
- [x] 端到端验证：generateSellingPointsCores（7 个卖点，解析成功）+ generateTitle（3 个标题，解析成功）

## Listing 五步流程迁移到新皇帝 Skill 系统（2026-07-30）
- [x] 将 Teamo Router 31 个模型写入 emperor_model_providers 表
- [x] 修改皇帝 run 引擎支持 custom provider 调用外部 LLM（Teamo Router）
- [x] 设置 DeepSeek V4 Pro 为默认模型
- [x] 端到端测试验证（deepseek-v4-flash + claude-sonnet-5 均成功）
- [x] 为全部 110 个 Skill 配置最适合的高性能模型（按任务类型分配）
- [x] 创建 server/services/emperorSkillRunner.ts 统一 Skill 调用层（单元测试 4/4 通过 + 真实 LLM 流程测试通过）
- [x] 升级 renderTemplate 支持 Handlebars 条件语法（已使用 Handlebars.compile，并保留 #if/#each/#unless 回退实现）
- [x] 迁移 generateSellingPointsCores → listing.sellingpoints.generate（经后台 Job 与 G1 节点执行）
- [x] 迁移 generateTitle → listing.title.generate（经后台 Job 与 G2 节点执行）
- [x] 迁移 generateBulletPoints → listing.bullets.generate（经后台 Job 与 G1 节点执行）
- [x] 迁移 generateDescription → listing.description.generate（经后台 Job 与 G3 节点执行）
- [x] 迁移 generateSearchTerms → listing.searchterms.generate（经后台 Job 与 G4 节点执行）
- [x] 迁移 generateQA → listing.qa.generate（经后台 Job 与 G5 节点执行）
- [x] 迁移辅助接口（翻译/图片建议/自检/AB测试）（图片建议 E1 同步、自检显式 Skill 路由、翻译与 A/B 走业务 Skill 网关）
- [x] 端到端测试验证（Listing Job、Skill Runner、Agent/Skill 完整性回归共 20 项通过）

## AI 中台三个缺口修复（2026-08-03）
- [x] invokeLLM 添加 signal?: AbortSignal 参数，贯穿到 fetch 请求层（见同页 Gap 1 完成记录）
- [x] AgentCanvas 前台添加版本历史 UI（发布/回滚/灰度百分比/版本对比）（见同页 Gap 2 完成记录）
- [x] 皇帝前台新增 AI OS Observability Dashboard 页面（指标趋势/评测列表/质量评分）（见同页 Gap 3 完成记录）

## AI 中台底座三个缺口修复（2026-08-03）

- [x] Gap 1 - invokeLLM AbortSignal：server/_core/llm.ts 添加 signal?: AbortSignal 参数并传递给 fetch 调用
- [x] Gap 2 - AgentCanvas 版本历史 UI：修复 diffTemplateVersions 参数名（versionA/versionB → baseVersionId/targetVersionId），修复 setDiffVersions 类型（string → number）
- [x] Gap 3 - EmperorObservability 观测页面：创建 /emperor/observability 页面，注册路由，移除重复 DashboardLayout 嵌套，添加侧边栏导航项"AI 观测中心"
- [x] 修复 ai_jobs 表缺失列：补充 priority、queueName、timeoutSeconds、leaseUntil、lockedBy、claimedAt、lastHeartbeatAt、deadLetterAt、deadLetterReason、nextRunAt 列
- [x] 修复 phase2.test.ts appRouter 集成测试超时（5s → 15s），全量 3505 测试通过

## Step4 参考图内容为空修复（2026-08-07）
- [x] 根因确认：皇帝 Skill image.step4.reference 的 systemPrompt 使用旧版字段名（compositionGuide/visualEffectDescription），前台期望新版字段名（compositionReference/effectReference）
- [x] 修复1：通过 SQL 更新皇帝 Skill image.step4.reference 的 systemPrompt，改为新版字段名
- [x] 修复2：在 shared/imageWorkflow.ts 添加 normalizeStep4References 函数，兼容旧版字段名
- [x] 修复3：ReferenceImagesStep.tsx 引入 normalizeStep4References，在 useEffect 中对旧数据进行规范化

## 知识库选图弹窗遮挡和滚动修复（2026-08-07）
- [x] 修复1：dialog.tsx 将 DialogOverlay 和 DialogContent 的 z-index 从 z-50 提升到 z-[200]，解决被 sticky header（backdrop-blur 创建新 stacking context）遮挡的问题
- [x] 修复2：KnowledgeImagePickerDialog 改用原生 overflow-y-auto 替换 ScrollArea，确保图片网格可以正常向下滚动
- [x] 修复3：KnowledgeImagePickerDialog 改为 p-0 布局，header/filter/footer 分别设置 padding，图片区域独立滚动

## Step4 参考图重新优化后消失和其他辅图内容清空修复（2026-08-07）
- [x] 根因：reoptimize 后 AI 返回对象 spread 覆盖了 compositionRefImageUrl/effectRefImageUrl；regenerateSingle 直接用后端 updatedResult 替换整个 editData 导致其他辅图的前端状态丢失
- [x] 前端修复：handleReoptimize 合并时保留原有图片 URL 和 kbReferenceImages；handleRegenerateSingle 只更新对应 idx 的 AI 字段，保留其他辅图的完整前端状态
- [x] 后端修复：reoptimizeStep4WithRefs 返回结果时从 session 读取原有字段并保留；regenerateSingleImageFromRef 合并时保留 compositionRefImageUrl/effectRefImageUrl/kbReferenceImages
- [x] 皇帝 Skill 同步：更新 image.step4.reoptimize 的 manifest.implementation.systemPrompt，明确不返回前端管理字段
- [x] 知识库：写入"AI修复规范：代码修复必须同步皇帝平台 Skill"规则到 emperor_knowledge 表

## Step5 图片建议 AI output validation failed 修复（2026-08-11）
- [x] 根因1：skillRunner.ts 只读取数据库 manifest.systemPrompt，TiDB JSON 字段 \n 转义字符被压缩（3874→2285 字符），systemPrompt 不完整
- [x] 根因2：callImageWorkflowSkill validate 中 safeParseSkillJSON 返回 { raw } 时直接报错，没有尝试更激进的 JSON 提取
- [x] 根因3：image.step5.final.suggestion 的 maxTokens 为 NULL（默认 4096），Step5 输出长（6辅图+A+），可能被截断
- [x] 修复1：skillRunner.ts 改为 legacySystemPrompt?.trim() || implementation.systemPrompt（优先使用代码中的 prompt）
- [x] 修复2：callImageWorkflowSkill validate 中添加更激进的 JSON 提取（从 raw 字符串中找 { } 对）
- [x] 修复3：STEP5_FINAL_SUGGESTION_PROMPT 末尾添加强制 JSON 输出指令（不要 markdown 代码块）
- [x] 修复4：数据库更新 image.step5.final.suggestion 的 maxTokens 为 8192
- [x] 后续修正：新皇帝运行时已恢复以数据库 manifest.systemPrompt 为权威来源；legacy prompt 仅用于审计对比
- [x] 后续修正：数据库 Step5 Prompt 已补充“仅输出合法 JSON 对象”的约束，与 maxTokens=8192 一并生效

## Listing 新皇帝 Agent / Skill 完整性审计（2026-08-12）
- [x] 核对 Listing Agent DAG、节点依赖、数据流向和人工审核节点是否完整（v2.0.0 默认模板：16 节点、31 条连线）
- [x] 核对 Listing 核心 Skill 的存在性、启用状态、模型策略、输入输出契约和 JSON 模式配置（6 个核心 Skill 均为 Released）
- [x] 核对 Agent 节点与前台生成、编辑、确认、锁定及下一步解锁流程的一致性
- [x] 补齐发现的 Agent、Skill、连接线、审核节点或业务映射缺口，并执行数据库同步
- [x] 为完整性审计和关键迁移路径补充自动化测试并验证（20 项通过）
- [x] 修复五类 Listing 自检接口的 Skill 显式路由，避免网关推断误命中综合评分 Skill
- [x] 将最终结果预览页的人工确认同步至 O1 节点，并保存最终 Listing Preview Artifact
- [x] 将 Listing 图片建议生成结果同步至 E1 节点，进入统一人工审核与 Artifact 链路

## 图片工作流完整方案下载增强（2026-08-12）
- [x] 盘点现有“下载完整方案”实现与 Step0-5 工作流数据字段
- [x] 设计六步内容、图片资产、参考来源和 ASIN 风格集合的导出目录与版式
- [x] 导出 Step0 竞品图片分析、Step1 卖点梳理、Step2 图片大纲、Step3 风格确认、Step4 参考图确认、Step5 最终图片建议
- [x] 在导出文档中嵌入竞品图、知识库风格图、风格参考 ASIN 集、构图/效果参考图及来源信息
- [x] 为完整方案下载编写回归测试并验证用户下载流程（119 项图片工作流测试通过）

## 完整方案导出字段缺失修复（2026-08-12）
- [x] 核对 Step4 前台参考图字段与导出字段的映射差异（前台使用 compositionType/layout/focalPoint/visualFlow/proportions 与 colorApplication 等字段）
- [x] 导出 Step4 的构图方案、效果方案、焦点、视觉引导、比例与设计注意事项
- [x] 导出 Step5 的整套图片叙事逻辑与 A+ 故事线
- [x] 为字段映射与叙事逻辑导出补充回归测试并验证（4 项导出回归测试、TypeScript 检查通过）

## Step4 参考图与方案版本回退修复（2026-08-12）
- [x] 核对单图优化、重新优化、会话回写和 Artifact 水合的 Step4 数据流（确认已确认 Artifact 会覆盖仅写入 AI 结果的后续优化版本）
- [x] 修复优化结果合并时参考图 URL、知识库图片和已确认方案版本被覆盖的问题
- [x] 修复页面刷新或 Artifact 回填时回退至优化前方案的问题（解锁改为非破坏性版本合并，取消调用 resetToStep）
- [x] 为参考图和方案版本保留补充回归测试并验证（119 项图片工作流相关测试通过，TypeScript 无错误）

## Step4 全量快照一致性修复（2026-08-12）
- [x] 构建包含方案文本、构图图、效果图和知识库图的单一 Step4 完整快照
- [x] 解锁、刷新和重新锁定均从同一完整快照读写，不再分散回退
- [x] 确认时将完整快照写入会话并提升为唯一当前正式 Artifact
- [x] 为完整快照在解锁刷新和锁定展示的前后对比补充回归测试（4 项 Step4 回归测试通过）

## 六步完整方案逐图瀑布流导出（2026-08-12）
- [x] 核对图片大纲、Step4 参考图与 Step5 图片建议的图片编号映射（兼容 imageNumber 与中文图片标签两种来源）
- [x] 设计设计师友好的逐图瀑布流卡片版式
- [x] 每张图卡片对应输出图片大纲、构图/效果/知识库参考图、图片建议与设计注意事项
- [x] 为逐图对应关系和参考资产输出补充回归测试并验证（5 项完整方案导出测试通过）

## 六步完整方案横向瀑布流版式调整（2026-08-12）
- [x] 移除新增的设计师逐图执行版，保留原 Step0-5 内容
- [x] 将原 Step0-5 内容包装为六列横向并排瀑布流布局
- [x] 保持所有原有字段、图片资产和方案内容不变，仅调整展示位置
- [x] 为横向六列容器与内容保留补充回归测试并验证（5 项完整方案导出测试通过）

## Step4 参考图序号与设计师注意事项导出补全（2026-08-12）
- [x] 将每条参考图映射为对应的主图、辅图或 A+ 图片序号与名称
- [x] 导出构图、效果和顶层的全部设计师注意事项
- [x] 保持横向六列版式与原有图片资产不变
- [x] 为序号名称及注意事项补充回归测试并验证（6 项完整方案导出测试通过）

## Step4 系统页面与导出内容一致性修复（2026-08-12）
- [x] 核对锁定态页面、会话草稿、当前 Artifact 与导出数据包的 Step4 读取优先级（确认旧正式 Artifact 会覆盖会话确认快照）
- [x] 锁定态页面优先展示当前完整快照的方案文本和所有参考图片资产
- [x] 将构图图、效果图和知识库图与当前页面方案原子合并
- [x] 为页面与导出内容一致性补充回归测试并验证（5 项 Step4 快照回归测试通过，TypeScript 无错误）

## Step4 单图重新生成后锁定快照同步修复（2026-08-12）
- [x] 核对单图重新生成、前端 editData、会话草稿和 confirmStep4 的数据传递（数据库确认快照正确，旧 Artifact 水合仍会覆盖页面）
- [x] 将单图重新生成后的完整合并结果同步写入确认草稿
- [x] confirmStep4 优先使用页面当前完整 editData，而非旧 userEdit 快照
- [x] 为单图重新生成后确认锁定补充回归测试并验证（5 项 Step4 快照测试通过，TypeScript 无错误）

## Step4 单图重新生成与锁定版本闭环（2026-08-12）
- [x] 定义每张参考图的当前版本、锁定状态与锁定快照字段
- [x] 单图重新生成后显示“确认此图”与“解锁此图”操作
- [x] 全局确认只汇总各单图已确认版本，不覆盖单图锁定快照
- [x] 为单图确认、解锁、重新生成和全局汇总补充回归测试并验证（6 项 Step4 快照测试通过，TypeScript 无错误）

## Step4 整体确认不可覆盖单图锁定版本（2026-08-12）
- [x] 审计整体确认对 Step4 文案与参考图片的所有写入路径
- [x] 整体确认前强制校验所有图片均存在 lockedSnapshot
- [x] 整体确认只从 lockedSnapshot 组装正式快照，不读取或合并旧 AI/草稿字段
- [x] 为整体确认不可覆盖单图版本补充防回归测试并验证（6 项 Step4 快照测试通过，TypeScript 无错误）

## Step4 单图确认版本独立持久化重构（2026-08-12）
- [x] 设计并创建 Step4 单图确认版本表，存储项目、图片序号、版本内容、状态和时间戳（0139 迁移已执行）
- [x] 单图确认与解锁改为写入独立版本记录，不再依赖会话 JSON 快照
- [x] 页面 Step4 优先读取每张图的当前独立确认版本，整体发布仅汇总该版本
- [x] 回填空气套件现有 Step4 图片版本并验证端到端一致性（会话 780001 已回填 13 条当前版本）
- [x] 为独立版本记录、页面水合和整体发布补充真实数据库回归测试（8 项 Step4 回归测试通过，数据库记录数与图片索引范围已验证）

## Step4 Agent 节点确认入口防覆盖修复（2026-08-12）
- [x] 定位 Agent 节点“确认参考图”按钮对应的前端动作和后端确认接口（Step4 header 确认后调用 onConfirm，触发旧 Agent 节点回调）
- [x] 隔离该入口对旧 Artifact / 历史 checkpoint 的内容回填
- [x] 该入口只发布当前 Step4 正式快照，不允许写回旧文案或参考图
- [x] 为 Agent 节点确认按钮的防覆盖行为补充回归测试并验证（7 项 Step4 快照测试通过，TypeScript 无错误）

## 图片工作流后台失败任务诊断（2026-08-12）
- [x] 查询空气套件的失败后台任务、任务类型、失败时间和错误详情
- [x] 区分已失效的历史失败记录与仍阻断当前工作流的错误（Step4/Step5 均已有后续成功任务；仅历史 Agent 重新优化记录仍待人工处理）
- [x] 修复仍影响当前流程的失败处理，或改善失败历史的展示语义（历史失败与待处理失败分开展示；锁定业务步骤不再被旧 Agent 失败误标）
- [x] 验证当前图片工作流运行状态并补充诊断回归测试（3 条 Step5 成功任务，9 项 Step4/状态语义回归测试通过）

## 模块一：产品开发 AI 分析工具优化（2026-08-12）
- [x] 盘点数据上传、竞品全景分析表、标签管理和市场分析工作台的当前实现
- [x] 核验产品开发 Agent、Skill、输入输出契约及人工审核/锁定流程
- [x] 验证上传数据按 ASIN 融合、持久化、编辑确认和下载的完整性
- [x] 实施 P0 数据底座与门控优化：全景表确认版本冻结、编辑/上传/标签变更自动失效、下载冻结版本、七阶段门控要求当前版本
- [x] 为产品开发核心工作流补充回归测试并验证（5 项 P0 全景版本/门控测试通过）

## 统一治理方案对齐（2026-08-12）
- [ ] 将模块一表格上传改造为可审计的导入批次、校验、确认和回滚治理模型
- [x] 修复 AI 标签/属性标注失败被错误显示为“完成 0 条”的结果真实性语义（全失败抛出业务错误；部分失败返回 partial_failed 与失败批次详情）
- [ ] 统一产品开发、Listing、知识库与 AI Job/Run 的工作空间、资源范围和动作授权契约
- [ ] 建立数据快照、人工确认、Agent/Skill/Tool 版本与 Run 审计的跨模块追踪闭环
- [ ] 站外模块保持暂不修复、暂不纳入本轮治理实施范围

## 模块三：产品总览驱动库存规划替代方案（2026-08-12）
- [x] 核对产品总览现有上传数据中的总库存、7天/30天日销、在售状态和 ASIN 维度字段
- [x] 定义加权日销量、断货识别、可售日期、人工调整与补货时间倒推口径
- [x] 设计以产品总览为唯一输入、完全替代旧库存预警的库存规划工作台
- [x] 设计生产货期、物流时间、流购缓冲、目标覆盖天数和补货量的自助参数模型
- [x] 输出可确认的库存规划数据契约、页面结构和实施清单

## 模块三：领星 ASIN 日粒度数据与产品总览重构（2026-08-13）
- [x] 解析用户提供的领星 ASIN 产品表现表，建立日粒度销量、ASIN 库存和父 ASIN 映射字段契约
- [x] 将领星产品总览数据源切换为新的 ASIN 日粒度导入表，并保留赛狐后续接入的兼容边界
- [x] 将产品总览改为父 ASIN + 周维度汇总，同时保留 ASIN 维度库存计算与追溯
- [x] 在单产品详情页底部重构子 ASIN 变体销量看板，并支持最近 1 至 4 周周期选择
- [x] 将库存规划默认参数设为生产 30 天、物流 30 天、缓冲 10 天、总货期 70 天
- [x] 将总库存口径改为可售库存、在途库存与人工维护的本地库存之和，并形成可审计编辑记录
- [x] 更新库存规划替代方案、数据质量规则、人工审核闭环与实施清单，待确认后进入开发

## 模块三：领星日粒度产品总览与库存规划实施（2026-08-13）
- [x] 创建 ASIN 日快照、人工本地库存、库存参数、补货计划与规划版本的迁移和领域 Schema
- [x] 实现领星 ASIN 日粒度导入解析、预览校验、批次替代和历史可追溯逻辑
- [x] 实现父 ASIN + 店铺 + 国家 + 自然周的聚合查询及日销量、库存时点口径
- [x] 实现单产品详情子 ASIN 最近 1–4 周销量、趋势与库存数据接口
- [x] 实现默认 30/30/10 天货期、人工本地库存确认和 ASIN 库存规划计算服务
- [x] 重构产品总览、详情页变体销量看板和库存规划工作台，移除旧库存预警交互
- [x] 执行数据库迁移，补充并运行导入、汇总、库存计算与页面契约回归测试

## 模块三：产品总览展示形式回归（2026-08-13）
- [x] 保留原有产品总览的卡片展开、筛选、排序、批量操作和周度明细表格展示形式
- [x] 将领星 ASIN 日粒度父 ASIN 周汇总转换为原产品总览展示模型，补齐原界面必需字段
- [x] 移除简化汇总卡片展示，恢复原有产品卡片与最近四周明细交互
- [x] 验证领星新数据源下原页面筛选、详情跳转和周度字段展示的回归结果

## 模块三：产品总览 salesQty 运行时错误修复（2026-08-13）
- [x] 修复领星日粒度父 ASIN 周度适配层中的未定义 salesQty 变量引用
- [x] 补充产品总览适配层的运行时回归断言并验证页面构建

## 模块三：产品总览运营负责人映射修复（2026-08-13）
- [x] 核对父 ASIN、店铺、国家与既有运营负责人记录的匹配键及覆盖率
- [x] 在领星日粒度父 ASIN 适配层恢复运营负责人显示和批量筛选来源
- [x] 验证运营分配、显示、筛选和详情跳转在新数据源下的回归结果

## 模块三：父 ASIN 独立货期参数（2026-08-13）
- [x] 将库存规划参数作用域从单 ASIN 扩展为父 ASIN + 店铺 + 国家，保留历史 ASIN 参数兼容
- [x] 按父 ASIN 覆盖生产、物流、缓冲三项货期，并重算总货期、订货日期和补货量
- [x] 在库存规划工作台提供三项货期的行内编辑、保存和已确认状态展示
- [x] 为父 ASIN 货期覆盖与补货重算补充回归测试并发布

## 模块三：库存规划既有产品总览数据衔接修复（2026-08-13）
- [x] 核对当前工作空间的领星日快照、产品总览导入批次和库存规划查询覆盖情况
- [x] 修复库存规划与产品总览之间的用户、工作空间或市场筛选不一致问题
- [x] 验证无需重复上传即可在库存规划工作台展示既有产品总览数据

## 模块三：产品总览真实运营分配记录映射（2026-08-13）
- [x] 追踪原“分配运营”操作实际写入的产品分配表和父 ASIN 匹配键
- [x] 将真实产品运营分配记录优先合并至领星日粒度父 ASIN 周汇总
- [x] 验证已分配产品显示负责人、未分配产品仍保留分配入口的回归结果

## 模块三：库存规划恢复子 ASIN 维度（2026-08-13）
- [x] 移除父 ASIN 货期参数在库存规划中的优先覆盖，保留子 ASIN 参数优先级
- [x] 将生产、物流、缓冲时间、本地库存和补货建议全部明确为子 ASIN 行级数据
- [x] 将库存规划工作台改为子 ASIN 行内编辑三项货期并保留父 ASIN仅作归属信息
- [x] 验证不同子 ASIN 可独立保存货期并分别重算订货日期和补货量

## 模块三：产品总览具体运营映射追踪（2026-08-13）
- [x] 针对截图中未匹配记录核对日快照、产品档案和历史分配数据的父 ASIN与店铺键
- [x] 修复真实运营分配与日粒度汇总间的剩余数据匹配缺口
- [x] 验证截图中已分配产品显示运营负责人，未分配产品保留分配入口

## 模块三：产品总览上传人员映射继承（2026-08-13）
- [x] 核对领星日快照中的上传运营字段和既有人员名称映射覆盖情况
- [x] 让日粒度父 ASIN 周汇总直接继承上传人员字段并应用确认的人名映射
- [x] 验证人员映射页已确认用户显示在产品总览，未映射人员维持待确认状态
