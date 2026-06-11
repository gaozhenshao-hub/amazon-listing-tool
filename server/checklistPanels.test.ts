import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Test: Generic ChecklistPanel Component ─────────────────────────
describe("ChecklistPanel Component", () => {
  const componentPath = path.join(__dirname, "../client/src/components/ChecklistPanel.tsx");
  const componentCode = fs.readFileSync(componentPath, "utf-8");

  describe("Component Structure", () => {
    it("should export default ChecklistPanel function", () => {
      expect(componentCode).toContain("export default function ChecklistPanel");
    });

    it("should export ChecklistDimension interface", () => {
      expect(componentCode).toContain("export interface ChecklistDimension");
    });

    it("should export CheckListScores type", () => {
      expect(componentCode).toContain("export type CheckListScores");
    });

    it("should accept dimensions prop", () => {
      expect(componentCode).toContain("dimensions");
    });

    it("should accept checkListScores prop", () => {
      expect(componentCode).toContain("checkListScores");
    });

    it("should accept panelTitle prop", () => {
      expect(componentCode).toContain("panelTitle");
    });

    it("should accept onRunCheck callback prop", () => {
      expect(componentCode).toContain("onRunCheck");
    });

    it("should accept isRunningCheck prop", () => {
      expect(componentCode).toContain("isRunningCheck");
    });
  });

  describe("Run Check Button", () => {
    it("should show run-check button when checkListScores is undefined", () => {
      expect(componentCode).toContain("if (!checkListScores)");
    });

    it("should display loading spinner when running check", () => {
      expect(componentCode).toContain("animate-spin");
    });

    it("should display click-to-run badge", () => {
      expect(componentCode).toContain("点击运行");
    });

    it("should disable button when running check", () => {
      expect(componentCode).toContain("disabled={isRunningCheck}");
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
    });

    it("should show amber styling for partial-pass state", () => {
      expect(componentCode).toContain("bg-amber-50");
    });

    it("should display pass/total count in summary bar", () => {
      expect(componentCode).toContain("{passCount}/{totalCount}");
    });

    it("should use Checkbox component for each dimension", () => {
      expect(componentCode).toContain("<Checkbox");
    });

    it("should show re-check button in expanded header", () => {
      expect(componentCode).toContain("重新自检");
    });
  });

  describe("Footer Summary", () => {
    it("should show success message when all passed", () => {
      expect(componentCode).toContain("质量优秀");
    });

    it("should show optimization suggestion when some failed", () => {
      expect(componentCode).toContain("建议编辑优化后重新生成");
    });
  });
});

// ─── Test: StepTitle 10-Dimension Checklist Integration ─────────────
describe("StepTitle 10-Dimension Checklist", () => {
  const componentPath = path.join(__dirname, "../client/src/pages/listing/StepTitle.tsx");
  const componentCode = fs.readFileSync(componentPath, "utf-8");

  describe("Dimensions Definition", () => {
    it("should define TITLE_CHECKLIST_DIMENSIONS array", () => {
      expect(componentCode).toContain("const TITLE_CHECKLIST_DIMENSIONS");
    });

    it("should contain all 10 dimension codes T1-T10", () => {
      for (let i = 1; i <= 10; i++) {
        expect(componentCode).toContain(`"T${i}"`);
      }
    });

    it("should have T1 readability dimension", () => {
      expect(componentCode).toContain('key: "readability"');
      expect(componentCode).toContain('code: "T1"');
    });

    it("should have T2 formatting dimension", () => {
      expect(componentCode).toContain('key: "formatting"');
      expect(componentCode).toContain('code: "T2"');
    });

    it("should have T3 characterCount dimension", () => {
      expect(componentCode).toContain('key: "characterCount"');
      expect(componentCode).toContain('code: "T3"');
    });

    it("should have T4 contentCoverage dimension", () => {
      expect(componentCode).toContain('key: "contentCoverage"');
      expect(componentCode).toContain('code: "T4"');
    });

    it("should have T5 coreKeywords dimension", () => {
      expect(componentCode).toContain('key: "coreKeywords"');
      expect(componentCode).toContain('code: "T5"');
    });

    it("should have T6 wordOrder dimension", () => {
      expect(componentCode).toContain('key: "wordOrder"');
      expect(componentCode).toContain('code: "T6"');
    });

    it("should have T7 bundlePack dimension", () => {
      expect(componentCode).toContain('key: "bundlePack"');
      expect(componentCode).toContain('code: "T7"');
    });

    it("should have T8 trafficKeywords dimension", () => {
      expect(componentCode).toContain('key: "trafficKeywords"');
      expect(componentCode).toContain('code: "T8"');
    });

    it("should have T9 brand dimension", () => {
      expect(componentCode).toContain('key: "brand"');
      expect(componentCode).toContain('code: "T9"');
    });

    it("should have T10 seasonal dimension", () => {
      expect(componentCode).toContain('key: "seasonal"');
      expect(componentCode).toContain('code: "T10"');
    });
  });

  describe("Auto-trigger Integration", () => {
    it("should import ChecklistPanel component", () => {
      expect(componentCode).toContain('import ChecklistPanel from "@/components/ChecklistPanel"');
    });

    it("should import useEffect and useRef for auto-trigger", () => {
      expect(componentCode).toContain("useEffect");
      expect(componentCode).toContain("useRef");
    });

    it("should have autoCheckTriggered ref", () => {
      expect(componentCode).toContain("autoCheckTriggered");
    });

    it("should have titleCheckScores state", () => {
      expect(componentCode).toContain("titleCheckScores");
    });

    it("should call evaluateTitleChecklist mutation", () => {
      expect(componentCode).toContain("evaluateTitleChecklist");
    });

    it("should auto-trigger check when candidates are generated", () => {
      expect(componentCode).toContain("autoCheckTriggered.current = true");
    });

    it("should reset autoCheckTriggered on new generation", () => {
      expect(componentCode).toContain("autoCheckTriggered.current = false");
    });

    it("should render ChecklistPanel with title dimensions", () => {
      expect(componentCode).toContain("dimensions={TITLE_CHECKLIST_DIMENSIONS}");
    });

    it("should pass checkListScores to ChecklistPanel", () => {
      expect(componentCode).toContain("checkListScores={titleCheckScores}");
    });

    it("should show panel title for title checklist", () => {
      expect(componentCode).toContain("标题 - 10维度质量自检");
    });
  });
});

// ─── Test: StepSearchTerms 5-Dimension Checklist Integration ─────────
describe("StepSearchTerms 5-Dimension Checklist", () => {
  const componentPath = path.join(__dirname, "../client/src/pages/listing/StepSearchTerms.tsx");
  const componentCode = fs.readFileSync(componentPath, "utf-8");

  describe("Dimensions Definition", () => {
    it("should define SEARCH_TERMS_CHECKLIST_DIMENSIONS array", () => {
      expect(componentCode).toContain("const SEARCH_TERMS_CHECKLIST_DIMENSIONS");
    });

    it("should contain all 5 dimension codes S1-S5", () => {
      for (let i = 1; i <= 5; i++) {
        expect(componentCode).toContain(`"S${i}"`);
      }
    });

    it("should have S1 byteLimit dimension", () => {
      expect(componentCode).toContain('key: "byteLimit"');
      expect(componentCode).toContain('code: "S1"');
    });

    it("should have S2 noTitleDuplication dimension", () => {
      expect(componentCode).toContain('key: "noTitleDuplication"');
      expect(componentCode).toContain('code: "S2"');
    });

    it("should have S3 formatCompliance dimension", () => {
      expect(componentCode).toContain('key: "formatCompliance"');
      expect(componentCode).toContain('code: "S3"');
    });

    it("should have S4 prohibitedWords dimension", () => {
      expect(componentCode).toContain('key: "prohibitedWords"');
      expect(componentCode).toContain('code: "S4"');
    });

    it("should have S5 longTailPriority dimension", () => {
      expect(componentCode).toContain('key: "longTailPriority"');
      expect(componentCode).toContain('code: "S5"');
    });
  });

  describe("Auto-trigger Integration", () => {
    it("should import ChecklistPanel component", () => {
      expect(componentCode).toContain('import ChecklistPanel from "@/components/ChecklistPanel"');
    });

    it("should import useEffect and useRef", () => {
      expect(componentCode).toContain("useEffect");
      expect(componentCode).toContain("useRef");
    });

    it("should call evaluateSearchTermsChecklist mutation", () => {
      expect(componentCode).toContain("evaluateSearchTermsChecklist");
    });

    it("should auto-trigger check when search terms are generated", () => {
      expect(componentCode).toContain("autoCheckTriggered.current = true");
    });

    it("should reset autoCheckTriggered on new generation", () => {
      expect(componentCode).toContain("autoCheckTriggered.current = false");
    });

    it("should render ChecklistPanel with search terms dimensions", () => {
      expect(componentCode).toContain("dimensions={SEARCH_TERMS_CHECKLIST_DIMENSIONS}");
    });

    it("should show panel title for search terms checklist", () => {
      expect(componentCode).toContain("搜索词 - 5维度质量自检");
    });
  });
});

// ─── Test: StepDescription 8-Dimension Checklist Integration ─────────
describe("StepDescription 8-Dimension Checklist", () => {
  const componentPath = path.join(__dirname, "../client/src/pages/listing/StepDescription.tsx");
  const componentCode = fs.readFileSync(componentPath, "utf-8");

  describe("Dimensions Definition", () => {
    it("should define DESCRIPTION_CHECKLIST_DIMENSIONS array", () => {
      expect(componentCode).toContain("const DESCRIPTION_CHECKLIST_DIMENSIONS");
    });

    it("should contain all 8 dimension codes D1-D8", () => {
      for (let i = 1; i <= 8; i++) {
        expect(componentCode).toContain(`"D${i}"`);
      }
    });

    it("should have D1 readability dimension", () => {
      expect(componentCode).toContain('key: "readability"');
      expect(componentCode).toContain('code: "D1"');
    });

    it("should have D2 characterLimit dimension", () => {
      expect(componentCode).toContain('key: "characterLimit"');
      expect(componentCode).toContain('code: "D2"');
    });

    it("should have D3 hookOpening dimension", () => {
      expect(componentCode).toContain('key: "hookOpening"');
      expect(componentCode).toContain('code: "D3"');
    });

    it("should have D4 sellingPointCoverage dimension", () => {
      expect(componentCode).toContain('key: "sellingPointCoverage"');
      expect(componentCode).toContain('code: "D4"');
    });

    it("should have D5 keywordIntegration dimension", () => {
      expect(componentCode).toContain('key: "keywordIntegration"');
      expect(componentCode).toContain('code: "D5"');
    });

    it("should have D6 htmlFormatting dimension", () => {
      expect(componentCode).toContain('key: "htmlFormatting"');
      expect(componentCode).toContain('code: "D6"');
    });

    it("should have D7 specsParameters dimension", () => {
      expect(componentCode).toContain('key: "specsParameters"');
      expect(componentCode).toContain('code: "D7"');
    });

    it("should have D8 trustClosing dimension", () => {
      expect(componentCode).toContain('key: "trustClosing"');
      expect(componentCode).toContain('code: "D8"');
    });
  });

  describe("Auto-trigger Integration", () => {
    it("should import ChecklistPanel component", () => {
      expect(componentCode).toContain('import ChecklistPanel from "@/components/ChecklistPanel"');
    });

    it("should import useEffect and useRef", () => {
      expect(componentCode).toContain("useEffect");
      expect(componentCode).toContain("useRef");
    });

    it("should call evaluateDescriptionChecklist mutation", () => {
      expect(componentCode).toContain("evaluateDescriptionChecklist");
    });

    it("should auto-trigger check when description is generated", () => {
      expect(componentCode).toContain("autoCheckTriggered.current = true");
    });

    it("should reset autoCheckTriggered on new generation", () => {
      expect(componentCode).toContain("autoCheckTriggered.current = false");
    });

    it("should render ChecklistPanel with description dimensions", () => {
      expect(componentCode).toContain("dimensions={DESCRIPTION_CHECKLIST_DIMENSIONS}");
    });

    it("should show panel title for description checklist", () => {
      expect(componentCode).toContain("产品描述 - 8维度质量自检");
    });
  });
});

// ─── Test: StepQA 8-Dimension Checklist Integration ─────────────────
describe("StepQA 8-Dimension Checklist", () => {
  const componentPath = path.join(__dirname, "../client/src/pages/listing/StepQA.tsx");
  const componentCode = fs.readFileSync(componentPath, "utf-8");

  describe("Dimensions Definition", () => {
    it("should define QA_CHECKLIST_DIMENSIONS array", () => {
      expect(componentCode).toContain("const QA_CHECKLIST_DIMENSIONS");
    });

    it("should contain all 8 dimension codes Q1-Q8", () => {
      for (let i = 1; i <= 8; i++) {
        expect(componentCode).toContain(`"Q${i}"`);
      }
    });

    it("should have Q1 questionNaturalness dimension", () => {
      expect(componentCode).toContain('key: "questionNaturalness"');
      expect(componentCode).toContain('code: "Q1"');
    });

    it("should have Q2 answerProfessionalism dimension", () => {
      expect(componentCode).toContain('key: "answerProfessionalism"');
      expect(componentCode).toContain('code: "Q2"');
    });

    it("should have Q3 painPointCoverage dimension", () => {
      expect(componentCode).toContain('key: "painPointCoverage"');
      expect(componentCode).toContain('code: "Q3"');
    });

    it("should have Q4 differentiationCoverage dimension", () => {
      expect(componentCode).toContain('key: "differentiationCoverage"');
      expect(componentCode).toContain('code: "Q4"');
    });

    it("should have Q5 categoryStandard dimension", () => {
      expect(componentCode).toContain('key: "categoryStandard"');
      expect(componentCode).toContain('code: "Q5"');
    });

    it("should have Q6 dataQuantification dimension", () => {
      expect(componentCode).toContain('key: "dataQuantification"');
      expect(componentCode).toContain('code: "Q6"');
    });

    it("should have Q7 semanticRelation dimension", () => {
      expect(componentCode).toContain('key: "semanticRelation"');
      expect(componentCode).toContain('code: "Q7"');
    });

    it("should have Q8 priorityOrder dimension", () => {
      expect(componentCode).toContain('key: "priorityOrder"');
      expect(componentCode).toContain('code: "Q8"');
    });
  });

  describe("Auto-trigger Integration", () => {
    it("should import ChecklistPanel component", () => {
      expect(componentCode).toContain('import ChecklistPanel from "@/components/ChecklistPanel"');
    });

    it("should import useEffect and useRef", () => {
      expect(componentCode).toContain("useEffect");
      expect(componentCode).toContain("useRef");
    });

    it("should call evaluateQAChecklist mutation", () => {
      expect(componentCode).toContain("evaluateQAChecklist");
    });

    it("should auto-trigger check when QA items are generated", () => {
      expect(componentCode).toContain("autoCheckTriggered.current = true");
    });

    it("should reset autoCheckTriggered on new generation", () => {
      expect(componentCode).toContain("autoCheckTriggered.current = false");
    });

    it("should render ChecklistPanel with QA dimensions", () => {
      expect(componentCode).toContain("dimensions={QA_CHECKLIST_DIMENSIONS}");
    });

    it("should show panel title for QA checklist", () => {
      expect(componentCode).toContain("QA问答 - 8维度质量自检");
    });
  });
});

// ─── Test: Backend Evaluation Prompts ───────────────────────────────
describe("Backend Evaluation Prompts", () => {
  const promptsPath = path.join(__dirname, "prompts.ts");
  const promptsCode = fs.readFileSync(promptsPath, "utf-8");

  it("should export EVALUATE_TITLE_CHECKLIST_PROMPT", () => {
    expect(promptsCode).toContain("export const EVALUATE_TITLE_CHECKLIST_PROMPT");
  });

  it("should export EVALUATE_DESCRIPTION_CHECKLIST_PROMPT", () => {
    expect(promptsCode).toContain("export const EVALUATE_DESCRIPTION_CHECKLIST_PROMPT");
  });

  it("should export EVALUATE_SEARCH_TERMS_CHECKLIST_PROMPT", () => {
    expect(promptsCode).toContain("export const EVALUATE_SEARCH_TERMS_CHECKLIST_PROMPT");
  });

  it("should export EVALUATE_QA_CHECKLIST_PROMPT", () => {
    expect(promptsCode).toContain("export const EVALUATE_QA_CHECKLIST_PROMPT");
  });

  describe("Title Prompt Dimensions", () => {
    it("should include readability dimension key", () => {
      expect(promptsCode).toContain("readability");
    });

    it("should include formatting dimension key", () => {
      expect(promptsCode).toContain("formatting");
    });

    it("should include characterCount dimension key", () => {
      expect(promptsCode).toContain("characterCount");
    });

    it("should include coreKeywords dimension key", () => {
      expect(promptsCode).toContain("coreKeywords");
    });

    it("should include wordOrder dimension key", () => {
      expect(promptsCode).toContain("wordOrder");
    });
  });

  describe("Description Prompt Dimensions", () => {
    it("should include hookOpening dimension key", () => {
      expect(promptsCode).toContain("hookOpening");
    });

    it("should include htmlFormatting dimension key", () => {
      expect(promptsCode).toContain("htmlFormatting");
    });

    it("should include trustClosing dimension key", () => {
      expect(promptsCode).toContain("trustClosing");
    });
  });

  describe("Search Terms Prompt Dimensions", () => {
    it("should include byteLimit dimension key", () => {
      expect(promptsCode).toContain("byteLimit");
    });

    it("should include noTitleDuplication dimension key", () => {
      expect(promptsCode).toContain("noTitleDuplication");
    });

    it("should include prohibitedWords dimension key", () => {
      expect(promptsCode).toContain("prohibitedWords");
    });

    it("should include longTailPriority dimension key", () => {
      expect(promptsCode).toContain("longTailPriority");
    });
  });

  describe("QA Prompt Dimensions", () => {
    it("should include questionNaturalness dimension key", () => {
      expect(promptsCode).toContain("questionNaturalness");
    });

    it("should include answerProfessionalism dimension key", () => {
      expect(promptsCode).toContain("answerProfessionalism");
    });

    it("should include painPointCoverage dimension key", () => {
      expect(promptsCode).toContain("painPointCoverage");
    });

    it("should include differentiationCoverage dimension key", () => {
      expect(promptsCode).toContain("differentiationCoverage");
    });

    it("should include priorityOrder dimension key", () => {
      expect(promptsCode).toContain("priorityOrder");
    });
  });
});

// ─── Test: Backend Router Endpoints ─────────────────────────────────
describe("Backend Router Endpoints", () => {
  const routerPath = path.join(__dirname, "routers/listing.ts");
  const routerCode = fs.readFileSync(routerPath, "utf-8");

  it("should have evaluateTitleChecklist endpoint", () => {
    expect(routerCode).toContain("evaluateTitleChecklist:");
  });

  it("should have evaluateDescriptionChecklist endpoint", () => {
    expect(routerCode).toContain("evaluateDescriptionChecklist:");
  });

  it("should have evaluateSearchTermsChecklist endpoint", () => {
    expect(routerCode).toContain("evaluateSearchTermsChecklist:");
  });

  it("should have evaluateQAChecklist endpoint", () => {
    expect(routerCode).toContain("evaluateQAChecklist:");
  });

  it("should use protectedProcedure for all evaluate endpoints", () => {
    const titleMatch = routerCode.match(/evaluateTitleChecklist:\s*protectedProcedure/);
    expect(titleMatch).not.toBeNull();

    const descMatch = routerCode.match(/evaluateDescriptionChecklist:\s*protectedProcedure/);
    expect(descMatch).not.toBeNull();

    const searchMatch = routerCode.match(/evaluateSearchTermsChecklist:\s*protectedProcedure/);
    expect(searchMatch).not.toBeNull();

    const qaMatch = routerCode.match(/evaluateQAChecklist:\s*protectedProcedure/);
    expect(qaMatch).not.toBeNull();
  });

  it("should use json_object response format for all evaluate endpoints", () => {
    // Count occurrences of json_object in evaluate sections
    const evaluateSection = routerCode.slice(routerCode.indexOf("evaluateTitleChecklist:"));
    const jsonObjectCount = (evaluateSection.match(/json_object/g) || []).length;
    expect(jsonObjectCount).toBeGreaterThanOrEqual(4);
  });

  it("should return checkListScores from all evaluate endpoints", () => {
    const evaluateSection = routerCode.slice(routerCode.indexOf("evaluateTitleChecklist:"));
    const returnCount = (evaluateSection.match(/return \{ checkListScores:/g) || []).length;
    expect(returnCount).toBeGreaterThanOrEqual(4);
  });

  describe("Title Endpoint", () => {
    it("should accept title input", () => {
      const section = routerCode.slice(
        routerCode.indexOf("evaluateTitleChecklist:"),
        routerCode.indexOf("evaluateDescriptionChecklist:")
      );
      expect(section).toContain("title: z.string()");
    });

    it("should include character count in user message", () => {
      const section = routerCode.slice(
        routerCode.indexOf("evaluateTitleChecklist:"),
        routerCode.indexOf("evaluateDescriptionChecklist:")
      );
      expect(section).toContain("Character count:");
    });
  });

  describe("Description Endpoint", () => {
    it("should accept description input", () => {
      const section = routerCode.slice(
        routerCode.indexOf("evaluateDescriptionChecklist:"),
        routerCode.indexOf("evaluateSearchTermsChecklist:")
      );
      expect(section).toContain("description: z.string()");
    });
  });

  describe("Search Terms Endpoint", () => {
    it("should accept searchTerms input", () => {
      const section = routerCode.slice(
        routerCode.indexOf("evaluateSearchTermsChecklist:"),
        routerCode.indexOf("evaluateQAChecklist:")
      );
      expect(section).toContain("searchTerms: z.string()");
    });

    it("should include byte count in user message", () => {
      const section = routerCode.slice(
        routerCode.indexOf("evaluateSearchTermsChecklist:"),
        routerCode.indexOf("evaluateQAChecklist:")
      );
      expect(section).toContain("Byte count:");
    });

    it("should accept optional title for duplication check", () => {
      const section = routerCode.slice(
        routerCode.indexOf("evaluateSearchTermsChecklist:"),
        routerCode.indexOf("evaluateQAChecklist:")
      );
      expect(section).toContain("title: z.string().optional()");
    });
  });

  describe("QA Endpoint", () => {
    it("should accept qaContent input", () => {
      const section = routerCode.slice(routerCode.indexOf("evaluateQAChecklist:"));
      expect(section).toContain("qaContent: z.string()");
    });

    it("should parse QA array format", () => {
      const section = routerCode.slice(routerCode.indexOf("evaluateQAChecklist:"));
      expect(section).toContain("JSON.parse(input.qaContent)");
    });
  });
});
