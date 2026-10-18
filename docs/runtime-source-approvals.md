# Runtime source approvals

Agent 对话和利润 AI 的应用单例现在读取服务器部署审批文件，不再固定使用空 resolver。没有配置时仍明确不可用；Released、绑定关系、种子记录和示例文件都不构成批准。本项没有启用功能开关、调用模型或修改注册表。

## 部署配置

| 功能 | 绝对 JSON 文件路径环境变量 | 完整文件字节 SHA-256 环境变量 |
| --- | --- | --- |
| Agent 对话 | `ASSISTANT_CONVERSATION_APPROVAL_FILE` | `ASSISTANT_CONVERSATION_APPROVAL_SHA256` |
| 利润分析 | `PROFIT_ANALYSIS_APPROVAL_FILE` | `PROFIT_ANALYSIS_APPROVAL_SHA256` |
| Listing 四栏深度分析 | `LISTING_DEEP_ANALYSIS_APPROVAL_FILE` | `LISTING_DEEP_ANALYSIS_APPROVAL_SHA256` |

两项必须同时配置；不要填写相对路径、URL、符号链接或占位 hash。文件必须位于应用构建目录之外、部署管理员控制的目录内，不能放在上传目录或公开仓库。权限建议 `0600`，禁止组/其他用户写入。Web 和 AI worker 必须具有相同受审版本、可读路径和 SHA 配置；每个进程按自身本地路径读取。**不要**配置 `VITE_` 前缀、向浏览器发送该文件，或把真实映射提交到仓库。

`config/examples/` 中三个文件只有结构和空 `records`，不授权任何执行，也不含测试 hash。复制到受控部署目录后，由有权限的维护者根据**目标环境真实注册表和已确认来源证据**填写记录。文件最大 2 MiB、最多 1000 条记录；整体不可部分通过。以 `shasum -a 256 /绝对路径/审批文件.json`（Linux 可用 `sha256sum`）计算最终原始字节 hash，包括换行，不要自行估算或使用示例 hash。将输出的 64 位小写摘要配置到对应环境变量。

## 生成真实记录的依据

- 对话记录必须通过 `AssistantConversationSourceApprovalSchema`；每个工作区/Agent 的 `route`、`reply` 各唯一，`context` 按 Skill slug 唯一。启用的上下文 Skill 也必须有对应批准。通用 Skill 以青岛来源为主；`listing.*` 必须是 `user_listing`，不得替换成朋友来源。仅在确有独立审核证据时使用现有 schema 允许的 `reviewed_supplement`，不得把它当默认批准。
- 利润记录必须通过 `ProfitAnalysisSourceApprovalSchema`，每个工作区一条，`finance`/`profit_analysis`、来源 `qingdao`、`profit_evidence_v1`/`profit_evidence_selection_v1` 合同不变；须填写真实 `revision`、`approvalRef`、`evidenceId` 与证据文件内容摘要 `evidenceHash`。
- 四栏记录必须通过 `CompetitorDeepApprovalSchema`，同工作区的 `title`、`selling`、`buyers_batch`、`buyers_synthesis`、`summary` 各一条，来源均为 `user_listing`，明确匹配 `competitor_deep_evidence_v1`／`competitor_deep_claims_v1` 合同。保留已有用户 Skill；需要兼容新合同的版本应独立审核，不按同名 Skill 自动替换提示词。定义见 `competitorDeepRuntimeContract.ts`。
- Skill 指纹必须使用与运行时相同的 `assistantConversationSkillSnapshotFromRow(row)` → `assistantConversationSkillSnapshotHash(snapshot.pin)`，输入为真实注册表完整投影。不得只 hash slug、版本、提示词，或复制别的环境摘要。函数位于 `assistantConversationSourcePrimitives.ts`。
- 模型指纹使用 `strictModelSnapshotFromRow(workspaceId, modelSlug, row).configurationHash`，输入为目标环境真实模型配置投影；不含密钥正文。模型凭据仍走原有受控引用，不得写入审批文件。
- `inputContract`、`outputContract`、费用上限和图片预算按真实 Skill 合同与审核决定填写；不从 Released、配置绑定或默认预算自动推导批准。对话仅提供对话能力，并不自动执行所选业务 Skill。

维护者可在受控离线脚本中导入上述纯指纹函数，并使用对应 schema/fixed resolver 校验完整记录；避免打印提示词、密钥、文件正文或生产数据。此文档不提供自动审批脚本，审批依据需要负责人确认。

## 更新、撤销与验收

加载发生在 resolver 调用时，而非模块导入或构建时；每次重读并检查文件大小、类型、权限、完整 SHA 与既有合同。没有旧映射缓存回退。更改文件但未更新部署 SHA 会立即拒绝；更新进程环境需要按部署方式重载/重启进程。建议暂停新任务，部署不可变的新文件及对应环境配置，再恢复；不得在运行中临时以空审批绕过校验。

准备执行和派发前的原有 fresh revalidation 继续生效：被删记录、改动指纹、变动注册表/模型/绑定都不可继续使用旧批准。移除两个环境变量可撤回文件配置；仅移除其中一项、损坏 JSON、重复记录、错误来源/合同/摘要均 fail closed。错误只提供固定原因码，不包含文件路径、内容或底层异常。

朋友接手时应先用目标环境真实记录验证文件及 source/model 指纹，再验证 Web 与 worker 的可用状态和撤权流程；最后另行授权一次有费用的真实模型验收。当前单元测试使用合成记录、临时文件和 stub，不代表生产批准或模型质量验收。
