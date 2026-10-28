import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root=process.cwd();
const config=ts.readConfigFile(path.join(root,'tsconfig.json'),ts.sys.readFile);
const options=ts.parseJsonConfigFileContent(config.config,ts.sys,root).options;
const relative=p=>path.relative(root,p).replaceAll('\\','/');
const files=[];
function walk(dir){ for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.[cm]?[jt]sx?$/.test(p)&&!/(\.test\.|\.spec\.|__tests__)/.test(p))files.push(p);} }
for(const dir of ['client/src','server','shared'])walk(path.join(root,dir));
const graph=new Map();
const missing=[];
for(const file of files){
  const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
  const deps=[];
  function visit(n){
    let spec;
    if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier))spec=n.moduleSpecifier.text;
    if(ts.isCallExpression(n)&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||n.expression.getText(source)==='require')&&n.arguments.length&&ts.isStringLiteral(n.arguments[0]))spec=n.arguments[0].text;
    if(spec&&(spec.startsWith('.')||spec.startsWith('@/')||spec.startsWith('@shared/'))){
      const resolution=ts.resolveModuleName(spec,file,options,ts.sys).resolvedModule;
      if(resolution&&!resolution.isExternalLibraryImport)deps.push(relative(resolution.resolvedFileName));
      else if(!/\.(css|svg|png|jpg|json)$/.test(spec))missing.push({file:relative(file),spec});
    }
    ts.forEachChild(n,visit);
  }
  visit(source);graph.set(relative(file),deps);
}
const reached=new Set();
function reach(file){if(reached.has(file))return;reached.add(file);for(const dep of graph.get(file)||[])reach(dep);}
for(const entry of ['client/src/main.tsx','server/_core/index.ts','server/_core/aiWorker.ts','server/_core/scheduler.ts'])reach(entry);
const unreachable=[...graph.keys()].filter(p=>!reached.has(p));
const output={entrypoints:['client/src/main.tsx','server/_core/index.ts','server/_core/aiWorker.ts','server/_core/scheduler.ts'],reachable:reached.size,unreachable,missing,graph:Object.fromEntries(graph)};
const dest=process.argv[2]||'artifacts/platform-dependency-audit.json';
fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(output,null,2));
console.log(JSON.stringify({reachable:reached.size,unreachable:unreachable.length,missing:missing.length,report:dest}));
