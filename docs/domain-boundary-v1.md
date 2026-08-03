# Domain Boundary Refactor v1

本轮目标是让代码结构开始匹配业务结构：平台能力进入 AI OS，业务模块进入自己的 domain，旧路径保留兼容 wrapper。

## 领域目录

| Domain | Layer | Router | Service | Repository | Schema | Types |
| --- | --- | --- | --- | --- | --- | --- |
| AI OS | platform | `server/domains/ai_os/router.ts` | `server/domains/ai_os/services` | `server/domains/ai_os/repository.ts` | `server/domains/ai_os/schema.ts` | `server/domains/ai_os/types.ts` |
| Listing | business | `server/domains/listing/router.ts` | `server/domains/listing/service.ts` | `server/domains/listing/repository.ts` | `server/domains/listing/schema.ts` | `server/domains/listing/types.ts` |
| Image | business | `server/domains/image/router.ts` | `server/domains/image/service.ts` | `server/domains/image/repository.ts` | `server/domains/image/schema.ts` | `server/domains/image/types.ts` |
| Ops | business | `server/domains/ops/router.ts` | `server/domains/ops/service.ts` | `server/domains/ops/repository.ts` | `server/domains/ops/schema.ts` | `server/domains/ops/types.ts` |

旧入口仍然保留：

- `server/routers/emperor.ts`
- `server/routers/productOps.ts`
- `server/routers/listing.ts`
- `server/routers/imageWorkflow.ts`
- `server/services/emperorAgentRunner.ts`
- `server/services/emperorToolGateway.ts`
- `server/services/emperorSkillRunner.ts`
- `server/services/aiJobRunner.ts`

这些文件现在只做 re-export，保证前端 API 路径和历史测试不变。

## AI OS 拆分

`emperor.ts` 已经从单文件拆成子路由：

- `skills`
- `run`
- `models`
- `mcp`
- `agents`
- `scheduled`
- `tools`
- `diagnostics`
- `knowledge`
- `observability`

AI OS services 也归入 `server/domains/ai_os/services`：

- Agent Runtime
- Agent State Machine
- AI Job Runner
- Skill Runner
- Tool Gateway
- Observability

## 依赖规则

- AI OS 是平台层，只放 Skill、Agent、Tool、Job、Run、Checkpoint、Artifact、Event、Observability。
- Listing/Image/Ops 是业务层，可以调用 AI OS 的平台能力，但不把业务状态塞进 AI OS 表。
- 业务 domain 访问数据优先通过本领域 repository。
- 跨领域引用优先保存 ID，由 service 层查询，不在 router 里随意 join。
- `server/db.ts` 是历史兼容出口，不再作为新代码的默认数据访问入口。

## 已知迁移状态

本轮完成的是边界成型和低风险移动。Listing/Image/Ops 的大 router 已经进入各自 domain，但内部还保留部分历史过程式逻辑。后续建议按业务流程继续拆：

1. Listing：拆 `generationService`、`translationService`、`versionService`、`qaService`。
2. Image：拆 `contextBuilder`、`step5JobService`、`aplusModuleService`、`referenceService`。
3. Ops：拆 `productProfileRouter`、`conversionRouter`、`reviewRouter`、`reportRouter`、`syncRouter`。
4. AI OS：继续把 `agentRunner.ts` 拆为 DAG、template、artifact、context、execution、job-adapter 六个 service。
