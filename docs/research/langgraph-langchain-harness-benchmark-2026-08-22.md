# LangGraph 与 LangChain Harness 对标研究摘录

**研究日期：** 2026-08-22  
**用途：** 皇帝 Harness 前台—后端适配性审计与后续优化路线，不作为直接替换现有治理系统的依据。

## LangGraph 官方架构发现

LangGraph定位为低层编排运行时，重点在长运行、有状态Agent的确定性步骤与模型驱动步骤混合、持久化、人工介入、流式运行与生产部署。官方能力目录包含Persistence、Checkpointers、Stores、Fault tolerance、Event streaming、Interrupts、Time travel、Memory、Subgraphs、测试、部署和可观测性。[1]

对于皇帝Harness，最直接的可借鉴点是：把每次状态变迁显式建模为可恢复的执行状态；在人工确认位置保留可编辑的状态快照；让运行事件和流式信息成为前台可查看的同一审计链，而不是仅在后台日志中存在。皇帝当前已经具备Run Ledger、人工审批、计划步骤、Context Manifest和Agent DAG基础，因此应以补齐状态机契约和恢复语义为主，而不是引入第二套编排框架。

## LangChain 官方架构发现

LangChain将Harness定义为模型调用循环之外的提示词、工具和中间件组合；Agent负责工具调用循环，Harness负责在合适时机提供正确上下文。官方Agent页面覆盖工具、结构化输出、类型化Agent State、流式、上下文管理、规划/委派、容错、Guardrails和Steering。[2]

对于皇帝Harness，最直接的可借鉴点是：将现有Skill模型策略、Tool Gateway治理、附件/知识上下文、审批和错误恢复抽象为具备明确输入/输出/状态更新契约的中间件阶段，并按生命周期把验证、路由、授权、上下文预算、执行与评测分离。皇帝已经禁止页面或Router旁路模型，并已形成受控Provider、Context Manifest和审批边界；优化应强化契约编排、统一错误分类和可重复评测，而非放松受治理入口。

## 初步对标结论

| 对标主题 | 皇帝现有基础 | 建议关注的增量能力 |
|---|---|---|
| 执行状态与恢复 | Agent状态机、会话计划步骤、Run Ledger、人工审批 | 统一的可恢复状态快照、重放/幂等键、失败补偿契约 |
| 上下文工程 | Agent Context Package、对话Context Compiler、Context Manifest | 统一的上下文版本、预算决策解释、来源失效/重编译策略 |
| 人机协同 | L2/L3强制审批、计划后步骤确认 | 标准化“暂停—编辑—继续—拒绝—补偿”协议和前台时间线 |
| Tool治理 | Tool Gateway、白名单、权限、MCP只读范围、Trace | 生命周期中间件链、统一重试/熔断分类、审批前模拟/预检 |
| 可观测与评测 | Run Ledger、质量门禁、反馈/灰度 | Trace评测回放、关键路径SLO、失败簇分析与修复建议闭环 |

## 视频一手实践补充：中断、人工编辑与恢复

LangGraph持久化与人工介入的公开视频演示了以`thread_id`定位会话检查点、在工具节点前中断、读取下一节点与当前消息状态、人工注入或调整状态、随后以空输入恢复运行的模式。[3] 该思路与皇帝“计划批准—高风险步骤单独确认—Run Ledger Trace”的治理方向一致，但皇帝必须继续保留服务端权限、能力风险、输入Schema、审批事件和Tool Gateway边界，不能让前端直接篡改可执行Tool消息。

> “生产环境必须使用持久化数据库；内存级保存器在进程结束后会丢失检查点。” — 视频演示的生产限制说明。[3]

> “暂停后应从同一线程的最新状态继续，而不是重新发起整个图。” — 视频展示的检查点恢复语义。[3]

视频也指出，单纯的检查点并不自动提供前台通知、分布式并发控制、审计回放或安全的状态修改。这些正是皇帝现有Run Ledger、审批请求、Context Manifest和权限模型的优势，应在后续将“状态快照版本、人工编辑差异、恢复幂等键、补偿/回退”纳入同一审计链。

## 官方Interrupt与Middleware补充

LangGraph官方Interrupt文档明确把“持久化检查点、稳定线程指针、JSON可序列化中断载荷、继续执行输入”定义为恢复协议，并强调在中断前执行的副作用必须具备幂等性。[4] 皇帝应借鉴这一点，但以`conversationId`/`planId`/`stepId`/`traceId`组合替代通用线程标识，并把批准、编辑、拒绝、跳过和补偿都写入Run Ledger，不允许客户端直接写执行状态。

LangChain官方中间件目录提供了工具/模型错误规范化、有限重试、上下文总结、模型与工具调用限额、PII检测、人机审批、动态工具选择和上下文编辑等独立阶段。[5] 皇帝已有模型暂时不可用的有限规划重试、Tool Gateway白名单和Context Compiler；后续应将其发展为严格的服务器端生命周期中间件链，而不是允许每个Router自行处理重试、审计与异常。

| 官方模式 | 皇帝应采用的安全化版本 | 当前差距 |
|---|---|---|
| Interrupt + durable checkpoint | 计划/步骤的版本化状态快照与恢复令牌；批准载荷仅经审批服务端写入 | 缺少统一步骤快照版本、恢复幂等键和补偿语义 |
| Tool error + retry | Tool Gateway统一错误类别、仅幂等只读能力有限重试、写入能力不自动重试 | 规划Skill已有受限重试；Tool/Agent错误策略仍分散 |
| Context summarization/editing | Context Compiler确定性预算、摘要、来源版本与失效重编译 | 当前已有裁剪/哈希，未建立跨Run来源版本失效策略 |
| Call limits / tool selection | 基于风险、权限和工作空间的能力预算与可解释选择 | 当前有白名单/权限，缺少会话级调用预算与选择理由追踪 |
| HITL middleware | 标准化暂停、编辑、批准、拒绝、跳过、补偿事件与前台时间线 | 审批边界已存在；统一恢复协议与交互验收待补 |

## 参考来源

[1] [LangGraph Overview — 官方文档](https://docs.langchain.com/oss/python/langgraph/overview)  
[2] [LangChain Agents — 官方文档](https://docs.langchain.com/oss/python/langchain/agents)
[3] [LangGraph — Persistence & Human-in-the-Loop Workflow（公开视频）](https://www.youtube.com/watch?v=9BPCV5TYPmg)
[4] [LangGraph Interrupts — 官方文档](https://docs.langchain.com/oss/python/langgraph/interrupts)
[5] [LangChain Prebuilt Middleware — 官方文档](https://docs.langchain.com/oss/python/langchain/middleware/built-in)
