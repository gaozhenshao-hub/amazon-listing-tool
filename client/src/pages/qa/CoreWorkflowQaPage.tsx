import { WorkflowStepProgress } from "@/components/workflow/WorkflowStepProgress";
import type { WorkflowCheckpointLike, WorkflowStepDefinition } from "@/components/workflow/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Check, LockKeyhole, Pencil, RefreshCw, Save } from "lucide-react";
import { useMemo, useState } from "react";

type WorkflowFixture = {
  title: string;
  initialOutput: string;
  agentSlug: string;
  agentNodeId: string;
  steps: WorkflowStepDefinition[];
};

const FIXTURES: Record<string, WorkflowFixture> = {
  listing: {
    title: "Listing 核心工作流",
    initialOutput: "围绕核心关键词生成的 Listing 标题草稿",
    agentSlug: "listing.full.workflow",
    agentNodeId: "G2",
    steps: [
      { id: "selling-points", label: "卖点精雕", description: "AI 生成卖点并等待人工确认" },
      { id: "title", label: "标题生成", description: "使用已确认卖点生成标题" },
      { id: "description", label: "产品描述", description: "生成描述与 A+ 内容" },
    ],
  },
  image: {
    title: "图片核心工作流",
    initialOutput: "主图突出产品结构，第二张图展示核心利益点",
    agentSlug: "image.workflow",
    agentNodeId: "step4_skill",
    steps: [
      { id: "selling-points", label: "卖点梳理", description: "确认图片表达重点" },
      { id: "outline", label: "图片大纲", description: "确定模块和轮播图片数量" },
      { id: "suggestions", label: "图片建议", description: "生成最终构图建议" },
    ],
  },
  ads: {
    title: "广告核心工作流",
    initialOutput: "自动广告采词，手动精准广告承接高转化词",
    agentSlug: "ads.search-term.workflow",
    agentNodeId: "search_term_advice",
    steps: [
      { id: "analysis", label: "广告分析", description: "读取关键词和投放数据" },
      { id: "strategy", label: "策略生成", description: "生成预算与竞价策略" },
      { id: "review", label: "人工复核", description: "确认后进入执行计划" },
    ],
  },
  "product-development": {
    title: "产品开发核心工作流",
    initialOutput: "综合市场容量、差异化机会和供应链风险的分析结论",
    agentSlug: "product-development.analysis.workflow",
    agentNodeId: "market_overview",
    steps: [
      { id: "analysis", label: "市场分析", description: "生成市场与竞品洞察" },
      { id: "score", label: "机会评分", description: "人工校准评分与结论" },
      { id: "report", label: "开发报告", description: "输出 BOM、利润与测试报告" },
    ],
  },
  operations: {
    title: "运营核心工作流",
    initialOutput: "结合可售库存、在途数量和销量趋势生成补货计划",
    agentSlug: "ops.replenishment.workflow",
    agentNodeId: "replenishment_plan",
    steps: [
      { id: "inventory", label: "库存分析", description: "读取库存和销量趋势" },
      { id: "replenishment", label: "补货计划", description: "生成补货数量和到货节奏" },
      { id: "review", label: "人工复核", description: "确认后进入运营计划" },
    ],
  },
  video: {
    title: "视频核心工作流",
    initialOutput: "围绕产品核心卖点生成章节、分镜和剪辑脚本",
    agentSlug: "video.script.workflow",
    agentNodeId: "shot_storyboard",
    steps: [
      { id: "sections", label: "章节生成", description: "生成视频章节结构" },
      { id: "shots", label: "分镜生成", description: "生成镜头与画面说明" },
      { id: "script", label: "剪辑脚本", description: "确认最终剪辑脚本" },
    ],
  },
};

function getFixture(): WorkflowFixture {
  const domain = window.location.pathname.split("/").filter(Boolean).at(-1) || "listing";
  return FIXTURES[domain] || FIXTURES.listing;
}

export default function CoreWorkflowQaPage() {
  const fixture = useMemo(getFixture, []);
  const [activeStep, setActiveStep] = useState(fixture.steps[0].id);
  const [output, setOutput] = useState(fixture.initialOutput);
  const [isEditing, setIsEditing] = useState(false);
  const [status, setStatus] = useState<"waiting_human" | "confirmed" | "running">("waiting_human");
  const [version, setVersion] = useState(1);

  const checkpoints: WorkflowCheckpointLike[] = fixture.steps.map((step, index) => ({
    nodeId: String(step.id),
    nodeLabel: step.label,
    status: index === 0 ? status : "locked",
  }));

  const saveEdit = () => {
    setVersion(current => current + 1);
    setIsEditing(false);
    setStatus("waiting_human");
  };

  const confirm = () => {
    setIsEditing(false);
    setStatus("confirmed");
    const currentIndex = fixture.steps.findIndex(step => step.id === activeStep);
    const nextStep = fixture.steps[currentIndex + 1];
    if (nextStep) setActiveStep(nextStep.id);
  };

  const rerun = () => {
    setIsEditing(false);
    setStatus("running");
    window.setTimeout(() => setStatus("waiting_human"), 250);
  };

  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="space-y-2">
          <p className="text-sm font-medium text-primary">Human-in-the-loop workflow contract</p>
          <h1 className="text-3xl font-bold">{fixture.title}</h1>
          <p className="text-sm text-muted-foreground">AI 生成、人工编辑、版本保存、确认锁定和重跑使用同一套交互约束。</p>
          <p className="font-mono text-xs text-muted-foreground" data-testid="agent-binding">
            {fixture.agentSlug} / {fixture.agentNodeId}
          </p>
        </header>

        <WorkflowStepProgress
          steps={fixture.steps}
          activeStepId={activeStep}
          checkpoints={checkpoints}
          onStepClick={setActiveStep}
        />

        <section className="space-y-5 border-t pt-6" aria-label="节点产物确认">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">当前节点产物</h2>
              <p className="text-sm text-muted-foreground">Artifact 版本 v{version}</p>
            </div>
            <span
              className="rounded-md border px-2 py-1 text-sm font-medium"
              data-testid="workflow-status"
            >
              {status === "running" ? "生成中" : status === "confirmed" ? "已确认锁定" : "等待人工确认"}
            </span>
          </div>

          <Textarea
            aria-label="节点产物内容"
            value={output}
            readOnly={!isEditing}
            onChange={event => setOutput(event.target.value)}
            className="min-h-36 resize-y"
          />

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setIsEditing(true)} disabled={status === "running"}>
              <Pencil className="h-4 w-4" />
              解锁编辑
            </Button>
            <Button type="button" variant="outline" onClick={saveEdit} disabled={!isEditing}>
              <Save className="h-4 w-4" />
              保存新版本
            </Button>
            <Button type="button" onClick={confirm} disabled={status === "running" || isEditing}>
              {status === "confirmed" ? <LockKeyhole className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              确认并锁定
            </Button>
            <Button type="button" variant="ghost" onClick={rerun} disabled={status === "running"}>
              <RefreshCw className="h-4 w-4" />
              重新生成
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
