import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, it } from "vitest";

it("keeps eagerly loaded Web, Worker and Scheduler packages in production dependencies", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const builtins = new Set(builtinModules.map(name => name.replace(/^node:/u, "")));
  const result = await build({ absWorkingDir: root,
    entryPoints: ["server/_core/index.ts", "server/_core/aiWorker.ts", "server/_core/scheduler.ts"],
    platform: "node", packages: "external", bundle: true, format: "esm", outdir: "dist", write: false, metafile: true,
  });
  const missing = new Set<string>();
  for (const [output, info] of Object.entries(result.metafile!.outputs)) {
    for (const dep of info.imports) {
      if (!dep.external || dep.kind === "dynamic-import" || builtins.has(dep.path.replace(/^node:/u, ""))) continue;
      const name = dep.path.startsWith("@") ? dep.path.split("/").slice(0, 2).join("/") : dep.path.split("/")[0];
      if (!Object.hasOwn(pkg.dependencies, name)) missing.add(`${output}: ${dep.path}`);
    }
  }
  expect([...missing]).toEqual([]);
}, 30_000);
