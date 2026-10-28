import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../dist/public/release-features.json", import.meta.url)), "utf8"));
if (manifest.edition !== "slim-20261023") throw new Error("禁止发布：构建版本不符");
if (manifest.authMode !== "local") throw new Error("禁止发布：未启用本地账号登录");
if (manifest.flags?.VITE_ENABLE_MERGED_READONLY_FEATURES !== "1") throw new Error("禁止发布：图片知识库浏览功能未启用");
console.log("Release verified: slim edition, local login, image library browsing.");
