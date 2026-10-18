import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { inventoryCollectionCanonical, inventoryCollectionHash } from "../shared/inventorySnapshotCollection";
import { inventoryPlanningWriteCanonical, inventoryPlanningWriteHash } from "../shared/inventoryPlanningWrite";
import { inventoryCanonical } from "../shared/inventorySnapshotMapping";
import { inventoryRefreshHash } from "../shared/inventorySnapshotRefresh";
import { operationsBoardEditionCanonical, operationsBoardEditionHash } from "../shared/operationsBoardEdition";
import { operationsCostSheetWriteCanonical, operationsCostSheetWriteHash } from "../shared/operationsCostSheetWrite";
import { productTaskWriteCanonical, productTaskWriteHash } from "../shared/productTaskWrite";

const root = fileURLToPath(new URL("../", import.meta.url));
const sources = [
  "inventorySnapshotRefresh", "operationsBoardEdition", "inventorySnapshotCollection",
  "productTaskRead", "productTaskWrite", "operationsCostSheetWrite", "inventoryPlanningWrite",
];
const nativeHash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const values = ["", "abc", "合成校验 🧪", "line one\nline two\r\n", JSON.stringify({ ratio: 9.900990099009901, other: 9.813725490196079 })];

describe("external crypto-js imports under actual Node ESM", () => {
  it("loads the explicit package file without a bundler and preserves the existing CommonJS hashes", () => {
    // A new Node process is deliberate: Vitest's resolver would mask the missing
    // extension that fails in packages-external ESM production bundles.
    // This process imports only the hash library, with no inherited credentials,
    // application modules, dotenv, database connection or model invocation.
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
      import SHA256 from "crypto-js/sha256.js";
      import { createRequire } from "node:module";
      const previous = createRequire(import.meta.url)("crypto-js/sha256");
      process.stdout.write(JSON.stringify(${JSON.stringify(values)}.map(value => ({
        explicit: SHA256(value).toString(), previous: previous(value).toString()
      }))));
    `], { cwd: root, env: { NODE_ENV: "test", TZ: "UTC" }, encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024 });
    expect(JSON.parse(output)).toEqual(values.map(value => ({ explicit: nativeHash(value), previous: nativeHash(value) })));
    expect(nativeHash("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it.each(sources)("keeps %s's external subpath directly resolvable by Node", source => {
    const text = readFileSync(new URL(`../shared/${source}.ts`, import.meta.url), "utf8");
    expect(text).toContain('import SHA256 from "crypto-js/sha256.js";');
    expect(text).not.toMatch(/["']crypto-js\/sha256["']/u);
  });

  it.each([
    { name: "inventory refresh", canonical: inventoryCanonical, hash: inventoryRefreshHash },
    { name: "inventory collection", canonical: inventoryCollectionCanonical, hash: inventoryCollectionHash },
    { name: "inventory planning", canonical: inventoryPlanningWriteCanonical, hash: inventoryPlanningWriteHash },
    { name: "operations board", canonical: operationsBoardEditionCanonical, hash: operationsBoardEditionHash },
    { name: "cost sheet", canonical: operationsCostSheetWriteCanonical, hash: operationsCostSheetWriteHash },
    { name: "product task write", canonical: productTaskWriteCanonical, hash: productTaskWriteHash },
  ])("preserves $name's exact canonical UTF-8 digest", ({ canonical, hash }) => {
    const input = { z: [null, true, false, 9.900990099009901, 9.813725490196079], a: "合成校验 🧪\n" };
    const expected = nativeHash(canonical(input));
    expect(hash(input)).toBe(expected);
    expect(hash({ a: input.a, z: input.z })).toBe(expected);
  });
});
