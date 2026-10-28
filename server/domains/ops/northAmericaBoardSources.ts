import { selectSaihuOwnerMappings } from "./saihuOwnerMapping";
import { buildMonthlyFinancialDetails, parseMonthlyFinancialBatch, type MonthlyFinancialReadRow } from "../../../shared/monthlyFinancialRead";
import { resolveNorthAmericaFinancialBindings, type CurrentUsFinancialBinding } from "../../../shared/northAmericaFinancialConsolidation";
import { buildNorthAmericaBoard, northAmericaProductKey, type NorthAmericaBoardOwner } from "../../../shared/northAmericaBoard";
import { normalizeMarketplaceCode } from "../../../shared/marketplaceIdentity";
import { splitExternalOperatorNames } from "./operatorNameResolution";
import { financialSourceCache, type CompactFinancialSource } from "./financialSourceCache";
import { IncompleteScan, InvalidSource, positiveId, projection, query, sourceRecord, SCAN_BYTES_MAX, SCAN_BATCHES_MAX, type Row, type Session } from "./monthlyBoardReadCore";

/** Fixed whole-source winners, before ownership, parent, month or operator filters.
 * Reading a smaller subset must never revive a superseded report. */
export async function readNorthAmericaFinancialSources(session: Session) {
  const candidates = await query(session.tx, `SELECT id,workspaceId,status,fileHash,
    DATE_FORMAT(confirmedAt,'%Y-%m-%d %H:%i:%s.%f') AS confirmedAt,
    totalRows,skippedRows,unallocatedRows,
    OCTET_LENGTH(CAST(payload AS CHAR CHARACTER SET utf8mb4)) AS payloadBytes,
    OCTET_LENGTH(CAST(months AS CHAR CHARACTER SET utf8mb4)) AS monthsBytes
    FROM ops_monthly_profit_imports WHERE workspaceId=? AND status='completed' ORDER BY id DESC LIMIT 201 FOR SHARE`, [session.identity.workspaceId]);
  if (candidates.length > SCAN_BATCHES_MAX) throw new IncompleteScan();
  let bytes = 0;
  const winners = new Map<string, CompactFinancialSource["rows"]>(), batches: Array<{id:number;fileHash:string}> = [];
  for (const [index,candidate] of candidates.entries()) {
    if (!positiveId(candidate.id) || candidate.workspaceId !== session.identity.workspaceId || candidate.status !== "completed" || index > 0 && Number(candidate.id) >= Number(candidates[index-1].id)
      || !Number.isSafeInteger(candidate.payloadBytes) || !Number.isSafeInteger(candidate.monthsBytes) || Number(candidate.payloadBytes) < 0 || Number(candidate.monthsBytes) < 0) throw new InvalidSource();
    const remaining = SCAN_BYTES_MAX-bytes;
    if (Number(candidate.payloadBytes)+Number(candidate.monthsBytes)>remaining) throw new IncompleteScan();
    // Completed imports are immutable; corrections create a new batch. Read
    // current metadata every time so withdrawals/new imports take effect now.
    const cacheKey = typeof candidate.fileHash === "string" && /^[a-f0-9]{64}$/i.test(candidate.fileHash)
      && typeof candidate.confirmedAt === "string"
      ? JSON.stringify([candidate.workspaceId,candidate.id,candidate.fileHash,candidate.confirmedAt,
        candidate.payloadBytes,candidate.monthsBytes,candidate.totalRows,candidate.skippedRows,candidate.unallocatedRows])
      : null;
    const load = async (): Promise<CompactFinancialSource> => {
      const selected = await query(session.tx, `SELECT ${projection(remaining)} FROM ops_monthly_profit_imports WHERE workspaceId=? AND id=? LIMIT 2 FOR SHARE`, [session.identity.workspaceId,candidate.id]);
      if (selected.length!==1 || selected[0].id!==candidate.id || selected[0].payloadBytes!==candidate.payloadBytes || selected[0].monthsBytes!==candidate.monthsBytes
        || cacheKey && (selected[0].fileHash!==candidate.fileHash || selected[0].confirmedAt!==candidate.confirmedAt)) throw new InvalidSource();
      const record = sourceRecord(selected[0],session.identity.workspaceId), parsed = parseMonthlyFinancialBatch(record, { summaryOnly: true });
      return { id:record.id,fileHash:record.fileHash,rows:parsed.rows.filter(row=>["US","CA","MX"].includes(row.country)).map(({details: _details, ...row})=>row) };
    };
    const source = cacheKey ? await financialSourceCache.load(cacheKey, load) : await load();
    bytes+=Number(candidate.payloadBytes)+Number(candidate.monthsBytes);
    batches.push({id:source.id,fileHash:source.fileHash});
    const scopes = new Map<string, CompactFinancialSource["rows"]>();
    for (const row of source.rows) {
      const key = JSON.stringify([row.yearMonth,row.storeName,row.country]);
      // The board needs totals and exact source references, not every nested
      // original API field and fee component for nine months at once. Validate
      // the entire original batch above, then release that heavyweight detail.
      // Originals remain immutable in ops_monthly_profit_imports for drilldown.
      const group = scopes.get(key) ?? []; group.push(row); scopes.set(key,group);
    }
    for (const [key,rows] of scopes) if (!winners.has(key)) winners.set(key,rows);
  }
  return { rows:[...winners.values()].flat().map(row => ({ ...row, details: buildMonthlyFinancialDetails(row.metrics, {}, row.currency !== null) })), batches };
}
const parentKey = (storeName:string,parentAsin:string) => northAmericaProductKey({storeName,asin:parentAsin});
const checkCount = (rows:Row[],limit:number) => { if (rows.length>limit) throw new IncompleteScan(); };

/** Exact confirmed user IDs are authority. Names are only external lookup keys,
 * never an implicit account/partner grant. Sellfox source relationships determine ownership. */
export async function readNorthAmericaOwnership(session:Session, history:MonthlyFinancialReadRow[]) {
  const current = await query(session.tx, `SELECT id,asin,parent_asin AS parentAsin,store_name AS storeName,product_name AS title,operator FROM (
    SELECT id,asin,parent_asin,store_name,product_name,operator,
      ROW_NUMBER() OVER(PARTITION BY BINARY asin ORDER BY import_id DESC,report_date DESC,id DESC) AS rn
    FROM saihu_product_weekly WHERE workspaceId=? AND report_level<>'parent' AND asin IS NOT NULL
      AND UPPER(TRIM(site)) IN ('US','美国','美国站','亚马逊美国站','AMAZON.COM')
    ) latest WHERE rn=1 ORDER BY id LIMIT 20001`,[session.identity.workspaceId]);
  checkCount(current,20000);
  const bindings:CurrentUsFinancialBinding[] = current.map(row => {
    if (!positiveId(row.id) || typeof row.asin!=="string" || typeof row.storeName!=="string" || typeof row.parentAsin!=="string" && row.parentAsin!==null) throw new InvalidSource();
    return {asin:row.asin,parentAsin:row.parentAsin || row.asin,storeName:row.storeName,country:"US",source:{table:"saihu_product_weekly",rowId:row.id}};
  });
  const resolved = resolveNorthAmericaFinancialBindings(bindings,history);
  const members = await query(session.tx, `SELECT u.id,u.name,u.role FROM users u JOIN workspace_memberships m ON m.userId=u.id
    WHERE m.workspaceId=? AND m.status='active' AND u.status='active' AND u.defaultWorkspaceId=? ORDER BY u.id LIMIT 10001 FOR SHARE`,[session.identity.workspaceId,session.identity.workspaceId]);
  checkCount(members,10000);
  if (new Set(members.map(row=>row.id)).size!==members.length || members.some(row=>!positiveId(row.id) || typeof row.name!=="string" && row.name!==null)) throw new InvalidSource();
  const active = new Set(members.map(row=>Number(row.id)));
  const mappings = await query(session.tx, `SELECT id,workspaceId,external_name AS externalName,source_type AS sourceType,system_user_id AS userId,is_confirmed AS confirmed
    FROM operator_name_mappings WHERE workspaceId=? AND is_confirmed=1 AND source_type IN ('saihu','all') ORDER BY id LIMIT 10001 FOR SHARE`,[session.identity.workspaceId]);
  checkCount(mappings,10000);
  if (mappings.some(row=>!positiveId(row.id)||row.workspaceId!==session.identity.workspaceId||row.confirmed!==1||typeof row.externalName!=="string"||!["saihu","all"].includes(String(row.sourceType)))) throw new InvalidSource();
  const currentById = new Map(current.map(row=>[row.id,row]));
  const historyByRef = new Map(history.map(row=>[`${row.batchId}:${row.rowIndex}`,row]));
  const parentSources = new Map<string,Array<{operator:string|null;title:string;kind:"saihu"|"unknown"}>>();
  for (const binding of resolved) {
    const origin = binding.source.table==="saihu_product_weekly" ? currentById.get(binding.source.rowId) : historyByRef.get(`${binding.source.batchId}:${binding.source.rowIndex}`);
    if (!origin) throw new InvalidSource();
    const key = parentKey(binding.storeName,binding.parentAsin), values=parentSources.get(key)??[];
    values.push({operator:typeof origin.operator==="string"?origin.operator:null,title:typeof origin.title==="string"?origin.title:binding.parentAsin,
      kind:binding.source.table==="saihu_product_weekly" || "raw" in origin && (origin as MonthlyFinancialReadRow).raw.source==="sellfox_monthly_api" ? "saihu":"unknown"});
    parentSources.set(key,values);
  }
  const owners:NorthAmericaBoardOwner[]=[];
  for (const [key,sources] of parentSources) {
    const [storeName,parentAsin]=JSON.parse(key) as [string,string];
    let ownerIds:number[]=[];
    {
      const sets = sources.map(source=>{
        const names=splitExternalOperatorNames(source.operator);if (!names.length) return null;
        const ids=names.map(name=>{
          const found=selectSaihuOwnerMappings((source.kind === "saihu" ? mappings : mappings.filter(row=>row.sourceType==="all")) as any[],name);
          if (!found.length||found.some(row=>!positiveId(row.userId)||!active.has(row.userId))) return null;
          const unique=[...new Set(found.map(row=>Number(row.userId)))];return unique.length===1?unique[0]:null;
        });
        return ids.some(value=>value===null)?null:[...new Set(ids as number[])].sort((a,b)=>a-b);
      });
      if (sets.every(value=>value!==null)&&new Set(sets.map(value=>JSON.stringify(value))).size===1) ownerIds=sets[0]!;
    }
    owners.push({storeName,parentAsin,title:sources[0].title,ownerIds});
  }
  return {bindings:resolved,owners,members:members.map(row=>({id:Number(row.id),name:typeof row.name==="string"&&row.name.trim()?row.name.trim():`成员 #${row.id}`}))};
}
/** Only current explicitly confirmed co-owners establish partner visibility. */
export function filterNorthAmericaBoardAccess(session:Pick<Session,"identity"|"manager">, source:Awaited<ReturnType<typeof readNorthAmericaOwnership>>, rows:MonthlyFinancialReadRow[], operatorId?:number, month?:string) {
  const partners=new Set([session.identity.userId]);
  for (const owner of source.owners) if (owner.ownerIds.includes(session.identity.userId)) owner.ownerIds.forEach(id=>partners.add(id));
  if (operatorId!==undefined&&(!source.members.some(member=>member.id===operatorId)||!session.manager&&!partners.has(operatorId))) throw new Error("NA_BOARD_OPERATOR_DENIED");
  const visible=source.owners.filter(owner=>(session.manager||owner.ownerIds.some(id=>partners.has(id)))&&(operatorId===undefined||owner.ownerIds.includes(operatorId)));
  const allowed=new Set(visible.map(owner=>parentKey(owner.storeName,owner.parentAsin)));
  const bindingByAsin=new Map(source.bindings.map(binding=>[binding.asin,binding]));
  const filtered=rows.filter(row=>{
    if (!row.asin) return session.manager&&operatorId===undefined;
    const binding=bindingByAsin.get(row.asin);
    // Managers see unresolved source as an error, never silently omit it.
    if (!binding) return session.manager&&operatorId===undefined;
    return allowed.has(parentKey(binding.storeName,binding.parentAsin));
  });
  // Available months come from the authorized rows only; no unseen product metadata leaves this layer.
  return {payload:buildNorthAmericaBoard(filtered,source.bindings,visible,month),
    operators:source.members.filter(member=>session.manager||partners.has(member.id)),canViewAll:session.manager};
}
