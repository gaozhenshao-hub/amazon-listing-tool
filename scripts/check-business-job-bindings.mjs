import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const ROOT = resolve(process.cwd());
const SERVER_ROOT = join(ROOT, "server");
const JOB_FACTORIES = new Set(["createAiJobRun", "startRegisteredAiJob", "startAiJobInProcess"]);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith(".ts") || /\.(?:test|spec)\.ts$/.test(entry.name)) return [];
    if (/\s+\d+\.ts$/.test(entry.name)) return [];
    return [path];
  });
}

function propertyName(property, sourceFile) {
  return property.name?.getText(sourceFile).replace(/^["']|["']$/g, "") || "";
}

function findProperty(objectLiteral, name, sourceFile) {
  return objectLiteral.properties.find((property) => (
    (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))
    && propertyName(property, sourceFile) === name
  ));
}

const violations = [];
let checkedCalls = 0;

for (const absolutePath of sourceFiles(SERVER_ROOT)) {
  const file = relative(ROOT, absolutePath).replaceAll("\\", "/");
  if (file.startsWith("server/domains/ai_os/")) continue;

  const sourceText = readFileSync(absolutePath, "utf8");
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  function report(node, message) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push(`${file}:${line + 1} ${message}`);
  }

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const factoryName = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : "";
      if (JOB_FACTORIES.has(factoryName)) {
        checkedCalls += 1;
        const options = node.arguments[0];
        if (!options || !ts.isObjectLiteralExpression(options)) {
          report(node, `${factoryName} must receive an inline object so Agent binding can be audited`);
        } else {
          const inputProperty = findProperty(options, "input", sourceFile);
          if (!inputProperty || !ts.isPropertyAssignment(inputProperty) || !ts.isObjectLiteralExpression(inputProperty.initializer)) {
            report(node, `${factoryName}.input must be an inline object containing agentRunId and agentNodeId`);
          } else {
            for (const requiredField of ["agentRunId", "agentNodeId"]) {
              if (!findProperty(inputProperty.initializer, requiredField, sourceFile)) {
                report(inputProperty, `${factoryName}.input is missing explicit ${requiredField}`);
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

if (violations.length) {
  console.error(`Business Job Agent binding gate failed (${violations.length} violation${violations.length === 1 ? "" : "s"}):`);
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Business Job Agent binding gate passed: ${checkedCalls} production Job creation call${checkedCalls === 1 ? "" : "s"} audited.`);
