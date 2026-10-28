import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { NorthAmericaBoardPayloadSchema, northAmericaProductKey, type NorthAmericaBoardPayload } from "../../../shared/northAmericaBoard";
import { positiveId, query, type Session } from "./monthlyBoardReadCore";
import { readNorthAmericaFinancialSources, readNorthAmericaOwnership } from "./northAmericaBoardSources";
import { buildNorthAmericaBoard } from "../../../shared/northAmericaBoard";

const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
export const NORTH_BOARD_ARCHIVE_LIMIT=12*1024*1024;
export async function writeNorthBoardSql(session:Session,text:string,values:unknown[]) {
  const parts=text.split("?");if(parts.length!==values.length+1)throw new Error("NA_ARCHIVE_SQL");
  const result=await session.tx.execute(sql.join(parts.flatMap((part,index)=>index<values.length?[sql.raw(part),sql`${values[index]}`]:[sql.raw(part)]),sql.raw("")));
  if(!Array.isArray(result)||!result[0]||result[0].warningStatus!==0)throw new Error("NA_ARCHIVE_WRITE");
  return result[0] as {affectedRows:number;insertId:number};
}
/** Runs only inside the successfully confirmed monthly import transaction, or
 * the explicitly invoked one-time deployment initialization transaction. */
export async function captureNorthAmericaBoard(session:Session) {
  if(!session.manager)throw new Error("NA_ARCHIVE_CAPTURE_DENIED");
  const locked=await query(session.tx,"SELECT id FROM workspaces WHERE id=? FOR UPDATE",[session.identity.workspaceId]);
  if(locked.length!==1||locked[0].id!==session.identity.workspaceId)throw new Error("NA_ARCHIVE_WORKSPACE");
  const source=await readNorthAmericaFinancialSources(session), ownership=await readNorthAmericaOwnership(session,source.rows);
  const payload=buildNorthAmericaBoard(source.rows,ownership.bindings,ownership.owners);
  if(!payload)return null;
  const text=JSON.stringify(payload);if(Buffer.byteLength(text)>NORTH_BOARD_ARCHIVE_LIMIT)throw new Error("NA_ARCHIVE_LIMIT");
  const latest=await query(session.tx,"SELECT id,month FROM ops_north_america_editions WHERE workspace_id=? ORDER BY month DESC LIMIT 1 FOR UPDATE",[session.identity.workspaceId]);
  if(latest[0]&&String(latest[0].month)>payload.month)throw new Error("NA_ARCHIVE_MONTH_REGRESSION");
  await writeNorthBoardSql(session,"UPDATE ops_north_america_editions SET archived_at=CURRENT_TIMESTAMP(3) WHERE workspace_id=? AND month<? AND archived_at IS NULL",[session.identity.workspaceId,payload.month]);
  await writeNorthBoardSql(session,`INSERT INTO ops_north_america_editions(workspace_id,month,payload,payload_hash) VALUES (?,?,?,?) AS incoming
    ON DUPLICATE KEY UPDATE payload=IF(ops_north_america_editions.archived_at IS NULL,incoming.payload,ops_north_america_editions.payload),payload_hash=IF(ops_north_america_editions.archived_at IS NULL,incoming.payload_hash,ops_north_america_editions.payload_hash),updated_at=IF(ops_north_america_editions.archived_at IS NULL,CURRENT_TIMESTAMP(3),ops_north_america_editions.updated_at)`,[session.identity.workspaceId,payload.month,text,hash(text)]);
  const verified=await readNorthAmericaEdition(session,payload.month);
  if(!verified||JSON.stringify(verified.payload)!==text)throw new Error("NA_ARCHIVE_READBACK");
  return verified.id;
}
export async function northAmericaHistory(session:Session) {
  const rows=await query(session.tx,"SELECT id,month,DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s') AS updatedAt,archived_at IS NOT NULL AS archived FROM ops_north_america_editions WHERE workspace_id=? ORDER BY month DESC LIMIT 1201",[session.identity.workspaceId]);
  if(rows.length>1200||rows.some(row=>!positiveId(row.id)||typeof row.month!=="string"||!/^\d{4}-(0[1-9]|1[0-2])$/u.test(row.month)||![0,1].includes(Number(row.archived))))throw new Error("NA_ARCHIVE_HISTORY");
  return rows.map(row=>({id:Number(row.id),month:String(row.month),updatedAt:String(row.updatedAt),archived:!!row.archived}));
}
export async function readNorthAmericaEdition(session:Session,month:string) {
  const rows=await query(session.tx,`SELECT id,month,payload_hash AS payloadHash,archived_at IS NOT NULL AS archived,
    IF(OCTET_LENGTH(payload)<=${NORTH_BOARD_ARCHIVE_LIMIT},payload,NULL) AS payload
    FROM ops_north_america_editions WHERE workspace_id=? AND month=? LIMIT 2 FOR SHARE`,[session.identity.workspaceId,month]);
  if(!rows.length)return null;
  const row=rows[0];if(rows.length!==1||!positiveId(row.id)||typeof row.payload!=="string"||hash(row.payload)!==row.payloadHash)throw new Error("NA_ARCHIVE_INVALID");
  const payload=NorthAmericaBoardPayloadSchema.parse(JSON.parse(row.payload));if(payload.month!==month)throw new Error("NA_ARCHIVE_MONTH");
  return {id:row.id,archived:!!row.archived,payload};
}
/** Frozen owner annotations never grant access to a historical product. */
export function filterNorthAmericaEdition(payload:NorthAmericaBoardPayload,session:Pick<Session,"identity"|"manager">,ownership:Awaited<ReturnType<typeof readNorthAmericaOwnership>>,operatorId?:number) {
  const partners=new Set([session.identity.userId]);
  for(const owner of ownership.owners)if(owner.ownerIds.includes(session.identity.userId))owner.ownerIds.forEach(id=>partners.add(id));
  if(operatorId!==undefined&&(!ownership.members.some(member=>member.id===operatorId)||!session.manager&&!partners.has(operatorId)))throw new Error("NA_BOARD_OPERATOR_DENIED");
  const current=new Map(ownership.owners.map(owner=>[northAmericaProductKey({storeName:owner.storeName,asin:owner.parentAsin}),owner]));
  const products=payload.products.filter(product=>{
    const owner=current.get(northAmericaProductKey(product));
    return (session.manager||!!owner?.ownerIds.some(id=>partners.has(id)))&&(operatorId===undefined||!!owner?.ownerIds.includes(operatorId));
  }).map(product=>({...product,ownerIds:current.get(northAmericaProductKey(product))?.ownerIds??[]}));
  return {...payload,products,unallocated:session.manager&&operatorId===undefined?payload.unallocated:{}};
}
const number=z.number().finite();
const legacyMonth=z.object({profit:number,qty:number,sales:number,margin:number.nullable()});
const legacyChild=z.object({asin:z.string(),title:z.string(),months:z.record(z.string(),legacyMonth)});
const legacyRates=z.object({sales:number,salesAmount:number,profit:number,returns:number,refunds:number,returnRate:number.nullable(),refundRate:number.nullable()});
const legacyFinancial=z.object({qty:number,sales:number,profit:number,margin:number.nullable(),purchase:number,freight:number,cash:number});
const legacyProductChild=z.object({asin:z.string(),title:z.string(),financial:legacyFinancial.nullable(),rates:z.object({month:legacyRates,quarter:legacyRates,total:legacyRates})});
const legacyPayloadSchema=z.object({version:z.literal(1),month:z.string(),previousMonth:z.string(),months:z.array(z.string()),availableMonths:z.array(z.string()),
  products:z.array(legacyChild.extend({children:z.array(legacyChild)})),
  productBoard:z.object({version:z.literal(3),source:z.literal("monthly-financial"),month:z.string(),end:z.string(),periods:z.record(z.string(),z.object({start:z.string(),end:z.string(),months:number,expectedMonths:number})),
    products:z.array(legacyProductChild.extend({children:z.array(legacyProductChild)}))}).optional()});
export type LegacyNorthAmericaSnapshot=z.infer<typeof legacyPayloadSchema>;
export async function legacyNorthAmericaHistory(session:Session) {
  const rows=await query(session.tx,"SELECT id,month FROM ops_profit_board_editions WHERE workspace_id=? ORDER BY month DESC LIMIT 1201",[session.identity.workspaceId]);
  if(rows.length>1200||rows.some(row=>!positiveId(row.id)||typeof row.month!=="string"||!/^\d{4}-(0[1-9]|1[0-2])$/u.test(row.month)))throw new Error("NA_LEGACY_HISTORY");
  return rows.map(row=>({id:Number(row.id),month:String(row.month)}));
}
export async function readLegacyNorthAmericaEdition(session:Session,editionId:number,ownership:Awaited<ReturnType<typeof readNorthAmericaOwnership>>,operatorId?:number) {
  const rows=await query(session.tx,`SELECT id,month,IF(OCTET_LENGTH(payload)<=${NORTH_BOARD_ARCHIVE_LIMIT},payload,NULL) AS payload FROM ops_profit_board_editions WHERE workspace_id=? AND id=? LIMIT 2 FOR SHARE`,[session.identity.workspaceId,editionId]);
  if(rows.length!==1||typeof rows[0].payload!=="string")throw new Error("NA_LEGACY_MISSING");
  const payload=legacyPayloadSchema.parse(JSON.parse(rows[0].payload));if(payload.month!==rows[0].month)throw new Error("NA_LEGACY_MONTH");
  const partners=new Set([session.identity.userId]);for(const owner of ownership.owners)if(owner.ownerIds.includes(session.identity.userId))owner.ownerIds.forEach(id=>partners.add(id));
  if(operatorId!==undefined&&(!ownership.members.some(member=>member.id===operatorId)||!session.manager&&!partners.has(operatorId)))throw new Error("NA_BOARD_OPERATOR_DENIED");
  const allowed=(asin:string)=>{
    const owners=ownership.owners.filter(owner=>owner.parentAsin===asin);
    return (session.manager||owners.length===1&&owners[0].ownerIds.some(id=>partners.has(id)))&&(operatorId===undefined||owners.length===1&&owners[0].ownerIds.includes(operatorId));
  };
  const products=payload.products.filter(product=>allowed(product.asin)),visible=new Set(products.map(product=>product.asin));
  const notes=await query(session.tx,"SELECT parent_asin AS asin,note FROM ops_profit_board_notes WHERE workspace_id=? AND edition_id=?",[session.identity.workspaceId,editionId]);
  return {payload:{...payload,products,productBoard:payload.productBoard?{...payload.productBoard,products:payload.productBoard.products.filter(product=>allowed(product.asin))}:undefined},
    notes:notes.filter(note=>visible.has(String(note.asin))).map(note=>({asin:String(note.asin),note:String(note.note)}))};
}
