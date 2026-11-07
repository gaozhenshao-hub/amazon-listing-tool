import { build } from "esbuild";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { ZipArchive } from "archiver";
import { RESEARCH_EXTENSION_HOST_PERMISSION } from "../extensions/research-collector/origin.mjs";
const out = "artifacts/research-collector";
await mkdir(out, { recursive: true });
for (const name of ["background", "content", "popup"])
  await build({
    entryPoints: [`extensions/research-collector/${name}.ts`],
    outfile: `${out}/${name}.js`,
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome109",
    minify: true,
  });
await copyFile("extensions/research-collector/popup.html", `${out}/popup.html`);
const source = await readFile("shared/researchLibrary.ts", "utf8"),
  hosts = [
    ...source
      .match(/AMAZON_RESEARCH_HOSTS\s*=\s*(\[[\s\S]*?\])\s*as const/)[1]
      .matchAll(/"([^"]+)"/g),
  ].map(match => match[1]);
await writeFile(
  `${out}/manifest.json`,
  JSON.stringify(
    {
      manifest_version: 3,
      name: "星启产品收藏",
      version: "1.1.0",
      description: "登录星启系统，收藏亚马逊产品和店铺到本人的待调研产品库。",
      minimum_chrome_version: "109",
      permissions: ["storage"],
      host_permissions: [RESEARCH_EXTENSION_HOST_PERMISSION],
      background: { service_worker: "background.js" },
      action: { default_popup: "popup.html", default_title: "星启产品收藏" },
      content_scripts: [
        {
          matches: hosts.flatMap(host => [
            `https://${host}/*`,
            `https://www.${host}/*`,
          ]),
          js: ["content.js"],
          run_at: "document_idle",
        },
      ],
    },
    null,
    2
  )
);
await writeFile(
  `${out}/安装说明.txt`,
  "星启产品收藏（Chrome / Edge）\n1. 解压此文件夹并保留。\n2. 打开 chrome://extensions 或 edge://extensions。\n3. 打开开发者模式，加载已解压的扩展，选择本文件夹。\n4. 工具栏点插件，选择登录系统账号，在弹出的对话框输入系统账号和密码。登录保留30天。\n5. 不需要跳转网页登录。更新旧版本后，在扩展管理页面重新加载一次。浏览亚马逊商品或店铺后点击收藏按钮。\n6. 到系统的产品开发 → 待调研产品库查看。员工查看本人收藏，管理员查看工作区所有收藏。\n插件只申请存储权限、亚马逊页面内容脚本与星启系统接口访问，不读取浏览器Cookie或其他网站历史。\n"
);
await mkdir("client/public/downloads", { recursive: true });
const stream = createWriteStream(
    "client/public/downloads/research-collector.zip"
  ),
  zip = new ZipArchive({ zlib: { level: 9 } }),
  done = new Promise((resolve, reject) => {
    stream.on("close", resolve);
    stream.on("error", reject);
    zip.on("error", reject);
  });
zip.pipe(stream);
zip.directory(out, false);
await zip.finalize();
await done;
console.log("收藏插件已打包：client/public/downloads/research-collector.zip");
