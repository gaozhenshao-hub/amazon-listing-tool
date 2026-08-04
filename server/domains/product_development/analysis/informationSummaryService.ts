import * as devDb from "../../../devDb";
import { invokeLLM } from "../../../_core/llm";
import { DECISION_DASHBOARD_PROMPT, INFORMATION_SUMMARY_PROMPT } from "../../../devAnalysisPrompts";
import {
  registerDevAnalysisArtifact,
  resolveCurrentDevAnalysisArtifact,
} from "../../ai_os/services/businessArtifactRegistry";
import {
  buildInformationSummarySeed,
  mergeInformationSummaryAi,
  validateInformationSummaryForConfirmation,
  type InformationSummaryAi,
} from "./informationSummary";

type ProjectContext = {
  name: string;
  targetMarket?: string | null;
  keywords?: string | null;
  createdAt?: Date | string | null;
};

export async function generateInformationSummary(input: {
  projectId: number;
  userId: number;
  ownerName?: string | null;
  project: ProjectContext;
}) {
  await devDb.upsertDevAnalysisStage({
    projectId: input.projectId,
    userId: input.userId,
    stageType: "information_summary",
    status: "running",
    rawResult: null,
    editedResult: null,
    confirmedAt: null,
  });

  const [products, stages] = await Promise.all([
    devDb.getDevProductsByProject(input.projectId),
    devDb.getDevAnalysisStages(input.projectId),
  ]);
  const seed = buildInformationSummarySeed({
    project: input.project,
    products,
    stages,
    ownerName: input.ownerName,
  });
  const emperorContext = JSON.stringify({
    project: {
      name: input.project.name,
      targetMarket: input.project.targetMarket,
      keywords: input.project.keywords,
    },
    informationSummarySeed: seed,
  }, null, 2);

  let aiResult: InformationSummaryAi = {};
  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: INFORMATION_SUMMARY_PROMPT },
        { role: "user", content: emperorContext },
      ],
      response_format: { type: "json_object" },
      emperorSkill: {
        slug: "dev.analysis.information_summary",
        userId: input.userId,
        context: emperorContext,
        variables: { schemaVersion: "1.0", informationSummarySeed: seed },
      },
    });
    const content = response.choices?.[0]?.message?.content;
    aiResult = content ? JSON.parse(content as string) as InformationSummaryAi : {};
  } catch (error) {
    // Keep the structured system evidence editable when Emperor is temporarily unavailable.
    aiResult = {
      missingFields: [`皇帝 Skill 暂未完成AI归纳: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  const result = mergeInformationSummaryAi(seed, aiResult);
  const completedStage = await devDb.upsertDevAnalysisStage({
    projectId: input.projectId,
    userId: input.userId,
    stageType: "information_summary",
    status: "completed",
    rawResult: JSON.stringify(result),
    editedResult: null,
    confirmedAt: null,
  });
  await registerDevAnalysisArtifact(completedStage.id, "ai_output");
  return result;
}

const decisionResponseFormat = {
  type: "json_schema" as const,
  json_schema: {
    name: "decision_dashboard_ai",
    strict: true,
    schema: {
      type: "object",
      properties: {
        feasibilityScore: {
          type: "object",
          properties: {
            overall: { type: "number" },
            dimensions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  score: { type: "number" },
                  reason: { type: "string" },
                },
                required: ["name", "score", "reason"],
                additionalProperties: false,
              },
            },
            recommendation: { type: "string" },
          },
          required: ["overall", "dimensions", "recommendation"],
          additionalProperties: false,
        },
        productPositioning: {
          type: "object",
          properties: {
            targetAttributes: { type: "object", additionalProperties: { type: "string" } },
            priceRange: {
              type: "object",
              properties: { min: { type: "number" }, max: { type: "number" } },
              required: ["min", "max"],
              additionalProperties: false,
            },
            differentiationDirection: { type: "string" },
            targetAudience: { type: "string" },
            uniqueSellingPoints: { type: "array", items: { type: "string" } },
          },
          required: ["targetAttributes", "priceRange", "differentiationDirection", "targetAudience", "uniqueSellingPoints"],
          additionalProperties: false,
        },
        swotAnalysis: {
          type: "array",
          items: {
            type: "object",
            properties: {
              competitor: { type: "string" },
              strengths: { type: "array", items: { type: "string" } },
              weaknesses: { type: "array", items: { type: "string" } },
              opportunities: { type: "array", items: { type: "string" } },
              threats: { type: "array", items: { type: "string" } },
            },
            required: ["competitor", "strengths", "weaknesses", "opportunities", "threats"],
            additionalProperties: false,
          },
        },
        launchPlan: {
          type: "object",
          properties: {
            specifications: { type: "string" },
            targetPrice: { type: "number" },
            bestLaunchMonth: { type: "string" },
            initialOrderQuantity: { type: "number" },
            targetMonthlySales: { type: "number" },
            estimatedBreakEvenMonths: { type: "number" },
            keyMilestones: {
              type: "array",
              items: {
                type: "object",
                properties: { month: { type: "number" }, milestone: { type: "string" } },
                required: ["month", "milestone"],
                additionalProperties: false,
              },
            },
          },
          required: ["specifications", "targetPrice", "bestLaunchMonth", "initialOrderQuantity", "targetMonthlySales", "estimatedBreakEvenMonths", "keyMilestones"],
          additionalProperties: false,
        },
        risks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              risk: { type: "string" },
              probability: { type: "string" },
              impact: { type: "string" },
              mitigation: { type: "string" },
            },
            required: ["risk", "probability", "impact", "mitigation"],
            additionalProperties: false,
          },
        },
        summary: { type: "string" },
      },
      required: ["feasibilityScore", "productPositioning", "swotAnalysis", "launchPlan", "risks", "summary"],
      additionalProperties: false,
    },
  },
};

export async function generateDecisionDashboard(input: {
  projectId: number;
  userId: number;
  project: ProjectContext;
}) {
  await devDb.upsertDevAnalysisStage({
    projectId: input.projectId,
    userId: input.userId,
    stageType: "decision_dashboard",
    status: "running",
    rawResult: null,
    editedResult: null,
    confirmedAt: null,
  });

  try {
    const informationStage = await devDb.getDevAnalysisStage(input.projectId, "information_summary");
    if (!informationStage || informationStage.status !== "confirmed") throw new Error("信息汇总尚未确认锁定");
    const artifact = await resolveCurrentDevAnalysisArtifact(informationStage.id);
    if (!artifact?.content) throw new Error("已确认的信息汇总 Artifact 不可用，请解锁后重新确认");
    const informationSummary = validateInformationSummaryForConfirmation(artifact.content);
    const emperorContext = `项目: ${input.project.name}\n目标市场: ${input.project.targetMarket}\nArtifact: ${artifact.ref}\n\n已确认信息汇总 Artifact:\n${JSON.stringify(informationSummary, null, 2)}`;
    const response = await invokeLLM({
      messages: [
        { role: "system", content: DECISION_DASHBOARD_PROMPT },
        { role: "user", content: emperorContext },
      ],
      emperorSkill: {
        slug: "dev.analysis.decision_dashboard",
        userId: input.userId,
        context: emperorContext,
        variables: { schemaVersion: "1.0", informationSummary },
      },
      response_format: decisionResponseFormat,
    });
    const content = response.choices?.[0]?.message?.content;
    const result = { ai: content ? JSON.parse(content as string) : {} };
    const completedStage = await devDb.upsertDevAnalysisStage({
      projectId: input.projectId,
      userId: input.userId,
      stageType: "decision_dashboard",
      status: "completed",
      rawResult: JSON.stringify(result),
      editedResult: null,
      confirmedAt: null,
    });
    await registerDevAnalysisArtifact(completedStage.id, "ai_output");
    return result;
  } catch (error) {
    await devDb.upsertDevAnalysisStage({
      projectId: input.projectId,
      userId: input.userId,
      stageType: "decision_dashboard",
      status: "pending",
      rawResult: null,
      editedResult: null,
      confirmedAt: null,
    });
    throw error;
  }
}
