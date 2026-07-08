# 通用AI能力管理平台 — 完整技术方案

> **文档版本**：v4.0（优化版 — 融合审查报告全部补充项）**编写日期**：2026-07-06**作者**：Manus AI**定位**：独立部署的通用AI能力中台，服务于所有业务系统**变更说明**：本版本整合了方案审查报告中的8个待补充点和5个优化点，新增SDK/API接口规范、安全性设计、并发控制与队列、部署架构、版本管理粒度、数据迁移方案、Agent暂停/恢复细节、前端技术选型等章节，并调整了工期估算。

---

## 一、背景与目标

### 1.1 现状分析

在多个业务系统（亚马逊运营工具、产品开发工具、Listing工具等）的开发过程中，已积累了大量AI能力，分布在87个独立的Prompt常量和193个invokeLLM调用点中。这些AI能力硬编码在各项目的TypeScript源文件中，存在以下问题：

| 问题 | 影响 | 当前状态 |
| --- | --- | --- |
| Prompt修改需要改代码 | 非开发人员无法优化AI输出质量 | 87个Prompt分散在15+文件中 |
| 无版本管理 | 无法回滚到之前效果更好的版本 | 依赖Git历史，不直观 |
| 无效果监控 | 不知道哪个Prompt效果好/差 | 无采纳率、无满意度数据 |
| 工具连接硬编码 | 新增数据源需要开发介入 | NextSLS、爬虫、S3等分散配置 |
| 无工作流编排 | 复杂任务的步骤组合固定在代码中 | Listing生成流程无法灵活调整 |
| 模型绑定单一 | 无法按场景选择最优模型 | 全部使用内置LLM，无法切换 |
| 新增能力需开发 | 每次新增Skill/MCP都要写代码部署 | 无自助接入机制 |
| 能力无法跨项目复用 | 每个项目独立实现相似AI能力 | 重复开发，维护成本高 |

### 1.2 目标愿景

构建一个**独立部署的通用AI能力管理平台**（LLM → MCP → Skill → Agent + 知识库），作为所有业务系统共享的AI中台：

1. **独立部署** — 平台作为独立站点运行，通过API/SDK服务于任何业务系统

1. **多项目支持** — 统一管理多个业务系统的AI能力，支持全局共享和项目私有

1. **自助管理大模型** — 注册/切换/对比多个LLM提供商，按场景路由

1. **随时接入新工具** — 无需开发即可注册新的API、数据源、外部服务

1. **自由创建Skill** — 通过配置Prompt+模型+工具组合，即时上线新AI能力

1. **灵活编排Agent** — 可视化拖拽组合Skill和MCP，构建复杂工作流

1. **知识库联动** — 业务知识库注入AI上下文，平台自身知识库辅助优化

1. **实时监控效果** — 调用量、Token消耗、采纳率、成本一目了然

---

## 二、独立部署架构（方案三）

### 2.1 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                  通用AI能力管理平台（独立部署）                          │
│              https://ai-platform.your-domain.com                      │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                      管理后台 (Web UI )                            │ │
│  │  LLM管理 | MCP管理 | Skill管理 | Agent编排 | 知识库 | 监控面板   │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                      REST API Layer                               │ │
│  │  /api/skill/run | /api/agent/run | /api/knowledge | /api/mcp     │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                      执行引擎 (Runtime)                           │ │
│  │  LLM Router | MCP Engine | Skill Engine | Agent Engine | RAG     │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                      数据层 (Database + S3)                       │ │
│  │  模型配置 | MCP配置 | Skill定义 | Agent定义 | 知识库 | 调用日志   │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │ API / SDK / Embed
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
        ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
        │  亚马逊运营工具 │  │  产品开发工具  │  │  未来项目X    │
        │  (Project A)  │  │  (Project B)  │  │  (Project N)  │
        └──────────────┘  └──────────────┘  └──────────────┘
```

### 2.2 多项目管理

```sql
-- 项目注册表
CREATE TABLE ai_projects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(100) UNIQUE NOT NULL,          -- 如 "amazon_ops", "product_dev", "listing_tool"
  name VARCHAR(200) NOT NULL,                 -- 显示名称
  description TEXT,
  
  -- API认证
  api_key VARCHAR(200) UNIQUE NOT NULL,       -- 项目API Key
  api_secret_encrypted TEXT NOT NULL,         -- 加密的Secret
  
  -- 配置
  allowed_origins JSON,                       -- CORS白名单
  rate_limit_rpm INT DEFAULT 100,             -- 每分钟请求限制
  monthly_budget_cents INT,                   -- 月度预算
  
  -- 知识库连接
  knowledge_db_url TEXT,                      -- 业务系统数据库连接（用于知识库联动）
  knowledge_collections JSON,                 -- 可用的知识库集合定义
  
  -- 状态
  is_active BOOLEAN DEFAULT TRUE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
```

所有核心表（ai_skills、ai_agents、ai_mcp_tools）均新增以下字段支持多项目：

```sql
-- 在 ai_skills / ai_agents / ai_mcp_tools 表中新增
project_id INT,                              -- 所属项目（NULL=全局）
scope ENUM('global', 'private', 'shared') DEFAULT 'private',
-- global: 所有项目可用（平台内置）
-- private: 仅创建项目可用
-- shared: 创建项目+授权项目可用

FOREIGN KEY (project_id) REFERENCES ai_projects(id)
```

### 2.3 三种接入方式

#### 方式一：REST API（推荐）

任何业务系统通过HTTP调用平台能力：

```typescript
// 业务系统中调用Skill
const response = await fetch("https://ai-platform.your-domain.com/api/skill/run", {
  method: "POST",
  headers: {
    "Authorization": "Bearer PROJECT_API_KEY",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    skillSlug: "title_generation",
    input: { keywords: ["massage gun"], category: "Health" },
    options: { stream: false }
  } )
});

const result = await response.json();
// { success: true, output: { title: "..." }, usage: { tokens: 500, cost: 0.01 } }
```

```typescript
// 业务系统中调用Agent
const response = await fetch("https://ai-platform.your-domain.com/api/agent/run", {
  method: "POST",
  headers: { "Authorization": "Bearer PROJECT_API_KEY" },
  body: JSON.stringify({
    agentSlug: "listing_generation",
    input: { keywords: [...], category: "...", brand: "..." },
    webhook: "https://your-app.com/callback"  // 可选：完成后回调
  } )
});

// 异步执行，通过webhook或轮询获取结果
const { runId, status } = await response.json();
```

#### 方式二：JavaScript SDK（前端集成）

```typescript
// 安装: npm install @your-org/ai-platform-sdk

import { AIPlatform } from "@your-org/ai-platform-sdk";

const ai = new AIPlatform({
  apiUrl: "https://ai-platform.your-domain.com",
  apiKey: "PROJECT_API_KEY"
} );

// 调用Skill
const result = await ai.skill.run("title_generation", {
  keywords: ["massage gun"],
  category: "Health"
});

// 调用Agent（支持流式进度）
const run = await ai.agent.run("listing_generation", {
  keywords: [...],
  category: "..."
}, {
  onProgress: (step) => console.log(`执行到: ${step.nodeName}`),
  onHumanReview: (data, resume) => {
    // 弹出编辑界面，用户确认后调用 resume(editedData)
    showReviewDialog(data, resume);
  },
  onComplete: (result) => handleResult(result)
});
```

#### 方式三：嵌入式UI组件（零开发集成）

```tsx
// 在业务系统中嵌入Agent运行器（iframe方式）
<iframe 
  src="https://ai-platform.your-domain.com/embed/agent-runner?project=amazon_ops&token=xxx"
  width="100%" 
  height="600px"
/>

// 或使用React组件（SDK方式 ）
import { AgentRunner, SkillTester } from "@your-org/ai-platform-sdk/react";

// 嵌入通用Agent运行器
<AgentRunner 
  apiKey="PROJECT_API_KEY"
  agentSlug="listing_generation"
  defaultInput={{ category: currentCategory }}
  onComplete={(result) => applyToPage(result)}
/>

// 嵌入Skill测试器
<SkillTester
  apiKey="PROJECT_API_KEY"
  skillSlug="keyword_analysis"
/>
```

### 2.4 Agent前台调用方案（混合模式）

新建的Agent**不需要重新生成前台界面**。通过以下混合调用模式，新Agent在管理平台配置完成后即可被前台自动识别和使用：

| 场景 | 调用方式 | 说明 | 是否需要开发 |
| --- | --- | --- | --- |
| 新建的Agent | 通用Agent运行器 | 自动渲染表单和结果，即建即用 | 零开发 |
| 已有业务页面 | 嵌入式Agent按钮 | 在业务页面嵌入触发按钮 | 加一行代码 |
| 高频核心Agent | 定制专属页面 | 为特别重要的Agent做专属UI | 需要开发 |
| 外部系统调用 | REST API / SDK | 通过API触发Agent执行 | 零开发 |

**通用Agent运行器的自动适配机制：**

系统根据Agent的inputSchema自动渲染输入表单，根据outputSchema自动渲染结果：

| Schema类型 | 输入渲染为 | 输出渲染为 |
| --- | --- | --- |
| `string` | 文本输入框 | 文本段落 |
| `string` + `format: "textarea"` | 多行文本 | Markdown渲染 |
| `string` + `format: "file"` | 文件上传 | 文件下载链接 |
| `number` | 数字输入框 | 数字卡片 |
| `boolean` | 开关 | 状态标签 |
| `array` | 多选/标签输入 | 表格或列表 |
| `object` | 嵌套表单 | 结构化卡片 |
| `enum` | 下拉选择 | 标签 |
| 带`format: "chart"` | — | 自动图表 |
| 带`format: "editable"` | — | 可编辑卡片 |

**嵌入式Agent按钮（一行代码集成）：**

```tsx
import { AgentTriggerButton } from "@your-org/ai-platform-sdk/react";

// 在任何业务页面中嵌入
<AgentTriggerButton
  apiKey="PROJECT_API_KEY"
  agentSlug="listing_generation"
  input={{ keywords: selectedKeywords, category: currentCategory }}
  onComplete={(result) => setListingData(result)}
  label="AI生成Listing"
/>
```

点击后自动弹出执行进度弹窗，遇到人工审核节点时弹出编辑界面，完成后通过onComplete回调将结果回填到业务页面。

---

## 二-B、SDK/API接口规范

### 2B.1 REST API完整路由表

| 方法 | 路由 | 描述 | 认证 |
| --- | --- | --- | --- |
| POST | `/api/v1/skills/:slug/run` | 执行Skill | API Key |
| POST | `/api/v1/skills/:slug/test` | 测试运行Skill（不记录日志） | API Key |
| GET | `/api/v1/skills` | 获取可用Skill列表 | API Key |
| GET | `/api/v1/skills/:slug` | 获取Skill详情（含Schema） | API Key |
| GET | `/api/v1/skills/:slug/versions` | 获取Skill版本历史 | API Key |
| POST | `/api/v1/agents/:slug/run` | 启动Agent执行 | API Key |
| GET | `/api/v1/agents/:slug/runs/:runId` | 查询Agent执行状态 | API Key |
| POST | `/api/v1/agents/:slug/runs/:runId/resume` | 恢复暂停的Agent | API Key |
| DELETE | `/api/v1/agents/:slug/runs/:runId` | 取消Agent执行 | API Key |
| POST | `/api/v1/mcp/:slug/call` | 调用MCP工具 | API Key |
| GET | `/api/v1/mcp/:slug/health` | 查询MCP健康状态 | API Key |
| GET | `/api/v1/knowledge/:collection/search` | 知识库检索 | API Key |
| GET | `/api/v1/usage/summary` | 获取用量概览 | API Key |
| GET | `/api/v1/usage/daily` | 获取每日用量明细 | API Key |
| WS | `/ws/v1/agent-stream` | Agent实时进度推送 | JWT Token |
| WS | `/ws/v1/human-review` | 人工审核节点通知 | JWT Token |

### 2B.2 SDK方法签名与TypeScript类型定义

```typescript
// @your-org/ai-platform-sdk

export interface AIPlatformConfig {
  apiUrl: string;           // 平台域名
  apiKey: string;           // 项目API Key
  timeout?: number;         // 请求超时（默认30s）
  retries?: number;         // 重试次数（默认2）
  onError?: (err: PlatformError) => void;  // 全局错误回调
}

export interface SkillRunOptions {
  stream?: boolean;         // 是否流式输出
  version?: number;         // 指定版本（默认latest）
  model?: string;           // 覆盖默认模型
  metadata?: Record<string, string>; // 自定义元数据（用于日志追踪）
}

export interface SkillResult<T = any> {
  success: boolean;
  output: T;
  usage: { promptTokens: number; completionTokens: number; cost: number };
  duration: number;
  skillVersion: number;
  traceId: string;          // 链路追踪ID
}

export interface AgentRunOptions {
  onProgress?: (step: AgentStep) => void;
  onHumanReview?: (data: ReviewData, resume: (edited: any) => void) => void;
  onComplete?: (result: AgentResult) => void;
  onError?: (error: PlatformError) => void;
  webhook?: string;         // 完成后回调URL
  timeout?: number;         // Agent最大执行时间
}

export interface AgentStep {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  output?: any;
  progress: number;         // 0-100
}

export class AIPlatform {
  constructor(config: AIPlatformConfig);
  
  skill: {
    run<T = any>(slug: string, input: Record<string, any>, options?: SkillRunOptions): Promise<SkillResult<T>>;
    test<T = any>(slug: string, input: Record<string, any>): Promise<SkillResult<T>>;
    list(filter?: { category?: string; scope?: string }): Promise<SkillInfo[]>;
    getSchema(slug: string): Promise<{ input: JSONSchema; output: JSONSchema }>;
    getVersions(slug: string): Promise<SkillVersion[]>;
  };
  
  agent: {
    run(slug: string, input: Record<string, any>, options?: AgentRunOptions): Promise<AgentRun>;
    getStatus(slug: string, runId: string): Promise<AgentRunStatus>;
    resume(slug: string, runId: string, data: any): Promise<void>;
    cancel(slug: string, runId: string): Promise<void>;
    list(filter?: { status?: string }): Promise<AgentRunInfo[]>;
  };
  
  mcp: {
    call(slug: string, capability: string, params: Record<string, any>): Promise<any>;
    health(slug: string): Promise<MCPHealth>;
  };
  
  knowledge: {
    search(collection: string, query: string, options?: { limit?: number; type?: 'keyword' | 'semantic' | 'hybrid' }): Promise<KnowledgeItem[]>;
  };
  
  usage: {
    summary(period?: 'day' | 'week' | 'month'): Promise<UsageSummary>;
    daily(startDate: string, endDate: string): Promise<DailyUsage[]>;
  };
}
```

### 2B.3 错误码体系

| 错误码 | HTTP状态 | 描述 | 建议处理 |
| --- | --- | --- | --- |
| `AUTH_INVALID_KEY` | 401 | API Key无效或已过期 | 检查API Key配置 |
| `AUTH_PERMISSION_DENIED` | 403 | 无权访问该资源 | 检查项目权限和scope |
| `SKILL_NOT_FOUND` | 404 | Skill不存在或未对当前项目开放 | 检查slug和scope |
| `SKILL_INPUT_INVALID` | 422 | 输入不符合inputSchema | 根据返回的validation errors修正 |
| `SKILL_EXECUTION_FAILED` | 500 | Skill执行失败（LLM调用异常） | 重试或检查Skill配置 |
| `AGENT_NOT_FOUND` | 404 | Agent不存在 | 检查slug |
| `AGENT_TIMEOUT` | 408 | Agent执行超时 | 增加timeout或优化工作流 |
| `AGENT_PAUSED` | 202 | Agent等待人工审核（正常状态） | 调用resume接口 |
| `AGENT_CANCELLED` | 410 | Agent已被取消 | 无需处理 |
| `MODEL_QUOTA_EXCEEDED` | 429 | 模型配额耗尽 | 等待配额重置或升级计划 |
| `MODEL_UNAVAILABLE` | 503 | LLM服务不可用 | 系统自动降级到备用模型 |
| `RATE_LIMIT_EXCEEDED` | 429 | 超出项目QPS限制 | 降低调用频率或申请提限 |
| `MCP_CALL_FAILED` | 502 | MCP工具调用失败 | 检查MCP健康状态 |
| `MCP_TIMEOUT` | 504 | MCP调用超时 | 检查外部服务状态 |
| `KNOWLEDGE_EMPTY` | 200 | 知识库检索无结果（非错误） | 正常情况，Skill仍可执行 |
| `CONCURRENT_LIMIT` | 429 | 超出并发执行限制 | 等待队列排序或减少并发 |

### 2B.4 限流策略

平台采用三层限流机制，防止单个项目占满资源：

| 层级 | 维度 | 默认限制 | 可配置 |
| --- | --- | --- | --- |
| L1: 项目级 | 每分钟请求数(RPM) | 100 RPM | 按项目单独调整 |
| L2: Skill级 | 每分钟Skill调用数 | 30 RPM | 按Skill单独调整 |
| L3: 模型级 | 每分钟模型API调用数 | 跟随上游提供商限制 | 按模型配置 |

超出限制时返回 `429 Too Many Requests`，响应头包含重试信息：

```
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1720000000
Retry-After: 12
Content-Type: application/json

{
  "error": { "code": "RATE_LIMIT_EXCEEDED", "message": "Project rate limit exceeded", "retryAfter": 12 }
}
```

### 2B.5 WebSocket接口规范

用于Agent实时进度推送和人工审核节点通知：

```typescript
// 连接建立
const ws = new WebSocket('wss://ai-platform.your-domain.com/ws/v1/agent-stream?token=JWT_TOKEN' );

// 服务端推送消息类型
interface WSServerMessage {
  type: 'agent_progress' | 'human_review_request' | 'agent_complete' | 'agent_error' | 'heartbeat';
  runId: string;
  payload: any;
  timestamp: number;
}

// agent_progress payload
interface ProgressPayload {
  nodeId: string;
  nodeName: string;
  status: 'started' | 'completed' | 'failed';
  output?: any;
  progress: number; // 0-100
}

// human_review_request payload
interface ReviewRequestPayload {
  nodeId: string;
  displayData: Record<string, any>;  // 展示给用户的数据
  editableFields: string[];           // 可编辑字段列表
  timeout: number;                    // 超时时间(ms)
  schema?: JSONSchema;                // 可编辑字段的校验规则
}

// 客户端发送消息（恢复审核）
interface WSClientMessage {
  type: 'resume_review' | 'cancel_run' | 'ping';
  runId: string;
  nodeId?: string;
  editedData?: Record<string, any>;
}
```

心跳机制：服务端每30秒发送 `heartbeat` 消息，客户端60秒未收到心跳则重连。

---

## 三、四层架构设计

### 3.1 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                      Agent Layer（智能体层）                        │
│   编排多个Skill+MCP完成复杂任务，支持条件分支、循环、人工审核          │
│   ┌──────────┐  ┌──────────────┐  ┌───────────────┐             │
│   │Listing   │  │ 图片分析      │  │ 广告优化       │  ...        │
│   │生成Agent │  │ Agent        │  │ Agent         │             │
│   └─────┬────┘  └──────┬───────┘  └───────┬───────┘             │
│         │               │                  │                      │
├─────────┼───────────────┼──────────────────┼──────────────────────┤
│         ▼               ▼                  ▼                      │
│                      Skill Layer（技能层）                          │
│   一个原子AI能力 = Prompt + 模型选择 + 输入输出定义 + 知识库注入       │
│   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       │
│   │关键词   │ │五点生成│ │图片标签│ │广告诊断│ │评论分析│       │
│   │分级    │ │       │ │识别   │ │       │ │       │       │
│   └───┬────┘ └───┬───┘ └───┬───┘ └───┬───┘ └───┬───┘       │
│       │          │         │         │         │             │
├───────┼──────────┼─────────┼─────────┼─────────┼─────────────────┤
│       ▼          ▼         ▼         ▼         ▼                  │
│                      MCP Layer（工具/数据源层）                      │
│   外部API、数据库、文件存储、爬虫等工具连接                             │
│   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       │
│   │ERP API │ │S3存储  │ │爬虫服务│ │OCR服务 │ │自定义API│       │
│   └────────┘ └────────┘ └────────┘ └────────┘ └────────┘       │
│                                                                   │
├───────────────────────────────────────────────────────────────────┤
│                      LLM Layer（大模型层）                          │
│   多模型注册、路由、降级、成本控制                                     │
│   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       │
│   │GPT-4o  │ │Claude  │ │DeepSeek│ │Qwen    │ │本地模型 │       │
│   │        │ │3.5     │ │V3     │ │Max    │ │Ollama │       │
│   └────────┘ └────────┘ └────────┘ └────────┘ └────────┘       │
└───────────────────────────────────────────────────────────────────┘
```

### 3.2 四层职责划分

| 层级 | 职责 | 管理对象 | 自助操作 |
| --- | --- | --- | --- |
| **LLM Layer** | 提供AI算力 | 大模型API密钥、定价、能力 | 注册新模型、设置路由策略、预算控制 |
| **MCP Layer** | 提供工具和数据 | API连接、数据库、文件服务 | 注册新API、配置认证、定义能力 |
| **Skill Layer** | 定义原子AI能力 | Prompt + 模型 + 工具 + 知识库 | 创建/编辑Skill、测试、发布 |
| **Agent Layer** | 编排复杂工作流 | Skill+MCP的DAG组合 | 拖拽编排、设置触发器、查看日志 |

---

## 四、LLM大模型管理

### 4.1 功能清单

| 功能 | 描述 | 优先级 |
| --- | --- | --- |
| 模型注册 | 添加新的LLM提供商（API地址+Key+模型名） | P0 |
| 模型列表 | 查看所有已注册模型的状态和用量 | P0 |
| 模型路由 | 为每个Skill指定使用哪个模型 | P0 |
| 成本统计 | 按模型/Skill/Agent/项目统计Token消耗和费用 | P0 |
| 降级策略 | 主模型不可用时自动切换备用模型 | P1 |
| 效果对比 | 同一Skill用不同模型运行对比质量 | P1 |
| 预算告警 | 月度预算上限 + 告警通知（按项目） | P1 |
| 速率限制 | 按模型/项目设置RPM/TPM限制 | P2 |
| 模型能力标签 | 标记模型擅长的任务类型 | P2 |

### 4.2 数据模型

```sql
-- 大模型注册表
CREATE TABLE ai_llm_models (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(100) UNIQUE NOT NULL,          -- 如 "gpt4o", "deepseek_v3", "claude_35"
  name VARCHAR(200) NOT NULL,                 -- 显示名称
  provider VARCHAR(100) NOT NULL,             -- 提供商：openai/anthropic/deepseek/aliyun/local
  
  -- 连接配置
  api_base_url VARCHAR(500) NOT NULL,         -- API地址
  api_key_encrypted TEXT NOT NULL,            -- 加密存储的API Key
  model_id VARCHAR(100) NOT NULL,             -- 模型标识，如 "gpt-4o", "deepseek-chat"
  
  -- 能力配置
  max_context_tokens INT DEFAULT 128000,
  max_output_tokens INT DEFAULT 4096,
  supports_vision BOOLEAN DEFAULT FALSE,
  supports_json_mode BOOLEAN DEFAULT TRUE,
  supports_streaming BOOLEAN DEFAULT TRUE,
  supports_function_call BOOLEAN DEFAULT FALSE,
  
  -- 定价（每百万Token，单位：美分）
  input_price_per_million INT DEFAULT 0,
  output_price_per_million INT DEFAULT 0,
  
  -- 能力标签
  capability_tags JSON,                       -- ["中文优化","推理强","速度快","多模态"]
  
  -- 路由配置
  priority INT DEFAULT 0,
  is_default BOOLEAN DEFAULT FALSE,
  fallback_model_id INT,
  
  -- 限流
  rate_limit_rpm INT,
  rate_limit_tpm INT,
  
  -- 状态
  is_active BOOLEAN DEFAULT TRUE,
  health_status VARCHAR(20) DEFAULT 'unknown',
  last_health_check BIGINT,
  
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- 模型用量统计表（按天+项目聚合）
CREATE TABLE ai_llm_usage_daily (
  id INT AUTO_INCREMENT PRIMARY KEY,
  model_id INT NOT NULL,
  project_id INT,                             -- 按项目统计
  date_key VARCHAR(10) NOT NULL,
  
  total_calls INT DEFAULT 0,
  total_prompt_tokens BIGINT DEFAULT 0,
  total_completion_tokens BIGINT DEFAULT 0,
  total_cost_cents INT DEFAULT 0,
  avg_latency_ms INT DEFAULT 0,
  error_count INT DEFAULT 0,
  
  UNIQUE KEY (model_id, project_id, date_key),
  FOREIGN KEY (model_id) REFERENCES ai_llm_models(id),
  FOREIGN KEY (project_id) REFERENCES ai_projects(id)
);

-- 预算配置表（按项目）
CREATE TABLE ai_budget_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT,                             -- NULL=全局预算
  monthly_budget_cents INT NOT NULL,
  alert_threshold_percent INT DEFAULT 80,
  hard_limit BOOLEAN DEFAULT FALSE,
  alert_email VARCHAR(200),
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES ai_projects(id)
);
```

### 4.3 模型路由引擎

```typescript
// server/aiPlatform/llmRouter.ts

interface LLMCallOptions {
  messages: Array<{ role: string; content: string }>;
  skillSlug?: string;
  preferredModel?: string;       // Skill指定的模型
  projectId?: number;            // 调用来源项目
  responseFormat?: any;
  temperature?: number;
  maxTokens?: number;
}

export async function callLLM(options: LLMCallOptions) {
  // 1. 确定使用哪个模型
  const model = await routeModel(options);
  
  // 2. 检查预算和限流
  await checkBudgetAndRateLimit(model, options.projectId);
  
  // 3. 调用模型API（统一适配层）
  const startTime = Date.now();
  let response;
  try {
    response = await callModelAPI(model, options);
  } catch (err) {
    // 4. 失败时尝试降级模型
    if (model.fallbackModelId) {
      const fallback = await loadModel(model.fallbackModelId);
      response = await callModelAPI(fallback, options);
    } else {
      throw err;
    }
  }
  
  // 5. 记录用量
  const duration = Date.now() - startTime;
  await recordUsage(model.id, options.projectId, response.usage, duration);
  
  return response;
}

async function routeModel(options: LLMCallOptions) {
  // 优先级：Skill指定 > 项目默认 > 全局默认
  if (options.preferredModel) {
    return await loadModelBySlug(options.preferredModel);
  }
  // 按能力标签匹配最优模型
  return await getDefaultModel();
}
```

### 4.4 自助注册模型界面

```
┌─────────────────────────────────────────────────────────────────┐
│  注册新模型                                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  基本信息:                                                        │
│  ├─ 名称:     [DeepSeek V3____________]                          │
│  ├─ 标识:     [deepseek_v3___________]  (自动生成)                │
│  ├─ 提供商:   [DeepSeek ▼]                                       │
│  └─ 能力标签: [中文优化] [推理强] [性价比高] [+ 添加]              │
│                                                                   │
│  连接配置:                                                        │
│  ├─ API地址:  [https://api.deepseek.com/v1___]                   │
│  ├─ API Key:  [sk-xxxxxxxx____________]  🔒                      │
│  ├─ 模型ID:   [deepseek-chat__________]                          │
│  └─ 超时:     [60] 秒                                            │
│                                                                   │
│  能力配置:                                                        │
│  ├─ 最大上下文: [128000] tokens                                   │
│  ├─ 最大输出:   [8192] tokens                                     │
│  ├─ [x] 支持JSON模式  [ ] 支持视觉  [x] 支持流式  [ ] 函数调用    │
│  └─ 定价: 输入 [1] / 输出 [2] (每百万Token ，美分)                  │
│                                                                   │
│  路由配置:                                                        │
│  ├─ 优先级:   [5] (1-10，越高越优先)                               │
│  ├─ 降级模型: [gpt4o_mini ▼] (不可用时切换)                        │
│  └─ 限流:     RPM [60]  TPM [100000]                              │
│                                                                   │
│                    [测试连接]  [保存]                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 五、MCP工具/数据源管理

### 5.1 功能清单

| 功能 | 描述 | 优先级 |
| --- | --- | --- |
| MCP列表 | 查看所有已注册工具的状态和调用量 | P0 |
| 自助接入 | 无需开发即可注册新的外部工具 | P0 |
| 能力定义 | 为每个MCP定义可调用的能力（函数） | P0 |
| 健康监控 | 实时检测MCP可用性和响应时间 | P1 |
| 调用日志 | 记录每次MCP调用的输入/输出/耗时 | P1 |
| 认证管理 | 统一管理API Key、OAuth Token等 | P1 |
| 重试策略 | 配置失败重试次数和间隔 | P2 |

### 5.2 数据模型

```sql
-- MCP工具注册表
CREATE TABLE ai_mcp_tools (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(50) NOT NULL,              -- 数据服务/存储/爬虫/计算/通知
  description TEXT,
  icon VARCHAR(50),
  
  -- 多项目支持
  project_id INT,
  scope ENUM('global', 'private', 'shared') DEFAULT 'private',
  
  -- 连接配置
  connection_type ENUM('http_api', 'database', 'webhook', 'internal', 'script' ) NOT NULL,
  connection_config JSON NOT NULL,            -- 连接详情（加密敏感字段）
  
  -- 能力列表
  capabilities JSON NOT NULL,                 -- 该MCP提供的所有能力
  
  -- 健康检查
  health_check_url VARCHAR(500),
  health_status VARCHAR(20) DEFAULT 'unknown',
  last_health_check BIGINT,
  avg_response_ms INT,
  
  -- 重试配置
  retry_count INT DEFAULT 3,
  retry_delay_ms INT DEFAULT 1000,
  timeout_ms INT DEFAULT 30000,
  
  is_active BOOLEAN DEFAULT TRUE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES ai_projects(id)
);
```

### 5.3 四种自助接入方式

| 接入方式 | 适用场景 | 需要填写 |
| --- | --- | --- |
| HTTP API | 任意REST API | URL + 认证方式 + 能力定义 |
| 数据库查询 | 直接查DB | 连接串 + SQL模板 |
| Webhook | 接收外部推送 | 回调URL + 数据格式 |
| 自定义脚本 | 复杂逻辑 | JS/TS代码片段 |

### 5.4 MCP统一调用引擎

```typescript
// server/aiPlatform/mcpEngine.ts

export async function callMCP(
  mcpSlug: string,
  capabilityName: string,
  params: Record<string, any>,
  projectId?: number
): Promise<any> {
  // 1. 加载MCP配置（检查项目权限）
  const mcp = await loadMCPConfig(mcpSlug, projectId);
  if (!mcp || !mcp.isActive) {
    throw new Error(`MCP "${mcpSlug}" not found or disabled`);
  }
  
  // 2. 找到对应能力
  const capability = mcp.capabilities.find((c: any) => c.name === capabilityName);
  if (!capability) {
    throw new Error(`Capability "${capabilityName}" not found`);
  }
  
  // 3. 根据连接类型执行调用
  const startTime = Date.now();
  let result: any;
  
  try {
    switch (mcp.connectionType) {
      case "http_api":
        result = await executeHttpAPI(mcp, capability, params );
        break;
      case "database":
        result = await executeDatabaseQuery(mcp, capability, params);
        break;
      case "webhook":
        result = await sendWebhook(mcp, capability, params);
        break;
      case "script":
        result = await executeCustomScript(mcp, capability, params);
        break;
    }
  } catch (err: any) {
    // 重试逻辑
    for (let i = 0; i < mcp.retryCount; i++) {
      await sleep(mcp.retryDelayMs * (i + 1));
      try {
        result = await executeCall(mcp, capability, params);
        break;
      } catch (retryErr) { continue; }
    }
    if (!result) throw err;
  }
  
  // 4. 记录调用日志
  await recordMCPCall(mcp.id, capabilityName, params, result, Date.now() - startTime, projectId);
  return result;
}
```

---

## 六、Skill技能管理

### 6.1 功能清单

| 功能 | 描述 | 优先级 |
| --- | --- | --- |
| Skill列表 | 按模块/项目分类展示所有Skill卡片 | P0 |
| 自助创建Skill | 无需开发即可新建AI能力 | P0 |
| Prompt编辑器 | Monaco Editor + 变量高亮 + 实时预览 | P0 |
| 版本管理 | 每次保存自动存档，支持对比和回滚 | P0 |
| 模型选择 | 为每个Skill指定使用哪个LLM | P0 |
| 测试沙盒 | 填入样例输入，实时运行查看输出 | P1 |
| Schema编辑器 | 可视化编辑输入/输出JSON Schema | P1 |
| 知识库关联 | 选择注入哪些知识库内容作为上下文 | P1 |
| MCP依赖 | 声明Skill需要调用哪些MCP工具 | P2 |
| A/B测试 | 同时运行两个版本对比效果 | P2 |
| 跨项目共享 | 将Skill设为全局或授权给其他项目 | P1 |

### 6.2 数据模型

```sql
-- Skill（技能）表
CREATE TABLE ai_skills (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(50) NOT NULL,
  description TEXT,
  icon VARCHAR(50),
  
  -- 多项目支持
  project_id INT,
  scope ENUM('global', 'private', 'shared') DEFAULT 'private',
  
  -- Prompt配置
  system_prompt TEXT NOT NULL,
  user_prompt_template TEXT NOT NULL,         -- {{变量}}插值
  
  -- 模型配置
  llm_model_slug VARCHAR(100),               -- 指定模型（null=默认）
  temperature DECIMAL(3,2) DEFAULT 0.7,
  max_tokens INT DEFAULT 4096,
  response_format JSON,
  
  -- Schema定义
  input_schema JSON NOT NULL,
  output_schema JSON,
  
  -- 关联配置
  knowledge_refs JSON,                        -- 关联知识库
  mcp_dependencies JSON,                      -- 依赖的MCP工具
  
  -- 元数据
  version INT DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  is_system BOOLEAN DEFAULT FALSE,
  call_count INT DEFAULT 0,
  accept_rate DECIMAL(5,2),
  
  created_by VARCHAR(100),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES ai_projects(id)
);

-- Skill版本历史表
CREATE TABLE ai_skill_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  skill_id INT NOT NULL,
  version INT NOT NULL,
  system_prompt TEXT NOT NULL,
  user_prompt_template TEXT NOT NULL,
  llm_model_slug VARCHAR(100),
  temperature DECIMAL(3,2),
  max_tokens INT,
  response_format JSON,
  input_schema JSON,
  output_schema JSON,
  change_note TEXT,
  performance_score DECIMAL(5,2),
  created_by VARCHAR(100),
  created_at BIGINT NOT NULL,
  FOREIGN KEY (skill_id) REFERENCES ai_skills(id)
);

-- Skill调用日志表
CREATE TABLE ai_skill_calls (
  id INT AUTO_INCREMENT PRIMARY KEY,
  skill_id INT NOT NULL,
  skill_version INT,
  project_id INT,                             -- 调用来源项目
  agent_run_id INT,
  llm_model_id INT,
  input_data JSON,
  output_data JSON,
  prompt_tokens INT,
  completion_tokens INT,
  duration_ms INT,
  cost_cents INT,
  success BOOLEAN NOT NULL,
  error_message TEXT,
  user_accepted BOOLEAN,
  user_feedback TEXT,
  created_at BIGINT NOT NULL,
  user_id VARCHAR(100),
  FOREIGN KEY (skill_id) REFERENCES ai_skills(id),
  FOREIGN KEY (project_id) REFERENCES ai_projects(id)
);
```

### 6.3 自助创建Skill流程

```
┌─────────────────────────────────────────────────────────────────┐
│  创建新Skill                                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Step 1: 基本信息                                                 │
│  ├─ 名称:   [竞品价格分析__________]                               │
│  ├─ 标识:   [competitor_price_analysis]  (自动生成)                │
│  ├─ 分类:   [产品开发 ▼]                                          │
│  ├─ 项目:   [全局(所有项目可用) ▼]                                  │
│  └─ 描述:   [分析竞品定价策略，给出定价建议_____]                     │
│                                                                   │
│  Step 2: Prompt配置                                               │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  System Prompt:                                          │    │
│  │  ┌───────────────────────────────────────────────────┐  │    │
│  │  │ 你是一位资深定价策略分析师。                         │  │    │
│  │  │ 请根据提供的竞品价格数据，分析定价策略并给出建议。    │  │    │
│  │  └───────────────────────────────────────────────────┘  │    │
│  │                                                          │    │
│  │  User Prompt Template:                                   │    │
│  │  ┌───────────────────────────────────────────────────┐  │    │
│  │  │ 产品类目: {{category}}                             │  │    │
│  │  │ 我的产品成本: {{cost}}                              │  │    │
│  │  │ 竞品数据: {{competitorData}}                       │  │    │
│  │  │ 请给出定价建议。                                    │  │    │
│  │  └───────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
│  Step 3: 输入定义                                    [+ 添加字段] │
│  ├─ category    (string, 必填)  产品类目                          │
│  ├─ cost        (number, 必填)  产品成本                          │
│  └─ competitorData (string, 必填) 竞品数据                        │
│                                                                   │
│  Step 4: 输出格式                                                 │
│  ├─ 模式: [JSON Schema ▼]                                        │
│  └─ Schema: { priceRange: {min, max}, strategy: string, ... }    │
│                                                                   │
│  Step 5: 模型与参数                                               │
│  ├─ 模型:   [DeepSeek-V3 ▼]                                      │
│  ├─ 温度:   [0.5] ────●──── (0-1)                                │
│  ├─ 最大Token: [2048]                                             │
│  └─ 知识库:  [☐ 定价SOP] [☐ 行业规则]                              │
│                                                                   │
│  ┌─ 右侧: 知识库推荐 ──────────────────────────────────────────┐  │
│  │  💡 推荐关联的知识库:                                        │  │
│  │  • Prompt最佳实践: "定价分析类Prompt建议使用对比表格输出"      │  │
│  │  • 行业规则: "亚马逊定价需考虑FBA费用和佣金比例"              │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│                    [保存草稿]  [测试运行]  [发布上线]                │
└─────────────────────────────────────────────────────────────────┘
```

### 6.4 Skill运行时引擎

```typescript
// server/aiPlatform/skillEngine.ts

export async function executeSkill(options: {
  skillSlug: string;
  input: Record<string, any>;
  projectId?: number;
  userId?: string;
  agentRunId?: number;
}): Promise<SkillResult> {
  const startTime = Date.now();
  
  // 1. 加载Skill配置（检查项目权限）
  const skill = await loadSkill(options.skillSlug, options.projectId);
  
  // 2. 注入知识库上下文（两层知识库联动）
  let contextText = "";
  if (skill.knowledgeRefs?.length > 0) {
    // Layer 1: 业务知识库（来自业务系统）
    const businessKB = await loadBusinessKnowledge(skill.knowledgeRefs, options.projectId);
    // Layer 2: 平台知识库（最佳实践、行业规则）
    const platformKB = await loadPlatformKnowledge(skill.knowledgeRefs);
    contextText = [...businessKB, ...platformKB]
      .map(k => `### ${k.title}\n${k.content}`).join("\n\n");
  }
  
  // 3. 渲染Prompt模板
  const template = Handlebars.compile(skill.userPromptTemplate);
  const userPrompt = template({ ...options.input, _knowledge: contextText });
  const systemPrompt = contextText 
    ? `${skill.systemPrompt}\n\n=== 参考知识 ===\n${contextText}`
    : skill.systemPrompt;
  
  // 4. 调用LLM（通过路由引擎）
  const response = await callLLM({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    skillSlug: options.skillSlug,
    preferredModel: skill.llmModelSlug,
    projectId: options.projectId,
    responseFormat: skill.responseFormat,
    temperature: skill.temperature,
    maxTokens: skill.maxTokens,
  });
  
  // 5. 解析输出
  let output = response.choices[0]?.message?.content;
  if (skill.responseFormat?.type === "json_schema") {
    output = JSON.parse(output);
  }
  
  // 6. 记录调用日志
  await recordSkillCall(skill.id, options.projectId, {
    input: options.input, output,
    promptTokens: response.usage?.prompt_tokens,
    completionTokens: response.usage?.completion_tokens,
    durationMs: Date.now() - startTime,
    userId: options.userId,
    agentRunId: options.agentRunId,
  });
  
  return { success: true, output, duration: Date.now() - startTime };
}
```

### 6.5 现有87个Skill清单（按模块分类）

以下为从亚马逊运营工具项目中梳理出的所有AI能力，迁移后将作为平台的初始Skill库：

#### Listing生成模块（14个）

| Skill Slug | 名称 | 源文件 |
| --- | --- | --- |
| title_generation | 标题生成 | server/prompts.ts |
| bullet_points_generation | 五点描述生成 | server/prompts.ts |
| single_bullet_generation | 单条Bullet生成 | server/prompts.ts |
| description_generation | 长描述生成 | server/prompts.ts |
| search_terms_generation | 搜索词生成 | server/prompts.ts |
| qa_generation | QA问答生成 | server/prompts.ts |
| image_advice | 图片建议生成 | server/prompts.ts |
| image_advice_translation | 图片建议翻译 | server/prompts.ts |
| chinese_translation | 中文翻译 | server/prompts.ts |
| selling_points_core | 核心卖点提取 | server/prompts.ts |
| expand_keyword_to_fabe | 关键词FABE展开 | server/prompts.ts |
| competitor_analysis | 竞品分析 | server/prompts.ts |
| comparison_summary | 对比总结 | server/prompts.ts |
| review_analysis | 评论分析 | server/prompts.ts |

#### 关键词分析模块（6个）

| Skill Slug | 名称 | 源文件 |
| --- | --- | --- |
| keyword_scene_tag | 场景标签 | server/keywordPrompts.ts |
| keyword_strategy_matrix | 3D策略矩阵 | server/keywordPrompts.ts |
| keyword_root_classify | 词根分类 | server/keywordPrompts.ts |
| keyword_semantic_filter | 语义过滤 | server/keywordPrompts.ts |
| keyword_listing_layout | Listing布局建议 | server/keywordPrompts.ts |
| keyword_traffic_competition | 流量竞争分级 | server/keywordPrompts.ts |

#### 广告分析模块（12个）

| Skill Slug | 名称 | 源文件 |
| --- | --- | --- |
| ad_structure | 广告架构建议 | server/adStructurePrompt.ts |
| ad_structure_translation | 广告架构翻译 | server/adStructurePrompt.ts |
| ad_stage_diagnosis | 广告阶段诊断 | server/routers/adDeepAnalysis.ts |
| ad_keyword_tier | 关键词分级管理 | server/routers/adDeepAnalysis.ts |
| ad_cross_diagnosis | 多维串联诊断 | server/routers/adDeepAnalysis.ts |
| ad_placement_analysis | 广告位分析 | server/routers/adDeepAnalysis.ts |
| ad_search_term_analysis | 搜索词分析 | server/routers/adDeepAnalysis.ts |
| ad_impression_share | 展示量份额分析 | server/routers/adDeepAnalysis.ts |
| ad_sb_benchmark | SB Benchmark分析 | server/routers/adDeepAnalysis.ts |
| ad_business_cross | 业务×广告交叉分析 | server/routers/adDeepAnalysis.ts |
| ad_sop_generation | SOP任务生成 | server/routers/adDeepAnalysis.ts |
| ad_clinic_diagnosis | 广告、问诊诊断 | server/routers/adDeepAnalysis.ts |

#### 产品开发分析模块（6个）

| Skill Slug | 名称 | 源文件 |
| --- | --- | --- |
| market_overview | 市场概览分析 | server/devAnalysisPrompts.ts |
| price_analysis | 价格分析 | server/devAnalysisPrompts.ts |
| review_kano | Review Kano分析 | server/devAnalysisPrompts.ts |
| decision_dashboard | 决策面板 | server/devAnalysisPrompts.ts |
| brand_competition | 品牌竞争分析 | server/devAnalysisPrompts.ts |
| attribute_analysis | 属性分析 | server/devAnalysisPrompts.ts |

#### 图片分析模块（13个）

| Skill Slug | 名称 | 源文件 |
| --- | --- | --- |
| main_image_scoring | 主图评分 | server/routers/imageAiAnalyzer.ts |
| secondary_image_scoring | 副图评分 | server/routers/imageAiAnalyzer.ts |
| aplus_image_scoring | A+图片评分 | server/routers/imageAiAnalyzer.ts |
| image_step1_selling_points | 卖点提取 | server/imageWorkflowPrompts.ts |
| image_step2_outline | 图片大纲 | server/imageWorkflowPrompts.ts |
| image_step3_style | 风格定义 | server/imageWorkflowPrompts.ts |
| image_step4_reference | 参考匹配 | server/imageWorkflowPrompts.ts |
| image_step4_reoptimize | 参考优化 | server/imageWorkflowPrompts.ts |
| image_step5_aplus_module | A+模块优化 | server/imageWorkflowPrompts.ts |
| image_step5_aplus_combo | A+组合推荐 | server/imageWorkflowPrompts.ts |
| image_step5_final_suggestion | 最终建议 | server/imageWorkflowPrompts.ts |
| image_step5_translation | 翻译 | server/imageWorkflowPrompts.ts |
| image_step6_lovart_translation | Lovart翻译 | server/imageWorkflowPrompts.ts |

#### 视频脚本模块（7个）

| Skill Slug | 名称 | 源文件 |
| --- | --- | --- |
| video_competitor_analysis | 竞品视频分析 | server/videoScriptPrompts.ts |
| video_competitor_summary | 竞品视频总结 | server/videoScriptPrompts.ts |
| video_product_info_extraction | 产品信息提取 | server/videoScriptPrompts.ts |
| video_section_planning | 段落规划 | server/videoScriptPrompts.ts |
| video_subtopic_expansion | 子主题展开 | server/videoScriptPrompts.ts |
| video_shot_detail | 分镜细节 | server/videoScriptPrompts.ts |
| video_edit_script | 剪辑脚本 | server/videoScriptPrompts.ts |

#### 站外营销模块（13个）

| Skill Slug | 名称 | 源文件 |
| --- | --- | --- |
| influencer_matching | 达人匹配 | server/routers/offsitePrompts.ts |
| outreach_email | 外联邮件 | server/routers/offsitePrompts.ts |
| content_review | 内容审核 | server/routers/offsitePrompts.ts |
| campaign_analysis | 活动分析 | server/routers/offsitePrompts.ts |
| content_calendar | 内容日历 | server/routers/offsitePrompts.ts |
| social_content_generation | 社交内容生成 | server/routers/offsitePrompts.ts |
| matrix_content_variation | 矩阵内容变体 | server/routers/offsitePrompts.ts |
| attribution_analysis | 归因分析 | server/routers/offsitePrompts.ts |
| offsite_summary | 站外总结 | server/offsitePrompts.ts |
| tiktok_analysis | TikTok分析 | server/offsitePrompts.ts |
| youtube_analysis | YouTube分析 | server/offsitePrompts.ts |
| reddit_analysis | Reddit分析 | server/offsitePrompts.ts |
| facebook_analysis | Facebook分析 | server/offsitePrompts.ts |

#### 数据分析模块（4个） + Listing评分模块（5个） + 其他（3个）

| Skill Slug | 名称 | 源文件 |
| --- | --- | --- |
| rufus_attribute | Rufus属性提取 | server/analysisPrompts.ts |
| multi_competitor_analysis | 多竞品格局分析 | server/analysisPrompts.ts |
| cosmo_scene_mapping | COSMO场景映射 | server/analysisPrompts.ts |
| a9_keyword_grading | A9关键词分级 | server/analysisPrompts.ts |
| evaluate_title_checklist | 标题评分 | server/prompts.ts |
| evaluate_bullet_checklist | 五点评分 | server/prompts.ts |
| evaluate_description_checklist | 描述评分 | server/prompts.ts |
| evaluate_search_terms_checklist | 搜索词评分 | server/prompts.ts |
| evaluate_qa_checklist | QA评分 | server/prompts.ts |
| review_kano_aggregation | Review Kano聚合 | server/routers/reviewAggregation.ts |
| image_recognition | 图片识别 | server/prompts.ts |
| kb_image_7d_analysis | 知识库图片7维分析 | server/routers/kbImages.ts |

---

## 七、Agent智能体编排

### 7.1 功能清单

| 功能 | 描述 | 优先级 |
| --- | --- | --- |
| Agent列表 | 查看所有已注册的Agent（按项目筛选） | P0 |
| 可视化编排器 | 拖拽式工作流画布（React Flow） | P0 |
| 节点类型 | Skill/MCP/LLM/条件/循环/人工审核/输出 | P0 |
| 执行引擎 | 按DAG顺序执行工作流 | P0 |
| 自助创建Agent | 无需开发即可编排新工作流 | P0 |
| 执行日志 | 完整链路追踪（每个节点的输入输出） | P1 |
| 人工介入节点 | 指定步骤暂停等待用户确认/编辑 | P1 |
| 跨项目共享 | 将Agent设为全局或授权给其他项目 | P1 |
| 并行执行 | 无依赖的节点并行运行 | P2 |
| 触发器 | 手动/事件/定时触发 | P2 |
| 子Agent复用 | 一个Agent可作为另一个Agent的子节点 | P2 |

### 7.2 数据模型

```sql
-- Agent（智能体）表
CREATE TABLE ai_agents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(50) NOT NULL,
  description TEXT,
  icon VARCHAR(50),
  
  -- 多项目支持
  project_id INT,
  scope ENUM('global', 'private', 'shared') DEFAULT 'private',
  
  -- 工作流定义（完整的DAG）
  workflow JSON NOT NULL,
  -- 结构: {
  --   nodes: [{ id, type, position, config, label }],
  --   edges: [{ id, source, target, sourceHandle, label }],
  --   globalVariables: { key: defaultValue }
  -- }
  
  -- 输入输出Schema（用于通用运行器自动渲染）
  input_schema JSON NOT NULL,
  output_schema JSON,
  
  -- 触发配置
  trigger_type VARCHAR(30) DEFAULT 'manual',
  trigger_config JSON,
  
  -- 全局配置
  global_context JSON,
  error_strategy VARCHAR(30) DEFAULT 'stop',
  max_execution_time_ms INT DEFAULT 300000,
  
  -- 元数据
  version INT DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  is_system BOOLEAN DEFAULT FALSE,
  run_count INT DEFAULT 0,
  avg_duration_ms INT,
  success_rate DECIMAL(5,2),
  
  created_by VARCHAR(100),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES ai_projects(id)
);

-- Agent执行记录表
CREATE TABLE ai_agent_runs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  agent_id INT NOT NULL,
  agent_version INT,
  project_id INT,                             -- 调用来源项目
  status VARCHAR(20) NOT NULL,                -- running/paused/completed/failed
  
  input_data JSON,
  output_data JSON,
  execution_trace JSON,                       -- 每个节点的执行记录
  
  paused_at_node VARCHAR(100),
  pause_data JSON,
  resume_data JSON,
  
  total_tokens INT DEFAULT 0,
  total_duration_ms INT DEFAULT 0,
  total_cost_cents INT DEFAULT 0,
  nodes_executed INT DEFAULT 0,
  nodes_total INT DEFAULT 0,
  
  user_accepted BOOLEAN,
  user_rating INT,
  user_feedback TEXT,
  
  started_at BIGINT NOT NULL,
  completed_at BIGINT,
  user_id VARCHAR(100),
  FOREIGN KEY (agent_id) REFERENCES ai_agents(id),
  FOREIGN KEY (project_id) REFERENCES ai_projects(id)
);
```

### 7.3 节点类型定义

| 节点类型 | 图标 | 用途 | 配置项 |
| --- | --- | --- | --- |
| **Skill节点** | 🎯 | 调用一个AI技能 | skillSlug + 输入映射 |
| **MCP节点** | 🔧 | 调用外部工具 | mcpSlug + capability + 参数 |
| **LLM直调节点** | 🤖 | 直接调用LLM（不走Skill） | prompt + 模型 + 参数 |
| **条件节点** | ◇ | 根据条件分支 | 表达式 + True/False出口 |
| **循环节点** | 🔄 | 对数组逐项处理 | 迭代路径 + 子工作流 |
| **人工审核节点** | 👤 | 暂停等待用户确认 | 展示内容 + 可编辑字段 |
| **数据转换节点** | ⚡ | JS表达式转换数据 | 转换表达式 |
| **子Agent节点** | 📦 | 调用另一个Agent | agentSlug + 输入映射 |
| **输出节点** | 📤 | 定义最终输出 | 输出字段映射 |

### 7.4 执行引擎

```typescript
// server/aiPlatform/agentEngine.ts

export async function executeAgent(
  agentSlug: string,
  input: Record<string, any>,
  userId: string,
  projectId?: number
): Promise<AgentRunResult> {
  const agent = await loadAgent(agentSlug, projectId);
  const workflow = agent.workflow;
  
  const runId = await createRun(agent.id, input, userId, projectId);
  const executionOrder = topologicalSort(workflow.nodes, workflow.edges);
  
  const ctx: Record<string, any> = { 
    input, 
    global: workflow.globalVariables || {} 
  };
  
  for (const nodeId of executionOrder) {
    const node = workflow.nodes.find(n => n.id === nodeId)!;
    
    switch (node.type) {
      case "skill": {
        const mappedInput = resolveMapping(node.config.inputMapping, ctx);
        const result = await executeSkill({
          skillSlug: node.config.skillSlug,
          input: mappedInput,
          projectId, userId, agentRunId: runId,
        });
        ctx[nodeId] = { output: result.output };
        break;
      }
      case "mcp": {
        const params = resolveMapping(node.config.params, ctx);
        const result = await callMCP(node.config.mcpSlug, node.config.capabilityName, params, projectId);
        ctx[nodeId] = { output: result };
        break;
      }
      case "human_review": {
        const displayData = resolveMapping(node.config.displayMapping, ctx);
        await pauseRun(runId, nodeId, displayData);
        return { status: "paused", runId, pausedAt: nodeId, displayData };
      }
      case "condition": {
        const result = evaluateExpression(node.config.condition, ctx);
        ctx[nodeId] = { result };
        break;
      }
      case "transform": {
        const result = evaluateExpression(node.config.expression, ctx);
        ctx[nodeId] = { output: result };
        break;
      }
      case "sub_agent": {
        const subInput = resolveMapping(node.config.inputMapping, ctx);
        const subResult = await executeAgent(node.config.agentSlug, subInput, userId, projectId);
        ctx[nodeId] = { output: subResult.output };
        break;
      }
    }
    await updateTrace(runId, nodeId, "completed", ctx[nodeId]);
  }
  
  const outputNode = workflow.nodes.find(n => n.type === "output");
  const finalOutput = outputNode ? resolveMapping(outputNode.config.outputMapping, ctx) : ctx;
  await completeRun(runId, finalOutput);
  return { status: "completed", runId, output: finalOutput };
}
```

### 7.5 示例Agent

#### Agent 1：Listing生成Agent

| 步骤 | 节点类型 | Skill/MCP | 输入来源 |
| --- | --- | --- | --- |
| 1 | Skill | keyword_strategy_matrix | 用户输入关键词 |
| 2 | Skill | selling_points_core | 用户输入+步骤1输出 |
| 3 | Skill (并行) | title_generation | 步骤1+2输出 |
| 4 | Skill (并行) | bullet_points_generation | 步骤1+2输出 |
| 5 | Skill (并行) | description_generation | 步骤1+2输出 |
| 6 | 人工审核 | — | 步骤3-5输出，用户可编辑 |
| 7 | Skill | evaluate_*_checklist | 步骤6确认后的内容 |
| 8 | 条件 | score > 7? | 步骤7评分 |
| 9a | 输出 | — | 通过→最终结果 |
| 9b | Skill | 重新优化 | 未通过→回到步骤6 |

#### Agent 2：广告深度分析Agent

| 步骤 | 节点类型 | Skill/MCP | 输入来源 |
| --- | --- | --- | --- |
| 1 | MCP | erp_api.getAdData | 用户选择ASIN+日期 |
| 2 | Skill | ad_stage_diagnosis | 步骤1数据 |
| 3-6 | Skill (并行) | ad_keyword_tier / ad_placement / ad_search_term / ad_impression | 步骤1数据 |
| 7 | Skill | ad_cross_diagnosis | 步骤2-6输出汇总 |
| 8 | Skill | ad_sop_generation | 步骤7诊断结果 |
| 9 | 人工审核 | — | SOP任务列表，可编辑 |
| 10 | 输出 | — | 最终优化方案 |

#### Agent 3：图片创意Agent

| 步骤 | 节点类型 | Skill/MCP | 输入来源 |
| --- | --- | --- | --- |
| 1 | Skill | image_step1_selling_points | 产品信息 |
| 2 | Skill | image_step2_outline | 步骤1卖点 |
| 3 | 人工审核 | — | 大纲确认 |
| 4 | Skill | image_step3_style | 步骤3确认的大纲 |
| 5 | MCP | kb_images.searchSimilar | 在知识库中搜索参考图 |
| 6 | Skill | image_step4_reference | 步骤4+5 |
| 7 | Skill | image_step5_final_suggestion | 汇总 |
| 8 | 人工审核 | — | 最终方案确认 |
| 9 | 输出 | — | 图片创意方案 |

---

## 七-B、并发控制与任务队列

### 7B.1 架构设计

平台采用BullMQ作为任务队列，基于Redis实现分布式任务调度：

```typescript
// server/aiPlatform/queue.ts
import { Queue, Worker, QueueScheduler } from 'bullmq';
import Redis from 'ioredis';

const connection = new Redis(process.env.REDIS_URL);

// 三个核心队列
export const skillQueue = new Queue('skill-execution', { connection });
export const agentQueue = new Queue('agent-execution', { connection, defaultJobOptions: { attempts: 2, backoff: { type: 'exponential', delay: 1000 } } });
export const mcpQueue = new Queue('mcp-calls', { connection });

// Skill执行Worker
export const skillWorker = new Worker('skill-execution', async (job) => {
  const { skillSlug, input, projectId, userId } = job.data;
  return await executeSkillInternal(skillSlug, input, projectId, userId);
}, {
  connection,
  concurrency: 10,           // 单Worker并发数
  limiter: {
    max: 50,                 // 每分钟最大任务数
    duration: 60000,
  },
});
```

### 7B.2 多层并发控制

| 层级 | 控制维度 | 默认限制 | 实现方式 |
| --- | --- | --- | --- |
| 项目级 | 每个项目的并发Skill执行数 | 10个 | Redis计数器 |
| 项目级 | 每个项目的并发Agent运行数 | 5个 | Redis计数器 |
| 模型级 | 每个模型的并发调用数 | 跟随上游限制 | 令牌桶算法 |
| MCP级 | 每个MCP工具的并发调用数 | 5个 | 信号量 |
| 全局级 | 平台总并发执行数 | 100个 | Worker数量限制 |

```typescript
// 项目级并发控制
async function checkProjectConcurrency(projectId: number, type: 'skill' | 'agent'): Promise<boolean> {
  const key = `concurrency:${type}:project:${projectId}`;
  const current = await redis.incr(key);
  await redis.expire(key, 300); // 5分钟过期保护
  
  const limit = type === 'skill' ? 10 : 5;
  if (current > limit) {
    await redis.decr(key);
    return false; // 拒绝执行，返回 CONCURRENT_LIMIT 错误
  }
  return true;
}

// 模型级Rate Limit（令牌桶）
async function checkModelRateLimit(modelSlug: string): Promise<boolean> {
  const model = await getModelConfig(modelSlug);
  const key = `ratelimit:model:${modelSlug}`;
  const tokens = await redis.get(key);
  
  if (Number(tokens || 0) >= model.maxConcurrent) {
    return false;
  }
  await redis.incr(key);
  await redis.expire(key, 60);
  return true;
}
```

### 7B.3 优先级队列

Agent执行支持优先级排序，确保重要任务优先处理：

| 优先级 | 场景 | 说明 |
| --- | --- | --- |
| P1 (最高) | 人工审核恢复 | 用户已确认，立即继续执行 |
| P2 | 实时交互调用 | 用户在等待结果 |
| P3 | API调用 | 业务系统后台调用 |
| P4 (最低) | 定时任务/批量处理 | 无用户等待 |

### 7B.4 超时与取消机制

```typescript
// Agent执行超时控制
interface TimeoutConfig {
  agentMaxExecutionMs: number;    // Agent总超时（默认5分钟）
  nodeMaxExecutionMs: number;     // 单节点超时（默认60秒）
  humanReviewTimeoutMs: number;   // 人工审核超时（默认24小时）
  llmCallTimeoutMs: number;       // LLM调用超时（默认30秒）
}

// 取消机制
async function cancelAgentRun(runId: number, reason: 'user' | 'timeout' | 'error') {
  // 1. 标记状态为cancelled
  await updateRunStatus(runId, 'cancelled', { cancelReason: reason });
  // 2. 如果有正在执行的LLM调用，发送abort信号
  await abortPendingLLMCalls(runId);
  // 3. 释放并发计数器
  await releaseConcurrencySlot(runId);
  // 4. 通知客户端
  await notifyClient(runId, 'agent_cancelled', { reason });
}
```

---

## 七-C、Agent暂停/恢复状态持久化

### 7C.1 暂停状态存储方案

Agent执行到“人工审核”节点时暂停，状态通过数据库+Redis双层存储保证可靠性：

```typescript
// 暂停时的状态持久化
async function pauseRun(runId: number, nodeId: string, displayData: any) {
  const executionContext = getCurrentContext(); // 包含所有节点输出
  
  // Layer 1: 数据库持久化（长期存储，用户可能数小时后才回来）
  await db.update(aiAgentRuns)
    .set({
      status: 'paused',
      pausedAtNode: nodeId,
      pauseData: JSON.stringify({
        displayData,
        executionContext,
        pausedAt: Date.now(),
        timeoutAt: Date.now() + getTimeoutConfig(runId),
      }),
    })
    .where(eq(aiAgentRuns.id, runId));
  
  // Layer 2: Redis缓存（快速读取，用于状态查询和超时检查）
  await redis.setex(
    `agent:paused:${runId}`,
    86400, // 24小时TTL
    JSON.stringify({ nodeId, pausedAt: Date.now(), timeoutAt: Date.now() + getTimeoutConfig(runId) })
  );
  
  // Layer 3: 发送通知
  await notifyUser(runId, 'agent_paused', { nodeId, displayData });
}
```

### 7C.2 超时策略

每个Agent可配置不同的审核超时时间：

| 场景 | 默认超时 | 超时后行为 | 可配置 |
| --- | --- | --- | --- |
| 普通审核节点 | 24小时 | 自动取消 + 通知用户 | 是 |
| 紧急审核（如定价确认） | 4小时 | 自动取消 + 通知用户 | 是 |
| 批量审核（如Listing确认） | 72小时 | 自动取消 + 通知用户 | 是 |
| 无超时（特殊场景） | 无限 | 不自动取消 | 是 |

```typescript
// 超时检查定时任务（每分钟执行）
async function checkPausedTimeouts() {
  const pausedRuns = await redis.keys('agent:paused:*');
  
  for (const key of pausedRuns) {
    const data = JSON.parse(await redis.get(key) || '{}');
    if (data.timeoutAt && Date.now() > data.timeoutAt) {
      const runId = parseInt(key.split(':')[2]);
      
      // 超时前提醒（超时前1小时）
      if (Date.now() > data.timeoutAt - 3600000 && !data.reminderSent) {
        await notifyUser(runId, 'review_timeout_warning', { remainingMs: data.timeoutAt - Date.now() });
        await redis.hset(key, 'reminderSent', 'true');
      }
      
      // 已超时，自动取消
      if (Date.now() > data.timeoutAt) {
        await cancelAgentRun(runId, 'timeout');
        await redis.del(key);
      }
    }
  }
}
```

### 7C.3 恢复时上下文重建

用户确认审核后，系统从数据库重建执行上下文并继续执行：

```typescript
async function resumeAgentRun(runId: number, editedData: Record<string, any>) {
  // 1. 从数据库加载暂停状态
  const run = await db.select().from(aiAgentRuns).where(eq(aiAgentRuns.id, runId)).limit(1);
  if (!run[0] || run[0].status !== 'paused') throw new Error('Run is not paused');
  
  const pauseState = JSON.parse(run[0].pauseData);
  const { executionContext, displayData } = pauseState;
  
  // 2. 重建执行上下文
  const ctx = executionContext;
  ctx[run[0].pausedAtNode] = { output: editedData }; // 用户编辑后的数据作为当前节点输出
  
  // 3. 更新状态为running
  await db.update(aiAgentRuns).set({ status: 'running', resumeData: JSON.stringify(editedData) }).where(eq(aiAgentRuns.id, runId));
  await redis.del(`agent:paused:${runId}`);
  
  // 4. 从暂停节点的下一个节点继续执行
  const agent = await loadAgent(run[0].agentId);
  const workflow = agent.workflow;
  const executionOrder = topologicalSort(workflow.nodes, workflow.edges);
  const resumeIndex = executionOrder.indexOf(run[0].pausedAtNode) + 1;
  
  // 5. 继续执行剩余节点
  for (let i = resumeIndex; i < executionOrder.length; i++) {
    await executeNode(workflow.nodes.find(n => n.id === executionOrder[i])!, ctx, runId);
  }
  
  // 6. 完成
  const outputNode = workflow.nodes.find(n => n.type === 'output');
  const finalOutput = outputNode ? resolveMapping(outputNode.config.outputMapping, ctx) : ctx;
  await completeRun(runId, finalOutput);
}
```

### 7C.4 通知机制

| 事件 | 通知方式 | 触发时机 |
| --- | --- | --- |
| Agent暂停等待审核 | WebSocket推送 + 站内通知 | 立即 |
| 审核超时提醒 | 站内通知 + 邮件（可选） | 超时前1小时 |
| 审核超时自动取消 | WebSocket + 站内通知 | 超时时 |
| Agent执行完成 | WebSocket推送 + Webhook回调 | 立即 |
| Agent执行失败 | WebSocket + 站内通知 | 立即 |

### 7C.5 多用户隔离

多个用户同时运行同一Agent时，每次执行都是独立的`run`实例，通过`runId`完全隔离：

- 每次执行创建独立的`ai_agent_runs`记录

- 执行上下文存储在各自的`execution_trace`字段中

- 暂停状态通过`runId`隔离，互不影响

- WebSocket推送按`userId`+`runId`定向发送

---

## 八、知识库联动体系

### 8.1 双层知识库架构

平台的知识库分为两个层级，服务于不同目的：

```
┌─────────────────────────────────────────────────────────────────┐
│                      AI能力管理平台                                │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Layer 2: 平台知识库（辅助AI能力优化）                         │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │ │
│  │  │Prompt    │ │模型特性  │ │行业规则  │ │效果案例  │      │ │
│  │  │最佳实践  │ │指南     │ │库       │ │库       │      │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Layer 1: 业务知识库连接（来自各业务系统）                      │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │ │
│  │  │文案知识库│ │图片知识库│ │运营技能库│ │视频脚本库│      │ │
│  │  │(Project A)│ │(Project A)│ │(Project A)│ │(Project A)│      │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │ │
│  │  ┌──────────┐ ┌──────────┐                                  │ │
│  │  │产品数据库│ │市场报告库│  ...（来自其他项目）                │ │
│  │  │(Project B)│ │(Project C)│                                  │ │
│  │  └──────────┘ └──────────┘                                  │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 Layer 1：业务知识库联动

每个接入的业务项目可以注册自己的知识库集合，供Skill/Agent运行时注入上下文：

```sql
-- 知识库集合注册表
CREATE TABLE ai_knowledge_collections (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  slug VARCHAR(100) NOT NULL,                 -- 如 "copywriting_kb", "image_kb"
  name VARCHAR(200) NOT NULL,
  description TEXT,
  
  -- 数据源配置
  source_type ENUM('database', 'api', 'static') NOT NULL,
  source_config JSON NOT NULL,
  -- database: { table, titleField, contentField, filterField, connectionUrl }
  -- api: { endpoint, method, headers, responseMapping }
  -- static: { items: [{ title, content }] }
  
  -- 检索配置
  search_type ENUM('keyword', 'semantic', 'hybrid') DEFAULT 'keyword',
  max_items INT DEFAULT 5,                    -- 每次注入最多条目数
  max_tokens INT DEFAULT 2000,                -- 注入内容最大Token数
  
  is_active BOOLEAN DEFAULT TRUE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  
  UNIQUE KEY (project_id, slug),
  FOREIGN KEY (project_id) REFERENCES ai_projects(id)
);
```

**联动场景示例：**

| Skill | 关联知识库 | 注入效果 |
| --- | --- | --- |
| title_generation | 文案知识库（标题模板） | AI参考同类目高转化标题公式 |
| image_step2_outline | 图片知识库（竞品图片标签） | AI参考竞品图片的构图和卖点布局 |
| ad_sop_generation | 运营技能库（广告SOP） | AI生成的SOP符合团队标准流程 |
| video_section_planning | 视频脚本库（成功案例） | AI参考高播放量视频的段落结构 |

**Skill编辑器中的知识库配置：**

```
Step 5: 知识库关联                                    [+ 关联知识库]
┌─────────────────────────────────────────────────────────────┐
│  已关联:                                                     │
│  ├─ [x] 文案知识库 (Project: 亚马逊运营工具)                  │
│  │      筛选条件: category = {{input.category}}               │
│  │      最大条目: 3                                          │
│  │                                                           │
│  ├─ [x] 行业规则库 (平台知识库)                               │
│  │      筛选条件: platform = "amazon"                         │
│  │      最大条目: 2                                          │
│  │                                                           │
│  └─ [ ] Prompt最佳实践 (平台知识库)                           │
│         用途: 编辑Skill时参考，不注入运行时                     │
└─────────────────────────────────────────────────────────────┘
```

### 8.3 Layer 2：平台自身知识库

平台维护自己的知识库，用于辅助AI能力的创建和优化：

| 知识库 | 内容 | 用途 | 数据来源 |
| --- | --- | --- | --- |
| **Prompt最佳实践库** | 各类Prompt的写作技巧和模板 | Skill编辑器右侧推荐 | 人工整理 + 高采纳率Prompt自动收集 |
| **模型特性指南** | 各模型的优劣势和适用场景 | 模型选择时的推荐依据 | 人工整理 + 效果对比数据 |
| **行业规则库** | 平台规则（如亚马逊标题限制、禁用词） | Skill输出校验 | 人工整理 |
| **效果案例库** | 高采纳率的AI输出案例 | 作为few-shot示例注入 | 自动从高评分调用中收集 |
| **错误模式库** | 低采纳率的AI输出模式 | 输出后自动检查 | 自动从低评分调用中学习 |

```sql
-- 平台知识库表
CREATE TABLE ai_platform_knowledge (
  id INT AUTO_INCREMENT PRIMARY KEY,
  collection VARCHAR(50) NOT NULL,            -- prompt_best_practices / model_guide / industry_rules / success_cases / error_patterns
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  tags JSON,                                  -- 标签，用于检索匹配
  
  -- 来源追踪
  source_type ENUM('manual', 'auto_collected') NOT NULL,
  source_skill_id INT,                        -- 自动收集时的来源Skill
  source_call_id INT,                         -- 自动收集时的来源调用
  
  -- 质量指标
  relevance_score DECIMAL(5,2),
  usage_count INT DEFAULT 0,                  -- 被引用次数
  
  is_active BOOLEAN DEFAULT TRUE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
```

### 8.4 自动学习机制（含人工审核）

平台通过监控Skill调用的采纳率，自动收集候选知识，经人工审核后正式入库：

```
流程：自动收集 → 候选池 → 人工审核 → 正式入库

┌───────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐
│ Skill调用  │──→│ 自动筛选  │──→│ 候选池    │──→│ 人工审核  │──→ 正式入库
│ (采纳/拒绝) │    │ (评分阈值) │    │ (pending) │    │ (管理员)  │
└───────────┘    └───────────┘    └───────────┘    └───────────┘
```

```typescript
// 自动收集候选知识（进入候选池，而非直接入库）
async function autoCollectKnowledge(callRecord: SkillCallRecord) {
  // 高采纳率（用户评分>=4或直接采纳）→ 候选效果案例
  if (callRecord.userAccepted && callRecord.userRating >= 4) {
    await addToCandidatePool("success_cases", {
      title: `${callRecord.skillName} - 优秀输出案例`,
      content: JSON.stringify({ input: callRecord.input, output: callRecord.output }),
      tags: [callRecord.skillCategory, callRecord.skillSlug],
      sourceSkillId: callRecord.skillId,
      sourceCallId: callRecord.id,
      status: 'pending_review',  // 待审核状态
    });
  }
  
  // 低采纳率（用户评分<=2或明确拒绝）→ 候选错误模式
  if (callRecord.userAccepted === false || callRecord.userRating <= 2) {
    await addToCandidatePool("error_patterns", {
      title: `${callRecord.skillName} - 需改进模式`,
      content: JSON.stringify({ 
        input: callRecord.input, 
        output: callRecord.output,
        feedback: callRecord.userFeedback 
      }),
      tags: [callRecord.skillCategory, callRecord.skillSlug],
      sourceSkillId: callRecord.skillId,
      sourceCallId: callRecord.id,
      status: 'pending_review',  // 待审核状态
    });
  }
}

// 人工审核接口
async function reviewKnowledgeCandidate(candidateId: number, action: 'approve' | 'reject' | 'edit', editedContent?: string) {
  const candidate = await getCandidateById(candidateId);
  
  switch (action) {
    case 'approve':
      // 审核通过，正式入库
      await addToCollection(candidate.collection, {
        ...candidate,
        status: 'active',
        reviewedBy: ctx.user.id,
        reviewedAt: Date.now(),
      });
      break;
    case 'edit':
      // 编辑后入库
      await addToCollection(candidate.collection, {
        ...candidate,
        content: editedContent,
        status: 'active',
        reviewedBy: ctx.user.id,
        reviewedAt: Date.now(),
      });
      break;
    case 'reject':
      // 拒绝，标记为已拒绝（保留记录供分析）
      await updateCandidateStatus(candidateId, 'rejected', ctx.user.id);
      break;
  }
}
```

### 8.5 知识库在各环节的应用

| 环节 | 使用的知识库 | 应用方式 |
| --- | --- | --- |
| **创建Skill时** | Prompt最佳实践 + 模型特性指南 | 编辑器右侧推荐面板 |
| **Skill运行时** | 业务知识库 + 效果案例库 | 注入到System Prompt上下文 |
| **输出校验时** | 行业规则库 + 错误模式库 | 自动检查输出合规性 |
| **Agent编排时** | 效果案例库 | 推荐最佳节点组合 |
| **效果分析时** | 错误模式库 | 识别常见失败原因 |

---

## 八-B、安全性设计

### 8B.1 自定义脚本沙箱执行

MCP工具支持`script`类型（自定义脚本），必须在隔离环境中执行以防止恶意代码：

```typescript
// server/aiPlatform/sandbox.ts
import ivm from 'isolated-vm';

export async function executeInSandbox(code: string, context: Record<string, any>): Promise<any> {
  const isolate = new ivm.Isolate({ memoryLimit: 128 }); // 128MB内存限制
  const vmContext = await isolate.createContext();
  
  // 注入安全的API白名单
  const jail = vmContext.global;
  await jail.set('global', jail.derefInto());
  
  // 只允许访问以下API
  const allowedAPIs = {
    JSON: { parse: JSON.parse, stringify: JSON.stringify },
    Math: Math,
    Date: { now: Date.now },
    console: { log: (...args: any[]) => logs.push(args) },
  };
  
  for (const [key, value] of Object.entries(allowedAPIs)) {
    await jail.set(key, new ivm.ExternalCopy(value).copyInto());
  }
  
  // 注入上下文数据
  await jail.set('input', new ivm.ExternalCopy(context).copyInto());
  
  // 执行（超时5秒）
  const script = await isolate.compileScript(code);
  const result = await script.run(vmContext, { timeout: 5000 });
  
  isolate.dispose();
  return result;
}
```

**脚本可访问的API白名单：**

| 允许 | 禁止 |
| --- | --- |
| JSON.parse / JSON.stringify | require / import |
| Math.所有方法 | fs / path / child_process |
| Date.now() | process / os |
| console.log（记录日志） | 网络请求（fetch/http ） |
| 基础数据类型操作 | 文件系统访问 |
| input上下文数据 | eval / Function构造器 |

### 8B.2 API Key权限粒度

每个项目的API Key支持细粒度权限控制：

```sql
-- API Key权限表
CREATE TABLE ai_api_key_permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  api_key_id INT NOT NULL,
  permission ENUM(
    'skill:read',      -- 查看Skill列表和Schema
    'skill:execute',   -- 执行Skill
    'skill:manage',    -- 创建/编辑/删除Skill
    'agent:read',      -- 查看Agent列表
    'agent:execute',   -- 运行Agent
    'agent:manage',    -- 创建/编辑Agent
    'mcp:read',        -- 查看MCP工具
    'mcp:execute',     -- 调用MCP
    'mcp:manage',      -- 管理MCP
    'knowledge:read',  -- 检索知识库
    'knowledge:manage',-- 管理知识库
    'usage:read',      -- 查看用量统计
    'admin:all'        -- 超级管理员
  ) NOT NULL,
  FOREIGN KEY (api_key_id) REFERENCES ai_api_keys(id)
);
```

| 角色 | 典型权限组合 | 使用场景 |
| --- | --- | --- |
| 只读调用方 | skill:read + skill:execute + agent:execute | 业务系统后端调用 |
| 运营管理员 | skill:* + agent:* + knowledge:read + usage:read | 运营团队自助管理 |
| 开发者 | 全部权限 | 平台开发和维护 |

### 8B.3 敏感数据加密存储

所有敏感信息（API密钥、数据库连接串、OAuth凭据）采用AES-256-GCM加密存储：

```typescript
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; // 32字节密钥

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  const [ivHex, authTagHex, encrypted] = ciphertext.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

### 8B.4 审计日志

所有管理操作记录完整审计轨迹：

```sql
CREATE TABLE ai_audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL,
  action VARCHAR(50) NOT NULL,          -- create_skill / update_skill / delete_agent / ...
  resource_type VARCHAR(30) NOT NULL,   -- skill / agent / mcp / model / project
  resource_id INT,
  resource_slug VARCHAR(100),
  changes JSON,                         -- { before: {...}, after: {...} }
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at BIGINT NOT NULL,
  INDEX idx_user (user_id),
  INDEX idx_resource (resource_type, resource_id),
  INDEX idx_time (created_at)
);
```

审计日志记录的操作类型：

| 资源类型 | 记录的操作 |
| --- | --- |
| Skill | 创建、编辑Prompt、发布版本、回滚、删除、修改权限 |
| Agent | 创建、编辑工作流、发布、删除 |
| MCP | 注册、修改配置、禁用、删除 |
| Model | 注册、修改路由、修改预算、禁用 |
| Project | 创建、修改配置、生成/撤销API Key |
| Knowledge | 添加条目、删除条目、修改配置 |

### 8B.5 MCP健康检查与主动告警

```typescript
// MCP健康检查定时任务（每5分钟执行）
async function mcpHealthCheck() {
  const mcpTools = await getAllActiveMCPs();
  
  for (const mcp of mcpTools) {
    try {
      const start = Date.now();
      await callMCPHealthEndpoint(mcp);
      const latency = Date.now() - start;
      
      // 更新健康状态
      await updateMCPHealth(mcp.id, { status: 'healthy', latency, checkedAt: Date.now() });
      
      // 重置失败计数器
      await redis.del(`mcp:fail_count:${mcp.id}`);
    } catch (err) {
      // 累计失败次数
      const failCount = await redis.incr(`mcp:fail_count:${mcp.id}`);
      await updateMCPHealth(mcp.id, { status: failCount >= 3 ? 'unhealthy' : 'degraded', error: err.message });
      
      // 连续失败3次，触发告警
      if (failCount === 3) {
        await sendAlert({
          type: 'mcp_unhealthy',
          title: `MCP工具不可用: ${mcp.name}`,
          message: `${mcp.name} 已连续${failCount}次健康检查失败，已自动降级。`,
          channels: ['notification', 'email'], // 站内通知 + 邮件
        });
      }
      
      // 连续失败5次，自动禁用
      if (failCount >= 5) {
        await disableMCP(mcp.id, 'auto_disabled_unhealthy');
      }
    }
  }
}

// 自动降级策略：MCP不可用时Agent的处理
async function handleMCPUnavailable(agentRunId: number, mcpSlug: string, nodeConfig: any) {
  const strategy = nodeConfig.fallbackStrategy || 'skip'; // skip | cache | fail
  
  switch (strategy) {
    case 'skip':
      // 跳过该节点，继续执行
      return { skipped: true, reason: 'MCP unavailable' };
    case 'cache':
      // 使用上次成功的缓存数据
      const cached = await redis.get(`mcp:cache:${mcpSlug}:${JSON.stringify(nodeConfig.params)}`);
      if (cached) return JSON.parse(cached);
      return { skipped: true, reason: 'MCP unavailable, no cache' };
    case 'fail':
      // 终止Agent执行
      throw new Error(`Required MCP ${mcpSlug} is unavailable`);
  }
}
```

---

## 九、监控与分析仪表盘

### 9.1 监控指标体系

| 维度 | 指标 | 可视化 | 数据来源 |
| --- | --- | --- | --- |
| **调用量** | 总调用次数（按天/项目/Skill） | 折线图 | ai_skill_calls |
| **Token消耗** | 按Skill/模型/项目分组 | 堆叠柱状图 | ai_skill_calls |
| **成本** | 总费用 + 按模型/项目分布 | 数字卡片+饼图 | ai_llm_usage_daily |
| **质量** | 采纳率（用户接受AI输出的比例） | 趋势线+排行榜 | ai_skill_calls |
| **性能** | 各Skill/MCP的平均延迟 | 热力图 | ai_skill_calls |
| **可用性** | MCP健康状态 + 错误率 | 状态卡片 | ai_mcp_calls |
| **效率** | Agent完成率 + 平均步骤数 | 漏斗图 | ai_agent_runs |
| **项目对比** | 各项目的调用量/成本/质量对比 | 多维对比图 | 按project_id聚合 |

### 9.2 仪表盘界面

```
┌─────────────────────────────────────────────────────────────────┐
│  📊 AI能力监控面板                 项目: [全部 ▼]  时间: [本月 ▼]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ 总调用    │  │ Token消耗 │  │ 总费用    │  │ 平均采纳率│        │
│  │ 12,345   │  │ 45.2M    │  │ $67.8    │  │ 78.5%    │        │
│  │ ↑12%     │  │ ↑8%      │  │ ↑5%      │  │ ↑3.2%    │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
│                                                                   │
│  ┌─ 调用趋势 (30天) ──────────────────────────────────────────┐  │
│  │  ▁▂▃▄▅▆▇█▇▆▅▄▃▂▁▂▃▄▅▆▇█▇▆▅▄▃▂▁                          │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─ Top 10 Skill (按调用量) ─────┐  ┌─ 模型用量分布 ──────────┐  │
│  │  1. 标题生成      2,345次      │  │  GPT-4o    ████████ 60% │  │
│  │  2. 五点生成      1,987次      │  │  DeepSeek  ████░░░░ 25% │  │
│  │  3. 关键词分级    1,234次      │  │  Claude    ██░░░░░░ 15% │  │
│  └────────────────────────────────┘  └──────────────────────────┘  │
│                                                                   │
│  ┌─ 项目调用分布 ────────────────┐  ┌─ MCP健康状态 ────────────┐  │
│  │  亚马逊运营工具   65%  $44    │  │  🟢 LLM API    2.1s     │  │
│  │  产品开发工具     20%  $14    │  │  🟢 S3存储     0.3s     │  │
│  │  Listing工具     15%  $10    │  │  🟡 爬虫服务   5.2s     │  │
│  └────────────────────────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 九-B、部署架构与基础设施

### 9B.1 部署拓扑图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        互联网 (Public)                              │
│                                                                     │
│   用户浏览器 ───→ CDN (Cloudflare/Vercel Edge)                    │
│       │                   │                                          │
│       │         ┌───────┴───────┐                                │
│       │         │ Nginx/Caddy   │  ← SSL终止 + 反向代理           │
│       │         │ :443 (HTTPS)  │                                    │
│       │         └──────┬────────┘                                    │
└─────────────────┴───────────────────────────────────────────────────┘
                    │
┌─────────────────┴───────────────────────────────────────────────────┐
│                VPC / 内网 (Private Network)                          │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                   应用服务器 (Node.js)                            │  │
│  │                                                                 │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │  │
│  │  │ REST API     │  │ WebSocket    │  │ 任务队列     │     │  │
│  │  │ Server       │  │ Server       │  │ Worker       │     │  │
│  │  │ :3000        │  │ :3001        │  │ (BullMQ)     │     │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘     │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                      数据层                                       │  │
│  │                                                                 │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │  │
│  │  │ MySQL/TiDB   │  │ Redis        │  │ S3           │     │  │
│  │  │ (主数据库)   │  │ (缓存+队列) │  │ (文件存储)   │     │  │
│  │  │ :3306        │  │ :6379        │  │              │     │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘     │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                   业务系统连接                                  │  │
│  │                                                                 │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │  │
│  │  │ 亚马逊工具   │  │ 产品开发工具 │  │ 未来项目X   │     │  │
│  │  │ (Project A)  │  │ (Project B)  │  │ (Project N)  │     │  │
│  │  │ 同VPC内网    │  │ 同VPC内网    │  │ 公网API     │     │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘     │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 9B.2 基础设施需求

| 组件 | 规格 | 用途 | 是否必须 |
| --- | --- | --- | --- |
| **应用服务器** | 2C4G起步，可水平扩展 | REST API + WebSocket + Worker | 必须 |
| **MySQL/TiDB** | 独立实例，不与业务系统共享 | 平台核心数据存储 | 必须 |
| **Redis** | 1G内存起步 | 任务队列(BullMQ) + 会话缓存 + 限流计数器 + Agent状态缓存 | 必须 |
| **S3存储** | 复用现有存储桶 | 知识库文件、日志归档 | 必须 |
| **CDN** | Cloudflare/Vercel Edge | 前端静态资源加速 | 推荐 |
| **向量数据库** | pgvector扩展 或 Pinecone | 知识库语义检索（Phase 5引入） | Phase 5 |

### 9B.3 域名规划

| 域名 | 用途 | 说明 |
| --- | --- | --- |
| `ai-platform.your-domain.com` | 管理后台前端 | 管理员操作界面 |
| `ai-api.your-domain.com` | REST API服务 | 业务系统调用入口 |
| `ai-ws.your-domain.com` | WebSocket服务 | 实时推送 |
| `ai-embed.your-domain.com` | 嵌入式组件 | iframe嵌入用 |

### 9B.4 网络拓扑与安全

业务系统与AI平台的网络连接方式：

| 场景 | 网络方式 | 延迟 | 安全性 |
| --- | --- | --- | --- |
| 同VPC内业务系统 | 内网直连（私有IP） | <5ms | 最高（不经过公网） |
| 跨VPC业务系统 | VPC Peering / PrivateLink | <10ms | 高（不经过公网） |
| 外部业务系统 | 公网HTTPS + API Key | <50ms | 中（TLS加密） |
| 管理后台访问 | 公网HTTPS + OAuth | 变动 | 中（可加IP白名单） |

### 9B.5 部署方案选择

| 方案 | 适用场景 | 优势 | 劣势 |
| --- | --- | --- | --- |
| **Manus WebDev** | 快速验证、小团队 | 零运维、内置域名 | 定制化受限 |
| **云服务器自建** | 生产环境、大团队 | 完全可控、可扩展 | 需要运维 |
| **Docker Compose** | 开发/测试环境 | 一键启动、环境一致 | 不适合生产 |
| **Kubernetes** | 大规模生产 | 自动扩缩容、高可用 | 复杂度高 |

**推荐路径：** Phase 1-3使用Manus WebDev快速验证 → Phase 4-5迁移到云服务器（Docker Compose） → 用户量增长后升级Kubernetes。

---

## 十、管理平台导航结构

平台作为独立站点，拥有自己的完整导航：

```
┌─────────────────────────────────────────────────────────────────┐
│  🧠 AI能力管理平台                              [用户名] [设置]   │
├────────────┬────────────────────────────────────────────────────┤
│            │                                                    │
│  📊 总览    │  (当前页面内容区)                                   │
│            │                                                    │
│  🤖 大模型  │                                                    │
│  ├ 模型列表 │                                                    │
│  ├ 路由策略 │                                                    │
│  └ 预算控制 │                                                    │
│            │                                                    │
│  🔧 工具    │                                                    │
│  ├ 工具列表 │                                                    │
│  ├ 接入新工具│                                                    │
│  └ 健康监控 │                                                    │
│            │                                                    │
│  🎯 技能    │                                                    │
│  ├ 技能列表 │                                                    │
│  ├ 创建技能 │                                                    │
│  ├ 版本历史 │                                                    │
│  └ 测试沙盒 │                                                    │
│            │                                                    │
│  🔗 智能体  │                                                    │
│  ├ Agent列表│                                                    │
│  ├ 可视化编排│                                                    │
│  └ 执行日志 │                                                    │
│            │                                                    │
│  📚 知识库  │                                                    │
│  ├ 业务知识库│                                                    │
│  ├ 平台知识库│                                                    │
│  └ 自动学习 │                                                    │
│            │                                                    │
│  📈 监控    │                                                    │
│  ├ 总览面板 │                                                    │
│  ├ 成本分析 │                                                    │
│  └ 效果对比 │                                                    │
│            │                                                    │
│  ⚙️ 设置   │                                                    │
│  ├ 项目管理 │                                                    │
│  ├ API密钥  │                                                    │
│  └ 权限控制 │                                                    │
│            │                                                    │
└────────────┴────────────────────────────────────────────────────┘
```

---

## 十-B、版本管理粒度

### 10B.1 版本引用策略

Agent引用Skill时支持两种版本策略：

| 策略 | 行为 | 适用场景 | 配置方式 |
| --- | --- | --- | --- |
| `latest` | 始终使用Skill最新版本 | 开发/测试环境，希望自动获取优化 | 默认 |
| `pinned:N` | 锁定到指定版本号N | 生产环境，需要稳定性 | 在Agent节点配置中指定 |

```typescript
// Agent节点中的Skill版本引用
interface SkillNodeConfig {
  skillSlug: string;
  versionStrategy: 'latest' | `pinned:${number}`; // 默认latest
  inputMapping: Record<string, string>;
}

// 解析实际使用的版本
async function resolveSkillVersion(slug: string, strategy: string): Promise<number> {
  if (strategy === 'latest') {
    const skill = await getSkillBySlug(slug);
    return skill.version; // 当前最新版本
  }
  const pinnedVersion = parseInt(strategy.split(':')[1]);
  return pinnedVersion;
}
```

### 10B.2 灰度发布

Skill新版本发布支持灰度策略，逐步扩大新版本的流量比例：

```sql
-- Skill灰度发布配置
ALTER TABLE ai_skills ADD COLUMN canary_config JSON;
-- 结构: {
--   enabled: boolean,
--   newVersion: number,
--   trafficPercent: number,     // 0-100，新版本流量比例
--   targetProjects: number[],  // 指定项目灰度（可选）
--   startedAt: bigint,
--   metrics: { oldAcceptRate: number, newAcceptRate: number }
-- }
```

| 灰度阶段 | 流量比例 | 持续时间 | 决策条件 |
| --- | --- | --- | --- |
| 初始 | 10% | 1天 | 新版采纳率 ≥ 旧版-5% |
| 扩大 | 50% | 2天 | 新版采纳率 ≥ 旧版 |
| 全量 | 100% | 永久 | 手动确认或自动 |
| 回滚 | 0% | 立即 | 新版采纳率 < 旧版-10% |

### 10B.3 回滚影响范围分析

回滚Skill版本时，系统自动分析影响范围：

```typescript
async function analyzeRollbackImpact(skillSlug: string, fromVersion: number, toVersion: number) {
  // 1. 查找引用该Skill的所有Agent
  const affectedAgents = await findAgentsUsingSkill(skillSlug);
  
  // 2. 区分latest vs pinned
  const latestAgents = affectedAgents.filter(a => a.versionStrategy === 'latest');
  const pinnedAgents = affectedAgents.filter(a => a.versionStrategy.startsWith('pinned:'));
  
  // 3. 检查正在运行的Agent
  const runningRuns = await findRunningAgentRuns(affectedAgents.map(a => a.id));
  
  return {
    affectedAgents: latestAgents.length,  // 使用latest的Agent会立即受影响
    pinnedAgents: pinnedAgents.length,     // 使用pinned的Agent不受影响
    runningRuns: runningRuns.length,       // 正在运行的不会中断（已加载旧版Prompt）
    recommendation: runningRuns.length > 0 
      ? '建议等待运行中的Agent完成后再回滚' 
      : '可以安全回滚',
  };
}
```

---

## 十-C、数据迁移方案

### 10C.1 迁移脚本设计

从现有代码中自动提取87个Prompt并转化为平台Skill的迁移脚本：

```typescript
// scripts/migrate-prompts.ts

// Step 1: 自动扫描代码中的Prompt常量
import { parse } from '@typescript-eslint/parser';

async function extractPromptsFromCode(filePath: string): Promise<PromptDefinition[]> {
  const source = await fs.readFile(filePath, 'utf-8');
  const ast = parse(source, { jsx: true, loc: true });
  
  const prompts: PromptDefinition[] = [];
  
  // 遍历AST查找导出的字符串常量（包含“你是”、"You are"等Prompt特征）
  visit(ast, {
    ExportNamedDeclaration(node) {
      if (isPromptConstant(node)) {
        prompts.push(extractPromptInfo(node));
      }
    }
  });
  
  return prompts;
}

// Step 2: 扫描 invokeLLM 调用点，提取参数映射
async function extractInvokeLLMCalls(filePath: string): Promise<LLMCallSite[]> {
  // 查找所有 invokeLLM({ messages: [...] }) 调用
  // 提取 system prompt、user prompt template、response_format、temperature 等参数
  // 识别动态插值变量（如 ${keywords}）并转换为 {{keywords}} 模板语法
}

// Step 3: 生成Skill定义
function generateSkillDefinition(prompt: PromptDefinition, callSite: LLMCallSite): SkillMigration {
  return {
    slug: generateSlug(prompt.name),
    name: prompt.name,
    category: inferCategory(prompt.filePath),
    systemPrompt: prompt.systemPrompt,
    userPromptTemplate: convertToHandlebars(callSite.userPromptTemplate),
    inputSchema: inferInputSchema(callSite.dynamicVariables),
    outputSchema: callSite.responseFormat || null,
    temperature: callSite.temperature || 0.7,
    maxTokens: callSite.maxTokens || 4096,
  };
}
```

### 10C.2 动态Prompt处理

现有代码中存在三种动态Prompt模式，需分别处理：

| 模式 | 示例 | 迁移策略 |
| --- | --- | --- |
| 模板字符串 | ``分析${keywords}的竞争情况`` | 直接转换为 `分析{{keywords}}的竞争情况` |
| 条件拼接 | `if (hasReviews) prompt += reviewSection` | 拆分为两个Skill版本，或使用条件模板语法 |
| 循环拼接 | `competitors.map(c => ...).join('\n')` | 转换为Handlebars `{{#each competitors}}` |

### 10C.3 迁移验证策略

确保迁移后的Skill输出与原始代码一致：

```typescript
// scripts/validate-migration.ts

async function validateMigration(skillSlug: string, testCases: TestCase[]) {
  const results: ValidationResult[] = [];
  
  for (const testCase of testCases) {
    // 旧方式：直接调用本地invokeLLM
    const oldResult = await localInvokeLLM(testCase.prompt, testCase.input);
    
    // 新方式：通过平台Skill执行
    const newResult = await platformSkillRun(skillSlug, testCase.input);
    
    // 对比输出（不要求完全一致，但结构和关键字段应匹配）
    const similarity = compareOutputs(oldResult, newResult);
    results.push({
      testCase: testCase.name,
      similarity,
      pass: similarity > 0.85, // 85%相似度阈值
      oldOutput: oldResult,
      newOutput: newResult,
    });
  }
  
  return results;
}
```

### 10C.4 回滚方案

迁移失败时的回滚策略：

| 场景 | 回滚操作 | 影响 |
| --- | --- | --- |
| 单个Skill迁移失败 | 删除平台Skill，保留本地代码 | 无影响（兼容层自动回退） |
| 批量迁移后效果下降 | 平台Skill设为inactive，兼容层回退到本地 | 无感知 |
| 平台服务不可用 | 兼容层自动降级到本地invokeLLM | 无感知 |

---

## 十-D、前端技术选型

### 10D.1 技术栈选择

沿用现有业务系统技术栈，降低学习成本和维护负担：

| 层面 | 技术选择 | 理由 |
| --- | --- | --- |
| 框架 | React 19 + TypeScript | 与现有项目一致，团队熟悉 |
| 构建 | Vite 6 | 开发体验极佳，与现有项目一致 |
| 样式 | Tailwind CSS 4 + shadcn/ui | 与现有项目一致，组件库丰富 |
| 状态管理 | Zustand + React Query (tRPC) | 轻量级，适合Agent编排器复杂状态 |
| 可视化编排 | React Flow v12 | Agent工作流DAG可视化编排 |
| 代码编辑器 | Monaco Editor | Prompt编辑+变量高亮+自动补全 |
| 图表 | Recharts | 监控仪表盘数据可视化 |
| 路由 | Wouter | 轻量级路由，与现有项目一致 |

### 10D.2 Agent编排器状态管理

Agent编排器涉及复杂状态（节点、连线、选中状态、配置面板、撤销/重做），采用Zustand管理：

```typescript
// stores/agentEditorStore.ts
import { create } from 'zustand';
import { temporal } from 'zundo'; // 撤销/重做支持

interface AgentEditorState {
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  configPanelOpen: boolean;
  isDirty: boolean;
  
  // Actions
  addNode: (type: string, position: XYPosition) => void;
  removeNode: (id: string) => void;
  updateNodeConfig: (id: string, config: any) => void;
  addEdge: (source: string, target: string) => void;
  removeEdge: (id: string) => void;
  selectNode: (id: string | null) => void;
  saveWorkflow: () => Promise<void>;
  loadWorkflow: (agentSlug: string) => Promise<void>;
}

export const useAgentEditorStore = create<AgentEditorState>()(
  temporal(
    (set, get) => ({
      // ... implementation with undo/redo support
    }),
    { limit: 50 } // 保留最近50步撤销历史
  )
);
```

### 10D.3 Monaco Editor配置

Prompt编辑器基于Monaco，提供变量高亮和自动补全：

| 功能 | 实现方式 |
| --- | --- |
| `{{variable}}` 变量高亮 | 自定义Monarch语法规则 |
| 变量自动补全 | 根据inputSchema动态注册补全项 |
| 实时预览 | 右侧面板渲染模板替换后的效果 |
| 语法检查 | 检查未定义的变量引用 |
| 多语言支持 | 支持Markdown、JSON、Handlebars混合语法 |

---

## 十一、现有系统渐进式迁移策略

### 11.1 迁移原则

平台开发完成后，现有业务系统**不需要重新开发**，通过渐进式替换即可接入：

| 改动类型 | 工作量 | 说明 |
| --- | --- | --- |
| 替换调用方式 | 中等 | 把`invokeLLM()`改为SDK调用`ai.skill.run()` |
| 删除硬编码Prompt | 小 | 迁移到平台后，删除代码中的常量 |
| 嵌入Agent按钮 | 小 | 在关键页面加`<AgentTriggerButton>` |
| 前台UI | 无需改动 | 现有页面保持不变 |
| 业务逻辑 | 无需改动 | 数据流、表单、展示不变 |

### 11.2 兼容层设计

```typescript
// 业务系统中的兼容层：优先调用平台，平台不可用时回退到本地
import { AIPlatform } from "@your-org/ai-platform-sdk";

const ai = new AIPlatform({ apiUrl: "...", apiKey: "..." });

export async function resolveSkillPrompt(
  skillSlug: string,
  fallbackPrompt: string,
  input: Record<string, any>
): Promise<string> {
  try {
    // 优先通过平台执行
    const result = await ai.skill.run(skillSlug, input);
    return result.output;
  } catch (err) {
    // 平台不可用时回退到本地Prompt
    console.warn(`Platform unavailable, using fallback for ${skillSlug}`);
    return await localInvokeLLM(fallbackPrompt, input);
  }
}
```

### 11.3 迁移时间线

```
Phase 1: 平台开发完成，现有系统完全不动（并行运行）
  ↓
Phase 2: 注册项目 + 批量导入87个Prompt到平台（脚本自动完成，1天）
  ↓
Phase 3: 逐模块替换调用方式（兼容层保证新旧共存）
  - 第1周: Listing模块（14个Skill）
  - 第2周: 关键词+广告模块（18个Skill）
  - 第3周: 图片+视频模块（20个Skill）
  - 第4周: 其余模块
  ↓
Phase 4: 验证无误后，删除旧代码中的Prompt常量
```

### 11.4 用户感知对比

| 角度 | 迁移前 | 迁移后 | 用户感知 |
| --- | --- | --- | --- |
| 前台界面 | 不变 | 不变 | **无感** |
| AI输出质量 | 不变 | 不变（同样的Prompt） | **无感** |
| 响应速度 | 直接调用LLM | 多一次网络请求（<50ms） | **基本无感** |
| 新增能力 | 需要开发 | 管理后台配置 | **体验提升** |
| 优化Prompt | 需要开发 | 管理后台编辑 | **体验提升** |
| 切换模型 | 需要开发 | 管理后台选择 | **体验提升** |
| 编排工作流 | 不可能 | 拖拽组合 | **全新能力** |

---

## 十二、权限控制

| 角色 | LLM管理 | MCP管理 | Skill管理 | Agent管理 | 监控 |
| --- | --- | --- | --- | --- | --- |
| 超级管理员 | 全部操作 | 全部操作 | 全部操作 | 全部操作 | 全部 |
| 项目管理员 | 查看+本项目配额 | 本项目工具 | 本项目Skill | 本项目Agent | 本项目 |
| 运营主管 | 查看+测试 | 查看 | 编辑Prompt+测试 | 查看+运行 | 查看 |
| 普通运营 | 无 | 无 | 查看 | 运行 | 无 |
| API调用方 | 无 | 无 | 执行 | 执行 | 无 |

---

## 十三、实施计划

### 13.1 分阶段排期（优化后）

| 阶段 | 内容 | 工期 | 交付物 |
| --- | --- | --- | --- |
| **Phase 1.1** | 独立项目初始化+数据库表设计 | 1天 | 项目骨架+10张核心表（含审计日志+权限表） |
| **Phase 1.2** | 多项目管理+API认证+安全基础 | 2天 | 项目注册+API Key权限+加密存储+审计日志 |
| **Phase 1.3** | LLM路由引擎+模型管理API | 2天 | 模型CRUD+路由+降级+Rate Limit |
| **Phase 1.4** | LLM管理前端页面 | 2天 | 模型列表+注册+预算 |
| **Phase 1.5** | Phase 1集成测试 | 1天 | 端到端测试+修复 |
| **Phase 2.1** | MCP引擎+管理API+健康检查 | 2天 | MCP CRUD+统一调用+健康监控+告警 |
| **Phase 2.2** | MCP管理前端+自助接入+沙箱 | 2天 | 工具列表+注册表单+测试+脚本沙箱 |
| **Phase 2.3** | Phase 2集成测试 | 1天 | 端到端测试+修复 |
| **Phase 3.1** | Skill引擎+管理API+版本控制 | 2天 | Skill CRUD+执行+版本+灰度发布 |
| **Phase 3.2** | Skill管理前端+Monaco编辑器 | 3天 | 列表+编辑器+测试沙盒+知识库关联 |
| **Phase 3.3** | 现有87个Prompt批量迁移 | 2天 | 迁移脚本+自动提取+新旧对比验证 |
| **Phase 3.4** | Phase 3集成测试 | 1天 | 端到端测试+修复 |
| **Phase 4.1** | Agent执行引擎+并发队列 | 3天 | DAG执行+BullMQ队列+暂停恢复+超时控制 |
| **Phase 4.2** | Agent可视化编排器 | 6天 | React Flow画布+9种节点+连线验证+表单配置面板 |
| **Phase 4.3** | 通用Agent运行器+嵌入式组件+SDK | 2天 | 自动表单+SDK发布+文档 |
| **Phase 4.4** | Phase 4集成测试 | 1天 | 端到端测试+修复 |
| **Phase 5.1** | 知识库联动（双层）+向量检索 | 4天 | 业务KB连接+平台KB+pgvector语义检索+自动学习审核流 |
| **Phase 5.2** | 监控仪表盘 | 2天 | 总览+成本+效果+项目对比 |
| **Phase 5.3** | 现有系统迁移对接 | 2天 | SDK集成+兼容层+渐进式替换 |
| **Phase 5.4** | Phase 5集成测试+全平台联调 | 1天 | 全链路测试+修复 |

**总计：约37个工作日（7-8周）**

> 调整说明（相比v3.0的变化）：- Phase 1.2从1天→ 2天：新增安全基础（加密存储+审计日志+权限表）- Phase 3.3从1天→ 2天：迁移脚本需处理动态Prompt拼接和新旧对比验证- Phase 4.2从4天→ 6天：React Flow自定义节点开发(9种)+连线验证+表单配置复杂度高- Phase 5.1从2天→ 4天：包含向量检索(pgvector)和自动学习审核流- 每Phase末尾新增1天集成测试（共5天）

### 13.2 建议实施顺序

```
Week 1-2:  Phase 1 (项目初始化 + LLM管理 + 安全基础) — 最基础
Week 2-3:  Phase 2 (MCP管理 + 健康监控) — Skill调用MCP需要它
Week 3-4:  Phase 3 (Skill管理 + 批量迁移) — 核心价值
Week 5-6:  Phase 4 (Agent编排 + 并发队列) — 最复杂
Week 7-8:  Phase 5 (知识库 + 监控 + 迁移 + 联调) — 收尾
```

### 13.3 即时价值节点

| 里程碑 | 完成时间 | 立即可用的能力 |
| --- | --- | --- |
| Phase 1完成 | 第2周末 | 注册多个模型，按场景切换，成本可控，安全基础就绪 |
| Phase 3完成 | 第4周末 | **Prompt自主编辑**，无需开发即可优化AI质量，87个Skill已迁移 |
| Phase 4完成 | 第6周末 | 拖拽编排新工作流，灵活组合AI能力，并发控制完善 |
| Phase 5完成 | 第8周末 | 知识库联动，全局监控，业务系统对接完成，全平台联调通过 |

---

## 十四、技术风险与应对

| 风险 | 影响 | 应对策略 |
| --- | --- | --- |
| Prompt迁移后效果变化 | AI输出质量下降 | 渐进式迁移+A/B对比+一键回滚 |
| 多模型API格式不统一 | 调用失败 | 适配层统一转换+完善错误处理 |
| 平台API延迟 | 业务系统变慢 | 本地缓存配置+降级到本地Prompt |
| 执行引擎性能 | Agent运行变慢 | 并行节点+超时控制+缓存 |
| 工作流复杂度 | 难以调试 | 完整执行链路追踪+单步调试模式 |
| 自定义脚本安全 | 恶意代码 | 沙盒执行+超时限制+权限隔离 |
| 跨项目数据隔离 | 数据泄露 | 严格project_id过滤+API Key认证 |
| 日志数据量 | 数据库膨胀 | 分级存储+30天归档+压缩 |

---

## 十五、总结

本方案设计了一个**独立部署的通用AI能力管理平台**，核心特点：

| 特性 | 说明 |
| --- | --- |
| **独立部署** | 作为独立站点运行，不依赖任何业务系统 |
| **多项目支持** | 统一服务所有业务系统，支持全局/私有/共享三种作用域 |
| **四层架构** | LLM → MCP → Skill → Agent，层层递进 |
| **即插即用** | 新增模型/工具/技能/Agent，零开发即时上线 |
| **知识库联动** | 双层架构：业务知识注入AI上下文 + 平台知识辅助优化 |
| **自动学习** | 从调用数据中自动积累最佳实践和错误模式 |
| **渐进迁移** | 现有系统无需重写，兼容层保证平滑过渡 |

**核心设计原则：**

- 新增一个LLM → 所有Skill立即可选用

- 新增一个MCP → 所有Agent立即可调用

- 新增一个Skill → 所有Agent立即可编排，所有项目可共享

- 修改一个Prompt → 所有引用它的流程自动升级

- 接入一个新项目 → 立即可使用平台所有全局能力

**最终效果：** 系统的AI能力从"开发驱动"转变为"配置驱动"，运营团队可以自主扩展和优化系统智能，开发团队只需维护平台基础设施。任何新业务系统只需通过API/SDK接入，即可获得完整的AI能力支持。

---

## 附录：v4.0优化项完成清单

下表总结了本版本相比v3.0新增的所有内容，对应审查报告中的8个待补充点和5个优化点：

### 待补充点完成情况

| 序号 | 待补充项 | 对应章节 | 状态 |
| --- | --- | --- | --- |
| 1 | SDK/API接口规范（REST路由、类型定义、错误码、限流） | 二-B章 (2B.1-2B.5) | ✅ 已完成 |
| 2 | 安全性设计（沙箱、权限、加密、审计、MCP健康检查） | 八-B章 (8B.1-8B.5) | ✅ 已完成 |
| 3 | 并发控制与任务队列（BullMQ、多层限制、优先级、超时） | 七-B章 (7B.1-7B.4) | ✅ 已完成 |
| 4 | 部署架构图（拓扑、基础设施、域名、网络安全） | 九-B章 (9B.1-9B.5) | ✅ 已完成 |
| 5 | 版本管理粒度（引用策略、灰度发布、回滚影响分析） | 十-B章 (10B.1-10B.3) | ✅ 已完成 |
| 6 | 数据迁移方案（迁移脚本、动态Prompt、验证、回滚） | 十-C章 (10C.1-10C.4) | ✅ 已完成 |
| 7 | Agent暂停/恢复细节（状态持久化、超时、上下文重建、通知） | 七-C章 (7C.1-7C.5) | ✅ 已完成 |
| 8 | 前端技术选型（技术栈、状态管理、Monaco配置） | 十-D章 (10D.1-10D.3) | ✅ 已完成 |

### 优化点完成情况

| 序号 | 优化项 | 对应章节 | 状态 |
| --- | --- | --- | --- |
| 1 | 工期调整（Phase 4.2从4天→6天） | 十三章 13.1 | ✅ 已调整 |
| 2 | 迁移工期调整（Phase 3.3从1天→2天） | 十三章 13.1 | ✅ 已调整 |
| 3 | 自动学习机制增加人工审核环节 | 八章 8.4 | ✅ 已优化 |
| 4 | 每Phase末尾新增集成测试日（共5天） | 十三章 13.1 | ✅ 已增加 |
| 5 | 总工期从31天调整为37天（7-8周） | 十三章 13.1 | ✅ 已调整 |

---

> 本文档为「通用AI能力管理平台」的完整技术方案（v4.0优化版），涵盖了从架构设计到实施计划的全部内容。建议先完成Phase 1-3（约16天）达到可用状态，再按需推进后续阶段。本版本已完整融合审查报告中的所有补充和优化建议。

