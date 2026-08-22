# 皇帝中台通用对话任务管理器：公开参考研究

**研究日期：** 2026-08-22  
**目的：** 为可上传文件/图片、可调用 Skill、Agent 与 MCP 的通用对话式调度器明确可复用的编排、上下文与治理原则。

## Codex Symphony 可借鉴点

OpenAI 的 Symphony 将任务看板作为编排控制面：每个开放任务映射到独立 Agent 工作区；调度器持续跟踪状态，为停滞任务恢复执行，并根据依赖关系只启动未被阻塞的任务。该模式适合映射到皇帝的 **Conversation → Task Plan → Job/Run → Run Ledger** 链路，而不是将长对话直接等同于一次不可追踪的模型请求。[1]

对皇帝中台的具体落地是：用户消息先形成可编辑的“任务草案”；调度器只选择已经登记、具备权限且满足审批条件的 Skill、Agent 或 Tool；每一次执行以独立 Job/Run 记录，并以父 Conversation ID 串联。任务分支只在依赖解除后执行，人工批准、暂停、重试和回退均必须成为状态机事件。

## Manus 上下文工程可借鉴点

Manus 的公开说明提出保持提示词前缀稳定、上下文追加式记录、以状态机限制可用工具，并把文件系统作为可恢复的外部化上下文。[2] 对本项目而言，附件不能直接无限拼接到模型上下文：文件和图片应进入受控对象存储，消息仅保存附件元数据、摘要、MIME 类型、哈希和访问引用；Context Compiler 决定哪一部分被安全载入某次执行。

> “Rather than removing tools, [Manus] masks the token logits … based on the current context.” [2]

皇帝无需实现模型底层 logit mask，但应以等价的服务端能力门控实现：对话调度器生成的是“候选能力计划”，Tool Gateway 再按白名单、风险等级、范围、速率限制和审批协议进行最终允许或拒绝。工具定义稳定，调用许可随会话状态变化，避免未登记工具或任意 Shell 进入会话。

## Skills 与附件上下文

Manus 将 Skill 定义为可组合、可复用的专长和工作流资源，并强调按需载入的 progressive disclosure。[3] 因此对话任务管理器不应向每轮对话注入全部 Skill 提示词；应仅展示和载入用户选择或路由器建议的已发布 Skill，并将其版本快照写入 Run Ledger，以复现当时能力、模型和约束。

## 设计结论

| 参考原则 | 皇帝中台实现原则 |
|---|---|
| 任务是控制面对象 | 会话、消息、计划、Job/Run 分离；会话不是 Run 本身 |
| 依赖解除后才执行 | 复用现有受控并行计划、批准和等待人工状态机 |
| 上下文可恢复、按需载入 | 附件存对象存储；Context Compiler 载入脱敏摘要/受权片段 |
| 工具可用性随状态受限 | Skill/Agent/MCP 调度始终穿过权限目录、Tool Gateway 与审批协议 |
| 错误是审计证据 | 失败、拒绝、重试、人工跳过写入 Run Ledger，不静默删除 |

## 参考资料

[1] [OpenAI, *An open-source spec for Codex orchestration: Symphony*](https://openai.com/index/open-source-codex-orchestration-symphony/)

[2] [Manus, *Context Engineering for AI Agents: Lessons from Building Manus*](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)

[3] [Manus Documentation, *Manus Skills*](https://manus.im/docs/features/skills)
