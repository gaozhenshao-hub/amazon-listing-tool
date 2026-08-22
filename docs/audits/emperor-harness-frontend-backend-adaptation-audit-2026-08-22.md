# 皇帝 Harness 前台—后端适配性审计与 LangGraph/LangChain 对标优化方案

**审计日期：** 2026-08-22  
**审计范围：** 皇帝Harness阶段0153–0163、Agent/Skill/Tool/Run链路、对话任务管理器、前端路由、青岛ECS部署记录与受控验收。  
**结论等级：** **后端治理主体已完成，但前台可达性和源码回滚一致性尚未完成，因此不能判定为“全部完成”。**

## 执行摘要

皇帝Harness已经具备一个受治理AI中台的核心骨架：Skill作为能力、Agent作为流程、Tool/MCP作为受控外部能力、Job/Run及Run Ledger作为执行审计记录。青岛ECS已部署Run Ledger、上下文清单、质量门禁、候选回放、灰度发布、人审请求、反馈信号、执行Preset、并行计划、Tool Gateway，以及会话—计划—步骤对话任务管理器。`gpt-5.6-sol`规划Skill、L3步骤审批拒绝和L1无副作用Skill的Trace回写均已完成受控验证。

> LangGraph将自身定位为长运行、有状态Agent的低层编排运行时，核心包括“durable execution, streaming, human-in-the-loop”。[1]

上述能力与皇帝的治理目标相匹配，尤其是将确定性业务规则、人工审批和模型生成放在同一可审计执行链中。不过，本次审计发现两项**P0完整性缺口**：第一，青岛ECS源码存在`EmperorQualityGates.tsx`与`EmperorHarnessGovernance.tsx`，但当前`App.tsx`未注册对应路由，侧边栏也未提供入口；第二，生产已应用0153–0156迁移，但托管回滚源码缺少这些迁移文件。两项问题意味着后端和部分前端页面虽然存在，却无法形成完整、可回滚、可访问的产品闭环。

此外，全部TypeScript编译检查在当前沙箱被资源终止（exit 143），未产生Harness文件错误清单，因此本审计的功能阶段只能评为**条件通过**；已通过的是目标定向单测与生产构建/运行健康证据，不能替代零错误全量类型检查。

## 方案完成度审计

| 能力域 | 后端与数据结构 | 前台与路由 | 青岛ECS受控证据 | 审计结论 |
|---|---|---|---|---|
| Run Ledger与Context Manifest | 0153已创建Trace、事件、Manifest表；Agent/Tool/对话步骤均写入审计链 | `/emperor/trace`已注册；对话完成步骤可按`runId`进入运行详情 | L1规划Skill已回写started/succeeded和Manifest | **完成** |
| Skill质量门禁、快照、回放、灰度 | 0154/0155已提供快照、评测、发布门禁、灰度计划与决定 | ECS存在质量门禁页面，但当前`App.tsx`未注册质量路由 | 数据结构与部署记录存在 | **部分完成：页面不可达** |
| Context Compiler | Agent Context Package与对话Context Compiler均有确定性裁剪、摘要、预算和策略哈希 | Agent Canvas已有开关；Trace可展示Manifest | 规划和L1步骤均验证Manifest | **完成** |
| 人审、Preset、受控并行计划 | 0156已提供人审请求、反馈、Preset、并行计划与分支；对话L2/L3服务端强制人审、默认串行 | ECS存在治理工作区页面，但当前`App.tsx`未注册治理路由 | L3步骤`waiting_human`状态被拒绝运行 | **部分完成：治理页面不可达** |
| Tool Gateway / MCP | 白名单、权限、Schema、限流、熔断、密钥引用和Trace均已落地；领星MCP为只读受控接入 | MCP、模型路由、Agent与对话入口已注册 | 真实领星只读与同步批次审计通过 | **完成** |
| 通用对话任务管理器 | 会话、消息、附件、知识引用、计划、步骤、Skill Run关联均已落库；0158–0163已覆盖 | `/emperor/conversations`已注册；三栏工作台、审批、运行详情入口已存在 | 真实规划、L3拒绝、L1运行/Trace均通过 | **完成，仍待独立站真实点击验收** |
| 回滚与源码一致性 | ECS已具有0153–0163迁移文件 | 托管项目本地仅见0158–0163，缺0153–0156 | 生产迁移账本记录已应用 | **未完成：回滚源漂移** |

### P0缺口一：质量门禁与治理工作区页面未接入当前前台路由

青岛ECS目录中已有`EmperorQualityGates.tsx`和`EmperorHarnessGovernance.tsx`，但当前`client/src/App.tsx`只注册了对话、Trace、模型、MCP、Agent、定时、知识和可观测路由；侧边栏也只显示对话任务管理器、Agent编排、模型路由、MCP连接器等入口。因而，质量门禁、候选回放、灰度计划、Preset、人审请求与并行计划在产品层面是**后端/页面存在但用户不可达**。

该问题不应通过新建独立控制台绕过。应将现有页面在统一权限目录下接入`/emperor/quality`和`/emperor/governance`，并补齐角色资源映射、侧边栏入口、空状态、只读/管理员操作态以及路由级回归。完成后才可把Harness阶段0154–0156定义为真正的前后端闭环。

### P0缺口二：托管回滚源码缺少0153–0156前向迁移

青岛ECS部署目录包含0153–0156，分别覆盖Run Ledger、质量门禁、反馈灰度、人审/Preset/并行计划；本地项目目录没有相应SQL。这会导致托管检查点、未来回滚或新环境重建无法完整复现生产Schema，且会使“青岛ECS为主要环境、托管站为回滚入口”的策略失效。

修复应只做**源码收敛**：从ECS读取已应用的前向SQL、校验其与生产迁移账本一致、复制回托管项目、审阅后保存检查点。不得重新执行历史迁移、不得基线覆盖或改写现有数据。该项应先于任何新功能优化完成。

## 与 LangGraph / LangChain 的对标结论

> “A harness is everything around [the agent loop]: the prompt, the tools, and any middleware that shapes the model’s behavior.” [2]

皇帝已经具备比通用框架更强的业务治理边界：多工作区授权、MCP白名单、Tool Gateway、结构化审批、Run Ledger、Artifact/OSS生命周期和领星只读范围。这些边界不能因借鉴框架而弱化。LangGraph与LangChain最有价值的地方，是提供更清晰的**状态恢复协议**与**生命周期中间件分层**，不是替代皇帝的权限和审计体系。

LangGraph的Interrupt强调持久化检查点、稳定线程指针、JSON审批载荷和恢复时的幂等副作用。[3] 对应到皇帝，应以`conversationId + planId + stepId + traceId + stateVersion`构成恢复定位，而不是仅根据页面状态重跑；批准、拒绝、编辑、跳过、超时和补偿均应成为不可变Ledger事件。LangChain的中间件将错误归一化、有限重试、上下文压缩、人机审批、调用上限、工具选择和PII处理解耦为组合阶段。[4] 对应到皇帝，应把当前散布在Skill Runner、Tool Gateway、Router和Job Worker中的策略收敛为服务器端中间件链，同时保持高风险写入不自动重试。

| 优化主题 | 当前皇帝基础 | 可借鉴模式 | 建议的皇帝化实现 | 优先级 |
|---|---|---|---|---|
| 状态快照与恢复 | Plan/Step状态、Run Ledger、审批记录 | LangGraph checkpoint + interrupt | 增加版本化`execution_state`快照、恢复令牌、幂等键与补偿事件；恢复必须重新校验权限和能力版本 | P1 |
| 生命周期中间件链 | Provider选择、Context Compiler、Tool Gateway、有限规划重试 | LangChain middleware | 固定顺序：输入验证→权限/风险→上下文编译→预算→模型/Tool执行→错误归一化→Ledger→评测；禁止Router自行旁路 | P1 |
| 审批交互协议 | L2/L3人审、`waiting_human`、计划后步骤确认 | HITL interrupt / review-edit-resume | 标准化批准、编辑、拒绝、跳过、过期、补偿的事件和前台时间线；保存人工编辑diff | P1 |
| 调用预算与能力解释 | 白名单、QPS、熔断、工作空间权限 | call limits + tool selector | 增加会话/计划级模型、Tool、并行分支配额；记录选择/排除能力的理由与风险 | P1 |
| 上下文失效治理 | 确定性裁剪、摘要、Token预算、策略哈希 | summarization / context editing | 给知识、附件、模型策略和能力目录加版本指纹；来源变化后明确重编译、失效或人工确认 | P2 |
| 流式运行体验 | Run Ledger已记录阶段事件 | event streaming / interrupt projection | 向前端投影`queued/running/waiting_human/succeeded/failed`的只读事件流；禁止事件流承担写入授权 | P2 |
| 评测与运行质量 | 金标、人工评分、回放、门禁、灰度 | observability + evaluation | 建立按Skill/模型/能力/异常类别聚合的SLO、失败簇、回归集和发布差异报告 | P2 |
| 子图与并行编排 | Agent Canvas、并行计划草稿 | subgraphs / delegation | 仅在纯读、可隔离、显式批准的子任务上启用；每个分支独立Context Manifest与审批边界 | P3 |

## 两阶段代码审计结论

| 阶段 | 结果 | 证据与限制 |
|---|---|---|
| 功能正确性：生产运行 | **条件通过** | 青岛ECS的Web、Worker、Scheduler和受管Teamorouter隧道均健康；真实规划、L3拒绝、L1无副作用运行及Trace已验收。 |
| 功能正确性：全量编译 | **未通过审计门槛** | 当前沙箱`pnpm check`因资源被终止（exit 143），未形成零错误全量TypeScript结论；不能据此宣称全局编译通过。 |
| 功能正确性：前台交互 | **部分通过** | 前端契约测试与双页面视觉验证存在；跨海星独立站审核未完成，真实认证会话点击验收待执行。 |
| 代码质量：架构 | **存在P0问题** | 生产迁移与托管回滚源漂移；质量/治理页面存在但未在当前路由/导航闭环。 |
| 代码质量：安全 | **基线通过，待强化** | 密钥以环境引用、Tool Gateway与审批约束为主；建议后续增加中间件统一错误分类、预算及恢复幂等约束。 |

## 建议实施顺序

首先完成P0源码收敛和前台可达性，不新增复杂Agent功能。其次以最小的“状态快照 + 生命周期中间件 + 审批事件协议”补足LangGraph/LangChain最有价值的生产语义。最后再做流式投影、上下文来源失效、评测SLO和受控子图并行。该顺序能保持“AI是助手，人是决策者”的原则，并确保所有模型、Tool、MCP和人工操作都继续经过皇帝Harness。

## 参考资料

[1] [LangGraph Overview — 官方文档](https://docs.langchain.com/oss/python/langgraph/overview)  
[2] [LangChain Agents — 官方文档](https://docs.langchain.com/oss/python/langchain/agents)  
[3] [LangGraph Interrupts — 官方文档](https://docs.langchain.com/oss/python/langgraph/interrupts)  
[4] [LangChain Prebuilt Middleware — 官方文档](https://docs.langchain.com/oss/python/langchain/middleware/built-in)  
[5] [LangGraph — Persistence & Human-in-the-Loop Workflow（公开视频）](https://www.youtube.com/watch?v=9BPCV5TYPmg)
