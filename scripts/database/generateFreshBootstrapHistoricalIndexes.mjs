// Source-only deterministic replay of the reviewed fresh lineage's explicit indexes.
// Does not execute SQL, connect to a database, import schema TS or modify files.
// Usage: node scripts/database/generateFreshBootstrapHistoricalIndexes.mjs --projection-dir /absolute/public-projection
// Emits the regenerated JSON to stdout for review and an explicit apply_patch update.
import fs from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFreshBootstrapPlan, sha256, fingerprint } from "./freshBootstrapPlan.mjs";
import { splitPublicStatements } from "./freshBootstrapReference.mjs";

export function buildHistoricalIndexInventory({ projectionSql, metadataBytes, bundle = loadFreshBootstrapPlan() }) {
  const projectionMetadata=JSON.parse(metadataBytes);
  must(sha256(projectionSql)==='d330a73df3419ae5a4a5bc064d31e6596d39bbe4e300febe37e99591eb5824a0'
   && sha256(metadataBytes)==='8e216c7c03a26915fb9e8e43d8055f9c61858aca27ca0efd111ab58aff36e0b8'
   && projectionMetadata.sourceSha256==='1348efaf7bb30e9c9e262d9ab8c8ca3ffec85428bdaaf9b391f841466988d926', 'public projection pins changed');
  function must(x,message){if(!x)throw Error(message);}
  function splitList(text){
    const out=[];let start=0,depth=0,quote=null;
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(quote){if(c==='\\'){i++;continue;}if(c===quote){if(text[i+1]===quote)i++;else quote=null;}continue;}
      if(["'","\x22","`"].includes(c)){quote=c;continue;}
      if(c==='(')depth++;else if(c===')')depth--;else if(c===','&&depth===0){out.push(text.slice(start,i).trim());start=i+1;}
      must(depth>=0,'negative list depth');
    }
    must(!quote&&depth===0,'unbalanced list');if(text.slice(start).trim())out.push(text.slice(start).trim());return out;
  }
  function bodyOf(sql){
    const start=sql.indexOf('(');must(start>=0,'no opening body');
    let quote=null,depth=0;
    for(let i=start;i<sql.length;i++){
      const c=sql[i];if(quote){if(c==='\\'){i++;continue;}if(c===quote){if(sql[i+1]===quote)i++;else quote=null;}continue;}
      if(["'","\x22","`"].includes(c)){quote=c;continue;}if(c==='(')depth++;else if(c===')'){depth--;if(depth===0)return{body:sql.slice(start+1,i),tail:sql.slice(i+1).trim()};}
    }throw Error('unclosed body');
  }
  function columns(text){
    return splitList(text).map(part=>{
      const match=part.match(/^`?([A-Za-z_][A-Za-z0-9_$]*)`?\s*(?:\(\s*(\d+)\s*\))?\s*(ASC|DESC)?$/i);
      must(match,'unreviewed index part '+part);
      return {name:match[1],prefixLength:match[2]?Number(match[2]):null,direction:match[3]?.toUpperCase()==='DESC'?'D':'A'};
    });
  }
  const signature=item=>fingerprint({unique:item.unique,indexType:item.indexType,columns:item.columns});
  function createSql(item){
   const parts=item.columns.map(p=>'`'+p.name+'`'+(p.prefixLength===null?'':'('+p.prefixLength+')')+(p.direction==='D'?' DESC':'')).join(', ');
   return 'CREATE '+(item.unique?'UNIQUE ':'')+'INDEX `'+item.name+'` ON `'+item.table+'` ('+parts+');';
  }
  function parseKey(clause,table,source,defaultDeclaration){
   const original=clause;let name;const con=clause.match(/^CONSTRAINT\s+`?([A-Za-z_][A-Za-z0-9_$]*)`?\s+/i);
   if(con){name=con[1];clause=clause.slice(con[0].length);}
   let unique=false,primary=false;
   if(/^PRIMARY KEY\s*\(/i.test(clause)){primary=true;unique=true;name='PRIMARY';clause=clause.replace(/^PRIMARY KEY\s*/i,'');}
   else if(/^UNIQUE\b/i.test(clause)){
     unique=true;clause=clause.replace(/^UNIQUE(?:\s+(?:KEY|INDEX))?\s*/i,'');
     if(!clause.startsWith('(')){const m=clause.match(/^`?([A-Za-z_][A-Za-z0-9_$]*)`?\s*/);must(m,'missing unique name');name=m[1];clause=clause.slice(m[0].length);}
   } else if(/^(KEY|INDEX)\b/i.test(clause)){
     clause=clause.replace(/^(?:KEY|INDEX)\s*/i,'');const m=clause.match(/^`?([A-Za-z_][A-Za-z0-9_$]*)`?\s*/);must(m,'missing index name');name=m[1];clause=clause.slice(m[0].length);
   } else return null;
   must(name&&clause.startsWith('('),'unreviewed key syntax '+original);
   const {body,tail}=bodyOf(clause);must(tail===''||/^USING BTREE$/i.test(tail),'unreviewed key suffix '+tail);
   const item={table,name,unique,indexType:'BTREE',columns:columns(body),source,declaration:defaultDeclaration,declarationSql:original,declarationSha256:sha256(original)};
   if(!primary)item.createSql=createSql(item);
   return item;
  }
  function replay(entries,label){
   const active=new Map(),tables=new Set(),exclusions=[],mutations=[];
   const add=item=>{const key=item.table+'.'+item.name;must(!active.has(key),label+': duplicate index '+key);active.set(key,item);};
   for(const entry of entries){
    const statements=splitPublicStatements(entry.sql);
    for(const [statementIndex,rawSql]of statements.entries()){
     const sql=rawSql.replace(/^--> statement-breakpoint\s*/gm,'').trim();
     const source={path:entry.path,sha256:entry.sha256,statementIndex,statementSha256:sha256(rawSql),executableStatementSha256:sha256(sql)};
     let match=sql.match(/^CREATE TABLE(?: IF NOT EXISTS)?\s+`?([A-Za-z_][A-Za-z0-9_$]*)`?\s*\(/i);
     if(match){
      const table=match[1];if(tables.has(table)){must(/^CREATE TABLE IF NOT EXISTS/i.test(sql),'duplicate table '+table);exclusions.push({reason:'create-if-not-exists-after-earlier-real-create',table,source});continue;}tables.add(table);
      for(const clause of splitList(bodyOf(sql).body)){
       const parsed=parseKey(clause,table,source,'inline-key');if(parsed){add(parsed);continue;}
       const col=clause.match(/^`?([A-Za-z_][A-Za-z0-9_$]*)`?\s+/);
       if(col&&!/^(CONSTRAINT|FOREIGN|CHECK)\b/i.test(clause)){
        const isPrimary=/\bPRIMARY KEY\b/i.test(clause),isUnique=/\bUNIQUE\b/i.test(clause);
        if(isPrimary||isUnique){const item={table,name:isPrimary?'PRIMARY':col[1],unique:true,indexType:'BTREE',columns:[{name:col[1],prefixLength:null,direction:'A'}],source,declaration:'inline-column',declarationSql:clause,declarationSha256:sha256(clause)};if(!isPrimary)item.createSql=createSql(item);add(item);}
       }
      }continue;
     }
     match=sql.match(/^CREATE\s+(UNIQUE\s+)?INDEX\s+`?([A-Za-z_][A-Za-z0-9_$]*)`?\s+ON\s+`?([A-Za-z_][A-Za-z0-9_$]*)`?\s*\(/i);
     if(match){const {body,tail}=bodyOf(sql);must(tail===''||/^USING BTREE$/i.test(tail),'index suffix');const item={table:match[3],name:match[2],unique:!!match[1],indexType:'BTREE',columns:columns(body),source,declaration:'create-index',declarationSql:sql,declarationSha256:sha256(sql)};item.createSql=createSql(item);add(item);continue;}
     match=sql.match(/^DROP INDEX\s+`?([A-Za-z_][A-Za-z0-9_$]*)`?\s+ON\s+`?([A-Za-z_][A-Za-z0-9_$]*)`?$/i);
     if(match){
      must(entry.path==='drizzle/bootstrap/0004_current_source_alignment.sql'&&match[1]==='idx_sh_asin_week'&&match[2]==='saihu_product_weekly','unreviewed standalone index drop');
      const key=match[2]+'.'+match[1];must(active.has(key),'drop unknown index '+key);
      const removed=active.get(key);must(removed.unique===false,'reviewed lookup unexpectedly unique');
      active.delete(key);exclusions.push({reason:'explicit-drop-index',removed,source});continue;
     }
     match=sql.match(/^DROP TABLE\s+`?([A-Za-z_][A-Za-z0-9_$]*)`?$/i);
     if(match){const table=match[1];must(tables.has(table),'drop unknown table '+table+' in '+source.path+' known '+[...tables].slice(0,10).join(','));tables.delete(table);for(const [key,item]of active)if(item.table===table){active.delete(key);exclusions.push({reason:'explicit-drop-table',removed:item,source});}continue;}
     match=sql.match(/^ALTER TABLE\s+`?([A-Za-z_][A-Za-z0-9_$]*)`?\s+([\s\S]+)$/i);
     if(match){const table=match[1];for(const clause of splitList(match[2])){
      const addKey=clause.match(/^ADD\s+(?=(?:CONSTRAINT|PRIMARY KEY|UNIQUE|KEY|INDEX)\b)([\s\S]+)$/i);
      if(addKey){const item=parseKey(addKey[1],table,source,'alter-add-index');must(item,'unreviewed alter key '+clause);add(item);mutations.push({operation:'alter-add-index',table,name:item.name,source});continue;}
      const drop=clause.match(/^DROP\s+(?:INDEX|KEY)\s+`?([A-Za-z_][A-Za-z0-9_$]*)`?$/i);
      if(drop){const key=table+'.'+drop[1];must(active.has(key),'drop unknown index '+key);const removed=active.get(key);active.delete(key);exclusions.push({reason:'explicit-drop-index',removed,source});continue;}
      const changeColumn=clause.match(/^CHANGE COLUMN\s+`?([A-Za-z_][A-Za-z0-9_$]*)`?\s+`?([A-Za-z_][A-Za-z0-9_$]*)`?\s+/i);
      if(changeColumn){
       const permitted={ops_inventory_planning_versions:'inventory_planning_version_status',ops_replenishment_plans:'replenishment_plan_status'};
       must(entry.path==='drizzle/bootstrap/0004_current_source_alignment.sql'&&changeColumn[1]==='status'&&permitted[table]===changeColumn[2],'unreviewed index column rename');
       let affected=0;
       for(const item of active.values())if(item.table===table&&item.columns.some(c=>c.name===changeColumn[1])){
        item.columns=item.columns.map(c=>c.name===changeColumn[1]?{...c,name:changeColumn[2]}:c);
        item.columnRenames=[...(item.columnRenames??[]),{from:changeColumn[1],to:changeColumn[2],source}];
        if(item.name!=='PRIMARY')item.createSql=createSql(item);affected++;
       }
       must(affected===1,'reviewed status index dependency changed');
       mutations.push({operation:'change-column-preserving-index',table,from:changeColumn[1],to:changeColumn[2],affectedIndexes:affected,source});continue;
      }
      const dropColumn=clause.match(/^DROP COLUMN(?: IF EXISTS)?\s+`?([A-Za-z_][A-Za-z0-9_$]*)`?$/i);
      if(dropColumn){const affected=[...active.values()].filter(x=>x.table===table&&x.columns.some(c=>c.name===dropColumn[1]));must(affected.length===0,'drop-column affects index '+table+'.'+dropColumn[1]);mutations.push({operation:'drop-column-not-indexed',table,column:dropColumn[1],source});continue;}
      must(!/\b(?:INDEX|KEY|CONSTRAINT|RENAME|CHANGE)\b/i.test(clause),'unhandled alter '+clause);
     }continue;}
     must(!/^(?:RENAME|DROP INDEX|CREATE (?:UNIQUE )?INDEX|ALTER TABLE)\b/i.test(sql),'unhandled ddl '+sql.slice(0,100));
    }
   }
   return {active:[...active.values()].sort((a,b)=>(a.table+'.'+a.name).localeCompare(b.table+'.'+b.name)),exclusions,mutations,tables:[...tables].sort()};
  }
  const history=replay(bundle.plan.map(x=>({path:'drizzle/'+x.fileName,sha256:x.checksum,sql:x.sql})),'historical');
  const projection=replay([{path:'source-projection.sql',sha256:sha256(projectionSql),sql:projectionSql}],'projection');
  const h=new Map(history.active.map(x=>[x.table+'.'+x.name,x])),p=new Map(projection.active.map(x=>[x.table+'.'+x.name,x]));
  const historyOnly=[],projectionOnly=[],sameNameMismatch=[],matching=[];
  for(const [key,index]of h){const other=p.get(key);if(!other)historyOnly.push({table:index.table,name:index.name,signature:signature(index)});else if(signature(index)!==signature(other))sameNameMismatch.push({table:index.table,name:index.name,historical:index,projection:other});else matching.push(key);}
  for(const [key,index]of p)if(!h.has(key))projectionOnly.push({index,equivalentHistoricalNames:history.active.filter(x=>x.table===index.table&&signature(x)===signature(index)).map(x=>x.name)});
  const output={version:'amazon-fresh-public-index-inventory/1',bootstrapPlanSha256:bundle.planSha256,bootstrapSourcesSha256:bundle.sourcesSha256,databaseConnected:false,candidateDatabaseUsed:false,productionDdlUsed:false,projection:{sqlSha256:sha256(projectionSql),metadataSha256:sha256(metadataBytes),sourceSha256:projectionMetadata.sourceSha256,tableCount:projectionMetadata.tableCount},inputs:bundle.plan.map(x=>({path:'drizzle/'+x.fileName,sha256:x.checksum})),activeIndexes:history.active.filter(x=>x.name!=='PRIMARY'),primaryKeys:history.active.filter(x=>x.name==='PRIMARY'),exclusions:history.exclusions,ddlMutations:history.mutations,comparison:{matchingCount:matching.length,historicalOnly:historyOnly,sameNameMismatch,projectionOnly},coverage:{declarationKinds:[...new Set(history.active.map(x=>x.declaration))].sort(),historicalTables:history.tables.length,projectionTables:projection.tables.length,totalHistoricalIndexesIncludingPrimary:history.active.length,totalProjectionIndexesIncludingPrimary:projection.active.length,unhandledIndexDdl:0},limitations:['Source-level syntax inventory; not executed SQL nor database metadata proof.','PRIMARY names normalize to MySQL physical PRIMARY; non-primary names/column order/prefix/direction/uniqueness are preserved.','A missing projection index must be added from reviewed public definition; projection-only or conflicting same-name definitions require explicit review, never silent removal.','Runtime automatically-created foreign-key indexes must be verified separately from public FK/parent prefix definitions.']};
  output.scope={businessTablesOnly:true,ledgerExcluded:"app_schema_migrations is created by the existing runner, not by a historical SQL statement in this inventory.",statementIndexBase:0,projectionIdentity:"fixed public aligned source projection; not candidate database metadata",historyOrder:"exact "+bundle.plan.length+"-entry fresh bootstrap source plan; latest live index after explicit DROP/CREATE operations",implicitForeignKeyIndexPolicy:"No implicit indexes synthesized; reference must preserve and verify FK supporting indexes."};
  output.comparison.primaryKeys={historicalCount:output.primaryKeys.length,projectionCount:projection.active.filter(x=>x.name==='PRIMARY').length,matchingCount:output.primaryKeys.filter(p=>!output.comparison.historicalOnly.some(h=>h.name==="PRIMARY"&&h.table===p.table)&&!output.comparison.sameNameMismatch.some(h=>h.name==="PRIMARY"&&h.table===p.table)).length,historicalOnly:output.comparison.historicalOnly.filter(x=>x.name==="PRIMARY").map(x=>x.table),sameNameMismatch:output.comparison.sameNameMismatch.filter(x=>x.name==="PRIMARY"),projectionOnly:output.comparison.projectionOnly.filter(x=>x.index.name==="PRIMARY").map(x=>x.index.table)};
  for(const x of output.comparison.projectionOnly)x.equivalentHistoricalDefinitions=output.activeIndexes.filter(i=>i.table===x.index.table&&x.equivalentHistoricalNames.includes(i.name)).map(i=>({name:i.name,source:i.source,declaration:i.declaration,declarationSha256:i.declarationSha256,createSql:i.createSql}));
  return output;

}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== "--projection-dir" || !isAbsolute(process.argv[3])) {
    process.stderr.write("Usage: --projection-dir /absolute/public-projection; no database access or file writes\n");
    process.exitCode = 1;
  } else {
    const directory = fs.realpathSync(process.argv[3]);
    const projectionSql = fs.readFileSync(resolve(directory, "source-projection.sql"), "utf8");
    const metadataBytes = fs.readFileSync(resolve(directory, "source-projection.metadata.json"), "utf8");
    process.stdout.write(JSON.stringify(buildHistoricalIndexInventory({ projectionSql, metadataBytes }), null, 2) + "\n");
  }
}
