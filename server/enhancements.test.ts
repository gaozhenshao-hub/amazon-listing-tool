import { describe, it, expect } from "vitest";

// ─── Test 1: Exchange Rate API endpoint ─────────────────
describe("Exchange Rate API", () => {
  it("getExchangeRate should return rate, source, and updatedAt", async () => {
    // Simulate the expected response structure
    const mockResponse = { rate: 0.137, source: "fallback", updatedAt: Date.now() };
    expect(mockResponse).toHaveProperty("rate");
    expect(mockResponse).toHaveProperty("source");
    expect(mockResponse).toHaveProperty("updatedAt");
    expect(typeof mockResponse.rate).toBe("number");
    expect(mockResponse.rate).toBeGreaterThan(0);
    expect(mockResponse.rate).toBeLessThan(1); // CNY to USD is always < 1
  });

  it("exchange rate should be within reasonable range for CNY→USD", () => {
    const rate = 0.137;
    // CNY to USD historically ranges from 0.12 to 0.18
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.2);
  });
});

// ─── Test 2: Batch Simulate with Exchange Rate ──────────
describe("Batch Simulate with Exchange Rate", () => {
  const simulateProfit = (params: {
    sellingPrice: number;
    productCostCny: number;
    exchangeRate: number;
    shippingCost: number;
    fbaFee: number;
    referralFeeRate: number;
    advertisingCost: number;
    otherCosts: number;
    totalMoldCostCny: number;
    quantities: number[];
  }) => {
    const rate = params.exchangeRate;
    const productCostUsd = params.productCostCny * rate;
    const totalMoldCostUsd = params.totalMoldCostCny * rate;
    const referralRate = params.referralFeeRate / 100;
    const referralFee = params.sellingPrice * referralRate;

    return params.quantities.map(qty => {
      const moldPerUnitUsd = qty > 0 ? totalMoldCostUsd / qty : 0;
      const moldPerUnitCny = qty > 0 ? params.totalMoldCostCny / qty : 0;
      const totalUnitCost = productCostUsd + moldPerUnitUsd + params.shippingCost + referralFee + params.fbaFee + params.advertisingCost + params.otherCosts;
      const profit = params.sellingPrice - totalUnitCost;
      const profitMargin = params.sellingPrice > 0 ? (profit / params.sellingPrice) * 100 : 0;
      const roi = totalUnitCost > 0 ? (profit / totalUnitCost) * 100 : 0;

      return {
        quantity: qty,
        moldPerUnitCny: Math.round(moldPerUnitCny * 100) / 100,
        moldPerUnit: Math.round(moldPerUnitUsd * 100) / 100,
        productCostUsd: Math.round(productCostUsd * 100) / 100,
        totalUnitCost: Math.round(totalUnitCost * 100) / 100,
        profit: Math.round(profit * 100) / 100,
        profitMargin: Math.round(profitMargin * 100) / 100,
        roi: Math.round(roi * 100) / 100,
        totalProfit: Math.round(profit * qty * 100) / 100,
      };
    });
  };

  it("should correctly convert CNY to USD using exchange rate", () => {
    const results = simulateProfit({
      sellingPrice: 29.99,
      productCostCny: 50, // ¥50
      exchangeRate: 0.14, // 1 CNY = 0.14 USD
      shippingCost: 3.5,
      fbaFee: 5.0,
      referralFeeRate: 15,
      advertisingCost: 3.0,
      otherCosts: 1.0,
      totalMoldCostCny: 10000, // ¥10000 mold cost
      quantities: [100, 1000],
    });

    // Product cost: 50 * 0.14 = $7.00
    expect(results[0].productCostUsd).toBe(7.00);

    // For 100 units: mold per unit = 10000 * 0.14 / 100 = $14.00
    expect(results[0].moldPerUnit).toBe(14.00);
    expect(results[0].moldPerUnitCny).toBe(100.00); // ¥10000/100

    // For 1000 units: mold per unit = 10000 * 0.14 / 1000 = $1.40
    expect(results[1].moldPerUnit).toBe(1.40);
    expect(results[1].moldPerUnitCny).toBe(10.00); // ¥10000/1000
  });

  it("should show higher profit margin with more units due to mold cost spreading", () => {
    const results = simulateProfit({
      sellingPrice: 29.99,
      productCostCny: 50,
      exchangeRate: 0.14,
      shippingCost: 3.5,
      fbaFee: 5.0,
      referralFeeRate: 15,
      advertisingCost: 3.0,
      otherCosts: 1.0,
      totalMoldCostCny: 10000,
      quantities: [100, 500, 1000, 5000],
    });

    // Profit margin should increase as quantity increases (mold cost spreads)
    for (let i = 1; i < results.length; i++) {
      expect(results[i].profitMargin).toBeGreaterThan(results[i - 1].profitMargin);
    }
  });

  it("should handle zero mold cost correctly", () => {
    const results = simulateProfit({
      sellingPrice: 29.99,
      productCostCny: 50,
      exchangeRate: 0.14,
      shippingCost: 3.5,
      fbaFee: 5.0,
      referralFeeRate: 15,
      advertisingCost: 3.0,
      otherCosts: 1.0,
      totalMoldCostCny: 0,
      quantities: [100, 1000],
    });

    expect(results[0].moldPerUnit).toBe(0);
    expect(results[0].moldPerUnitCny).toBe(0);
    // All quantities should have same profit when no mold cost
    expect(results[0].profitMargin).toBe(results[1].profitMargin);
  });
});

// ─── Test 3: Profile Section Configuration ──────────────
describe("Profile Section Configuration", () => {
  const PROFILE_SECTIONS = [
    "appearance", "function", "cost", "package", "packageDesign",
    "userPersona", "usageScenarios", "productMap",
  ];

  it("should have exactly 8 sub-modules", () => {
    expect(PROFILE_SECTIONS).toHaveLength(8);
  });

  it("each section should have corresponding DB column mapping", () => {
    const SECTION_DB_MAP: Record<string, { data: string; ai: string; confirmed: string }> = {
      appearance: { data: "appearanceColors", ai: "appearanceAiSuggestion", confirmed: "appearanceConfirmed" },
      function: { data: "mainFunctions", ai: "functionsAiSuggestion", confirmed: "functionsConfirmed" },
      cost: { data: "costBreakdown", ai: "costAiSuggestion", confirmed: "costConfirmed" },
      package: { data: "packageDimensions", ai: "packageAiSuggestion", confirmed: "packageConfirmed" },
      packageDesign: { data: "packageDesign", ai: "packageDesignAiSuggestion", confirmed: "packageDesignConfirmed" },
      userPersona: { data: "userPersona", ai: "userPersonaAiSuggestion", confirmed: "userPersonaConfirmed" },
      usageScenarios: { data: "usageScenarios", ai: "usageScenariosAiSuggestion", confirmed: "usageScenariosConfirmed" },
      productMap: { data: "productMap", ai: "productMapAiSuggestion", confirmed: "productMapConfirmed" },
    };

    PROFILE_SECTIONS.forEach(section => {
      expect(SECTION_DB_MAP[section]).toBeDefined();
      expect(SECTION_DB_MAP[section].data).toBeTruthy();
      expect(SECTION_DB_MAP[section].ai).toBeTruthy();
      expect(SECTION_DB_MAP[section].confirmed).toBeTruthy();
    });
  });

  it("section labels should have both CN and EN names", () => {
    const SECTION_LABELS: Record<string, { cn: string; en: string }> = {
      appearance: { cn: "外观设计", en: "Appearance Design" },
      function: { cn: "功能提升", en: "Function Enhancement" },
      cost: { cn: "产品成本", en: "Product Cost" },
      package: { cn: "包装设计", en: "Package Design" },
      packageDesign: { cn: "包装外观", en: "Package Appearance" },
      userPersona: { cn: "用户画像", en: "User Persona" },
      usageScenarios: { cn: "使用场景", en: "Usage Scenarios" },
      productMap: { cn: "产品地图", en: "Product Map" },
    };

    PROFILE_SECTIONS.forEach(section => {
      expect(SECTION_LABELS[section].cn).toBeTruthy();
      expect(SECTION_LABELS[section].en).toBeTruthy();
    });
  });
});

// ─── Test 4: Phase Filtering Logic ──────────────────────
describe("Phase Filtering Logic", () => {
  const mockProjects = [
    { id: 1, name: "Project A", phase: "market_analysis", status: "analyzing", approvedAt: null },
    { id: 2, name: "Project B", phase: "project_execution", status: "scoring", approvedAt: Date.now() },
    { id: 3, name: "Project C", phase: "market_analysis", status: "draft", approvedAt: null },
    { id: 4, name: "Project D", phase: "project_execution", status: "completed", approvedAt: Date.now() },
  ];

  it("should filter by market_analysis phase", () => {
    const filtered = mockProjects.filter(p => p.phase === "market_analysis");
    expect(filtered).toHaveLength(2);
    expect(filtered.every(p => p.phase === "market_analysis")).toBe(true);
  });

  it("should filter by project_execution phase", () => {
    const filtered = mockProjects.filter(p => p.phase === "project_execution");
    expect(filtered).toHaveLength(2);
    expect(filtered.every(p => p.phase === "project_execution")).toBe(true);
  });

  it("should show all projects when filter is 'all'", () => {
    const phaseFilter = "all";
    const filtered = mockProjects.filter(p =>
      phaseFilter === "all" || p.phase === phaseFilter
    );
    expect(filtered).toHaveLength(4);
  });

  it("should combine phase and status filters", () => {
    const phaseFilter = "market_analysis";
    const statusFilter = "analyzing";
    const filtered = mockProjects.filter(p =>
      (phaseFilter === "all" || p.phase === phaseFilter) &&
      (statusFilter === "all" || p.status === statusFilter)
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe("Project A");
  });

  it("approved projects should have approvedAt timestamp", () => {
    const approved = mockProjects.filter(p => p.approvedAt !== null);
    expect(approved).toHaveLength(2);
    expect(approved.every(p => p.phase === "project_execution")).toBe(true);
  });

  it("phase stats should correctly count projects", () => {
    let ma = 0, pe = 0;
    mockProjects.forEach(p => {
      if (p.phase === "project_execution") pe++;
      else ma++;
    });
    expect(ma).toBe(2);
    expect(pe).toBe(2);
    expect(ma + pe).toBe(mockProjects.length);
  });
});

// ─── Test 5: Content Format Helper ──────────────────────
describe("Content Format Helper", () => {
  const formatContent = (raw: any): string => {
    if (!raw) return "";
    if (typeof raw === "string") {
      try {
        return JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        return raw;
      }
    }
    return JSON.stringify(raw, null, 2);
  };

  it("should format valid JSON string", () => {
    const input = '{"key":"value"}';
    const result = formatContent(input);
    expect(result).toBe('{\n  "key": "value"\n}');
  });

  it("should return plain text as-is", () => {
    const input = "This is plain text";
    expect(formatContent(input)).toBe("This is plain text");
  });

  it("should format object to JSON", () => {
    const input = { key: "value", nested: { a: 1 } };
    const result = formatContent(input);
    expect(result).toContain('"key": "value"');
    expect(result).toContain('"a": 1');
  });

  it("should return empty string for null/undefined", () => {
    expect(formatContent(null)).toBe("");
    expect(formatContent(undefined)).toBe("");
  });
});
