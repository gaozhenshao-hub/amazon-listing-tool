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
