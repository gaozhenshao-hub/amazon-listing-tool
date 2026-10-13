import fs from "node:fs";
import base from "../../vitest.config.ts";
import { checkProtectedBaseline, DEFAULT_MANIFEST } from "./checkProtectedBaseline.mjs";
import { selectedTests } from "./testProtectedBaseline.mjs";

// Positional Vitest filters are substring matches, not an exact allowlist.
// Replace (do not concatenate) include with canonical, glob-free literal paths.
const root = new URL("../../", import.meta.url);
if (!checkProtectedBaseline().ok) throw new Error("Protected baseline drift; test gate refused");
const manifest = JSON.parse(fs.readFileSync(new URL(DEFAULT_MANIFEST, root), "utf8"));
export default { ...base, test: { ...base.test, include: selectedTests(manifest).unit } };
