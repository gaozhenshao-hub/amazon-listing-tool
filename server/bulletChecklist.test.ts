import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Test: BulletChecklistPanel Component ─────────────────────────
describe("BulletChecklistPanel Component", () => {
  const componentPath = path.join(__dirname, "../client/src/components/BulletChecklistPanel.tsx");
  const componentCode = fs.readFileSync(componentPath, "utf-8");

  describe("Component Structure", () => {
    it("should export default BulletChecklistPanel function", () => {
      expect(componentCode).toContain("export default function BulletChecklistPanel");
    });

    it("should accept checkListScores prop", () => {
      expect(componentCode).toContain("checkListScores");
    });

    it("should accept bulletIndex prop", () => {
      expect(componentCode).toContain("bulletIndex");
    });

    it("should accept aiSemanticRelations prop", () => {
      expect(componentCode).toContain("aiSemanticRelations");
    });

    it("should show run-check button when checkListScores is undefined", () => {
      expect(componentCode).toContain("if (!checkListScores)");
      expect(componentCode).toContain("Check List \u81ea\u68c0");
      expect(componentCode).toContain("onRunCheck");
    });
  });

  describe("15 Dimensions Definition", () => {
    it("should define CHECKLIST_DIMENSIONS array", () => {
      expect(componentCode).toContain("const CHECKLIST_DIMENSIONS");
    });

    it("should contain all 15 dimension codes B1-B15", () => {
      for (let i = 1; i <= 15; i++) {
        expect(componentCode).toContain(`"B${i}"`);
      }
    });

    it("should have B1 readability dimension", () => {
      expect(componentCode).toContain('key: "readability"');
      expect(componentCode).toContain('code: "B1"');
      expect(componentCode).toContain('label: "可读性"');
    });

    it("should have B2 formatting dimension", () => {
      expect(componentCode).toContain('key: "formatting"');
      expect(componentCode).toContain('code: "B2"');
    });

    it("should have B3 layout dimension", () => {
      expect(componentCode).toContain('key: "layout"');
      expect(componentCode).toContain('code: "B3"');
    });

    it("should have B4 sellingPointFocus dimension", () => {
      expect(componentCode).toContain('key: "sellingPointFocus"');
      expect(componentCode).toContain('code: "B4"');
    });

    it("should have B5 subtitle dimension", () => {
      expect(componentCode).toContain('key: "subtitle"');
      expect(componentCode).toContain('code: "B5"');
    });

    it("should have B6 FABE dimension", () => {
      expect(componentCode).toContain('key: "fabe"');
      expect(componentCode).toContain('code: "B6"');
      expect(componentCode).toContain('label: "FABE法则"');
    });

    it("should have B7 structured format dimension", () => {
      expect(componentCode).toContain('key: "structured"');
      expect(componentCode).toContain('code: "B7"');
    });

    it("should have B8 user psychology dimension", () => {
      expect(componentCode).toContain('key: "psychology"');
      expect(componentCode).toContain('code: "B8"');
    });

    it("should have B9 FAQ coverage dimension", () => {
      expect(componentCode).toContain('key: "faqCoverage"');
      expect(componentCode).toContain('code: "B9"');
    });

    it("should have B10 quantified data dimension", () => {
      expect(componentCode).toContain('key: "quantifiedData"');
      expect(componentCode).toContain('code: "B10"');
    });

    it("should have B11 scene integration dimension", () => {
      expect(componentCode).toContain('key: "scenes"');
      expect(componentCode).toContain('code: "B11"');
    });

    it("should have B12 trust signals dimension", () => {
      expect(componentCode).toContain('key: "trustSignals"');
      expect(componentCode).toContain('code: "B12"');
    });

    it("should have B13 warranty dimension", () => {
      expect(componentCode).toContain('key: "warranty"');
      expect(componentCode).toContain('code: "B13"');
    });

    it("should have B14 traffic keywords dimension", () => {
      expect(componentCode).toContain('key: "trafficKeywords"');
      expect(componentCode).toContain('code: "B14"');
    });

    it("should have B15 AI semantic relations dimension", () => {
      expect(componentCode).toContain('key: "aiReadability"');
      expect(componentCode).toContain('code: "B15"');
      expect(componentCode).toContain("AI语义关系");
    });

    it("should have exactly 15 dimensions in CHECKLIST_DIMENSIONS array", () => {
      // Extract only the CHECKLIST_DIMENSIONS array block
      const arrayStart = componentCode.indexOf("const CHECKLIST_DIMENSIONS");
      const arrayEnd = componentCode.indexOf("] as const;");
      const arrayBlock = componentCode.slice(arrayStart, arrayEnd);
      const matches = arrayBlock.match(/\{ key: "/g);
      expect(matches).toHaveLength(15);
    });
  });

  describe("B15 Semantic Relations", () => {
    it("should include purpose semantic relation type", () => {
      expect(componentCode).toContain('"purpose"');
      expect(componentCode).toContain("用途关系");
    });

    it("should include capability semantic relation type", () => {
      expect(componentCode).toContain('"capability"');
      expect(componentCode).toContain("能力关系");
    });

    it("should include identity semantic relation type", () => {
      expect(componentCode).toContain('"identity"');
      expect(componentCode).toContain("定义关系");
    });

    it("should include causation semantic relation type", () => {
      expect(componentCode).toContain('"causation"');
      expect(componentCode).toContain("因果关系");
    });

    it("should display semantic relations in a dedicated section", () => {
      expect(componentCode).toContain("B15 语义关系覆盖");
    });

    it("should show uncovered status for missing semantic relations", () => {
      expect(componentCode).toContain("未覆盖");
    });
  });

  describe("Collapsible UI", () => {
    it("should use useState for expanded state", () => {
      expect(componentCode).toContain("const [expanded, setExpanded] = useState(false)");
    });

    it("should toggle expanded state on click", () => {
      expect(componentCode).toContain("setExpanded(!expanded)");
    });

    it("should show ChevronDown when collapsed", () => {
      expect(componentCode).toContain("ChevronDown");
    });

    it("should show ChevronUp when expanded", () => {
      expect(componentCode).toContain("ChevronUp");
    });

    it("should conditionally render expanded panel", () => {
      expect(componentCode).toContain("{expanded && (");
    });

    it("should start collapsed by default", () => {
      expect(componentCode).toContain("useState(false)");
    });
  });

  describe("Pass/Fail Visual Indicators", () => {
    it("should calculate pass count from dimensions", () => {
      expect(componentCode).toContain("passCount");
    });

    it("should calculate pass rate percentage", () => {
      expect(componentCode).toContain("passRate");
    });

    it("should show green styling for all-passed state", () => {
      expect(componentCode).toContain("bg-green-50");
      expect(componentCode).toContain("border-green-200");
    });

    it("should show amber styling for partial-pass state", () => {
      expect(componentCode).toContain("bg-amber-50");
      expect(componentCode).toContain("border-amber-200");
    });

    it("should display pass/total count in summary bar", () => {
      expect(componentCode).toContain("{passCount}/{totalCount}");
    });

    it("should show mini dots preview for each dimension", () => {
      expect(componentCode).toContain("CHECKLIST_DIMENSIONS.map");
      expect(componentCode).toContain("bg-green-500");
      expect(componentCode).toContain("bg-red-400");
    });

    it("should use Checkbox component for each dimension", () => {
      expect(componentCode).toContain("<Checkbox");
      expect(componentCode).toContain("checked={passed}");
    });

    it("should make checkboxes read-only (disabled)", () => {
      expect(componentCode).toContain("disabled");
    });

    it("should use green checkbox style for passed dimensions", () => {
      expect(componentCode).toContain("data-[state=checked]:bg-green-600");
    });

    it("should use red border for failed dimensions", () => {
      expect(componentCode).toContain("border-red-300");
    });

    it("should highlight failed dimension rows with red background", () => {
      expect(componentCode).toContain("bg-red-50/50");
    });
  });

  describe("Dimension Display", () => {
    it("should show dimension code badge (B1-B15)", () => {
      expect(componentCode).toContain("{dim.code}");
    });

    it("should show dimension Chinese label", () => {
      expect(componentCode).toContain("{dim.label}");
    });

    it("should show dimension English label", () => {
      expect(componentCode).toContain("{dim.labelEn}");
    });

    it("should show dimension description", () => {
      expect(componentCode).toContain("{dim.description}");
    });

    it("should show AI notes for each dimension", () => {
      expect(componentCode).toContain("{notes && (");
    });

    it("should differentiate pass/fail notes with color", () => {
      expect(componentCode).toContain("text-green-700");
      expect(componentCode).toContain("text-red-600");
    });

    it("should show CheckCircle2 for passed dimensions", () => {
      expect(componentCode).toContain("CheckCircle2");
    });

    it("should show XCircle for failed dimensions", () => {
      expect(componentCode).toContain("XCircle");
    });
  });

  describe("Footer Summary", () => {
    it("should show success message when all passed", () => {
      expect(componentCode).toContain("全部15维度通过");
    });

    it("should show optimization suggestion when some failed", () => {
      expect(componentCode).toContain("待优化");
    });

    it("should display count of failed dimensions", () => {
      expect(componentCode).toContain("{totalCount - passCount}");
    });
  });

  describe("Type Safety", () => {
    it("should define CheckListScores type", () => {
      expect(componentCode).toContain("type CheckListScores = Record<string, { pass: boolean; notes: string }>");
    });

    it("should define BulletChecklistPanelProps interface", () => {
      expect(componentCode).toContain("interface BulletChecklistPanelProps");
    });

    it("should make checkListScores optional", () => {
      expect(componentCode).toContain("checkListScores?: CheckListScores");
    });

    it("should make aiSemanticRelations optional", () => {
      expect(componentCode).toContain("aiSemanticRelations?: Record<string, string | null>");
    });
  });
});

// ─── Test: Backend Prompt checkListScores Output Format ─────────────
describe("Backend Prompt - checkListScores Format", () => {
  const promptsPath = path.join(__dirname, "prompts.ts");
  const promptsCode = fs.readFileSync(promptsPath, "utf-8");

  it("should include checkListScores in SINGLE_BULLET_PROMPT output", () => {
    expect(promptsCode).toContain('"checkListScores"');
  });

  it("should define all 15 dimension keys in checkListScores", () => {
    const dimensionKeys = [
      "readability", "formatting", "layout", "sellingPointFocus", "subtitle",
      "fabe", "structured", "psychology", "faqCoverage", "quantifiedData",
      "scenes", "trustSignals", "warranty", "trafficKeywords", "aiReadability",
    ];
    for (const key of dimensionKeys) {
      expect(promptsCode).toContain(`"${key}": { "pass"`);
    }
  });

  it("should include aiSemanticRelations in output format", () => {
    expect(promptsCode).toContain('"aiSemanticRelations"');
  });

  it("should define purpose semantic relation", () => {
    expect(promptsCode).toContain('"purpose"');
  });

  it("should define capability semantic relation", () => {
    expect(promptsCode).toContain('"capability"');
  });

  it("should define identity semantic relation", () => {
    expect(promptsCode).toContain('"identity"');
  });

  it("should define causation semantic relation", () => {
    expect(promptsCode).toContain('"causation"');
  });

  it("should include pass boolean and notes string in each dimension", () => {
    expect(promptsCode).toContain('"pass": true');
    expect(promptsCode).toContain('"notes": ""');
  });
});

// ─── Test: GeneratePage Integration ─────────────────────────────────
describe("GeneratePage - BulletChecklistPanel Integration", () => {
  const pagePath = path.join(__dirname, "../client/src/pages/GeneratePage.tsx");
  const pageCode = fs.readFileSync(pagePath, "utf-8");

  it("should import BulletChecklistPanel component", () => {
    expect(pageCode).toContain('import BulletChecklistPanel from "@/components/BulletChecklistPanel"');
  });

  it("should render BulletChecklistPanel with checkListScores prop", () => {
    expect(pageCode).toContain("checkListScores={generatedBullets[idx].checkListScores}");
  });

  it("should pass bulletIndex prop to BulletChecklistPanel", () => {
    expect(pageCode).toContain("bulletIndex={idx}");
  });

  it("should pass aiSemanticRelations prop from generatedBullets", () => {
    expect(pageCode).toContain("aiSemanticRelations={generatedBullets[idx].aiSemanticRelations}");
  });

  it("should place BulletChecklistPanel after incorporatedKeywords section", () => {
    const keywordsIdx = pageCode.indexOf("incorporatedKeywords.map");
    // Find the BulletChecklistPanel usage (not the import)
    const checklistIdx = pageCode.indexOf("<BulletChecklistPanel");
    expect(checklistIdx).toBeGreaterThan(keywordsIdx);
  });

  it("should place BulletChecklistPanel before the action buttons", () => {
    const checklistIdx = pageCode.indexOf("BulletChecklistPanel");
    // The confirm/edit/regenerate buttons come after
    const confirmIdx = pageCode.indexOf("确认此条", checklistIdx);
    expect(confirmIdx).toBeGreaterThan(checklistIdx);
  });
});

// ─── Test: Dimension Key Alignment Between Frontend and Backend ─────
describe("Frontend-Backend Dimension Key Alignment", () => {
  const componentPath = path.join(__dirname, "../client/src/components/BulletChecklistPanel.tsx");
  const componentCode = fs.readFileSync(componentPath, "utf-8");
  const promptsPath = path.join(__dirname, "prompts.ts");
  const promptsCode = fs.readFileSync(promptsPath, "utf-8");

  const dimensionKeys = [
    "readability", "formatting", "layout", "sellingPointFocus", "subtitle",
    "fabe", "structured", "psychology", "faqCoverage", "quantifiedData",
    "scenes", "trustSignals", "warranty", "trafficKeywords", "aiReadability",
  ];

  for (const key of dimensionKeys) {
    it(`should have matching key "${key}" in both frontend and backend`, () => {
      expect(componentCode).toContain(`key: "${key}"`);
      expect(promptsCode).toContain(`"${key}"`);
    });
  }
});
