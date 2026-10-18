# Runtime source approvals

Agent 对话、利润 AI、四栏研究、逐图标签、图片大纲、新品市场分析、知识问答和视频流程的应用单例读取各自服务器部署审批文件。没有配置时仍明确不可用；Released、绑定关系、种子记录和示例文件都不构成批准。本项没有启用功能开关、调用模型或修改注册表。

## 部署配置

| 功能 | 绝对 JSON 文件路径环境变量 | 完整文件字节 SHA-256 环境变量 |
| --- | --- | --- |
| Agent 对话 | `ASSISTANT_CONVERSATION_APPROVAL_FILE` | `ASSISTANT_CONVERSATION_APPROVAL_SHA256` |
| 利润分析 | `PROFIT_ANALYSIS_APPROVAL_FILE` | `PROFIT_ANALYSIS_APPROVAL_SHA256` |
| Listing 四栏深度分析 | `LISTING_DEEP_ANALYSIS_APPROVAL_FILE` | `LISTING_DEEP_ANALYSIS_APPROVAL_SHA256` |
| 逐图标签 | `IMAGE_TAGGING_APPROVAL_FILE` | `IMAGE_TAGGING_APPROVAL_SHA256` |
| 图片 Step 2 大纲 | `IMAGE_PLANNING_APPROVAL_FILE` | `IMAGE_PLANNING_APPROVAL_SHA256` |
| 新品市场概况 | `DEVELOPMENT_MARKET_APPROVAL_FILE` | `DEVELOPMENT_MARKET_APPROVAL_SHA256` |
| 原知识库三层问答 | `KNOWLEDGE_QA_APPROVAL_FILE` | `KNOWLEDGE_QA_APPROVAL_SHA256` |
| 视频七类业务操作 | `VIDEO_WORKFLOW_APPROVAL_FILE` | `VIDEO_WORKFLOW_APPROVAL_SHA256` |

两项必须同时配置；不要填写相对路径、URL、符号链接或占位 hash。文件必须位于应用构建目录之外、部署管理员控制的目录内，不能放在上传目录或公开仓库。权限建议 `0600`，禁止组/其他用户写入。Web 和 AI worker 必须具有相同受审版本、可读路径和 SHA 配置；每个进程按自身本地路径读取。**不要**配置 `VITE_` 前缀、向浏览器发送该文件，或把真实映射提交到仓库。

`config/examples/` 中对应八个文件只有结构和空 `records`，不授权任何执行，也不含测试 hash。复制到受控部署目录后，由有权限的维护者根据**目标环境真实注册表和已确认来源证据**填写记录。文件最大 2 MiB、最多 1000 条记录；整体不可部分通过。以 `shasum -a 256 /绝对路径/审批文件.json`（Linux 可用 `sha256sum`）计算最终原始字节 hash，包括换行，不要自行估算或使用示例 hash。将输出的 64 位小写摘要配置到对应环境变量。

## 生成真实记录的依据

- 对话记录必须通过 `AssistantConversationSourceApprovalSchema`；每个工作区/Agent 的 `route`、`reply` 各唯一，`context` 按 Skill slug 唯一。启用的上下文 Skill 也必须有对应批准。通用 Skill 以青岛来源为主；`listing.*` 必须是 `user_listing`，不得替换成朋友来源。仅在确有独立审核证据时使用现有 schema 允许的 `reviewed_supplement`，不得把它当默认批准。
- 利润记录必须通过 `ProfitAnalysisSourceApprovalSchema`，每个工作区一条，`finance`/`profit_analysis`、来源 `qingdao`、`profit_evidence_v1`/`profit_evidence_selection_v1` 合同不变；须填写真实 `revision`、`approvalRef`、`evidenceId` 与证据文件内容摘要 `evidenceHash`。
- 四栏记录必须通过 `CompetitorDeepApprovalSchema`，同工作区、同输入合同的 `title`、`selling`、`buyers_batch`、`buyers_synthesis`、`summary` 各一条，来源均为 `user_listing`。新任务使用已保存 `listing` 配置，要求 `competitor_deep_agent_evidence_v2`／`competitor_deep_claims_v1`；已有 v1 任务继续原 `competitor_deep_evidence_v1` 合同，不补造新配置或把 v1 审批当作 v2 审批。两种合同可在同文件分别保留五条映射。保留已有用户 Skill；需要兼容新合同的版本应独立审核，不按同名 Skill 自动替换提示词。定义见 `competitorDeepRuntimeContract.ts`。
- 逐图标签记录通过 `ImageTaggingSourceApprovalSchema`，固定 `tagger`、来源 `qingdao`、`image_tagging_evidence_v1`／`image_tagging_labels_v1`，匹配完整原图、Skill/model 快照及每图字节／费用预算。既有人工确认标签不自动重新计费。
- 图片大纲与新品市场概况通过 `ConfiguredBusinessSourceApprovalSchema`，来源必须 `qingdao`。前者固定 `images`／`image_outline`／`image.step2.outline`、`image_planning_evidence_v1`／`image_planning_outline_v1`；后者固定 `development`／`development_market_overview`／`dev.analysis.market_overview`、`development_market_evidence_v1`／`development_market_analysis_v1`。两者各自文件的 `kind` 必须为 `image_planning` 或 `development_market`，不能互借批准。只覆盖这两个明确阶段，不表示其余图片或新品阶段已接入配置。
- 知识问答通过 `KnowledgeQaApprovalSchema`（`knowledgeQaRuntimeContract.ts`），`kind=knowledge_qa`、`agentKey=knowledge`，`knowledge_select`／`knowledge.qa.select` 为 `knowledge_qa_selection_v1` JSON，`knowledge_answer`／`knowledge.qa.answer` 为 `knowledge_qa_markdown_v1` Markdown，输入均为 `knowledge_qa_evidence_v1`。两个独立阶段均须真实青岛来源批准；首次计费固定两个版本和总预算，L1/L2 选择各有独立上下文及持久派发回执。最多三次调用，不将通用对话审批当问答批准，不将旧版未绑定工作区对话塞入新上下文。
- 视频通过 `VideoConfiguredSourceApprovalSchema`（`videoConfiguredRuntimeContract.ts`），`kind=video_workflow`、`agentKey=video`、来源 `qingdao`，逐操作绑定七类操作与四个原业务 Skill。输入／输出按 `shared/videoWorkflow.ts` 的固定映射精确匹配，不以同名 Skill 或另一操作的批准代替。仅处理已有文本和结构化引用，不声称已读取图片／视频字节；源码存在不等于视频旧 writer、真实数据库和完整业务验收已全部完成。
- Skill 指纹必须使用与运行时相同的 `assistantConversationSkillSnapshotFromRow(row)` → `assistantConversationSkillSnapshotHash(snapshot.pin)`，输入为真实注册表完整投影。不得只 hash slug、版本、提示词，或复制别的环境摘要。函数位于 `assistantConversationSourcePrimitives.ts`。
- 模型指纹使用 `strictModelSnapshotFromRow(workspaceId, modelSlug, row).configurationHash`，输入为目标环境真实模型配置投影；不含密钥正文。模型凭据仍走原有受控引用，不得写入审批文件。
- `inputContract`、`outputContract`、费用上限和图片预算按真实 Skill 合同与审核决定填写；不从 Released、配置绑定或默认预算自动推导批准。对话仅提供对话能力，并不自动执行所选业务 Skill。

新四栏任务、图片大纲和新品市场概况将已保存配置、规则、Skill 版本绑定及实际模型写入不可变运行快照，并在派发前重新校验。配置的 `modelSlug` 为空仅可继承原获批 Skill 的 `modelOverride`；缺失或不匹配时拒绝，不选择猜测模型。一次性派发结果未知只能核对或取消原 UUID，不通过改配置或新 UUID 自动再付费。模型输出先保存候选；人工应用不代表人工确认已完成。

维护者可在受控离线脚本中导入上述纯指纹函数，并使用对应 schema/fixed resolver 校验完整记录；避免打印提示词、密钥、文件正文或生产数据。此文档不提供自动审批脚本，审批依据需要负责人确认。

## 赛狐来源合同（不是模型审批）

赛狐受控手工日／月报另用 `SAIHU_REPORT_CONTRACT_FILE` 和 `SAIHU_REPORT_CONTRACT_SHA256`，定义见 `server/domains/ops/saihuReportContract.ts`。`config/examples/saihu-report-contracts.example.json` 只有空记录，不授权任何供应商请求。合同须根据核验后的官方 API 文档，逐工作区／日报或月报固定精确店铺、站点、完整请求模板、响应字段、周期、USD、月结口径及明确空店铺证明；不能用旧 mapper、MCP 能力名称或产品帮助页代替字段证据。

来源合同不含凭据，真实文件不进入公开仓库或浏览器。当前没有可用的批准合同；新日报表也只是未注册、未落库候选。手工请求后台采集后只产生原件和预览，必须另行人工应用；不因此启用自动周期、双调度或自动写事实。月报复用既有受控财务内核，不能把 JSON 原件标成 Excel，不能以日运营利润充当月结利润。

## 已有四栏候选的人工采纳

“审阅并采纳四栏候选”是独立的人工操作，以 `ENABLE_LISTING_DEEP_ADOPTION_WRITES=true` 控制新写入，默认关闭。它不派发模型、不启动 worker，也不替代上述模型执行审批。服务端完整重放核验原终态任务、来源及原候选，再另存不可变人工采纳记录；旧 AI 与 stale 标记仍保留。只有与当前来源、摘要及人工确认版本相符的正式投影可供下游使用，不通过核验时不回退旧 AI。

未知回执只能核对或取消原采纳 UUID；关闭新写入不取消这两条恢复入口及其权限检查。编辑／解锁后的同源重新采纳仍须显式审核并新建操作，不能把旧 committed 回执当作当前有效证明，也不会因此重新调用模型。数据库及真实业务验收仍独立进行。

## 更新、撤销与验收

加载发生在 resolver 调用时，而非模块导入或构建时；每次重读并检查文件大小、类型、权限、完整 SHA 与既有合同。没有旧映射缓存回退。更改文件但未更新部署 SHA 会立即拒绝；更新进程环境需要按部署方式重载/重启进程。建议暂停新任务，部署不可变的新文件及对应环境配置，再恢复；不得在运行中临时以空审批绕过校验。

准备执行和派发前的原有 fresh revalidation 继续生效：被删记录、改动指纹、变动注册表/模型/绑定都不可继续使用旧批准。移除两个环境变量可撤回文件配置；仅移除其中一项、损坏 JSON、重复记录、错误来源/合同/摘要均 fail closed。错误只提供固定原因码，不包含文件路径、内容或底层异常。

朋友接手时应先用目标环境真实记录验证文件及 source/model 指纹，再验证 Web 与 worker 的可用状态和撤权流程；最后另行授权一次有费用的真实模型验收。当前单元测试使用合成记录、临时文件和 stub，不代表生产批准或模型质量验收。
