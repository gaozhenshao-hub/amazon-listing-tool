import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(process.cwd());
const SERVER_ROOT = join(ROOT, "server");
const APPROVED_PLATFORM_CALLERS = new Map([
  ["server/domains/ai_os/services/skillRunner.ts", "skill_runner_provider_call"],
  ["server/domains/ai_os/routers/run.ts", "skill_runner_provider_call"],
  ["server/domains/ai_os/routers/models.ts", "model_health_check"],
  ["server/domains/ai_os/routers/diagnostics.ts", "platform_diagnostics"],
]);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts") || entry.name.endsWith(".real.test.ts")) return [];
    if (/\s+\d+\.ts$/.test(entry.name)) return [];
    return [path];
  });
}

function propertyName(property, sourceFile) {
  return property.name?.getText(sourceFile).replace(/^["']|["']$/g, "") || "";
}

const violations = [];
let businessSkillCalls = 0;
let platformRawCalls = 0;

for (const absolutePath of sourceFiles(SERVER_ROOT)) {
  const file = relative(ROOT, absolutePath).replaceAll("\\", "/");
  const sourceText = readFileSync(absolutePath, "utf8");
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const approvedReason = APPROVED_PLATFORM_CALLERS.get(file);

  function report(node, message) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push(`${file}:${line + 1} ${message}`);
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      const importsRawLlm = node.importClause.namedBindings.elements.some((element) => element.name.text === "invokeLLM");
      if (importsRawLlm && !approvedReason) report(node, "business code cannot import invokeLLM");
    }

    if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === "invokeLLM") {
      platformRawCalls += 1;
      if (!approvedReason) {
        report(node, "business code must call invokeBusinessSkill instead of invokeLLM");
      } else if (!sourceText.includes(`emperorBypassReason: "${approvedReason}"`) && !sourceText.includes(`emperorBypassReason = "${approvedReason}"`)) {
        report(node, `platform bypass must declare reason '${approvedReason}'`);
      }
    }

    if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === "invokeBusinessSkill") {
      businessSkillCalls += 1;
      const input = node.arguments[0];
      if (input && ts.isObjectLiteralExpression(input)) {
        for (const property of input.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const name = propertyName(property, sourceFile);
          if (name === "bypassEmperor") report(property, "business Skill calls cannot bypass Emperor");
          if (name === "emperorBypassReason") report(property, "bypass reasons are reserved for AI OS platform code");
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

if (violations.length) {
  console.error("Emperor Skill boundary violations:\n" + violations.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

console.log(`Emperor Skill boundary passed: ${businessSkillCalls} business Skill calls, ${platformRawCalls} approved platform LLM calls.`);
