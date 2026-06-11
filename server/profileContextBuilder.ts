/**
 * Profile Context Builder
 * 
 * Builds comprehensive product profile context for AI prompts.
 * Used by BOM AI suggestion, Test Report generation, and other AI features
 * to reference the full product profile data (all 8 sub-modules).
 */

interface ProfileData {
  appearanceColors?: string | null;
  mainFunctions?: string | null;
  costBreakdown?: string | null;
  packageDimensions?: string | null;
  packageDesign?: string | null;
  userPersona?: string | null;
  usageScenarios?: string | null;
  productMap?: string | null;
  appearanceConfirmed?: number;
  functionsConfirmed?: number;
  costConfirmed?: number;
  packageConfirmed?: number;
  packageDesignConfirmed?: number;
  userPersonaConfirmed?: number;
  usageScenariosConfirmed?: number;
  productMapConfirmed?: number;
}

function safeParseJson(str: string | null | undefined): any {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return str; // Return raw string if not valid JSON
  }
}

function summarizeAppearance(data: any): string {
  if (!data) return "";
  if (typeof data === "string") return data;
  const parts: string[] = [];
  if (data.colors) parts.push(`颜色方案: ${Array.isArray(data.colors) ? data.colors.join(", ") : data.colors}`);
  if (data.materials) parts.push(`材质: ${Array.isArray(data.materials) ? data.materials.join(", ") : data.materials}`);
  if (data.dimensions) parts.push(`尺寸: ${typeof data.dimensions === "object" ? JSON.stringify(data.dimensions) : data.dimensions}`);
  if (data.weight) parts.push(`重量: ${data.weight}`);
  if (data.style) parts.push(`风格: ${data.style}`);
  if (data.surfaceTreatment) parts.push(`表面处理: ${data.surfaceTreatment}`);
  if (data.items && Array.isArray(data.items)) {
    parts.push(data.items.map((i: any) => `${i.name || i.label || ""}: ${i.value || i.description || ""}`).join("; "));
  }
  return parts.length > 0 ? parts.join("\n") : JSON.stringify(data).slice(0, 500);
}

function summarizeFunctions(data: any): string {
  if (!data) return "";
  if (typeof data === "string") return data;
  const parts: string[] = [];
  if (data.mainFeatures && Array.isArray(data.mainFeatures)) {
    parts.push("主要功能:\n" + data.mainFeatures.map((f: any, i: number) => 
      `  ${i + 1}. ${f.name || f.title || ""}: ${f.description || ""} (优先级: ${f.priority || "中"})`
    ).join("\n"));
  }
  if (data.upgradePoints && Array.isArray(data.upgradePoints)) {
    parts.push("功能升级点:\n" + data.upgradePoints.map((u: any, i: number) =>
      `  ${i + 1}. ${u.name || u.title || ""}: ${u.description || ""} (难度: ${u.difficulty || "中"}, 成本影响: ${u.costImpact || "中"})`
    ).join("\n"));
  }
  if (data.differentiatedFeatures || data.differentiation) {
    const diff = data.differentiatedFeatures || data.differentiation;
    parts.push(`差异化功能: ${typeof diff === "string" ? diff : JSON.stringify(diff).slice(0, 300)}`);
  }
  if (data.items && Array.isArray(data.items)) {
    parts.push(data.items.map((i: any) => `${i.name || i.label || ""}: ${i.value || i.description || ""}`).join("; "));
  }
  return parts.length > 0 ? parts.join("\n") : JSON.stringify(data).slice(0, 500);
}

function summarizeCost(data: any): string {
  if (!data) return "";
  if (typeof data === "string") return data;
  const parts: string[] = [];
  if (data.targetCost) parts.push(`目标成本: ${data.targetCost}`);
  if (data.targetPrice) parts.push(`目标售价: ${data.targetPrice}`);
  if (data.targetMargin) parts.push(`目标毛利率: ${data.targetMargin}`);
  if (data.materialCost) parts.push(`材料成本: ${data.materialCost}`);
  if (data.laborCost) parts.push(`人工成本: ${data.laborCost}`);
  if (data.moldCost) parts.push(`模具成本: ${data.moldCost}`);
  if (data.packagingCost) parts.push(`包装成本: ${data.packagingCost}`);
  if (data.shippingCost) parts.push(`运费: ${data.shippingCost}`);
  if (data.items && Array.isArray(data.items)) {
    parts.push(data.items.map((i: any) => `${i.name || i.label || ""}: ${i.value || ""}`).join("; "));
  }
  return parts.length > 0 ? parts.join("\n") : JSON.stringify(data).slice(0, 500);
}

function summarizePackage(data: any): string {
  if (!data) return "";
  if (typeof data === "string") return data;
  const parts: string[] = [];
  if (data.length) parts.push(`尺寸: ${data.length}x${data.width || ""}x${data.height || ""} ${data.unit || "cm"}`);
  if (data.weight) parts.push(`重量: ${data.weight} ${data.weightUnit || "kg"}`);
  if (data.type) parts.push(`包装类型: ${data.type}`);
  if (data.material) parts.push(`包装材质: ${data.material}`);
  if (data.items && Array.isArray(data.items)) {
    parts.push(data.items.map((i: any) => `${i.name || i.label || ""}: ${i.value || ""}`).join("; "));
  }
  return parts.length > 0 ? parts.join("\n") : JSON.stringify(data).slice(0, 500);
}

function summarizeUserPersona(data: any): string {
  if (!data) return "";
  if (typeof data === "string") return data;
  const parts: string[] = [];
  if (data.targetAge) parts.push(`目标年龄: ${data.targetAge}`);
  if (data.gender) parts.push(`性别: ${data.gender}`);
  if (data.income) parts.push(`收入水平: ${data.income}`);
  if (data.painPoints && Array.isArray(data.painPoints)) {
    parts.push(`痛点: ${data.painPoints.join(", ")}`);
  }
  if (data.needs && Array.isArray(data.needs)) {
    parts.push(`需求: ${data.needs.join(", ")}`);
  }
  if (data.items && Array.isArray(data.items)) {
    parts.push(data.items.map((i: any) => `${i.name || i.label || ""}: ${i.value || i.description || ""}`).join("; "));
  }
  return parts.length > 0 ? parts.join("\n") : JSON.stringify(data).slice(0, 500);
}

function summarizeUsageScenarios(data: any): string {
  if (!data) return "";
  if (typeof data === "string") return data;
  if (Array.isArray(data)) {
    return data.map((s: any, i: number) => 
      `  ${i + 1}. ${s.name || s.scenario || s.title || ""}: ${s.description || ""}`
    ).join("\n");
  }
  if (data.items && Array.isArray(data.items)) {
    return data.items.map((i: any) => `${i.name || i.label || ""}: ${i.value || i.description || ""}`).join("; ");
  }
  return JSON.stringify(data).slice(0, 500);
}

/**
 * Build comprehensive product profile context string for AI prompts.
 * Includes all 8 sub-modules with confirmed data prioritized.
 */
export function buildProfileContext(profile: ProfileData | null | undefined): string {
  if (!profile) return "产品画像数据: 暂无（尚未填写产品画像）";

  const sections: string[] = [];

  // 1. 外观设计
  const appearance = safeParseJson(profile.appearanceColors);
  if (appearance) {
    sections.push(`【外观设计】${profile.appearanceConfirmed ? "(已确认)" : "(草稿)"}
${summarizeAppearance(appearance)}`);
  }

  // 2. 功能提升
  const functions = safeParseJson(profile.mainFunctions);
  if (functions) {
    sections.push(`【功能提升】${profile.functionsConfirmed ? "(已确认)" : "(草稿)"}
${summarizeFunctions(functions)}`);
  }

  // 3. 产品成本
  const cost = safeParseJson(profile.costBreakdown);
  if (cost) {
    sections.push(`【产品成本】${profile.costConfirmed ? "(已确认)" : "(草稿)"}
${summarizeCost(cost)}`);
  }

  // 4. 包装设计
  const pkg = safeParseJson(profile.packageDimensions);
  if (pkg) {
    sections.push(`【包装设计】${profile.packageConfirmed ? "(已确认)" : "(草稿)"}
${summarizePackage(pkg)}`);
  }

  // 5. 包装外观
  const pkgDesign = safeParseJson(profile.packageDesign);
  if (pkgDesign) {
    sections.push(`【包装外观】${profile.packageDesignConfirmed ? "(已确认)" : "(草稿)"}
${typeof pkgDesign === "string" ? pkgDesign : JSON.stringify(pkgDesign).slice(0, 300)}`);
  }

  // 6. 用户画像
  const persona = safeParseJson(profile.userPersona);
  if (persona) {
    sections.push(`【用户画像】${profile.userPersonaConfirmed ? "(已确认)" : "(草稿)"}
${summarizeUserPersona(persona)}`);
  }

  // 7. 使用场景
  const scenarios = safeParseJson(profile.usageScenarios);
  if (scenarios) {
    sections.push(`【使用场景】${profile.usageScenariosConfirmed ? "(已确认)" : "(草稿)"}
${summarizeUsageScenarios(scenarios)}`);
  }

  // 8. 产品地图
  const productMap = safeParseJson(profile.productMap);
  if (productMap) {
    sections.push(`【产品地图】${profile.productMapConfirmed ? "(已确认)" : "(草稿)"}
${typeof productMap === "string" ? productMap : JSON.stringify(productMap).slice(0, 300)}`);
  }

  if (sections.length === 0) {
    return "产品画像数据: 暂无（各子模块尚未填写）";
  }

  return `产品画像数据（共${sections.length}个模块）:\n${sections.join("\n\n")}`;
}

/**
 * Build a concise summary of profile data for shorter prompts.
 */
export function buildProfileSummary(profile: ProfileData | null | undefined): string {
  if (!profile) return "";
  const parts: string[] = [];

  const appearance = safeParseJson(profile.appearanceColors);
  if (appearance) parts.push(`外观: ${summarizeAppearance(appearance).slice(0, 150)}`);

  const functions = safeParseJson(profile.mainFunctions);
  if (functions) parts.push(`功能: ${summarizeFunctions(functions).slice(0, 200)}`);

  const cost = safeParseJson(profile.costBreakdown);
  if (cost) parts.push(`成本: ${summarizeCost(cost).slice(0, 150)}`);

  const pkg = safeParseJson(profile.packageDimensions);
  if (pkg) parts.push(`包装: ${summarizePackage(pkg).slice(0, 100)}`);

  return parts.join("\n");
}
